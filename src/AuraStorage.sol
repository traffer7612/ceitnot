// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AuraStorage
 * @author Sanzhik(traffer7612)
 * @notice EIP-7201 namespaced storage layout for the Aura Engine. Ensures zero collision risk
 *         with implementation contract storage and other namespaces across upgrades.
 * @dev Storage location: erc7201("com.aura.engine.v1")
 *      Formula: keccak256(abi.encode(uint256(keccak256("com.aura.engine.v1")) - 1)) & ~bytes32(uint256(0xff))
 *
 *      Phase 2: multi-market layout. Single-market fields removed; per-market state lives in
 *      `marketStates` and per-user-per-market positions in `positions`.
 */
library AuraStorage {
    /// @dev ERC-7201 base slot (literal for assembly). Precomputed: erc7201("com.aura.engine.v1")
    uint256 private constant AURA_ENGINE_STORAGE_SLOT =
        0x183a6125c38840424c4a85fa12bab2ab606c4b6d0e7cc73c0c06ba5300eab500;

    /// @notice Scaling constants
    uint256 internal constant WAD = 1e18;
    uint256 internal constant RAY = 1e27;

    // ------------------------------------------------------------------ structs

    /// @notice Mutable per-market state (changes every harvest / interaction).
    struct MarketState {
        uint256 globalDebtScale;          // RAY; starts at RAY, decreases as yield reduces debt
        uint256 lastHarvestPricePerShare;  // WAD; vault price at last harvest
        uint256 lastHarvestTimestamp;
        uint256 totalCollateralShares;     // WAD; sum of all user shares in this market
        uint256 totalPrincipalDebt;        // WAD; sum of all user principal debts in this market
        // ---- Interest accrual (Phase 3)
        uint256 borrowIndex;              // RAY; starts at RAY, grows per-second with interest rate
        uint256 lastAccrualTimestamp;     // seconds; 0 = uninitialized (treated as RAY)
        uint256 totalReserves;            // WAD; accumulated protocol reserves from interest
    }

    /// @notice Per-user per-market position.
    struct MarketPosition {
        uint256 collateralShares;     // ERC-4626 shares deposited (WAD)
        uint256 principalDebt;        // Debt principal at scaleAtLastUpdate (WAD)
        uint256 scaleAtLastUpdate;    // globalDebtScale snapshot when last touched (RAY)
        uint256 lastInteractionBlock; // Flash-loan / same-block protection
    }

    /// @notice Global protocol state
    /// @custom:storage-location erc7201:com.aura.engine.v1
    struct EngineStorage {
        // ---- Core addresses
        address debtToken;        // Stablecoin / synthetic debt token (single across all markets)
        address marketRegistry;   // AuraMarketRegistry contract address

        // ---- Per-market mutable state
        mapping(uint256 => MarketState) marketStates;

        // ---- Per-user per-market positions: user => marketId => MarketPosition
        mapping(address => mapping(uint256 => MarketPosition)) positions;

        // ---- User market tracking (needed for cross-collateral health factor)
        mapping(address => uint256[]) userMarketIds;            // ordered list of markets user entered
        mapping(address => mapping(uint256 => bool)) userInMarket; // quick existence check

        // ---- Isolation mode
        mapping(address => bool)    userInIsolation;    // true if user is in an isolated market
        mapping(address => uint256) userIsolatedMarket; // which market is isolated

        // ---- Circuit breaker & access
        bool    paused;
        bool    emergencyShutdown;
        uint256 heartbeat;           // Min seconds between harvests (engine-level default)
        uint256 minHarvestYieldDebt; // Min yield (debt token units) to apply in one harvest

        // ---- Governance / timelock
        uint256 constantTimelockDelay;
        mapping(bytes32 => uint256) timelockDeadline;
        mapping(bytes32 => uint256) pendingParamValue;   // engine-level params
        // Per-market timelocked param storage: key = keccak256(abi.encode(marketId, paramId))
        mapping(bytes32 => uint256) pendingMarketParamValue;

        address admin;
        address pendingAdmin;
        mapping(address => bool) guardians; // can pause / emergency-shutdown
        mapping(address => bool) keepers;   // can trigger harvestYield

        // ---- Initializable
        uint256 initializationVersion; // 0 = uninitialized, type(uint256).max = disabled

        // ---- Reentrancy guard
        uint256 reentrancyStatus; // 1 = NOT_ENTERED, 2 = ENTERED

        // ---- Storage gap for future upgrades (each new variable consumes one slot)
        uint256[50] __gap;
    }

    // ------------------------------------------------------------------ accessor

    /// @notice Returns the namespaced storage struct pointer.
    function getStorage() internal pure returns (EngineStorage storage $) {
        assembly {
            $.slot := AURA_ENGINE_STORAGE_SLOT
        }
    }

    /// @notice Returns the ERC-7201 storage slot (for verification and tooling).
    function getStorageSlot() external pure returns (bytes32) {
        return bytes32(AURA_ENGINE_STORAGE_SLOT);
    }
}
