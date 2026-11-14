// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

interface IBallastFactoryView {
    function accountOf(uint256 tokenId) external view returns (address);
}

interface IBallastAccountHook {
    function controllerChanged(address newController) external;
}

/// @title BallastAccountNFT
/// @notice ERC-721 whose current holder (ownerOf) controls the matching BallastAccount.
/// @dev (v2) The token is transferable at any time: whoever holds it controls the whole account, including an open
///      loan, its collateral, MUSD, reserve and hedge module. Buying an account means taking on its debt.
///      - Only the factory can mint. There is no burn path.
///      - Tokens can only be sent to addresses without code (EOAs), so control cannot be stranded in a contract
///        that cannot act on it (marketplace escrow contracts are therefore not supported yet).
///      - On transfer the account clears its custom payout address so income follows the new holder.
contract BallastAccountNFT is ERC721 {
    address public immutable factory;

    error OnlyFactory();
    error RecipientMustBeEOA(address to);

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
            if (to.code.length != 0) revert RecipientMustBeEOA(to);
            from = super._update(to, tokenId, auth);
            IBallastAccountHook(IBallastFactoryView(factory).accountOf(tokenId)).controllerChanged(to);
            return from;
        }
        return super._update(to, tokenId, auth);
    }
}
