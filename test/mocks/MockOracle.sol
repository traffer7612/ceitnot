// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Mock oracle: returns mutable price (default 1e18 = 1:1) for testing.
contract MockOracle {
    uint256 public price = 1e18;

    function setPrice(uint256 price_) external {
        price = price_;
    }

    function getLatestPrice() external view returns (uint256 value, uint256 timestamp) {
        return (price, block.timestamp);
    }
}
