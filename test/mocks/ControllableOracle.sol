// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Oracle with settable price for security tests (manipulation, staleness, zero price).
contract ControllableOracle {
    uint256 public price;
    uint256 public updatedAt;

    constructor(uint256 price_) {
        price = price_;
        updatedAt = block.timestamp;
    }

    function setPrice(uint256 price_) external {
        price = price_;
        updatedAt = block.timestamp;
    }

    function setPriceStale(uint256 price_, uint256 timestamp_) external {
        price = price_;
        updatedAt = timestamp_;
    }

    function getLatestPrice() external view returns (uint256 value, uint256 timestamp) {
        return (price, updatedAt);
    }
}
