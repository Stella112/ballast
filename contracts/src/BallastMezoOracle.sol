// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IPriceFeed} from "../interfaces/IMezo.sol";

/// @title BallastMezoOracle
/// @notice Morpho Blue oracle for a market with MUSD collateral and BTC (18 decimals) as the loan asset.
///         Morpho expects the price of 1 unit of collateral quoted in units of the loan asset, scaled by 1e36.
///         1 MUSD = 1 / P BTC where P = Mezo PriceFeed.fetchPrice() (MUSD per BTC, 1e18). Both tokens have 18
///         decimals, so price = 1e36 * 1e18 / P. Reverts if Mezo's feed reverts (e.g. stale), which pauses
///         borrowing and liquidation rather than using a bad price.
contract BallastMezoOracle {
    IPriceFeed public immutable priceFeed;

    error ZeroPrice();

    constructor(address priceFeed_) {
        priceFeed = IPriceFeed(priceFeed_);
    }

    function price() external view returns (uint256) {
        uint256 p = priceFeed.fetchPrice();
        if (p == 0) revert ZeroPrice();
        return 1e54 / p;
    }
}
