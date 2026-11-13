// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BallastAccount} from "./BallastAccount.sol";
import {BallastAccountNFT} from "./BallastAccountNFT.sol";

interface IRouterFactoryCheck {
    function factory() external view returns (address);
    function musd() external view returns (address);
}

/// @title BallastFactory
/// @notice Deploys one BallastAccount per NFT. No owner, no admin, no upgrade path.
/// @dev Deployment order (script): router(factory=predicted), nft(factory=predicted), factory.
///      The constructor rejects mismatched wiring.
contract BallastFactory {
    BallastAccountNFT public immutable nft;
    address public immutable router;
    address public immutable borrowerOperations;
    address public immutable troveManager;
    address public immutable musd;

    uint256 public nextTokenId = 1;
    mapping(uint256 => address) public accountOf;
    mapping(address => uint256) public tokenIdOf;

    event AccountCreated(uint256 indexed tokenId, address indexed account, address indexed owner);

    error BadWiring();

    constructor(address nft_, address router_, address borrowerOperations_, address troveManager_, address musd_) {
        if (BallastAccountNFT(nft_).factory() != address(this)) revert BadWiring();
        if (IRouterFactoryCheck(router_).factory() != address(this)) revert BadWiring();
        if (IRouterFactoryCheck(router_).musd() != musd_) revert BadWiring();
        if (borrowerOperations_.code.length == 0 || troveManager_.code.length == 0 || musd_.code.length == 0) {
            revert BadWiring();
        }
        nft = BallastAccountNFT(nft_);
        router = router_;
        borrowerOperations = borrowerOperations_;
        troveManager = troveManager_;
        musd = musd_;
    }

    /// @notice Create a Ballast account controlled by an NFT minted to msg.sender.
    function createAccount() external returns (uint256 tokenId, address account) {
        tokenId = nextTokenId++;
        account = address(new BallastAccount(address(nft), tokenId, router, borrowerOperations, troveManager, musd));
        accountOf[tokenId] = account;
        tokenIdOf[account] = tokenId;
        nft.mint(msg.sender, tokenId);
        emit AccountCreated(tokenId, account, msg.sender);
    }
}
