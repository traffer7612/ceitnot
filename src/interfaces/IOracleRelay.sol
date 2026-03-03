// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IOracleRelay
 * @author Sanzhik(traffer7612)
 * @notice Multi-oracle price feed with Chainlink primary and RedStone (or other) fallback.
 *         Prices returned in 1e8 (USD decimals) or configurable.
 */
interface IOracleRelay {
    /// @notice Returns the latest price with fallback logic; reverts if both fail or stale
    /// @return value Price normalized to 1e18 (WAD)
    /// @return timestamp When the price was observed
    function getLatestPrice() external view returns (uint256 value, uint256 timestamp);

    /// @notice Returns TWAP over the configured period if twapPeriod > 0
    function getTwapPrice() external view returns (uint256 value);

    /// @notice Whether the primary feed is considered valid (not stale, not zero)
    function isPrimaryValid() external view returns (bool);

    /// @notice Whether the fallback feed is valid
    function isFallbackValid() external view returns (bool);
}
