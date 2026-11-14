// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IWormholeTokenBridge, IPoolsRouter} from "../interfaces/IExternal.sol";
import {BallastRouter} from "./BallastRouter.sol";

/// @title BallastBridgeReceiver
/// @notice Settles a Ballast invoice paid with USDC on Base Sepolia, on Mezo testnet, in ONE Mezo transaction:
///         1. redeems the customer's Wormhole Token Bridge transfer-with-payload (genuine Wormhole VAA, only this
///            contract can redeem it),
///         2. swaps the bridged USDC to MUSD in a Mezo Pools stable pool,
///         3. pays the Ballast invoice through BallastRouter (policy split + repayment of the merchant's Mezo loan),
///         4. returns any MUSD above the invoice amount to the customer's refund address on Mezo.
///         If the swap or the invoice payment fails (expired, already paid, slippage, repay over Mezo's floor),
///         the invoice is NOT paid and everything received is sent to the refund address — nothing is stranded.
///
///         Anyone may submit the VAA (it only proves the Base transfer). No owner, no admin, holds nothing
///         between transactions.
/// @dev UNAUDITED. Testnet only. The USDC→MUSD pool on Mezo testnet was created and seeded by the Ballast team
///      because none existed; see docs/DEPLOYMENTS.md.
contract BallastBridgeReceiver is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint8 public constant PAYLOAD_VERSION = 1;
    /// Minimum gas forwarded into the invoice payment so a submitter cannot force the fallback by starving it.
    uint256 public constant MIN_PAY_GAS = 2_000_000;

    /// @notice What the customer's Base transaction carries (abi-encoded in the Wormhole payload).
    struct BridgePayload {
        uint8 version;
        BallastRouter.Invoice invoice;
        bytes invoiceSig;
        address refundTo; // customer's address on Mezo for change / refunds
        uint256 minMusdOut; // slippage bound for the USDC -> MUSD swap
    }

    IWormholeTokenBridge public immutable tokenBridge;
    uint16 public immutable sourceChain; // Wormhole chain id of Base Sepolia (10004)
    bytes32 public immutable sourceToken; // USDC on Base Sepolia, left-padded
    IPoolsRouter public immutable poolsRouter;
    address public immutable poolFactory;
    IERC20 public immutable musd;
    BallastRouter public immutable ballastRouter;

    event BridgedInvoicePaid(
        bytes32 indexed vaaHash,
        uint256 indexed tokenId,
        bytes32 indexed invoiceId,
        bytes32 baseSender,
        uint256 usdcIn,
        uint256 musdOut,
        uint256 change,
        address refundTo
    );
    event BridgedPaymentRefunded(bytes32 indexed vaaHash, address indexed token, uint256 amount, address refundTo, bytes reason);

    error ZeroAddress();
    error BadPayloadVersion(uint8 version);
    error InsufficientGas();

    constructor(
        address tokenBridge_,
        uint16 sourceChain_,
        bytes32 sourceToken_,
        address poolsRouter_,
        address poolFactory_,
        address musd_,
        address ballastRouter_
    ) {
        if (
            tokenBridge_ == address(0) || poolsRouter_ == address(0) || poolFactory_ == address(0)
                || musd_ == address(0) || ballastRouter_ == address(0) || sourceToken_ == bytes32(0)
        ) revert ZeroAddress();
        tokenBridge = IWormholeTokenBridge(tokenBridge_);
        sourceChain = sourceChain_;
        sourceToken = sourceToken_;
        poolsRouter = IPoolsRouter(poolsRouter_);
        poolFactory = poolFactory_;
        musd = IERC20(musd_);
        ballastRouter = BallastRouter(ballastRouter_);
    }

    /// @notice The Mezo-side wrapped USDC (0 until the token is attested on Mezo).
    function wrappedUsdc() public view returns (address) {
        return tokenBridge.wrappedAsset(sourceChain, sourceToken);
    }

    function encodePayload(BridgePayload calldata p) external pure returns (bytes memory) {
        return abi.encode(p);
    }

    /// @notice Settle a Base Sepolia USDC payment. `upperHint`/`lowerHint` are SortedTroves hints for the
    ///         merchant's repayment (only affect gas).
    function settle(bytes calldata encodedVm, address upperHint, address lowerHint) external nonReentrant {
        bytes memory raw = tokenBridge.completeTransferWithPayload(encodedVm);
        IWormholeTokenBridge.TransferWithPayload memory t = tokenBridge.parseTransferWithPayload(raw);
        bytes32 vaaHash = keccak256(encodedVm);
        BridgePayload memory p = abi.decode(t.payload, (BridgePayload));
        if (p.version != PAYLOAD_VERSION) revert BadPayloadVersion(p.version);
        if (p.refundTo == address(0)) revert ZeroAddress();

        // Received token: wrapped foreign asset, or a Mezo-native token being returned.
        address token = t.tokenChain == tokenBridge.chainId()
            ? address(uint160(uint256(t.tokenAddress)))
            : tokenBridge.wrappedAsset(t.tokenChain, t.tokenAddress);
        uint256 received = IERC20(token).balanceOf(address(this));

        if (t.tokenChain != sourceChain || t.tokenAddress != sourceToken) {
            _refund(vaaHash, token, received, p.refundTo, "unsupported token");
            return;
        }

        // 1) swap bridged USDC -> MUSD
        IPoolsRouter.Route[] memory route = new IPoolsRouter.Route[](1);
        route[0] = IPoolsRouter.Route({from: token, to: address(musd), stable: true, factory: poolFactory});
        IERC20(token).forceApprove(address(poolsRouter), received);
        uint256 musdOut;
        try poolsRouter.swapExactTokensForTokens(received, p.minMusdOut, route, address(this), block.timestamp) returns (
            uint256[] memory amounts
        ) {
            musdOut = amounts[amounts.length - 1];
        } catch (bytes memory reason) {
            IERC20(token).forceApprove(address(poolsRouter), 0);
            _refund(vaaHash, token, received, p.refundTo, reason);
            return;
        }

        if (musdOut < p.invoice.amount) {
            _refund(vaaHash, address(musd), musdOut, p.refundTo, "swap output below invoice amount");
            return;
        }

        // 2) pay the invoice (split + Mezo repayment). Failure -> refund in MUSD; invoice stays unpaid.
        if (gasleft() < MIN_PAY_GAS) revert InsufficientGas();
        musd.forceApprove(address(ballastRouter), p.invoice.amount);
        try ballastRouter.payInvoice(p.invoice, p.invoiceSig, upperHint, lowerHint) {
            uint256 change = musdOut - p.invoice.amount;
            if (change > 0) musd.safeTransfer(p.refundTo, change);
            emit BridgedInvoicePaid(
                vaaHash, p.invoice.tokenId, p.invoice.invoiceId, t.fromAddress, received, musdOut, change, p.refundTo
            );
        } catch (bytes memory reason) {
            musd.forceApprove(address(ballastRouter), 0);
            _refund(vaaHash, address(musd), musdOut, p.refundTo, reason);
        }
    }

    function _refund(bytes32 vaaHash, address token, uint256 amount, address to, bytes memory reason) internal {
        if (amount > 0) IERC20(token).safeTransfer(to, amount);
        emit BridgedPaymentRefunded(vaaHash, token, amount, to, reason);
    }
}
