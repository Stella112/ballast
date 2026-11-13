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
    struct Policy {
        uint16 repayBps;
        uint16 reserveBps;
        bool paused;
        address payout;
    }

    function policy() external view returns (Policy memory);
    function payoutAddress() external view returns (address);
    function controller() external view returns (address);
    function applyPayment(bytes32 ref, uint256 reserveAmount, uint256 repayAmount, address upperHint, address lowerHint)
        external;
}

/// @title BallastRouter
/// @notice Pays a Ballast invoice in MUSD and atomically splits it per the merchant account's stored policy:
///         spendable -> payout address, reserve -> account (earmarked), repay -> account's own Mezo trove.
///         Invoices are EIP-712 messages signed by the account's current controller (no on-chain registry).
///         Every leg succeeds or the whole payment reverts. No fees. No admin.
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

    /// @notice Pure split math. spendable absorbs rounding dust; legs always sum to amount.
    function computeSplit(uint256 amount, uint16 repayBps, uint16 reserveBps, bool paused)
        public
        pure
        returns (uint256 spendable, uint256 reserve, uint256 repay)
    {
        repay = paused ? 0 : (amount * repayBps) / BPS;
        reserve = (amount * reserveBps) / BPS;
        spendable = amount - repay - reserve; // repayBps + reserveBps <= 10_000 enforced by account
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
        _settle(inv, acct, upperHint, lowerHint);
    }

    function _settle(Invoice calldata inv, IBallastAccount acct, address upperHint, address lowerHint) internal {
        IBallastAccount.Policy memory p = acct.policy();
        (uint256 spendable, uint256 reserve, uint256 repay) =
            computeSplit(inv.amount, p.repayBps, p.reserveBps, p.paused);
        address payout = acct.payoutAddress();

        if (spendable > 0) musd.safeTransferFrom(msg.sender, payout, spendable);
        if (reserve + repay > 0) {
            musd.safeTransferFrom(msg.sender, address(acct), reserve + repay);
            acct.applyPayment(inv.invoiceId, reserve, repay, upperHint, lowerHint);
        }

        emit InvoicePaid(
            inv.tokenId, inv.invoiceId, msg.sender, address(acct), payout, inv.amount, spendable, reserve, repay
        );
    }
}
