// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IMarketRegistry } from "./interfaces/IMarketRegistry.sol";
import { IERC4626 }         from "./interfaces/IERC4626.sol";
import { IOracleRelay }     from "./interfaces/IOracleRelay.sol";

/**
 * @title  AuraMarketRegistry
 * @author Sanzhik(traffer7612)
 * @notice Standalone registry of supported collateral markets for the Aura protocol.
 *         Each market maps a collateral type (ERC-4626 vault + oracle) to risk parameters.
 *         Admin manages the market list; the AuraEngine address may update risk params after
 *         a timelock has been executed on the engine side.
 */
contract AuraMarketRegistry is IMarketRegistry {
    // ----------------------------- Errors
    error Registry__Unauthorized();
    error Registry__InvalidParams();
    error Registry__MarketNotFound();

    // ----------------------------- Events
    event MarketAdded(uint256 indexed marketId, address indexed vault, address indexed oracle);
    event MarketRiskParamsUpdated(uint256 indexed marketId);
    event MarketCapsUpdated(uint256 indexed marketId);
    event MarketFrozen(uint256 indexed marketId, bool frozen);
    event MarketActivated(uint256 indexed marketId, bool active);
    event AdminProposed(address indexed current, address indexed pending);
    event AdminTransferred(address indexed prev, address indexed next);
    event EngineSet(address indexed engine);

    // ----------------------------- State
    uint256 public marketCount;

    mapping(uint256 => MarketConfig) private _markets;
    mapping(uint256 => bool)         private _exists;

    address public admin;
    address public pendingAdmin;
    /// @notice AuraEngine address — permitted to call updateMarketRiskParams after timelock
    address public engine;

    // ----------------------------- Modifiers
    modifier onlyAdmin() {
        if (msg.sender != admin) revert Registry__Unauthorized();
        _;
    }

    modifier onlyAdminOrEngine() {
        if (msg.sender != admin && msg.sender != engine) revert Registry__Unauthorized();
        _;
    }

    // ----------------------------- Constructor
    constructor(address admin_) {
        if (admin_ == address(0)) revert Registry__InvalidParams();
        admin = admin_;
    }

    // ----------------------------- Admin management
    /// @notice Propose a new admin (two-step transfer).
    function proposeAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert Registry__InvalidParams();
        pendingAdmin = newAdmin;
        emit AdminProposed(admin, newAdmin);
    }

    /// @notice Accept admin role. Must be called by pendingAdmin.
    function acceptAdmin() external {
        if (msg.sender != pendingAdmin) revert Registry__Unauthorized();
        address old = admin;
        admin = msg.sender;
        pendingAdmin = address(0);
        emit AdminTransferred(old, msg.sender);
    }

    /// @notice Set the authorised engine address (AuraEngine proxy).
    function setEngine(address engine_) external onlyAdmin {
        engine = engine_;
        emit EngineSet(engine_);
    }

    // ----------------------------- Market management
    /**
     * @notice Register a new collateral market.
     * @return marketId Assigned market ID (0-based, monotonically increasing).
     */
    function addMarket(
        address vault,
        address oracle,
        uint16  ltvBps,
        uint16  liquidationThresholdBps,
        uint16  liquidationPenaltyBps,
        uint256 supplyCap,
        uint256 borrowCap,
        bool    isIsolated,
        uint256 isolatedBorrowCap
    ) external onlyAdmin returns (uint256 marketId) {
        _validateRiskParams(ltvBps, liquidationThresholdBps);
        if (vault == address(0) || oracle == address(0)) revert Registry__InvalidParams();

        // Sanity-check vault is a valid ERC-4626
        try IERC4626(vault).convertToAssets(1e18) returns (uint256) {}
        catch { revert Registry__InvalidParams(); }

        // Sanity-check oracle returns a non-zero price
        try IOracleRelay(oracle).getLatestPrice() returns (uint256 p, uint256) {
            if (p == 0) revert Registry__InvalidParams();
        } catch { revert Registry__InvalidParams(); }

        marketId = marketCount++;
        _markets[marketId] = MarketConfig({
            vault:                   vault,
            oracle:                  oracle,
            ltvBps:                  ltvBps,
            liquidationThresholdBps: liquidationThresholdBps,
            liquidationPenaltyBps:   liquidationPenaltyBps,
            supplyCap:               supplyCap,
            borrowCap:               borrowCap,
            isActive:                true,
            isFrozen:                false,
            isIsolated:              isIsolated,
            isolatedBorrowCap:       isolatedBorrowCap,
            baseRate:                0,
            slope1:                  0,
            slope2:                  0,
            kink:                    0,
            reserveFactorBps:        0
        });
        _exists[marketId] = true;
        emit MarketAdded(marketId, vault, oracle);
    }

    /**
     * @notice Update risk parameters for an existing market.
     *         Called by engine after timelock, or by admin directly.
     */
    function updateMarketRiskParams(
        uint256 marketId,
        uint16  ltvBps,
        uint16  liquidationThresholdBps,
        uint16  liquidationPenaltyBps
    ) external onlyAdminOrEngine {
        if (!_exists[marketId]) revert Registry__MarketNotFound();
        _validateRiskParams(ltvBps, liquidationThresholdBps);
        MarketConfig storage cfg = _markets[marketId];
        cfg.ltvBps                  = ltvBps;
        cfg.liquidationThresholdBps = liquidationThresholdBps;
        cfg.liquidationPenaltyBps   = liquidationPenaltyBps;
        emit MarketRiskParamsUpdated(marketId);
    }

    /// @notice Update supply and borrow caps for a market.
    function updateMarketCaps(
        uint256 marketId,
        uint256 supplyCap,
        uint256 borrowCap
    ) external onlyAdmin {
        if (!_exists[marketId]) revert Registry__MarketNotFound();
        _markets[marketId].supplyCap = supplyCap;
        _markets[marketId].borrowCap = borrowCap;
        emit MarketCapsUpdated(marketId);
    }

    /// @notice Freeze or unfreeze a market (frozen → deposits and borrows disabled).
    function freezeMarket(uint256 marketId, bool frozen) external onlyAdmin {
        if (!_exists[marketId]) revert Registry__MarketNotFound();
        _markets[marketId].isFrozen = frozen;
        emit MarketFrozen(marketId, frozen);
    }

    /// @notice Deactivate a market (only repay/withdraw allowed).
    function deactivateMarket(uint256 marketId) external onlyAdmin {
        if (!_exists[marketId]) revert Registry__MarketNotFound();
        _markets[marketId].isActive = false;
        emit MarketActivated(marketId, false);
    }

    /// @notice Update Interest Rate Model parameters for a market.
    function updateMarketIrmParams(
        uint256 marketId,
        uint256 baseRate,
        uint256 slope1,
        uint256 slope2,
        uint256 kink,
        uint16  reserveFactorBps
    ) external onlyAdminOrEngine {
        if (!_exists[marketId]) revert Registry__MarketNotFound();
        if (reserveFactorBps > 10_000) revert Registry__InvalidParams();
        // kink must be in [0, RAY] if non-zero
        uint256 RAY = 1e27;
        if (kink > RAY) revert Registry__InvalidParams();
        MarketConfig storage cfg = _markets[marketId];
        cfg.baseRate         = baseRate;
        cfg.slope1           = slope1;
        cfg.slope2           = slope2;
        cfg.kink             = kink;
        cfg.reserveFactorBps = reserveFactorBps;
        emit MarketRiskParamsUpdated(marketId);
    }

    /// @notice Re-activate a previously deactivated market.
    function activateMarket(uint256 marketId) external onlyAdmin {
        if (!_exists[marketId]) revert Registry__MarketNotFound();
        _markets[marketId].isActive = true;
        emit MarketActivated(marketId, true);
    }

    // ----------------------------- View
    function getMarket(uint256 marketId) external view returns (MarketConfig memory) {
        if (!_exists[marketId]) revert Registry__MarketNotFound();
        return _markets[marketId];
    }

    function marketExists(uint256 marketId) external view returns (bool) {
        return _exists[marketId];
    }

    // ----------------------------- Internal
    function _validateRiskParams(uint16 ltvBps, uint16 liquidationThresholdBps) internal pure {
        if (ltvBps > 10_000)                          revert Registry__InvalidParams();
        if (liquidationThresholdBps > 10_000)          revert Registry__InvalidParams();
        if (liquidationThresholdBps < ltvBps)          revert Registry__InvalidParams();
    }
}
