// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

interface IBallastFactory {
    function accountOf(uint256 tokenId) external view returns (address);
}

interface IBallastAccount {
    function payoutAddress() external view returns (address);
    function controller() external view returns (address);
    function quoteSplit(uint256 amount) external view returns (uint256 toOwner, uint256 toReserve, uint256 repay);
    function applyPayment(
        bytes32 ref,
        uint256 amount,
        uint256 toOwner,
        uint256 toReserve,
        uint256 repayAmount,
        address upperHint,
        address lowerHint
    ) external returns (uint256 icrBefore, uint256 icrAfter);
}

/// @title BallastRouter
/// @notice (v2) Routes MUSD payments to a Ballast account and splits them by that account's own policy:
///         owner share -> payout address, hedge reserve -> account (earmarked), repay -> the account's own Mezo
///         trove (capped at Mezo's minimum debt; the excess goes to the owner). Two ways to pay:
///         - `pay(accountId, amount, reference)`: open pay link / integration call for any MUSD app;
///         - `payInvoice`: an exact-amount, single-use, expiring invoice signed by the account's controller.
///         Every payment emits `Payment` with the split and the collateral ratio before and after.
///         All legs succeed or the whole payment reverts. No fees. No admin. The payer chooses no destination.
/// @dev UNAUDITED. Testnet demo only.
contract BallastRouter is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 internal constant BPS = 10_000;

    bytes32 public constant INVOICE_TYPEHASH =
        keccak256("Invoice(uint256 tokenId,bytes32 invoiceId,uint256 amount,uint256 expiry)");

    address public immutable factory;
    IERC20 public immutable musd;

    /// @notice tokenId => invoiceId => paid
    mapping(uint256 => mapping(bytes32 => bool)) public invoicePaid;

    struct Invoice {
        uint256 tokenId;
        bytes32 invoiceId;
        uint256 amount;
        uint256 expiry;
    }

    event InvoicePaid(
        uint256 indexed tokenId,
        bytes32 indexed invoiceId,
        address indexed payer,
        address account,
        address payout,
        uint256 amount,
        uint256 spendable,
        uint256 reserve,
        uint256 repaid
    );

    /// @notice Emitted for every routed payment (pay link or invoice). icr values are Mezo collateral ratios
    ///         (1e18 = 100%), 0 when the account has no active trove or Mezo's price feed is unavailable.
    event Payment(
        uint256 indexed accountId,
        bytes32 indexed reference_,
        address indexed payer,
        uint256 amount,
        uint256 toOwner,
        uint256 toReserve,
        uint256 repaid,
        uint256 icrBefore,
        uint256 icrAfter
    );

    error UnknownAccount(uint256 tokenId);
    error AlreadyPaid(bytes32 invoiceId);
    error Expired(uint256 expiry);
    error ZeroAmount();
    error BadSignature();

    constructor(address factory_, address musd_) EIP712("BallastRouter", "1") {
        factory = factory_;
        musd = IERC20(musd_);
    }

    function invoiceDigest(Invoice calldata inv) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(INVOICE_TYPEHASH, inv.tokenId, inv.invoiceId, inv.amount, inv.expiry)));
    }

    /// @notice Pure policy percentages (before the account's cash buffer and minimum-debt cap; see
    ///         BallastAccount.quoteSplit for the amounts actually applied). Legs always sum to amount.
    function computeSplit(uint256 amount, uint16 repayBps, uint16 reserveBps, bool paused)
        public
        pure
        returns (uint256 spendable, uint256 reserve, uint256 repay)
    {
        repay = paused ? 0 : (amount * repayBps) / BPS;
        reserve = (amount * reserveBps) / BPS;
        spendable = amount - repay - reserve;
    }

    /// @notice Pay `amount` MUSD to Ballast account `accountId`. The caller must have approved this router.
    ///         `reference_` is any integrator tag (order id, invoice hash, ...); it is only logged.
    function pay(uint256 accountId, uint256 amount, bytes32 reference_) external nonReentrant {
        _route(accountId, amount, reference_, address(0), address(0));
    }

    /// @notice Same as `pay`, with SortedTroves hints to save gas on the repayment.
    function payWithHints(uint256 accountId, uint256 amount, bytes32 reference_, address upperHint, address lowerHint)
        external
        nonReentrant
    {
        _route(accountId, amount, reference_, upperHint, lowerHint);
    }

    /// @notice Pay an invoice. Payer must have approved this router for `inv.amount` MUSD.
    /// @param sig controller's EIP-712 signature over the invoice (EOA or ERC-1271).
    /// @param upperHint lowerHint SortedTroves hints for the reinsertion; bad hints only cost gas.
    function payInvoice(Invoice calldata inv, bytes calldata sig, address upperHint, address lowerHint)
        external
        nonReentrant
    {
        if (inv.amount == 0) revert ZeroAmount();
        if (block.timestamp > inv.expiry) revert Expired(inv.expiry);
        if (invoicePaid[inv.tokenId][inv.invoiceId]) revert AlreadyPaid(inv.invoiceId);

        address account = IBallastFactory(factory).accountOf(inv.tokenId);
        if (account == address(0)) revert UnknownAccount(inv.tokenId);

        IBallastAccount acct = IBallastAccount(account);
        if (!SignatureChecker.isValidSignatureNow(acct.controller(), invoiceDigest(inv), sig)) revert BadSignature();

        // effects
        invoicePaid[inv.tokenId][inv.invoiceId] = true;

        // interactions — all destinations come from account state, never from calldata
        (uint256 toOwner, uint256 toReserve, uint256 repaid) =
            _route(inv.tokenId, inv.amount, inv.invoiceId, upperHint, lowerHint);
        emit InvoicePaid(
            inv.tokenId, inv.invoiceId, msg.sender, account, acct.payoutAddress(), inv.amount, toOwner, toReserve, repaid
        );
    }

    function _route(uint256 accountId, uint256 amount, bytes32 ref, address upperHint, address lowerHint)
        internal
        returns (uint256 toOwner, uint256 toReserve, uint256 repaid)
    {
        if (amount == 0) revert ZeroAmount();
        address account = IBallastFactory(factory).accountOf(accountId);
        if (account == address(0)) revert UnknownAccount(accountId);
        IBallastAccount acct = IBallastAccount(account);

        (toOwner, toReserve, repaid) = acct.quoteSplit(amount);
        if (toOwner > 0) musd.safeTransferFrom(msg.sender, acct.payoutAddress(), toOwner);
        if (toReserve + repaid > 0) musd.safeTransferFrom(msg.sender, account, toReserve + repaid);
        (uint256 icr0, uint256 icr1) = acct.applyPayment(ref, amount, toOwner, toReserve, repaid, upperHint, lowerHint);
        emit Payment(accountId, ref, msg.sender, amount, toOwner, toReserve, repaid, icr0, icr1);
    }
}
