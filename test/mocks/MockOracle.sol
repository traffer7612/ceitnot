// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Mock oracle: returns fixed price (1e18 = 1:1) for testing.
contract MockOracle {
    uint256 public constant PRICE = 1e18;

    function getLatestPrice() external view returns (uint256 value, uint256 timestamp) {
        return (PRICE, block.timestamp);
    }
}
