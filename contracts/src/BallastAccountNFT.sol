// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

interface IBallastFactoryView {
    function accountOf(uint256 tokenId) external view returns (address);
}

interface IBallastAccountHook {
    function controllerChanged(address newController) external;
}

/// @title BallastAccountNFT
/// @notice ERC-721 whose current holder (ownerOf) controls the matching BallastAccount.
/// @dev (v3) The token is transferable at any time: whoever holds it controls the whole account, including an open
///      loan, its collateral, MUSD, reserve and hedge. Buying an account means taking on its debt.
///      - Only the factory can mint. There is no burn path.
///      - Wallets (addresses without code) can receive it with any transfer function.
///      - Contracts (marketplace escrows, multisigs, vaults) can receive it only through `safeTransferFrom`, which
///        requires them to implement IERC721Receiver. A plain `transferFrom` to a contract is rejected, so control
///        cannot be stranded in a contract that never expected it.
///      - On transfer the account clears its custom payout address so income follows the new holder.
contract BallastAccountNFT is ERC721 {
    address public immutable factory;

    error OnlyFactory();
    error UseSafeTransferForContracts(address to);

    bool private _inSafeTransfer;

    constructor(address factory_) ERC721("Ballast Account", "BALLAST") {
        factory = factory_;
    }

    function mint(address to, uint256 tokenId) external {
        if (msg.sender != factory) revert OnlyFactory();
        _mint(to, tokenId);
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = _ownerOf(tokenId);
        if (from != address(0)) {
            // transfer (burn is unreachable: no external path calls _update with to == 0 besides OZ's
            // transferFrom, which rejects address(0) as ERC721InvalidReceiver)
            from = super._update(to, tokenId, auth);
            IBallastAccountHook(IBallastFactoryView(factory).accountOf(tokenId)).controllerChanged(to);
            return from;
        }
        return super._update(to, tokenId, auth);
    }

    function transferFrom(address from, address to, uint256 tokenId) public override {
        if (to.code.length != 0 && !_inSafeTransfer) revert UseSafeTransferForContracts(to);
        super.transferFrom(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public override {
        _inSafeTransfer = true;
        transferFrom(from, to, tokenId);
        _inSafeTransfer = false;
        if (to.code.length != 0) {
            try IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data) returns (bytes4 r) {
                if (r != IERC721Receiver.onERC721Received.selector) revert ERC721InvalidReceiver(to);
            } catch {
                revert ERC721InvalidReceiver(to);
            }
        }
    }
}
