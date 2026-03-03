// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { AuraStorage } from "./AuraStorage.sol";
import { FixedPoint } from "./FixedPoint.sol";
import { IERC4626 } from "./interfaces/IERC4626.sol";
import { IOracleRelay } from "./interfaces/IOracleRelay.sol";

/**
 * @title AuraEngine
 * @author Sanzhik(traffer7612)
 * @notice Autonomous Yield-Backed Credit Engine: deposit ERC-4626 yield-bearing collateral,
 *         borrow stablecoin; yield is programmatically applied to principal (Yield Siphon).
 * @dev Uses EIP-7201 namespaced storage; UUPS upgradeable; stream-settlement via globalDebtScale.
 */
contract AuraEngine {
    // ------------------------------- Custom errors (gas-efficient)
    error Aura__Paused();
    error Aura__EmergencyShutdown();
    error Aura__InvalidVault();
    error Aura__InvalidOracle();
    error Aura__ZeroAmount();
    error Aura__InsufficientCollateral();
    error Aura__ExceedsLTV();
    error Aura__ExceedsLiquidationThreshold();
    error Aura__HealthFactorBelowOne();
    error Aura__HealthFactorAboveOne();
    error Aura__SameBlockInteraction();
    error Aura__HeartbeatNotElapsed();
    error Aura__HarvestTooSmall();
    error Aura__Unauthorized();
    error Aura__TimelockNotElapsed();
    error Aura__InvalidParams();

    event CollateralDeposited(address indexed user, uint256 shares);
    event CollateralWithdrawn(address indexed user, uint256 shares);
    event Borrowed(address indexed user, uint256 amount);
    event Repaid(address indexed user, uint256 amount);
    event YieldHarvested(uint256 yieldUnderlying, uint256 yieldAppliedToDebt, uint256 newScale);
    event Liquidated(address indexed user, address indexed liquidator, uint256 repayAmount, uint256 collateralSeized);
    event ParamsUpdated(string param, uint256 value);
    event EmergencyShutdownSet(bool status);
    event PausedSet(bool status);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);

    /// @notice Initializer (replaces constructor for proxy). Call from proxy.
    /// @param collateralVault_ ERC-4626 vault address (e.g. stETH wrapper)
    /// @param debtToken_ Stablecoin or debt token address
    /// @param oracleRelay_ Oracle for collateral price (in debt token units, 1e18)
    /// @param ltvBps_ Max LTV in basis points (e.g. 8000 = 80%)
    /// @param liquidationThresholdBps_ Liquidation threshold in bps
    /// @param liquidationPenaltyBps_ Liquidation penalty in bps
    /// @param heartbeat_ Min seconds between harvests
    /// @param timelockDelay_ Delay for critical param changes (seconds)
    function initialize(
        address collateralVault_,
        address debtToken_,
        address oracleRelay_,
        uint16 ltvBps_,
        uint16 liquidationThresholdBps_,
        uint16 liquidationPenaltyBps_,
        uint256 heartbeat_,
        uint256 timelockDelay_
    ) external {
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        if ($.collateralVault != address(0)) revert Aura__InvalidParams();
        if (collateralVault_ == address(0) || debtToken_ == address(0) || oracleRelay_ == address(0)) revert Aura__InvalidParams();
        if (liquidationThresholdBps_ < ltvBps_ || ltvBps_ > 10_000) revert Aura__InvalidParams();

        $.collateralVault = collateralVault_;
        $.debtToken = debtToken_;
        $.oracleRelay = oracleRelay_;
        $.ltvBps = ltvBps_;
        $.liquidationThresholdBps = liquidationThresholdBps_;
        $.liquidationPenaltyBps = liquidationPenaltyBps_;
        $.heartbeat = heartbeat_;
        $.constantTimelockDelay = timelockDelay_;
        $.globalDebtScale = AuraStorage.RAY;
        try IERC4626(collateralVault_).convertToAssets(AuraStorage.WAD) returns (uint256 p) {
            $.lastHarvestPricePerShare = p;
        } catch {
            $.lastHarvestPricePerShare = AuraStorage.WAD;
        }
        $.lastHarvestTimestamp = block.timestamp;
        $.admin = msg.sender;
    }

    // ------------------------------- UUPS Upgradeability (EIP-1967)
    /// @dev EIP-1967 implementation slot (literal for assembly)
    bytes32 private constant IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    /// @notice Upgrade proxy to new implementation. Only admin.
    /// @param newImplementation Address of the new implementation contract
    /// @param data Optional data to call on the new implementation (e.g. reinit)
    function upgradeToAndCall(address newImplementation, bytes memory data) external payable {
        if (AuraStorage.getStorage().admin != msg.sender) revert Aura__Unauthorized();
        assembly {
            sstore(IMPLEMENTATION_SLOT, newImplementation)
        }
        if (data.length > 0) {
            (bool ok, ) = newImplementation.delegatecall(data);
            if (!ok) revert Aura__InvalidParams();
        }
    }

    // ------------------------------- Governance: circuit breaker & params
    modifier onlyAdmin() {
        _onlyAdmin();
        _;
    }

    function _onlyAdmin() internal view {
        if (AuraStorage.getStorage().admin != msg.sender) revert Aura__Unauthorized();
    }

    /// @notice Pause deposits, borrows, withdrawals, repayments, harvests, liquidations
    function setPaused(bool paused_) external onlyAdmin {
        AuraStorage.getStorage().paused = paused_;
        emit PausedSet(paused_);
    }

    /// @notice Emergency shutdown: disable new borrows and deposits; allow repay + withdraw
    function setEmergencyShutdown(bool shutdown_) external onlyAdmin {
        AuraStorage.getStorage().emergencyShutdown = shutdown_;
        emit EmergencyShutdownSet(shutdown_);
    }

    /// @notice Set minimum yield (in debt token) to apply in one harvest (avoids dust updates)
    function setMinHarvestYieldDebt(uint256 value) external onlyAdmin {
        AuraStorage.getStorage().minHarvestYieldDebt = value;
        emit ParamsUpdated("minHarvestYieldDebt", value);
    }

    /// @notice Set heartbeat (min seconds between harvests)
    function setHeartbeat(uint256 value) external onlyAdmin {
        AuraStorage.getStorage().heartbeat = value;
        emit ParamsUpdated("heartbeat", value);
    }

    /// @notice Propose a timelocked parameter change. Apply with executeParam after delay.
    /// @param paramId keccak256("ltvBps"), keccak256("liquidationThresholdBps"), etc.
    /// @param value New value to apply
    function proposeParam(bytes32 paramId, uint256 value) external onlyAdmin {
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        $.timelockDeadline[paramId] = block.timestamp + $.constantTimelockDelay;
        $.pendingParamValue[paramId] = value;
    }

    /// @notice Execute a proposed parameter change after timelock has elapsed
    function executeParam(bytes32 paramId) external onlyAdmin {
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        if (block.timestamp < $.timelockDeadline[paramId]) revert Aura__TimelockNotElapsed();
        uint256 value = $.pendingParamValue[paramId];
        delete $.timelockDeadline[paramId];
        delete $.pendingParamValue[paramId];
        if (paramId == keccak256("ltvBps")) {
            if (value > 10_000 || value > $.liquidationThresholdBps) revert Aura__InvalidParams();
            // forge-lint: disable-next-line(unsafe-typecast)
            $.ltvBps = uint16(value);
            emit ParamsUpdated("ltvBps", value);
        } else if (paramId == keccak256("liquidationThresholdBps")) {
            if (value < $.ltvBps || value > 10_000) revert Aura__InvalidParams();
            // forge-lint: disable-next-line(unsafe-typecast)
            $.liquidationThresholdBps = uint16(value);
            emit ParamsUpdated("liquidationThresholdBps", value);
        } else if (paramId == keccak256("liquidationPenaltyBps")) {
            // forge-lint: disable-next-line(unsafe-typecast)
            $.liquidationPenaltyBps = uint16(value);
            emit ParamsUpdated("liquidationPenaltyBps", value);
        } else {
            revert Aura__InvalidParams();
        }
    }

    /// @notice Transfer admin to a new address
    function setAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert Aura__InvalidParams();
        address oldAdmin = AuraStorage.getStorage().admin;
        AuraStorage.getStorage().admin = newAdmin;
        emit AdminTransferred(oldAdmin, newAdmin);
    }

    // ------------------------------- Modifiers (access & circuit breaker)
    modifier whenNotPaused() {
        _whenNotPaused();
        _;
    }

    function _whenNotPaused() internal view {
        if (AuraStorage.getStorage().paused) revert Aura__Paused();
    }

    modifier whenNotShutdown() {
        _whenNotShutdown();
        _;
    }

    function _whenNotShutdown() internal view {
        if (AuraStorage.getStorage().emergencyShutdown) revert Aura__EmergencyShutdown();
    }

    modifier noSameBlock(address user) {
        _noSameBlock(user);
        _;
    }

    function _noSameBlock(address user) internal {
        AuraStorage.Position storage pos = AuraStorage.getStorage().positions[user];
        if (pos.lastInteractionBlock == block.number) revert Aura__SameBlockInteraction();
        pos.lastInteractionBlock = block.number;
    }

    // ------------------------------- Core: deposit / withdraw collateral
    /// @notice Deposit ERC-4626 vault shares as collateral. Caller must approve engine.
    /// @param user Beneficiary of the collateral position (can be msg.sender or another address)
    /// @param shares Amount of vault shares to deposit (WAD)
    function depositCollateral(address user, uint256 shares) external whenNotPaused whenNotShutdown noSameBlock(user) {
        if (shares == 0) revert Aura__ZeroAmount();
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        IERC4626 vault = IERC4626($.collateralVault);
        bool ok = vault.transferFrom(msg.sender, address(this), shares);
        if (!ok) revert Aura__InvalidParams();

        AuraStorage.Position storage pos = $.positions[user];
        pos.collateralShares += shares;
        $.totalCollateralShares += shares;
        emit CollateralDeposited(user, shares);
    }

    /// @notice Withdraw collateral. Reverts if health factor would go below 1. Caller must be position owner.
    /// @param user Owner of the position (must equal msg.sender)
    /// @param shares Amount of vault shares to withdraw (WAD)
    function withdrawCollateral(address user, uint256 shares) external whenNotPaused noSameBlock(user) {
        if (msg.sender != user) revert Aura__Unauthorized();
        if (shares == 0) revert Aura__ZeroAmount();
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        AuraStorage.Position storage pos = $.positions[user];
        if (pos.collateralShares < shares) revert Aura__InsufficientCollateral();

        _settlePosition($, user);
        pos.collateralShares -= shares;
        $.totalCollateralShares -= shares;
        _requireHealthy(user);
        bool ok = IERC4626($.collateralVault).transfer(msg.sender, shares);
        if (!ok) revert Aura__InvalidParams();
        emit CollateralWithdrawn(user, shares);
    }

    // ------------------------------- Borrow / Repay
    /// @notice Borrow debt token. Increases position debt; must remain within LTV. Caller must be position owner.
    /// @param user Owner of the position (must equal msg.sender; receives borrowed tokens)
    /// @param amount Amount of debt token to borrow (token decimals)
    function borrow(address user, uint256 amount) external whenNotPaused whenNotShutdown noSameBlock(user) {
        if (msg.sender != user) revert Aura__Unauthorized();
        if (amount == 0) revert Aura__ZeroAmount();
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        _settlePosition($, user);
        AuraStorage.Position storage pos = $.positions[user];
        uint256 newPrincipal = pos.principalDebt + amount;
        pos.principalDebt = newPrincipal;
        pos.scaleAtLastUpdate = $.globalDebtScale;
        $.totalPrincipalDebt += amount;
        _requireLtv(user);
        _transferOut($.debtToken, user, amount);
        emit Borrowed(user, amount);
    }

    /// @notice Repay debt. Reduces position debt. Caller must be position owner (and pays from their balance).
    /// @param user Position owner (must equal msg.sender)
    /// @param amount Amount of debt token to repay
    function repay(address user, uint256 amount) external whenNotPaused noSameBlock(user) {
        if (msg.sender != user) revert Aura__Unauthorized();
        if (amount == 0) revert Aura__ZeroAmount();
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        _settlePosition($, user);
        AuraStorage.Position storage pos = $.positions[user];
        uint256 debt = pos.principalDebt;
        if (amount > debt) amount = debt;
        unchecked {
            pos.principalDebt = debt - amount;
            $.totalPrincipalDebt -= amount;
        }
        _transferIn($.debtToken, msg.sender, amount);
        emit Repaid(user, amount);
    }

    // ------------------------------- Yield Siphon (Heartbeat)
    /// @notice Harvest yield from collateral and apply to global debt scale (O(1)).
    ///         Yield = increase in collateral value (from vault share price increase) since last harvest.
    /// @return yieldApplied Amount of debt effectively repaid by yield (WAD)
    function harvestYield() external whenNotPaused whenNotShutdown returns (uint256 yieldApplied) {
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        if (block.timestamp < $.lastHarvestTimestamp + $.heartbeat) revert Aura__HeartbeatNotElapsed();
        uint256 totalShares = $.totalCollateralShares;
        if (totalShares == 0) {
            $.lastHarvestPricePerShare = _currentPricePerShare();
            $.lastHarvestTimestamp = block.timestamp;
            return 0;
        }
        uint256 currentPrice = _currentPricePerShare();
        if (currentPrice <= $.lastHarvestPricePerShare) {
            $.lastHarvestPricePerShare = currentPrice;
            $.lastHarvestTimestamp = block.timestamp;
            return 0;
        }
        uint256 yieldUnderlying;
        unchecked {
            yieldUnderlying = (totalShares * (currentPrice - $.lastHarvestPricePerShare)) / AuraStorage.WAD;
        }
        (uint256 price, ) = IOracleRelay($.oracleRelay).getLatestPrice();
        if (price == 0) {
            $.lastHarvestPricePerShare = currentPrice;
            $.lastHarvestTimestamp = block.timestamp;
            return 0;
        }
        uint256 yieldDebt = (yieldUnderlying * price) / AuraStorage.WAD;
        if ($.minHarvestYieldDebt != 0 && yieldDebt < $.minHarvestYieldDebt) revert Aura__HarvestTooSmall();
        uint256 totalDebtNow = ($.totalPrincipalDebt * $.globalDebtScale) / AuraStorage.RAY;
        if (totalDebtNow == 0) {
            $.lastHarvestPricePerShare = currentPrice;
            $.lastHarvestTimestamp = block.timestamp;
            return 0;
        }
        if (yieldDebt > totalDebtNow) yieldDebt = totalDebtNow;
        $.globalDebtScale = FixedPoint.scaleAfterYield($.globalDebtScale, totalDebtNow, yieldDebt);
        $.lastHarvestPricePerShare = currentPrice;
        $.lastHarvestTimestamp = block.timestamp;
        emit YieldHarvested(yieldUnderlying, yieldDebt, $.globalDebtScale);
        return yieldDebt;
    }

    // ------------------------------- Liquidation
    /// @notice Liquidate an unhealthy position: repay debt on behalf of user, receive collateral (with penalty).
    /// @param user Unhealthy position owner
    /// @param repayAmount Amount of debt to repay
    function liquidate(address user, uint256 repayAmount) external whenNotPaused whenNotShutdown noSameBlock(user) {
        if (repayAmount == 0) revert Aura__ZeroAmount();
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        _settlePosition($, user);
        uint256 hf = _healthFactorRaw($, user);
        if (hf >= AuraStorage.WAD) revert Aura__HealthFactorAboveOne(); // only liquidate when unhealthy
        uint256 debt = _currentDebtRaw($, user);
        if (repayAmount > debt) repayAmount = debt;
        uint256 penaltyBps = $.liquidationPenaltyBps;
        uint256 valuePerShare = _collateralValuePerShare($);
        if (valuePerShare == 0) revert Aura__InvalidParams();
        uint256 collateralToSeize = (repayAmount * (10_000 + penaltyBps) * AuraStorage.WAD) / (10_000 * valuePerShare);
        AuraStorage.Position storage pos = $.positions[user];
        if (collateralToSeize > pos.collateralShares) collateralToSeize = pos.collateralShares;
        unchecked {
            pos.principalDebt -= repayAmount;
            pos.collateralShares -= collateralToSeize;
            $.totalPrincipalDebt -= repayAmount;
            $.totalCollateralShares -= collateralToSeize;
        }
        _transferIn($.debtToken, msg.sender, repayAmount);
        bool ok = IERC4626($.collateralVault).transfer(msg.sender, collateralToSeize);
        if (!ok) revert Aura__InvalidParams();
        emit Liquidated(user, msg.sender, repayAmount, collateralToSeize);
    }

    // ------------------------------- View: debt, health, ERC-4626 helpers
    /// @notice Current debt for a user (principal * globalScale / scaleAtLastUpdate).
    function getPositionDebt(address user) external view returns (uint256) {
        return _currentDebtRaw(AuraStorage.getStorage(), user);
    }

    function getPositionCollateralShares(address user) external view returns (uint256) {
        return AuraStorage.getStorage().positions[user].collateralShares;
    }

    /// @notice Health factor (WAD). < 1e18 = liquidatable.
    function getHealthFactor(address user) external view returns (uint256) {
        return _healthFactorRaw(AuraStorage.getStorage(), user);
    }

    /// @notice Total debt across all positions (for 4626 / analytics).
    function totalDebt() external view returns (uint256) {
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        return ($.totalPrincipalDebt * $.globalDebtScale) / AuraStorage.RAY;
    }

    /// @notice Total collateral in underlying (for 4626 compatibility).
    function totalCollateralAssets() external view returns (uint256) {
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        return IERC4626($.collateralVault).convertToAssets($.totalCollateralShares);
    }

    function asset() external view returns (address) {
        return AuraStorage.getStorage().collateralVault;
    }

    /// @notice Address of the debt token (e.g. USDC). Used by frontends to display symbol and decimals.
    function debtToken() external view returns (address) {
        return AuraStorage.getStorage().debtToken;
    }

    /// @notice Max LTV in basis points (e.g. 8500 = 85%). Used by frontends to show borrow limit.
    function ltvBps() external view returns (uint16) {
        return AuraStorage.getStorage().ltvBps;
    }

    /// @notice Collateral value for a position in debt-token units (same decimals as debt token). For UI: maxBorrow ≈ (value * ltvBps / 10000) - debt.
    function getPositionCollateralValue(address user) external view returns (uint256) {
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        return (IERC4626($.collateralVault).convertToAssets($.positions[user].collateralShares) * _getPrice($)) / AuraStorage.WAD;
    }

    // ------------------------------- Internal: settle, health, pricing
    /// @dev Settle user position: set principal = current debt, scaleAtLastUpdate = globalScale. Updates totalPrincipalDebt.
    function _settlePosition(AuraStorage.EngineStorage storage $, address user) internal {
        AuraStorage.Position storage pos = $.positions[user];
        uint256 oldPrincipal = pos.principalDebt;
        uint256 scale = $.globalDebtScale;
        uint256 scaleAt = pos.scaleAtLastUpdate;
        if (scaleAt == 0) scaleAt = AuraStorage.RAY;
        uint256 currentDebt = FixedPoint.currentDebt(oldPrincipal, scale, scaleAt);
        pos.principalDebt = currentDebt;
        pos.scaleAtLastUpdate = scale;
        // Safe arithmetic: avoid underflow if rounding made oldPrincipal > totalPrincipalDebt
        uint256 total = $.totalPrincipalDebt;
        if (oldPrincipal > total) {
            $.totalPrincipalDebt = currentDebt;
        } else {
            $.totalPrincipalDebt = total - oldPrincipal + currentDebt;
        }
    }

    function _currentDebtRaw(AuraStorage.EngineStorage storage $, address user) internal view returns (uint256) {
        AuraStorage.Position storage pos = $.positions[user];
        if (pos.scaleAtLastUpdate == 0) return 0;
        return FixedPoint.currentDebt(pos.principalDebt, $.globalDebtScale, pos.scaleAtLastUpdate);
    }

    function _healthFactorRaw(AuraStorage.EngineStorage storage $, address user) internal view returns (uint256) {
        uint256 debt = _currentDebtRaw($, user);
        if (debt == 0) return type(uint256).max;
        uint256 collateralValue = (IERC4626($.collateralVault).convertToAssets($.positions[user].collateralShares) * _getPrice($)) / AuraStorage.WAD;
        return (collateralValue * 10_000 * AuraStorage.WAD) / ($.liquidationThresholdBps * debt);
    }

    function _requireHealthy(address user) internal view {
        if (_healthFactorRaw(AuraStorage.getStorage(), user) < AuraStorage.WAD) revert Aura__HealthFactorBelowOne();
    }

    function _requireLtv(address user) internal view {
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        uint256 debt = _currentDebtRaw($, user);
        if (debt == 0) return;
        uint256 collateralValue = (IERC4626($.collateralVault).convertToAssets($.positions[user].collateralShares) * _getPrice($)) / AuraStorage.WAD;
        if ((debt * 10_000) > (collateralValue * $.ltvBps)) revert Aura__ExceedsLTV();
    }

    function _currentPricePerShare() internal view returns (uint256) {
        return IERC4626(AuraStorage.getStorage().collateralVault).convertToAssets(AuraStorage.WAD);
    }

    /// @dev Collateral value (in debt token) per 1e18 share
    function _collateralValuePerShare(AuraStorage.EngineStorage storage $) internal view returns (uint256) {
        uint256 assetsPerShare = IERC4626($.collateralVault).convertToAssets(AuraStorage.WAD);
        return (assetsPerShare * _getPrice($)) / AuraStorage.WAD;
    }

    function _getPrice(AuraStorage.EngineStorage storage $) internal view returns (uint256) {
        (uint256 price, ) = IOracleRelay($.oracleRelay).getLatestPrice();
        return price;
    }

    function _transferIn(address token, address from, uint256 amount) internal {
        (bool ok, bytes memory returndata) = token.call(abi.encodeWithSelector(0x23b872dd, from, address(this), amount));
        if (!ok || (returndata.length != 0 && !abi.decode(returndata, (bool)))) revert Aura__InvalidParams();
    }

    function _transferOut(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory returndata) = token.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
        if (!ok || (returndata.length != 0 && !abi.decode(returndata, (bool)))) revert Aura__InvalidParams();
    }
}
