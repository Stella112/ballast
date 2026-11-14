// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IBorrowerOperations, ITroveManager, IBorrowerOperationsSignatures} from "../interfaces/IMezo.sol";

/// @title BallastRepaymentAdapter
/// @notice Connects Ballast payments to Mezo loans that are NOT owned by a Ballast account (ordinary
///         wallet troves), using Mezo's own one-off signed repayment (`repayMUSDWithSignature`).
///         It also exposes the repayment headroom of any Mezo trove — wallet or Ballast account — so
///         integrators can quote both kinds of repayment from one place.
///
///         Each signed repayment is ONE-OFF: Mezo binds the borrower's signature to an exact amount, the
///         borrower's current Mezo nonce and a deadline. It is not a standing permission. Signing any other
///         Mezo signed operation first advances the nonce and invalidates it.
///
///         The adapter holds no funds between transactions, has no owner and no admin functions.
/// @dev UNAUDITED. Mezo testnet only.
contract BallastRepaymentAdapter is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint8 private constant TROVE_ACTIVE = 1;

    bytes32 public constant DIRECT_INVOICE_TYPEHASH = keccak256(
        "DirectInvoice(address merchant,bytes32 invoiceId,uint256 amount,uint256 repayAmount,uint256 expiry)"
    );

    /// @notice An invoice from a merchant whose Mezo loan is held directly by their wallet.
    /// @param repayAmount exact part of `amount` that repays the merchant's Mezo loan (0 = no repayment);
    ///        the remainder is paid to the merchant.
    struct DirectInvoice {
        address merchant;
        bytes32 invoiceId;
        uint256 amount;
        uint256 repayAmount;
        uint256 expiry;
    }

    /// @notice A Mezo RepayMUSD signature from the borrower (see IBorrowerOperationsSignatures).
    struct MezoRepaySig {
        uint256 deadline;
        bytes signature;
        address upperHint;
        address lowerHint;
    }

    IBorrowerOperationsSignatures public immutable signatures;
    IBorrowerOperations public immutable borrowerOperations;
    ITroveManager public immutable troveManager;
    IERC20 public immutable musd;

    /// @notice keccak256(merchant, invoiceId) => paid
    mapping(bytes32 => bool) public invoicePaid;

    event SignedRepayment(address indexed borrower, address indexed funder, uint256 amount, uint256 debtBefore, uint256 debtAfter);
    event DirectInvoicePaid(
        address indexed merchant,
        bytes32 indexed invoiceId,
        address indexed payer,
        uint256 amount,
        uint256 repaid,
        uint256 toMerchant,
        uint256 debtBefore,
        uint256 debtAfter
    );

    error ZeroAmount();
    error ZeroAddress();
    error BadWiring();
    error NoActiveTrove(address borrower);
    error RepayExceedsHeadroom(uint256 requested, uint256 maxRepayable);
    error InvalidRepayAmount();
    error InvoiceExpired();
    error InvoiceAlreadyPaid();
    error InvalidInvoiceSignature();
    error DebtDidNotDecrease();
    error UnexpectedMUSDMovement(uint256 expected, uint256 actual);

    constructor(address signatures_, address troveManager_, address musd_) EIP712("BallastRepaymentAdapter", "1") {
        if (signatures_ == address(0) || troveManager_ == address(0) || musd_ == address(0)) revert ZeroAddress();
        if (signatures_.code.length == 0 || troveManager_.code.length == 0 || musd_.code.length == 0) revert BadWiring();
        signatures = IBorrowerOperationsSignatures(signatures_);
        borrowerOperations = IBorrowerOperations(IBorrowerOperationsSignatures(signatures_).borrowerOperations());
        troveManager = ITroveManager(troveManager_);
        musd = IERC20(musd_);
    }

    // ------------------------------------------------------------------
    // Views (work for wallet troves and Ballast-account troves alike)
    // ------------------------------------------------------------------

    /// @notice Largest repayment Mezo accepts for `borrower` right now without closing:
    ///         (totalDebt - gasCompensation) - minNetDebt. 0 if no active trove.
    function maxRepayable(address borrower) public view returns (uint256) {
        if (troveManager.getTroveStatus(borrower) != TROVE_ACTIVE) return 0;
        uint256 debt = troveManager.getTroveDebt(borrower);
        uint256 floor = borrowerOperations.MUSD_GAS_COMPENSATION() + borrowerOperations.minNetDebt();
        return debt > floor ? debt - floor : 0;
    }

    /// @notice The borrower's current Mezo signature nonce (what a new RepayMUSD signature must use).
    function mezoNonce(address borrower) external view returns (uint256) {
        return signatures.getNonce(borrower);
    }

    function invoiceDigest(DirectInvoice calldata inv) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(DIRECT_INVOICE_TYPEHASH, inv.merchant, inv.invoiceId, inv.amount, inv.repayAmount, inv.expiry)
            )
        );
    }

    function invoiceKey(address merchant, bytes32 invoiceId) public pure returns (bytes32) {
        return keccak256(abi.encode(merchant, invoiceId));
    }

    // ------------------------------------------------------------------
    // Actions
    // ------------------------------------------------------------------

    /// @notice Repay `amount` of `borrower`'s own Mezo loan with MUSD from msg.sender, authorised by the
    ///         borrower's one-off Mezo RepayMUSD signature. Needs an MUSD allowance of `amount` to this adapter.
    function repayWithSignature(address borrower, uint256 amount, MezoRepaySig calldata sig)
        external
        nonReentrant
        returns (uint256 debtAfter)
    {
        if (borrower == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        musd.safeTransferFrom(msg.sender, address(this), amount);
        uint256 debtBefore;
        (debtBefore, debtAfter) = _signedRepay(borrower, amount, sig);
        emit SignedRepayment(borrower, msg.sender, amount, debtBefore, debtAfter);
    }

    /// @notice Pay a merchant-signed DirectInvoice. In ONE transaction: pulls `amount` MUSD from the payer,
    ///         repays exactly `repayAmount` of the merchant's Mezo loan using the merchant's one-off Mezo
    ///         signature, and sends the rest to the merchant. Any failure reverts the whole payment.
    function payDirectInvoice(DirectInvoice calldata inv, bytes calldata invoiceSig, MezoRepaySig calldata repaySig)
        external
        nonReentrant
    {
        if (inv.merchant == address(0)) revert ZeroAddress();
        if (inv.amount == 0) revert ZeroAmount();
        if (inv.repayAmount > inv.amount) revert InvalidRepayAmount();
        if (block.timestamp > inv.expiry) revert InvoiceExpired();
        bytes32 key = invoiceKey(inv.merchant, inv.invoiceId);
        if (invoicePaid[key]) revert InvoiceAlreadyPaid();
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(invoiceDigest(inv), invoiceSig);
        if (err != ECDSA.RecoverError.NoError || signer != inv.merchant) revert InvalidInvoiceSignature();

        invoicePaid[key] = true; // effects before interactions

        musd.safeTransferFrom(msg.sender, address(this), inv.amount);
        uint256 debtBefore;
        uint256 debtAfter;
        if (inv.repayAmount > 0) {
            (debtBefore, debtAfter) = _signedRepay(inv.merchant, inv.repayAmount, repaySig);
        } else {
            debtBefore = debtAfter = troveManager.getTroveDebt(inv.merchant);
        }
        uint256 toMerchant = inv.amount - inv.repayAmount;
        if (toMerchant > 0) musd.safeTransfer(inv.merchant, toMerchant);

        emit DirectInvoicePaid(
            inv.merchant, inv.invoiceId, msg.sender, inv.amount, inv.repayAmount, toMerchant, debtBefore, debtAfter
        );
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    /// @dev Mezo burns exactly `amount` MUSD from this adapter (the caller). Checks headroom first for a clear
    ///      error, then verifies the debt fell and that exactly `amount` MUSD left the adapter.
    function _signedRepay(address borrower, uint256 amount, MezoRepaySig calldata sig)
        internal
        returns (uint256 debtBefore, uint256 debtAfter)
    {
        if (troveManager.getTroveStatus(borrower) != TROVE_ACTIVE) revert NoActiveTrove(borrower);
        uint256 headroom = maxRepayable(borrower);
        if (amount > headroom) revert RepayExceedsHeadroom(amount, headroom);

        uint256 balBefore = musd.balanceOf(address(this));
        debtBefore = troveManager.getTroveDebt(borrower);
        signatures.repayMUSDWithSignature(amount, sig.upperHint, sig.lowerHint, borrower, sig.signature, sig.deadline);
        debtAfter = troveManager.getTroveDebt(borrower);
        uint256 balAfter = musd.balanceOf(address(this));

        if (debtAfter >= debtBefore) revert DebtDidNotDecrease();
        if (balBefore - balAfter != amount) revert UnexpectedMUSDMovement(amount, balBefore - balAfter);
    }
}
