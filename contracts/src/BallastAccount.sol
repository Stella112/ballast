// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IBorrowerOperations, ITroveManager} from "../interfaces/IMezo.sol";

/// @title BallastAccount
/// @notice A contract account that owns one Mezo trove. Control = current holder of the Ballast NFT.
///         The router may only (a) credit the hedge reserve and (b) repay this account's own trove,
///         using MUSD it delivered in the same transaction. It can never move collateral or free funds.
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

    // ---- policy (controller-owned) ----
    struct Policy {
        uint16 repayBps; // share of each invoice payment used to repay the trove
        uint16 reserveBps; // share kept in this account as an uninvested MUSD "hedge reserve"
        bool paused; // when true the repay share is paid out as spendable instead
        address payout; // spendable recipient; address(0) = current controller
    }

    Policy internal _policy;

    /// @notice MUSD held in this account that is earmarked as reserve (not spendable via withdrawMUSD).
    uint256 public hedgeReserve;

    // ---- events ----
    event PolicyUpdated(uint16 repayBps, uint16 reserveBps, bool paused, address payout);
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
        address musd_
    ) {
        if (
            nft_ == address(0) || router_ == address(0) || borrowerOperations_ == address(0)
                || troveManager_ == address(0) || musd_ == address(0)
        ) revert ZeroAddress();
        factory = msg.sender;
        nft = IERC721(nft_);
        tokenId = tokenId_;
        router = router_;
        borrowerOperations = IBorrowerOperations(borrowerOperations_);
        troveManager = ITroveManager(troveManager_);
        musd = IERC20(musd_);
        // Conservative default ("Keep my BTC" preset is applied by the UI); payback starts paused.
        _policy = Policy({repayBps: 0, reserveBps: 0, paused: true, payout: address(0)});
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

    /// @notice MUSD in this account not earmarked as reserve.
    function freeMUSD() public view returns (uint256) {
        uint256 bal = musd.balanceOf(address(this));
        return bal > hedgeReserve ? bal - hedgeReserve : 0;
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
        borrowerOperations.openTrove{value: msg.value}(debtAmount, upperHint, lowerHint);
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
        borrowerOperations.withdrawMUSD(amount, upperHint, lowerHint);
        emit Borrowed(amount);
    }

    /// @notice Repay from this account's free (non-reserve) MUSD.
    function repay(uint256 amount, address upperHint, address lowerHint) external onlyController nonReentrant {
        if (amount > freeMUSD()) revert InsufficientFreeMUSD(amount, freeMUSD());
        _repay(amount, upperHint, lowerHint, bytes32(0));
    }

    /// @notice Close the trove. Needs (totalDebt - 200 MUSD gas comp) free MUSD in this account.
    ///         Collateral returns to this account as native BTC.
    function closeTrove() external onlyController nonReentrant {
        if (!hasActiveTrove()) revert NoActiveTrove();
        borrowerOperations.closeTrove();
        if (musd.balanceOf(address(this)) < hedgeReserve) revert ReserveInvariantBroken();
        emit TroveClosed();
    }

    /// @notice Claim surplus collateral after redemption/liquidation into this account.
    function claimCollateral() external onlyController nonReentrant {
        borrowerOperations.claimCollateral();
    }

    // ------------------------------------------------------------------
    // Controller: funds & policy
    // ------------------------------------------------------------------
    function setPolicy(uint16 repayBps, uint16 reserveBps, bool paused, address payout) external onlyController {
        if (uint256(repayBps) + uint256(reserveBps) > BPS) revert InvalidBps();
        _policy = Policy({repayBps: repayBps, reserveBps: reserveBps, paused: paused, payout: payout});
        emit PolicyUpdated(repayBps, reserveBps, paused, payout);
    }

    function withdrawMUSD(address to, uint256 amount) external onlyController nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 free = freeMUSD();
        if (amount > free) revert InsufficientFreeMUSD(amount, free);
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
    // Router: the ONLY entry point it has. MUSD for both legs was already
    // transferred into this account by the router in the same transaction.
    // ------------------------------------------------------------------
    function applyPayment(bytes32 ref, uint256 reserveAmount, uint256 repayAmount, address upperHint, address lowerHint)
        external
        onlyRouter
        nonReentrant
    {
        if (reserveAmount > 0) {
            hedgeReserve += reserveAmount;
            emit ReserveCredited(ref, reserveAmount, hedgeReserve);
        }
        if (repayAmount > 0) {
            _repay(repayAmount, upperHint, lowerHint, ref);
        }
        if (musd.balanceOf(address(this)) < hedgeReserve) revert ReserveInvariantBroken();
    }

    function _repay(uint256 amount, address upperHint, address lowerHint, bytes32 ref) internal {
        if (amount == 0) revert ZeroAmount();
        if (!hasActiveTrove()) revert NoActiveTrove();
        uint256 headroom = maxRepayable();
        if (amount > headroom) revert RepayExceedsHeadroom(amount, headroom);

        uint256 debtBefore = troveManager.getTroveDebt(address(this));
        borrowerOperations.repayMUSD(amount, upperHint, lowerHint);
        uint256 debtAfter = troveManager.getTroveDebt(address(this));
        if (debtAfter >= debtBefore) revert DebtDidNotDecrease();
        emit Repaid(msg.sender, ref, amount, debtBefore, debtAfter);
    }
}
