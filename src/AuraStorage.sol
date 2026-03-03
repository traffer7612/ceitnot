// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AuraStorage
 * @author Sanzhik(traffer7612)
 * @notice EIP-7201 namespaced storage layout for the Aura Engine. Ensures zero collision risk
 *         with implementation contract storage and other namespaces across upgrades.
 * @dev Storage location: erc7201("com.aura.engine.v1")
 *      Formula: keccak256(abi.encode(uint256(keccak256("com.aura.engine.v1")) - 1)) & ~bytes32(uint256(0xff))
 */
library AuraStorage {
    /// @notice Namespace id for ERC-7201; unique and stable across upgrades
    bytes32 private constant NAMESPACE_ID = keccak256("com.aura.engine.v1");

    /// @dev ERC-7201 base slot (literal for assembly). Precomputed: erc7201("com.aura.engine.v1")
    uint256 private constant AURA_ENGINE_STORAGE_SLOT =
        0x183a6125c38840424c4a85fa12bab2ab606c4b6d0e7cc73c0c06ba5300eab500;

    /// @notice Scaling constants
    uint256 internal constant WAD = 1e18;
    uint256 internal constant RAY = 1e27;

    /// @notice Position data: collateral (4626 shares) and debt with index for O(1) settlement
    struct Position {
        uint256 collateralShares;   // Collateral in vault shares (WAD)
        uint256 principalDebt;      // Debt principal at scaleAtLastUpdate (WAD)
        uint256 scaleAtLastUpdate;  // globalDebtScale when position was last touched (RAY)
        uint256 lastInteractionBlock; // For flash-loan / TWAP protection
    }

    /// @notice Global protocol state
    /// @custom:storage-location erc7201:com.aura.engine.v1
    struct EngineStorage {
        // --- Collateral & Debt
        address collateralVault;       // ERC-4626 vault (e.g. stETH wrapper)
        address debtToken;             // Stablecoin or synthetic debt token
        address oracleRelay;           // Multi-oracle (Chainlink + RedStone fallback)
        uint256 totalCollateralShares; // Sum of all position collateral shares (WAD)
        uint256 totalPrincipalDebt;    // Sum of all position principals (WAD)
        // --- Global index for stream-settlement (yield siphon)
        uint256 globalDebtScale;       // RAY; effective totalDebt = totalPrincipalDebt * globalDebtScale / RAY
        uint256 lastHarvestPricePerShare; // WAD; vault assets per 1e18 share at last harvest
        uint256 lastHarvestTimestamp;
        // --- Risk
        uint16 ltvBps;                 // Max LTV e.g. 8000 = 80%
        uint16 liquidationThresholdBps;
        uint16 liquidationPenaltyBps;
        // --- Circuit breaker & access
        bool paused;
        bool emergencyShutdown;
        uint256 heartbeat;             // Min seconds between harvests
        uint256 minHarvestYieldDebt;   // Min yield (in debt token) to trigger harvest
        // --- Flash loan / manipulation protection
        uint256 twapPeriod;            // Seconds for TWAP; 0 = spot only
        mapping(address => Position) positions;
        mapping(address => bool) allowedBorrowers;
        // --- Timelock / governance
        uint256 constantTimelockDelay;
        mapping(bytes32 => uint256) timelockDeadline;
        address admin;
        mapping(bytes32 => uint256) pendingParamValue; // paramId => value to apply after timelock
    }

    /// @notice Returns the namespaced storage struct pointer
    /// @return $ Pointer to EngineStorage at the ERC-7201 slot
    function getStorage() internal pure returns (EngineStorage storage $) {
        assembly {
            $.slot := AURA_ENGINE_STORAGE_SLOT
        }
    }

    /// @notice Returns the ERC-7201 storage slot (for verification and tooling)
    function getStorageSlot() external pure returns (bytes32) {
        return bytes32(AURA_ENGINE_STORAGE_SLOT);
    }
}
