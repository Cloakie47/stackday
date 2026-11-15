// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IPriceAdapter} from "../interfaces/IAdapters.sol";
import {IMorphoOracle} from "../interfaces/IMorpho.sol";

interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @title ChainlinkPriceAdapter
/// @notice Reads Chainlink-style price feeds. The list of feeds is fixed at deployment. No owner.
contract ChainlinkPriceAdapter is IPriceAdapter {
    mapping(address token => address feed) public feedOf;

    error LengthMismatch();
    error NoFeed(address token);
    error BadPrice();

    constructor(address[] memory tokens, address[] memory feeds) {
        if (tokens.length != feeds.length) revert LengthMismatch();
        for (uint256 i; i < tokens.length; ++i) {
            feedOf[tokens[i]] = feeds[i];
        }
    }

    function getPrice(address token) external view returns (uint256 price, uint8 decimals, uint256 updatedAt) {
        address feed = feedOf[token];
        if (feed == address(0)) revert NoFeed(token);
        int256 answer;
        (, answer,, updatedAt,) = IAggregatorV3(feed).latestRoundData();
        if (answer <= 0) revert BadPrice();
        return (uint256(answer), IAggregatorV3(feed).decimals(), updatedAt);
    }
}

/// @title FeedOracle
/// @notice Turns a Chainlink-style USD feed into the price format a Morpho market expects.
/// Used for the Stackday market on Base Sepolia. On Base mainnet the existing markets have their own oracle.
contract FeedOracle is IMorphoOracle {
    IAggregatorV3 public immutable feed;
    uint256 public immutable scale;

    error BadPrice();

    /// @param collateralToken the stock token
    /// @param loanToken USDC (treated as 1 USD)
    constructor(IAggregatorV3 feed_, address collateralToken, address loanToken) {
        feed = feed_;
        uint256 exp =
            36 + IERC20Metadata(loanToken).decimals() - IERC20Metadata(collateralToken).decimals() - feed_.decimals();
        scale = 10 ** exp;
    }

    function price() external view returns (uint256) {
        (, int256 answer,,,) = feed.latestRoundData();
        if (answer <= 0) revert BadPrice();
        return uint256(answer) * scale;
    }
}
