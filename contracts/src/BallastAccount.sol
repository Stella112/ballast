// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IBorrowerOperations, ITroveManager, IPriceFeed} from "../interfaces/IMezo.sol";

/// @title BallastAccount
/// @notice (v2) A contract account that owns one Mezo trove. Control = current holder of the Ballast NFT.
///         Incoming MUSD is split by the controller's policy: repay this account's own trove (capped at Mezo's
///         minimum debt; the excess goes to the owner), hedge reserve, and the rest to the owner's payout address.
///         Two entry points apply the policy: the router (payer pushes MUSD through it) and `processIncome`,
///         which ANYONE (a keeper) may call for MUSD that arrived in the account directly. Neither can choose
///         destinations or amounts; they come from account state. Nobody but the controller can move collateral
///         or the owner's MUSD.
/// @dev UNAUDITED. Testnet demo only. See docs/SECURITY.md.
contract BallastAccount is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS = 10_000;
    uint8 internal constant TROVE_ACTIVE = 1;

    // ---- immutable wiring (set once by factory at construction) ----
    address public immutable factory;
    IERC721 public immutable nft;
    uint256 public immutable tokenId;
    address public immutable router;
    IBorrowerOperations public immutable borrowerOperations;
    ITroveManager public immutable troveManager;
    IERC20 public immutable musd;
    IPriceFeed public immutable priceFeed;

    // ---- policy (controller-owned) ----
    struct Policy {
        uint16 repayBps; // share of each invoice payment used to repay the trove
        uint16 reserveBps; // share kept in this account as an uninvested MUSD "hedge reserve"
        bool paused; // when true the repay share is paid out as spendable instead
        address payout; // spendable recipient; address(0) = current controller
        uint256 minCash; // cash buffer: while the payout address holds less MUSD than this, the repay share tops it up first
    }

    Policy internal _policy;

    /// @notice MUSD held in this account that is earmarked as reserve (not spendable via withdrawMUSD).
    uint256 public hedgeReserve;

    /// @notice MUSD in this account that belongs to the owner outright (borrowed or deposited). Withdrawable by the
    ///         controller. Anything in the balance beyond `ownerMUSD + hedgeReserve` is income not yet processed.
    uint256 public ownerMUSD;

    // ---- events ----
    event PolicyUpdated(uint16 repayBps, uint16 reserveBps, bool paused, address payout, uint256 minCash);
    /// @notice One policy application. `source` = router or keeper; icr values are Mezo collateral ratios (1e18),
    ///         0 if there is no active trove or Mezo's price feed is unavailable.
    event PaymentApplied(
        address indexed source,
        bytes32 indexed ref,
        uint256 amount,
        uint256 toOwner,
        uint256 toReserve,
        uint256 repaid,
        uint256 icrBefore,
        uint256 icrAfter
    );
    event MUSDDeposited(address indexed from, uint256 amount);
    event ControllerChanged(address indexed newController);
    event TroveOpened(uint256 collateral, uint256 debtAmount, uint256 totalDebt);
    event Repaid(address indexed source, bytes32 indexed ref, uint256 amount, uint256 debtBefore, uint256 debtAfter);
    event ReserveCredited(bytes32 indexed ref, uint256 amount, uint256 newReserve);
    event ReserveWithdrawn(address indexed to, uint256 amount);
    event MUSDWithdrawn(address indexed to, uint256 amount);
    event BTCWithdrawn(address indexed to, uint256 amount);
    event Borrowed(uint256 amount);
    event CollateralAdded(uint256 amount);
    event CollateralWithdrawn(uint256 amount);
    event TroveClosed();

    // ---- errors ----
    error NotController();
    error NotRouter();
    error NotNFT();
    error NothingToProcess();
    error InvalidBps();
    error ZeroAmount();
    error NoActiveTrove();
    error InsufficientFreeMUSD(uint256 requested, uint256 available);
    error InsufficientReserve(uint256 requested, uint256 available);
    error RepayExceedsHeadroom(uint256 requested, uint256 maxRepayable);
    error ReserveInvariantBroken();
    error DebtDidNotDecrease();
    error BTCTransferFailed();
    error ZeroAddress();
    error CannotRescueMUSD();

    constructor(
        address nft_,
        uint256 tokenId_,
        address router_,
        address borrowerOperations_,
        address troveManager_,
        address musd_,
        address priceFeed_
    ) {
        if (
            nft_ == address(0) || router_ == address(0) || borrowerOperations_ == address(0)
                || troveManager_ == address(0) || musd_ == address(0) || priceFeed_ == address(0)
        ) revert ZeroAddress();
        factory = msg.sender;
        nft = IERC721(nft_);
        tokenId = tokenId_;
        router = router_;
        borrowerOperations = IBorrowerOperations(borrowerOperations_);
        troveManager = ITroveManager(troveManager_);
        musd = IERC20(musd_);
        priceFeed = IPriceFeed(priceFeed_);
        // Conservative default ("Keep my BTC" preset is applied by the UI); payback starts paused.
        _policy = Policy({repayBps: 0, reserveBps: 0, paused: true, payout: address(0), minCash: 0});
    }

    // ------------------------------------------------------------------
    // Access control: always the CURRENT NFT holder, never a cached EOA
    // ------------------------------------------------------------------
    function controller() public view returns (address) {
        return nft.ownerOf(tokenId);
    }

    modifier onlyController() {
        if (msg.sender != controller()) revert NotController();
        _;
    }

    modifier onlyRouter() {
        if (msg.sender != router) revert NotRouter();
        _;
    }

    /// @notice Native BTC arrives from Mezo ActivePool (collateral withdrawal / close) or the controller.
    receive() external payable {}

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------
    function policy() external view returns (Policy memory) {
        return _policy;
    }

    function payoutAddress() public view returns (address) {
        address p = _policy.payout;
        return p == address(0) ? controller() : p;
    }

    function hasActiveTrove() public view returns (bool) {
        return troveManager.getTroveStatus(address(this)) == TROVE_ACTIVE;
    }

    /// @notice The owner's MUSD held here (withdrawable, usable for manual repayment).
    function freeMUSD() public view returns (uint256) {
        return ownerMUSD;
    }

    /// @notice MUSD that arrived directly (e.g. from a bridge) and has not had the policy applied yet.
    function pendingIncome() public view returns (uint256) {
        uint256 bal = musd.balanceOf(address(this));
        uint256 known = ownerMUSD + hedgeReserve;
        return bal > known ? bal - known : 0;
    }

    /// @notice Current Mezo collateral ratio (1e18 = 100%); 0 if no active trove or the price feed is unavailable.
    function currentICR() public view returns (uint256) {
        if (!hasActiveTrove()) return 0;
        try priceFeed.fetchPrice() returns (uint256 price) {
            return troveManager.getCurrentICR(address(this), price);
        } catch {
            return 0;
        }
    }

    /// @notice How `amount` of incoming MUSD is split right now. Legs always sum to `amount`.
    ///         1) policy percentages (repay share = 0 while paused),
    ///         2) cash buffer: while the payout address holds less than `minCash`, the repay share tops it up first,
    ///         3) cap: repayment never exceeds what Mezo accepts above its minimum debt (0 without an active trove);
    ///            the excess goes to the owner.
    function quoteSplit(uint256 amount) public view returns (uint256 toOwner, uint256 toReserve, uint256 repay) {
        Policy memory p = _policy;
        repay = p.paused ? 0 : (amount * p.repayBps) / BPS;
        toReserve = (amount * p.reserveBps) / BPS;
        toOwner = amount - repay - toReserve;
        if (p.minCash > 0 && repay > 0) {
            uint256 cash = musd.balanceOf(payoutAddress()) + toOwner;
            if (cash < p.minCash) {
                uint256 shift = p.minCash - cash;
                if (shift > repay) shift = repay;
                repay -= shift;
                toOwner += shift;
            }
        }
        uint256 cap = maxRepayable();
        if (repay > cap) {
            toOwner += repay - cap;
            repay = cap;
        }
    }

    /// @notice Largest repayment Mezo accepts right now without closing:
    ///         (totalDebt - gasCompensation) - minNetDebt. Exact for the current block timestamp.
    function maxRepayable() public view returns (uint256) {
        if (!hasActiveTrove()) return 0;
        uint256 debt = troveManager.getTroveDebt(address(this));
        uint256 floor = borrowerOperations.MUSD_GAS_COMPENSATION() + borrowerOperations.minNetDebt();
        return debt > floor ? debt - floor : 0;
    }

    // ------------------------------------------------------------------
    // Controller: trove lifecycle
    // ------------------------------------------------------------------

    /// @notice Open this account's Mezo trove with msg.value native BTC collateral.
    /// @param debtAmount MUSD minted to this account (Mezo adds borrowing fee + 200 MUSD gas comp to the debt).
    function openTrove(uint256 debtAmount, address upperHint, address lowerHint)
        external
        payable
        onlyController
        nonReentrant
    {
        if (msg.value == 0 || debtAmount == 0) revert ZeroAmount();
        uint256 bal0 = musd.balanceOf(address(this));
        borrowerOperations.openTrove{value: msg.value}(debtAmount, upperHint, lowerHint);
        ownerMUSD += musd.balanceOf(address(this)) - bal0;
        emit TroveOpened(msg.value, debtAmount, troveManager.getTroveDebt(address(this)));
    }

    function addCollateral(address upperHint, address lowerHint) external payable onlyController nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        borrowerOperations.addColl{value: msg.value}(upperHint, lowerHint);
        emit CollateralAdded(msg.value);
    }

    /// @notice Withdraw collateral from the trove into this account (then use withdrawBTC).
    function withdrawCollateral(uint256 amount, address upperHint, address lowerHint)
        external
        onlyController
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        borrowerOperations.withdrawColl(amount, upperHint, lowerHint);
        emit CollateralWithdrawn(amount);
    }

    /// @notice Borrow more MUSD into this account.
    function borrow(uint256 amount, address upperHint, address lowerHint) external onlyController nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 bal0 = musd.balanceOf(address(this));
        borrowerOperations.withdrawMUSD(amount, upperHint, lowerHint);
        ownerMUSD += musd.balanceOf(address(this)) - bal0;
        emit Borrowed(amount);
    }

    /// @notice Repay from the owner's MUSD held in this account.
    function repay(uint256 amount, address upperHint, address lowerHint) external onlyController nonReentrant {
        if (amount > ownerMUSD) revert InsufficientFreeMUSD(amount, ownerMUSD);
        uint256 headroom = maxRepayable();
        if (amount > headroom) revert RepayExceedsHeadroom(amount, headroom);
        ownerMUSD -= amount;
        uint256 icr0 = currentICR();
        _repay(amount, upperHint, lowerHint, bytes32(0));
        emit PaymentApplied(msg.sender, bytes32(0), amount, 0, 0, amount, icr0, currentICR());
    }

    /// @notice Add MUSD to the owner's balance here (anyone may deposit; only the controller can withdraw).
    function depositMUSD(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        musd.safeTransferFrom(msg.sender, address(this), amount);
        ownerMUSD += amount;
        emit MUSDDeposited(msg.sender, amount);
    }

    /// @notice Close the trove. Needs (totalDebt - 200 MUSD gas comp) of the owner's MUSD in this account.
    ///         Collateral returns to this account as native BTC.
    function closeTrove() external onlyController nonReentrant {
        if (!hasActiveTrove()) revert NoActiveTrove();
        uint256 bal0 = musd.balanceOf(address(this));
        borrowerOperations.closeTrove();
        uint256 burned = bal0 - musd.balanceOf(address(this));
        if (burned > ownerMUSD) revert InsufficientFreeMUSD(burned, ownerMUSD);
        ownerMUSD -= burned;
        emit TroveClosed();
    }

    /// @notice Claim surplus collateral after redemption/liquidation into this account.
    function claimCollateral() external onlyController nonReentrant {
        borrowerOperations.claimCollateral();
    }

    // ------------------------------------------------------------------
    // Controller: funds & policy
    // ------------------------------------------------------------------
    function setPolicy(uint16 repayBps, uint16 reserveBps, bool paused, address payout, uint256 minCash)
        external
        onlyController
    {
        if (uint256(repayBps) + uint256(reserveBps) > BPS) revert InvalidBps();
        if (payout == address(this)) revert ZeroAddress();
        _policy = Policy({repayBps: repayBps, reserveBps: reserveBps, paused: paused, payout: payout, minCash: minCash});
        emit PolicyUpdated(repayBps, reserveBps, paused, payout, minCash);
    }

    /// @notice Called by the NFT on every transfer: the custom payout address is cleared so income follows the
    ///         new holder (payout = controller) until they set their own. Percentages are kept.
    function controllerChanged(address newController) external {
        if (msg.sender != address(nft)) revert NotNFT();
        _policy.payout = address(0);
        emit ControllerChanged(newController);
    }

    function withdrawMUSD(address to, uint256 amount) external onlyController nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount > ownerMUSD) revert InsufficientFreeMUSD(amount, ownerMUSD);
        ownerMUSD -= amount;
        musd.safeTransfer(to, amount);
        emit MUSDWithdrawn(to, amount);
    }

    function withdrawReserve(address to, uint256 amount) external onlyController nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount > hedgeReserve) revert InsufficientReserve(amount, hedgeReserve);
        hedgeReserve -= amount;
        musd.safeTransfer(to, amount);
        emit ReserveWithdrawn(to, amount);
    }

    /// @notice Withdraw native BTC held by this account (never touches collateral locked in Mezo).
    function withdrawBTC(address to, uint256 amount) external onlyController nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert BTCTransferFailed();
        emit BTCWithdrawn(to, amount);
    }

    /// @notice Recover stray ERC-20s. MUSD is excluded: use withdrawMUSD / withdrawReserve.
    function rescueToken(address token, address to, uint256 amount) external onlyController nonReentrant {
        if (token == address(musd)) revert CannotRescueMUSD();
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
    }

    // ------------------------------------------------------------------
    // Policy application. Destinations and amounts come only from this account's state.
    // ------------------------------------------------------------------

    /// @notice Router entry point. The router has ALREADY sent `toReserve + repay` MUSD here and `toOwner` to the
    ///         payout address, using the amounts from `quoteSplit(amount)` in the same transaction.
    function applyPayment(bytes32 ref, uint256 amount, uint256 toOwner, uint256 toReserve, uint256 repayAmount, address upperHint, address lowerHint)
        external
        onlyRouter
        nonReentrant
        returns (uint256 icrBefore, uint256 icrAfter)
    {
        (icrBefore, icrAfter) = _apply(ref, toReserve, repayAmount, upperHint, lowerHint);
        emit PaymentApplied(msg.sender, ref, amount, toOwner, toReserve, repayAmount, icrBefore, icrAfter);
    }

    /// @notice Keeper entry point: ANYONE may apply the policy to MUSD that arrived here directly (for example from
    ///         a bridge). The caller chooses nothing but gas hints; the split and the destinations are the owner's.
    function processIncome(address upperHint, address lowerHint)
        external
        nonReentrant
        returns (uint256 toOwner, uint256 toReserve, uint256 repaid)
    {
        uint256 income = pendingIncome();
        if (income == 0) revert NothingToProcess();
        (toOwner, toReserve, repaid) = quoteSplit(income);
        (uint256 icr0, uint256 icr1) = _apply(bytes32(0), toReserve, repaid, upperHint, lowerHint);
        if (toOwner > 0) musd.safeTransfer(payoutAddress(), toOwner);
        emit PaymentApplied(msg.sender, bytes32(0), income, toOwner, toReserve, repaid, icr0, icr1);
    }

    function _apply(bytes32 ref, uint256 toReserve, uint256 repayAmount, address upperHint, address lowerHint)
        internal
        returns (uint256 icrBefore, uint256 icrAfter)
    {
        icrBefore = currentICR();
        if (toReserve > 0) {
            hedgeReserve += toReserve;
            emit ReserveCredited(ref, toReserve, hedgeReserve);
        }
        if (repayAmount > 0) _repay(repayAmount, upperHint, lowerHint, ref);
        if (musd.balanceOf(address(this)) < hedgeReserve + ownerMUSD) revert ReserveInvariantBroken();
        icrAfter = repayAmount > 0 ? currentICR() : icrBefore;
    }

    function _repay(uint256 amount, address upperHint, address lowerHint, bytes32 ref) internal {
        if (amount == 0) revert ZeroAmount();
        if (!hasActiveTrove()) revert NoActiveTrove();
        uint256 debtBefore = troveManager.getTroveDebt(address(this));
        borrowerOperations.repayMUSD(amount, upperHint, lowerHint);
        uint256 debtAfter = troveManager.getTroveDebt(address(this));
        if (debtAfter >= debtBefore) revert DebtDidNotDecrease();
        emit Repaid(msg.sender, ref, amount, debtBefore, debtAfter);
    }
}
