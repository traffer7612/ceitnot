// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IMarketRegistry
/// @notice Interface for the Aura Market Registry — read and update market configurations.
interface IMarketRegistry {
    /// @notice Configuration for a single collateral market
    struct MarketConfig {
        address vault;                  // ERC-4626 collateral vault
        address oracle;                 // Price oracle (IOracleRelay)
        uint16  ltvBps;                 // Max LTV in bps (e.g. 8000 = 80%)
        uint16  liquidationThresholdBps;// Liquidation threshold in bps
        uint16  liquidationPenaltyBps;  // Liquidation penalty in bps (e.g. 500 = 5%)
        uint256 supplyCap;              // Max collateral shares (0 = unlimited)
        uint256 borrowCap;              // Max total principal debt (0 = unlimited)
        bool    isActive;               // False → only repay/withdraw allowed
        bool    isFrozen;               // True → deposits and borrows disabled
        bool    isIsolated;             // True → position cannot mix with other collaterals
        uint256 isolatedBorrowCap;      // Max total debt when isolated (0 = unlimited)
    }

    /// @notice Fetch configuration for a market. Reverts if market does not exist.
    function getMarket(uint256 marketId) external view returns (MarketConfig memory);

    /// @notice Whether a market with the given ID has been registered.
    function marketExists(uint256 marketId) external view returns (bool);

    /// @notice Total number of registered markets.
    function marketCount() external view returns (uint256);

    /// @notice Update risk parameters. Called by engine after timelock.
    function updateMarketRiskParams(
        uint256 marketId,
        uint16  ltvBps,
        uint16  liquidationThresholdBps,
        uint16  liquidationPenaltyBps
    ) external;
}
