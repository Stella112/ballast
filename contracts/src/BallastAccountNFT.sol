// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

interface IBallastFactoryView {
    function accountOf(uint256 tokenId) external view returns (address);
}

interface IBallastAccountView {
    function hasActiveTrove() external view returns (bool);
}

/// @title BallastAccountNFT
/// @notice ERC-721 whose current holder (ownerOf) controls the matching BallastAccount.
/// @dev Hackathon safety restrictions (disclosed in UI and docs/SECURITY.md):
///      - Only the factory can mint. There is no burn path.
///      - A token cannot move while its account has an active Mezo trove.
///      - Tokens can only be sent to addresses without code (EOAs), so control cannot be
///        stranded in a contract that cannot act on it.
contract BallastAccountNFT is ERC721 {
    address public immutable factory;

    error OnlyFactory();
    error TransferLockedActiveTrove(uint256 tokenId);
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
            address account = IBallastFactoryView(factory).accountOf(tokenId);
            if (IBallastAccountView(account).hasActiveTrove()) revert TransferLockedActiveTrove(tokenId);
        }
        return super._update(to, tokenId, auth);
    }
}
