// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev Wormhole Native Token Transfers manager (v2.0.0). Signature checked by live simulation and a live
///      transfer on the canonical MUSD manager (see docs/VERIFICATION.md).
interface INttManager {
    function transfer(uint256 amount, uint16 recipientChain, bytes32 recipient) external payable returns (uint64);
}

/// @title BallastBaseGateway
/// @notice Deployed on Base. A payer sends MUSD here; the gateway forwards it through MUSD's own Wormhole NTT
///         bridge with the borrower's Ballast Account on Mezo as the recipient. When the MUSD lands, anyone
///         (a keeper) calls `processIncome` on the account, which applies the owner's policy.
///         The gateway holds nothing between transactions, has no owner and charges no fee.
/// @dev UNAUDITED. Testnet demo only.
contract BallastBaseGateway is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev NTT carries at most 8 decimals; MUSD has 18, so amounts must be multiples of 1e10 wei.
    uint256 public constant NTT_UNIT = 1e10;

    IERC20 public immutable musd;
    INttManager public immutable nttManager;
    uint16 public immutable mezoWormholeChainId;

    event BasePayment(
        address indexed account, bytes32 indexed paymentReference, address indexed payer, uint256 amount, uint64 nttSequence
    );

    error ZeroAmount();
    error ZeroAccount();
    error AmountHasDust(uint256 amount);
    error RefundFailed();

    constructor(address musd_, address nttManager_, uint16 mezoWormholeChainId_) {
        if (musd_ == address(0) || nttManager_ == address(0)) revert ZeroAccount();
        musd = IERC20(musd_);
        nttManager = INttManager(nttManager_);
        mezoWormholeChainId = mezoWormholeChainId_;
    }

    /// @notice Pay a Ballast Account on Mezo with MUSD held on this chain.
    /// @param account the BallastAccount contract on Mezo (the NTT recipient)
    /// @param amount MUSD in wei; must be a multiple of 1e10
    /// @param paymentReference free-form reference emitted for the merchant (not sent across the bridge)
    /// @return sequence the NTT manager's message sequence
    function pay(address account, uint256 amount, bytes32 paymentReference)
        external
        payable
        nonReentrant
        returns (uint64 sequence)
    {
        if (account == address(0)) revert ZeroAccount();
        if (amount == 0) revert ZeroAmount();
        if (amount % NTT_UNIT != 0) revert AmountHasDust(amount);

        musd.safeTransferFrom(msg.sender, address(this), amount);
        musd.forceApprove(address(nttManager), amount);
        sequence = nttManager.transfer{value: msg.value}(amount, mezoWormholeChainId, bytes32(uint256(uint160(account))));
        musd.forceApprove(address(nttManager), 0);

        // return any unused native fee and any MUSD the manager did not take
        uint256 leftover = musd.balanceOf(address(this));
        if (leftover > 0) musd.safeTransfer(msg.sender, leftover);
        if (address(this).balance > 0) {
            (bool ok,) = msg.sender.call{value: address(this).balance}("");
            if (!ok) revert RefundFailed();
        }
        emit BasePayment(account, paymentReference, msg.sender, amount, sequence);
    }

    receive() external payable {}
}
