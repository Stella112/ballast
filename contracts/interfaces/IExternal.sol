// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// Minimal interfaces for non-Mezo-MUSD contracts Ballast calls. Each was checked against explorer-verified
// source/ABI on 2026-11-14 (see docs/VERIFICATION.md). Do not add functions without re-verifying.

/// @dev Wormhole Token Bridge ("Wrapped Token Transfers"), BridgeImplementation (solc 0.8.4), verified on
///      Mezo testnet (proxy 0xA31aa3FDb7aF7Db93d18DDA4e19F811342EDF780, Wormhole chain 50) and Base Sepolia
///      (proxy 0x86F55A04690fd7815A3D802bD587e83eA888B239, Wormhole chain 10004).
///      completeTransferWithPayload: payload-3 transfers can only be redeemed by `to` (msg.sender check),
///      emitter must be the registered bridge of the source chain, each VAA completes once.
interface IWormholeTokenBridge {
    struct TransferWithPayload {
        uint8 payloadID;
        uint256 amount;
        bytes32 tokenAddress;
        uint16 tokenChain;
        bytes32 to;
        uint16 toChain;
        bytes32 fromAddress;
        bytes payload;
    }

    function completeTransferWithPayload(bytes memory encodedVm) external returns (bytes memory);
    function parseTransferWithPayload(bytes memory encoded) external pure returns (TransferWithPayload memory);
    function wrappedAsset(uint16 tokenChainId, bytes32 tokenAddress) external view returns (address);
    function chainId() external view returns (uint16);
}

/// @dev Mezo Pools basic router (Aerodrome-style), testnet 0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9 (verified "Router").
interface IPoolsRouter {
    struct Route {
        address from;
        address to;
        bool stable;
        address factory;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function getAmountsOut(uint256 amountIn, Route[] memory routes) external view returns (uint256[] memory amounts);
}

/// @dev Morpho Blue v1.0.0 (github.com/morpho-org/morpho-blue @ 55d2d99, src/interfaces/IMorpho.sol). Not deployed on
///      Mezo testnet by Morpho; Ballast deploys this exact source (owner = Ballast deployer), see docs/DEPLOYMENTS.md.
struct MorphoMarketParams {
    address loanToken;
    address collateralToken;
    address oracle;
    address irm;
    uint256 lltv;
}

interface IMorpho {
    function supply(MorphoMarketParams memory, uint256 assets, uint256 shares, address onBehalf, bytes memory data)
        external
        returns (uint256, uint256);
    function withdraw(MorphoMarketParams memory, uint256 assets, uint256 shares, address onBehalf, address receiver)
        external
        returns (uint256, uint256);
    function borrow(MorphoMarketParams memory, uint256 assets, uint256 shares, address onBehalf, address receiver)
        external
        returns (uint256, uint256);
    function repay(MorphoMarketParams memory, uint256 assets, uint256 shares, address onBehalf, bytes memory data)
        external
        returns (uint256, uint256);
    function supplyCollateral(MorphoMarketParams memory, uint256 assets, address onBehalf, bytes memory data) external;
    function withdrawCollateral(MorphoMarketParams memory, uint256 assets, address onBehalf, address receiver) external;
    function accrueInterest(MorphoMarketParams memory) external;
    function position(bytes32 id, address user)
        external
        view
        returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral);
    function market(bytes32 id)
        external
        view
        returns (
            uint128 totalSupplyAssets,
            uint128 totalSupplyShares,
            uint128 totalBorrowAssets,
            uint128 totalBorrowShares,
            uint128 lastUpdate,
            uint128 fee
        );
    function createMarket(MorphoMarketParams memory) external;
    function enableIrm(address irm) external;
    function enableLltv(uint256 lltv) external;
}
