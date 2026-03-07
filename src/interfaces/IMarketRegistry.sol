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
        // ---- Interest Rate Model (kink model, all rates RAY/sec; 0 = no interest)
        uint256 baseRate;               // RAY/sec rate at 0 utilization
        uint256 slope1;                 // RAY/sec marginal rate below kink
        uint256 slope2;                 // RAY/sec marginal rate above kink
        uint256 kink;                   // RAY optimal utilization (e.g. 0.8e27)
        uint16  reserveFactorBps;       // Protocol cut of interest accrued (bps, e.g. 1000 = 10%)
        // ---- Advanced Liquidation (Phase 4)
        uint16  closeFactorBps;             // Max % of debt repayable in one liquidation (5000=50%); 0=100%
        uint16  fullLiquidationThresholdBps;// HF below this (bps of WAD, e.g. 5000=0.5) → ignore close factor; 0=off
        uint16  protocolLiquidationFeeBps;  // % of seized collateral going to protocol reserves; 0=none
        bool    dutchAuctionEnabled;        // If true, penalty grows linearly from 0 to max over auctionDuration
        uint256 auctionDuration;            // Seconds from auction start until maxPenalty; 0=instant maxPenalty
        // ---- Fee Params (Phase 5)
        uint16  yieldFeeBps;                // % of harvested yield going to protocol reserves (e.g. 1000=10%); 0=none
        uint16  originationFeeBps;          // One-time fee on borrow added to principal (e.g. 10=0.1%); 0=none
        // ---- Debt Ceiling (Phase 9)
        uint256 debtCeiling;                // Max aUSD mintable from this market (0 = unlimited)
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

    /// @notice Update IRM parameters for a market. Called by admin (no timelock required).
    function updateMarketIrmParams(
        uint256 marketId,
        uint256 baseRate,
        uint256 slope1,
        uint256 slope2,
        uint256 kink,
        uint16  reserveFactorBps
    ) external;

    /// @notice Update advanced liquidation parameters for a market.
    function updateMarketLiquidationParams(
        uint256 marketId,
        uint16  closeFactorBps,
        uint16  fullLiquidationThresholdBps,
        uint16  protocolLiquidationFeeBps,
        bool    dutchAuctionEnabled,
        uint256 auctionDuration
    ) external;

    /// @notice Update fee parameters for a market (yield fee + origination fee).
    function updateMarketFeeParams(
        uint256 marketId,
        uint16  yieldFeeBps,
        uint16  originationFeeBps
    ) external;
}
