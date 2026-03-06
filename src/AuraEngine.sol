// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { AuraStorage }            from "./AuraStorage.sol";
import { FixedPoint }             from "./FixedPoint.sol";
import { InterestRateModel }      from "./InterestRateModel.sol";
import { IERC4626 }               from "./interfaces/IERC4626.sol";
import { IOracleRelay }           from "./interfaces/IOracleRelay.sol";
import { IMarketRegistry }        from "./interfaces/IMarketRegistry.sol";
import { IERC3156FlashBorrower }  from "./interfaces/IERC3156FlashBorrower.sol";
import { IERC3156FlashLender }    from "./interfaces/IERC3156FlashLender.sol";

/**
 * @title AuraEngine
 * @author Sanzhik(traffer7612)
 * @notice Autonomous Yield-Backed Credit Engine: deposit ERC-4626 yield-bearing collateral,
 *         borrow stablecoin; yield is programmatically applied to principal (Yield Siphon).
 * @dev Phase 2: multi-market. Uses EIP-7201 namespaced storage; UUPS upgradeable.
 *      Each market has its own collateral vault, oracle, and risk params (held in AuraMarketRegistry).
 *      Debt is a single token across all markets; health factor is aggregated cross-collateral.
 */
contract AuraEngine {
    // ------------------------------- Custom errors
    error Aura__Paused();
    error Aura__EmergencyShutdown();
    error Aura__ZeroAmount();
    error Aura__InsufficientCollateral();
    error Aura__ExceedsLTV();
    error Aura__HealthFactorBelowOne();
    error Aura__HealthFactorAboveOne();
    error Aura__SameBlockInteraction();
    error Aura__HeartbeatNotElapsed();
    error Aura__HarvestTooSmall();
    error Aura__Unauthorized();
    error Aura__TimelockNotElapsed();
    error Aura__InvalidParams();
    error Aura__Reentrancy();
    error Aura__AlreadyInitialized();
    error Aura__NotContract();
    error Aura__MarketNotFound();
    error Aura__MarketFrozen();
    error Aura__MarketInactive();
    error Aura__SupplyCapExceeded();
    error Aura__BorrowCapExceeded();
    error Aura__IsolationViolation();
    error Aura__InsufficientReserves();
    error Aura__CloseFactorExceeded();
    error Aura__AuctionNotStarted();
    error Aura__AuctionAlreadyActive();
    error Aura__InsufficientProtocolCollateral();
    // ---- Phase 6: Flash Loans
    error Aura__FlashLoanUnsupportedToken();
    error Aura__FlashLoanExceedsBalance();
    error Aura__FlashLoanCallbackFailed();

    // ------------------------------- Events
    event CollateralDeposited(address indexed user, uint256 indexed marketId, uint256 shares);
    event CollateralWithdrawn(address indexed user, uint256 indexed marketId, uint256 shares);
    event Borrowed(address indexed user, uint256 indexed marketId, uint256 amount);
    event Repaid(address indexed user, uint256 indexed marketId, uint256 amount);
    event YieldHarvested(uint256 indexed marketId, uint256 yieldUnderlying, uint256 yieldAppliedToDebt, uint256 protocolYield, uint256 newScale);
    event OriginationFeeCharged(address indexed user, uint256 indexed marketId, uint256 fee);
    event Liquidated(address indexed user, address indexed liquidator, uint256 indexed marketId, uint256 repayAmount, uint256 collateralSeized);
    event InterestAccrued(uint256 indexed marketId, uint256 interestAccrued, uint256 reservesAccrued, uint256 newBorrowIndex);
    event ReservesWithdrawn(uint256 indexed marketId, address indexed to, uint256 amount);
    event LiquidationInitiated(address indexed user, uint256 indexed marketId, uint256 timestamp);
    event BadDebtRealized(address indexed user, uint256 indexed marketId, uint256 badDebtAmount);
    event ProtocolCollateralWithdrawn(uint256 indexed marketId, address indexed to, uint256 shares);
    event EngineParamUpdated(string param, uint256 value);
    event MarketParamProposed(uint256 indexed marketId, bytes32 paramId, uint256 value);
    event MarketParamExecuted(uint256 indexed marketId, bytes32 paramId, uint256 value);
    event EmergencyShutdownSet(bool status);
    event PausedSet(bool status);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);
    event AdminProposed(address indexed currentAdmin, address indexed pendingAdmin);
    event GuardianSet(address indexed guardian, bool status);
    event KeeperSet(address indexed keeper, bool status);
    // ---- Phase 6: Flash Loans
    event FlashLoan(address indexed receiver, address indexed token, uint256 amount, uint256 fee);
    event FlashLoanFeeUpdated(uint16 feeBps);
    event FlashLoanReservesWithdrawn(address indexed to, uint256 amount);

    /// @notice EIP-1967 UUPS upgrade interface version
    string public constant UPGRADE_INTERFACE_VERSION = "5.0.0";

    /// @dev EIP-1967 implementation slot
    bytes32 private constant IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    // ------------------------------- Constructor
    /// @dev Locks the implementation contract from being initialized directly.
    constructor() {
        AuraStorage.getStorage().initializationVersion = type(uint256).max;
    }

    // ------------------------------- Initializer
    /// @notice Initializer (replaces constructor for proxy). Call once from proxy.
    /// @param debtToken_       Single stablecoin / debt token used across all markets
    /// @param marketRegistry_  AuraMarketRegistry address
    /// @param heartbeat_       Min seconds between harvests (engine-wide default)
    /// @param timelockDelay_   Delay for critical param changes (seconds)
    function initialize(
        address debtToken_,
        address marketRegistry_,
        uint256 heartbeat_,
        uint256 timelockDelay_
    ) external {
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        if ($.initializationVersion != 0) revert Aura__AlreadyInitialized();
        if (debtToken_ == address(0) || marketRegistry_ == address(0)) revert Aura__InvalidParams();

        $.debtToken           = debtToken_;
        $.marketRegistry      = marketRegistry_;
        $.heartbeat           = heartbeat_;
        $.constantTimelockDelay = timelockDelay_;
        $.admin               = msg.sender;
        $.initializationVersion = 1;
        $.reentrancyStatus    = 1;
    }

    // ------------------------------- UUPS
    /// @notice Upgrade proxy to new implementation. Only admin.
    function upgradeToAndCall(address newImplementation, bytes memory data) external payable {
        if (AuraStorage.getStorage().admin != msg.sender) revert Aura__Unauthorized();
        if (newImplementation == address(0)) revert Aura__InvalidParams();
        if (newImplementation.code.length == 0) revert Aura__NotContract();
        assembly { sstore(IMPLEMENTATION_SLOT, newImplementation) }
        if (data.length > 0) {
            (bool ok, ) = newImplementation.delegatecall(data);
            if (!ok) revert Aura__InvalidParams();
        }
    }

    // ------------------------------- Access modifiers
    modifier onlyAdmin() { _onlyAdmin(); _; }
    function _onlyAdmin() internal view {
        if (AuraStorage.getStorage().admin != msg.sender) revert Aura__Unauthorized();
    }

    modifier onlyAdminOrGuardian() { _onlyAdminOrGuardian(); _; }
    function _onlyAdminOrGuardian() internal view {
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        if ($.admin != msg.sender && !$.guardians[msg.sender]) revert Aura__Unauthorized();
    }

    modifier whenNotPaused()   { if (AuraStorage.getStorage().paused)             revert Aura__Paused();             _; }
    modifier whenNotShutdown() { if (AuraStorage.getStorage().emergencyShutdown)  revert Aura__EmergencyShutdown(); _; }

    modifier nonReentrant() {
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        if ($.reentrancyStatus == 2) revert Aura__Reentrancy();
        $.reentrancyStatus = 2;
        _;
        $.reentrancyStatus = 1;
    }

    /// @dev Per-user per-market same-block protection.
    modifier noSameBlock(address user, uint256 marketId) {
        AuraStorage.MarketPosition storage pos = AuraStorage.getStorage().positions[user][marketId];
        if (pos.lastInteractionBlock == block.number) revert Aura__SameBlockInteraction();
        pos.lastInteractionBlock = block.number;
        _;
    }

    // ------------------------------- Governance
    function setPaused(bool paused_) external onlyAdminOrGuardian {
        AuraStorage.getStorage().paused = paused_;
        emit PausedSet(paused_);
    }

    function setEmergencyShutdown(bool shutdown_) external onlyAdminOrGuardian {
        AuraStorage.getStorage().emergencyShutdown = shutdown_;
        emit EmergencyShutdownSet(shutdown_);
    }

    function setMinHarvestYieldDebt(uint256 value) external onlyAdmin {
        AuraStorage.getStorage().minHarvestYieldDebt = value;
        emit EngineParamUpdated("minHarvestYieldDebt", value);
    }

    function setHeartbeat(uint256 value) external onlyAdmin {
        AuraStorage.getStorage().heartbeat = value;
        emit EngineParamUpdated("heartbeat", value);
    }

    /// @notice Propose engine-level timelocked param (heartbeat, minHarvestYieldDebt).
    function proposeParam(bytes32 paramId, uint256 value) external onlyAdmin {
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        $.timelockDeadline[paramId]   = block.timestamp + $.constantTimelockDelay;
        $.pendingParamValue[paramId]  = value;
    }

    /// @notice Execute engine-level timelocked param after delay.
    function executeParam(bytes32 paramId) external onlyAdmin {
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        if (block.timestamp < $.timelockDeadline[paramId]) revert Aura__TimelockNotElapsed();
        uint256 value = $.pendingParamValue[paramId];
        delete $.timelockDeadline[paramId];
        delete $.pendingParamValue[paramId];
        if (paramId == keccak256("heartbeat")) {
            $.heartbeat = value;
            emit EngineParamUpdated("heartbeat", value);
        } else if (paramId == keccak256("minHarvestYieldDebt")) {
            $.minHarvestYieldDebt = value;
            emit EngineParamUpdated("minHarvestYieldDebt", value);
        } else {
            revert Aura__InvalidParams();
        }
    }

    /// @notice Propose a per-market risk param change (ltvBps, liquidationThresholdBps, liquidationPenaltyBps).
    /// @param marketId  Target market
    /// @param paramId   keccak256("ltvBps") | keccak256("liquidationThresholdBps") | keccak256("liquidationPenaltyBps")
    /// @param value     New value
    function proposeMarketParam(uint256 marketId, bytes32 paramId, uint256 value) external onlyAdmin {
        if (!IMarketRegistry(AuraStorage.getStorage().marketRegistry).marketExists(marketId))
            revert Aura__MarketNotFound();
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        bytes32 key = keccak256(abi.encode(marketId, paramId));
        $.timelockDeadline[key]             = block.timestamp + $.constantTimelockDelay;
        $.pendingMarketParamValue[key]       = value;
        emit MarketParamProposed(marketId, paramId, value);
    }

    /// @notice Execute a per-market risk param change after timelock has elapsed.
    function executeMarketParam(uint256 marketId, bytes32 paramId) external onlyAdmin {
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        bytes32 key = keccak256(abi.encode(marketId, paramId));
        if (block.timestamp < $.timelockDeadline[key]) revert Aura__TimelockNotElapsed();
        uint256 value = $.pendingMarketParamValue[key];
        delete $.timelockDeadline[key];
        delete $.pendingMarketParamValue[key];

        IMarketRegistry reg = IMarketRegistry($.marketRegistry);
        IMarketRegistry.MarketConfig memory cfg = reg.getMarket(marketId);

        uint16 newLtv   = cfg.ltvBps;
        uint16 newLt    = cfg.liquidationThresholdBps;
        uint16 newPen   = cfg.liquidationPenaltyBps;

        if (paramId == keccak256("ltvBps")) {
            if (value > 10_000 || value > cfg.liquidationThresholdBps) revert Aura__InvalidParams();
            newLtv = uint16(value);
        } else if (paramId == keccak256("liquidationThresholdBps")) {
            if (value < cfg.ltvBps || value > 10_000) revert Aura__InvalidParams();
            newLt = uint16(value);
        } else if (paramId == keccak256("liquidationPenaltyBps")) {
            newPen = uint16(value);
        } else {
            revert Aura__InvalidParams();
        }
        reg.updateMarketRiskParams(marketId, newLtv, newLt, newPen);
        emit MarketParamExecuted(marketId, paramId, value);
    }

    function proposeAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert Aura__InvalidParams();
        AuraStorage.getStorage().pendingAdmin = newAdmin;
        emit AdminProposed(msg.sender, newAdmin);
    }

    function acceptAdmin() external {
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        if (msg.sender != $.pendingAdmin) revert Aura__Unauthorized();
        address oldAdmin = $.admin;
        $.admin = msg.sender;
        $.pendingAdmin = address(0);
        emit AdminTransferred(oldAdmin, msg.sender);
    }

    function setGuardian(address guardian, bool status) external onlyAdmin {
        AuraStorage.getStorage().guardians[guardian] = status;
        emit GuardianSet(guardian, status);
    }

    function setKeeper(address keeper, bool status) external onlyAdmin {
        AuraStorage.getStorage().keepers[keeper] = status;
        emit KeeperSet(keeper, status);
    }

    /**
     * @notice Initiate a Dutch Auction liquidation for an unhealthy position.
     *         Must be called before `liquidate` when `dutchAuctionEnabled` is true.
     *         Anyone can call; sets the auction start timestamp.
     * @param user     Position owner
     * @param marketId Market with the unhealthy position
     */
    function initiateLiquidation(
        address user,
        uint256 marketId
    ) external whenNotPaused whenNotShutdown nonReentrant {
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        _getMarketCfg($.marketRegistry, marketId); // validate market
        _accrueInterest($, marketId);
        _settlePosition($, user, marketId);

        if (_healthFactor($, user) >= AuraStorage.WAD) revert Aura__HealthFactorAboveOne();

        AuraStorage.MarketPosition storage pos = $.positions[user][marketId];
        if (pos.auctionStartTime != 0) revert Aura__AuctionAlreadyActive();
        pos.auctionStartTime = block.timestamp;
        emit LiquidationInitiated(user, marketId, block.timestamp);
    }

    /**
     * @notice Withdraw vault shares accumulated as protocol liquidation fees.
     * @param marketId Source market
     * @param shares   Amount of vault shares to withdraw
     * @param to       Recipient address
     */
    function withdrawProtocolCollateral(
        uint256 marketId,
        uint256 shares,
        address to
    ) external onlyAdmin {
        if (shares == 0) revert Aura__ZeroAmount();
        if (to == address(0)) revert Aura__InvalidParams();
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        IMarketRegistry.MarketConfig memory cfg = _getMarketCfg($.marketRegistry, marketId);
        AuraStorage.MarketState storage ms = $.marketStates[marketId];
        if (ms.protocolCollateralReserves < shares) revert Aura__InsufficientProtocolCollateral();
        unchecked { ms.protocolCollateralReserves -= shares; }
        bool ok = IERC4626(cfg.vault).transfer(to, shares);
        if (!ok) revert Aura__InvalidParams();
        emit ProtocolCollateralWithdrawn(marketId, to, shares);
    }

    /**
     * @notice Accrue interest for a market without other side effects.
     *         Useful for keepers and accurate state snapshots.
     * @param marketId Target market
     */
    function accrueInterest(uint256 marketId) external nonReentrant {
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        if (!IMarketRegistry($.marketRegistry).marketExists(marketId)) revert Aura__MarketNotFound();
        _accrueInterest($, marketId);
    }

    /**
     * @notice Withdraw accumulated protocol reserves for a market to a treasury address.
     * @param marketId Target market
     * @param amount   Amount of debt token to withdraw (WAD)
     * @param to       Recipient address
     */
    function withdrawReserves(uint256 marketId, uint256 amount, address to) external onlyAdmin {
        if (amount == 0) revert Aura__ZeroAmount();
        if (to == address(0)) revert Aura__InvalidParams();
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        AuraStorage.MarketState storage ms = $.marketStates[marketId];
        if (ms.totalReserves < amount) revert Aura__InsufficientReserves();
        unchecked { ms.totalReserves -= amount; }
        _transferOut($.debtToken, to, amount);
        emit ReservesWithdrawn(marketId, to, amount);
    }

    // ------------------------------- Core: Deposit / Withdraw
    /**
     * @notice Deposit ERC-4626 vault shares as collateral into a specific market.
     * @param user     Beneficiary of the position
     * @param marketId Target market (must be active and not frozen)
     * @param shares   Amount of vault shares to deposit
     */
    function depositCollateral(
        address user,
        uint256 marketId,
        uint256 shares
    ) external whenNotPaused whenNotShutdown noSameBlock(user, marketId) nonReentrant {
        if (shares == 0) revert Aura__ZeroAmount();
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        IMarketRegistry.MarketConfig memory cfg = _requireActiveMarket($.marketRegistry, marketId);
        _accrueInterest($, marketId);

        // Supply cap check
        AuraStorage.MarketState storage ms = $.marketStates[marketId];
        if (cfg.supplyCap != 0 && ms.totalCollateralShares + shares > cfg.supplyCap)
            revert Aura__SupplyCapExceeded();

        // Isolation mode check
        _checkIsolationOnDeposit($, user, marketId, cfg.isIsolated);

        // Pull shares from caller
        bool ok = IERC4626(cfg.vault).transferFrom(msg.sender, address(this), shares);
        if (!ok) revert Aura__InvalidParams();

        // Update state
        AuraStorage.MarketPosition storage pos = $.positions[user][marketId];
        if (!$.userInMarket[user][marketId]) {
            $.userInMarket[user][marketId] = true;
            $.userMarketIds[user].push(marketId);
        }
        pos.collateralShares += shares;
        ms.totalCollateralShares += shares;

        // Initialise per-market state on first deposit
        if (ms.globalDebtScale == 0) {
            ms.globalDebtScale = AuraStorage.RAY;
            try IERC4626(cfg.vault).convertToAssets(AuraStorage.WAD) returns (uint256 p) {
                ms.lastHarvestPricePerShare = p;
            } catch {
                ms.lastHarvestPricePerShare = AuraStorage.WAD;
            }
            ms.lastHarvestTimestamp = block.timestamp;
        }

        emit CollateralDeposited(user, marketId, shares);
    }

    /**
     * @notice Withdraw collateral shares from a market. Reverts if cross-collateral HF < 1.
     * @param user     Position owner (must equal msg.sender)
     * @param marketId Source market
     * @param shares   Amount of shares to withdraw
     */
    function withdrawCollateral(
        address user,
        uint256 marketId,
        uint256 shares
    ) external whenNotPaused noSameBlock(user, marketId) nonReentrant {
        if (msg.sender != user) revert Aura__Unauthorized();
        if (shares == 0) revert Aura__ZeroAmount();
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        IMarketRegistry.MarketConfig memory cfg = _getMarketCfg($.marketRegistry, marketId);
        _accrueInterest($, marketId);

        AuraStorage.MarketPosition storage pos = $.positions[user][marketId];
        if (pos.collateralShares < shares) revert Aura__InsufficientCollateral();

        _settlePosition($, user, marketId);
        pos.collateralShares -= shares;
        $.marketStates[marketId].totalCollateralShares -= shares;

        // Clean up market tracking if position fully closed
        _tryExitMarket($, user, marketId);

        _requireHealthy($, user);

        bool ok = IERC4626(cfg.vault).transfer(msg.sender, shares);
        if (!ok) revert Aura__InvalidParams();
        emit CollateralWithdrawn(user, marketId, shares);
    }

    // ------------------------------- Core: Borrow / Repay
    /**
     * @notice Borrow debt token against collateral in a specific market.
     * @param user     Position owner (must equal msg.sender)
     * @param marketId Source market (determines per-market LTV check)
     * @param amount   Amount of debt token to borrow
     */
    function borrow(
        address user,
        uint256 marketId,
        uint256 amount
    ) external whenNotPaused whenNotShutdown noSameBlock(user, marketId) nonReentrant {
        if (msg.sender != user) revert Aura__Unauthorized();
        if (amount == 0) revert Aura__ZeroAmount();
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        IMarketRegistry.MarketConfig memory cfg = _requireActiveMarket($.marketRegistry, marketId);
        _accrueInterest($, marketId);

        _settlePosition($, user, marketId);

        AuraStorage.MarketState   storage ms  = $.marketStates[marketId];
        AuraStorage.MarketPosition storage pos = $.positions[user][marketId];

        // Isolation borrow cap
        if (cfg.isIsolated && cfg.isolatedBorrowCap != 0) {
            uint256 currentIsolatedDebt = (ms.totalPrincipalDebt * _effectiveScale(ms)) / AuraStorage.RAY;
            if (currentIsolatedDebt + amount > cfg.isolatedBorrowCap)
                revert Aura__BorrowCapExceeded();
        }

        // ---- 5.2 Origination Fee
        uint256 originationFee;
        if (cfg.originationFeeBps > 0) {
            originationFee = (amount * cfg.originationFeeBps) / 10_000;
        }
        uint256 totalDebtAdded = amount + originationFee;

        // Re-check borrow cap against full debt increase
        if (cfg.borrowCap != 0 && ms.totalPrincipalDebt + totalDebtAdded > cfg.borrowCap)
            revert Aura__BorrowCapExceeded();

        pos.principalDebt    += totalDebtAdded;
        pos.scaleAtLastUpdate = _effectiveScale(ms);
        ms.totalPrincipalDebt += totalDebtAdded;

        if (originationFee > 0) {
            ms.totalReserves += originationFee;
            emit OriginationFeeCharged(user, marketId, originationFee);
        }

        _requireLtv($, user, marketId, cfg);
        _transferOut($.debtToken, user, amount);
        emit Borrowed(user, marketId, amount);
    }

    /**
     * @notice Repay debt in a specific market.
     * @param user     Position owner (must equal msg.sender)
     * @param marketId Target market
     * @param amount   Amount of debt token to repay
     */
    function repay(
        address user,
        uint256 marketId,
        uint256 amount
    ) external whenNotPaused noSameBlock(user, marketId) nonReentrant {
        if (msg.sender != user) revert Aura__Unauthorized();
        if (amount == 0) revert Aura__ZeroAmount();
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        _getMarketCfg($.marketRegistry, marketId); // ensures market exists
        _accrueInterest($, marketId);

        _settlePosition($, user, marketId);
        AuraStorage.MarketPosition storage pos = $.positions[user][marketId];
        uint256 debt = pos.principalDebt;
        if (amount > debt) amount = debt;
        unchecked {
            pos.principalDebt                        -= amount;
            $.marketStates[marketId].totalPrincipalDebt -= amount;
        }
        _tryExitMarket($, user, marketId);
        _transferIn($.debtToken, msg.sender, amount);
        emit Repaid(user, marketId, amount);
    }

    // ------------------------------- Yield Siphon
    /**
     * @notice Harvest yield accrued by a market's collateral vault and apply it to reduce debt (O(1)).
     * @param marketId Target market
     * @return yieldApplied Amount of debt effectively reduced by yield
     */
    function harvestYield(
        uint256 marketId
    ) external whenNotPaused whenNotShutdown nonReentrant returns (uint256 yieldApplied) {
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        IMarketRegistry.MarketConfig memory cfg = _getMarketCfg($.marketRegistry, marketId);
        AuraStorage.MarketState storage ms = $.marketStates[marketId];

        if (ms.globalDebtScale == 0) revert Aura__MarketNotFound(); // market never had a deposit
        _accrueInterest($, marketId);
        if (block.timestamp < ms.lastHarvestTimestamp + $.heartbeat) revert Aura__HeartbeatNotElapsed();

        uint256 totalShares = ms.totalCollateralShares;
        uint256 currentPrice = IERC4626(cfg.vault).convertToAssets(AuraStorage.WAD);

        if (totalShares == 0 || currentPrice <= ms.lastHarvestPricePerShare) {
            ms.lastHarvestPricePerShare = currentPrice;
            ms.lastHarvestTimestamp     = block.timestamp;
            return 0;
        }

        uint256 yieldUnderlying;
        unchecked {
            yieldUnderlying = (totalShares * (currentPrice - ms.lastHarvestPricePerShare)) / AuraStorage.WAD;
        }

        (uint256 price, ) = IOracleRelay(cfg.oracle).getLatestPrice();
        if (price == 0) {
            ms.lastHarvestPricePerShare = currentPrice;
            ms.lastHarvestTimestamp     = block.timestamp;
            return 0;
        }

        uint256 yieldDebt = (yieldUnderlying * price) / AuraStorage.WAD;
        if ($.minHarvestYieldDebt != 0 && yieldDebt < $.minHarvestYieldDebt) revert Aura__HarvestTooSmall();

        uint256 totalDebtNow = (ms.totalPrincipalDebt * _effectiveScale(ms)) / AuraStorage.RAY;
        if (totalDebtNow == 0) {
            ms.lastHarvestPricePerShare = currentPrice;
            ms.lastHarvestTimestamp     = block.timestamp;
            return 0;
        }
        if (yieldDebt > totalDebtNow) yieldDebt = totalDebtNow;

        // ---- 5.1 Yield Fee
        uint256 protocolYield;
        if (cfg.yieldFeeBps > 0) {
            protocolYield = (yieldDebt * cfg.yieldFeeBps) / 10_000;
            ms.totalReserves += protocolYield;
        }
        uint256 yieldAppliedToDebt = yieldDebt - protocolYield;

        ms.globalDebtScale          = FixedPoint.scaleAfterYield(ms.globalDebtScale, totalDebtNow, yieldAppliedToDebt);
        ms.lastHarvestPricePerShare  = currentPrice;
        ms.lastHarvestTimestamp      = block.timestamp;

        emit YieldHarvested(marketId, yieldUnderlying, yieldAppliedToDebt, protocolYield, ms.globalDebtScale);
        return yieldAppliedToDebt;
    }

    // ------------------------------- Liquidation
    /**
     * @notice Liquidate an unhealthy position in a specific market.
     *         Integrates close factor, Dutch auction, protocol fee, and bad debt socialization.
     * @param user        Unhealthy position owner
     * @param marketId    Market to liquidate in
     * @param repayAmount Amount of debt to repay (capped by close factor unless HF < fullLiquidationThreshold)
     */
    function liquidate(
        address user,
        uint256 marketId,
        uint256 repayAmount
    ) external whenNotPaused whenNotShutdown noSameBlock(user, marketId) nonReentrant {
        if (repayAmount == 0) revert Aura__ZeroAmount();
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        IMarketRegistry.MarketConfig memory cfg = _getMarketCfg($.marketRegistry, marketId);
        _accrueInterest($, marketId);
        _settlePosition($, user, marketId);

        // HF check
        uint256 hf = _healthFactor($, user);
        if (hf >= AuraStorage.WAD) revert Aura__HealthFactorAboveOne();

        AuraStorage.MarketPosition storage pos = $.positions[user][marketId];
        AuraStorage.MarketState    storage ms  = $.marketStates[marketId];

        uint256 debt = _currentDebtInMarket($, user, marketId);

        // ---- 4.1 Close Factor
        if (cfg.closeFactorBps > 0) {
            bool fullLiqAllowed = cfg.fullLiquidationThresholdBps > 0
                && hf < (uint256(cfg.fullLiquidationThresholdBps) * AuraStorage.WAD / 10_000);
            if (!fullLiqAllowed) {
                uint256 maxRepay = (debt * cfg.closeFactorBps) / 10_000;
                if (repayAmount > maxRepay) revert Aura__CloseFactorExceeded();
            }
        }
        if (repayAmount > debt) repayAmount = debt;

        uint256 valuePerShare = _collateralValuePerShare(cfg);
        if (valuePerShare == 0) revert Aura__InvalidParams();

        // ---- 4.2 Dutch Auction penalty
        uint256 effectivePenaltyBps;
        if (cfg.dutchAuctionEnabled) {
            if (pos.auctionStartTime == 0) revert Aura__AuctionNotStarted();
            uint256 elapsed = block.timestamp - pos.auctionStartTime;
            if (cfg.auctionDuration == 0 || elapsed >= cfg.auctionDuration) {
                effectivePenaltyBps = cfg.liquidationPenaltyBps;
            } else {
                effectivePenaltyBps = (elapsed * cfg.liquidationPenaltyBps) / cfg.auctionDuration;
            }
        } else {
            effectivePenaltyBps = cfg.liquidationPenaltyBps;
        }

        uint256 collateralToSeize = (repayAmount * (10_000 + effectivePenaltyBps) * AuraStorage.WAD)
            / (10_000 * valuePerShare);
        if (collateralToSeize > pos.collateralShares) collateralToSeize = pos.collateralShares;

        // ---- 4.3 Protocol Liquidation Fee
        uint256 protocolFeeShares;
        if (cfg.protocolLiquidationFeeBps > 0 && collateralToSeize > 0) {
            protocolFeeShares = (collateralToSeize * cfg.protocolLiquidationFeeBps) / 10_000;
            ms.protocolCollateralReserves += protocolFeeShares;
        }
        uint256 liquidatorShares = collateralToSeize - protocolFeeShares;

        // Update state
        unchecked {
            pos.principalDebt        -= repayAmount;
            pos.collateralShares      -= collateralToSeize;
            ms.totalPrincipalDebt    -= repayAmount;
            ms.totalCollateralShares -= collateralToSeize;
        }

        // Reset auction if position closed
        if (pos.collateralShares == 0 && pos.principalDebt == 0) {
            pos.auctionStartTime = 0;
        }

        // ---- 4.4 Bad Debt Socialization
        if (pos.collateralShares == 0 && pos.principalDebt > 0) {
            uint256 badDebt = pos.principalDebt;
            uint256 covered = badDebt <= ms.totalReserves ? badDebt : ms.totalReserves;
            unchecked {
                ms.totalReserves     -= covered;
                ms.totalPrincipalDebt = ms.totalPrincipalDebt > badDebt
                    ? ms.totalPrincipalDebt - badDebt : 0;
                pos.principalDebt = 0;
            }
            emit BadDebtRealized(user, marketId, badDebt);
        }

        _tryExitMarket($, user, marketId);

        _transferIn($.debtToken, msg.sender, repayAmount);
        if (liquidatorShares > 0) {
            bool ok = IERC4626(cfg.vault).transfer(msg.sender, liquidatorShares);
            if (!ok) revert Aura__InvalidParams();
        }
        emit Liquidated(user, msg.sender, marketId, repayAmount, liquidatorShares);
    }

    // ------------------------------- View
    /// @notice Current debt for a user in a specific market.
    function getPositionDebt(address user, uint256 marketId) external view returns (uint256) {
        return _currentDebtInMarket(AuraStorage.getStorage(), user, marketId);
    }

    /// @notice Collateral shares held by a user in a specific market.
    function getPositionCollateralShares(address user, uint256 marketId) external view returns (uint256) {
        return AuraStorage.getStorage().positions[user][marketId].collateralShares;
    }

    /// @notice Cross-collateral health factor (WAD). < 1e18 = liquidatable.
    function getHealthFactor(address user) external view returns (uint256) {
        return _healthFactor(AuraStorage.getStorage(), user);
    }

    /// @notice Total effective debt in a market (principal * effectiveScale / RAY).
    function totalDebt(uint256 marketId) external view returns (uint256) {
        AuraStorage.MarketState storage ms = AuraStorage.getStorage().marketStates[marketId];
        if (ms.globalDebtScale == 0) return 0;
        return (ms.totalPrincipalDebt * _effectiveScale(ms)) / AuraStorage.RAY;
    }

    /// @notice Total collateral in underlying assets for a market.
    function totalCollateralAssets(uint256 marketId) external view returns (uint256) {
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        IMarketRegistry.MarketConfig memory cfg = _getMarketCfg($.marketRegistry, marketId);
        return IERC4626(cfg.vault).convertToAssets($.marketStates[marketId].totalCollateralShares);
    }

    /// @notice Debt token address.
    function debtToken() external view returns (address) {
        return AuraStorage.getStorage().debtToken;
    }

    /// @notice Market registry address.
    function marketRegistry() external view returns (address) {
        return AuraStorage.getStorage().marketRegistry;
    }

    /// @notice Fetch market config from registry.
    function getMarket(uint256 marketId) external view returns (IMarketRegistry.MarketConfig memory) {
        return _getMarketCfg(AuraStorage.getStorage().marketRegistry, marketId);
    }

    /// @notice Collateral value (in debt-token units) for a user's position in one market.
    function getPositionCollateralValue(address user, uint256 marketId) external view returns (uint256) {
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        IMarketRegistry.MarketConfig memory cfg = _getMarketCfg($.marketRegistry, marketId);
        uint256 assets = IERC4626(cfg.vault).convertToAssets($.positions[user][marketId].collateralShares);
        (uint256 price, ) = IOracleRelay(cfg.oracle).getLatestPrice();
        return (assets * price) / AuraStorage.WAD;
    }

    /// @notice List of market IDs where a user has an active position.
    function getUserMarkets(address user) external view returns (uint256[] memory) {
        return AuraStorage.getStorage().userMarketIds[user];
    }

    /// @notice Current borrow index for a market (RAY; RAY = uninitialized/no interest).
    function getMarketBorrowIndex(uint256 marketId) external view returns (uint256) {
        uint256 idx = AuraStorage.getStorage().marketStates[marketId].borrowIndex;
        return idx == 0 ? AuraStorage.RAY : idx;
    }

    /// @notice Total accumulated protocol reserves for a market (WAD).
    function getMarketTotalReserves(uint256 marketId) external view returns (uint256) {
        return AuraStorage.getStorage().marketStates[marketId].totalReserves;
    }

    /// @notice Vault shares accumulated as protocol liquidation fee for a market.
    function getProtocolCollateralReserves(uint256 marketId) external view returns (uint256) {
        return AuraStorage.getStorage().marketStates[marketId].protocolCollateralReserves;
    }

    // ------------------------------- Phase 6: Flash Loans (EIP-3156)

    /// @notice Set the flash loan fee. Admin only. Max 10_000 bps (100%).
    function setFlashLoanFee(uint16 feeBps) external onlyAdmin {
        if (feeBps > 10_000) revert Aura__InvalidParams();
        AuraStorage.getStorage().flashLoanFeeBps = feeBps;
        emit FlashLoanFeeUpdated(feeBps);
    }

    /// @notice Maximum amount available for flash loan of `token`.
    ///         Returns 0 for any token other than the debt token.
    function maxFlashLoan(address token) external view returns (uint256) {
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        if (token != $.debtToken) return 0;
        (bool ok, bytes memory data) = token.staticcall(
            abi.encodeWithSelector(0x70a08231, address(this)) // balanceOf(address)
        );
        uint256 bal = (ok && data.length >= 32) ? abi.decode(data, (uint256)) : 0;
        uint256 reserves = $.flashLoanReserves;
        return bal > reserves ? bal - reserves : 0;
    }

    /// @notice Fee charged for a flash loan of `amount` of `token`.
    ///         Reverts for unsupported tokens.
    function flashFee(address token, uint256 amount) external view returns (uint256) {
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        if (token != $.debtToken) revert Aura__FlashLoanUnsupportedToken();
        return (amount * $.flashLoanFeeBps) / 10_000;
    }

    /// @notice Accumulated flash loan fee reserves (engine-wide).
    function getFlashLoanReserves() external view returns (uint256) {
        return AuraStorage.getStorage().flashLoanReserves;
    }

    /**
     * @notice EIP-3156 flash loan. Lends `amount` of `token` (must be debtToken) to `receiver`,
     *         calls `onFlashLoan`, then pulls back `amount + fee`.
     * @dev    Uses `nonReentrant` — receiver cannot re-enter engine functions during callback.
     */
    function flashLoan(
        IERC3156FlashBorrower receiver,
        address token,
        uint256 amount,
        bytes calldata data
    ) external whenNotPaused whenNotShutdown nonReentrant returns (bool) {
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        if (token != $.debtToken)  revert Aura__FlashLoanUnsupportedToken();
        if (amount == 0)           revert Aura__ZeroAmount();

        // Check available liquidity (exclude already-reserved fees)
        (bool ok, bytes memory balData) = token.staticcall(
            abi.encodeWithSelector(0x70a08231, address(this))
        );
        uint256 bal = (ok && balData.length >= 32) ? abi.decode(balData, (uint256)) : 0;
        uint256 available = bal > $.flashLoanReserves ? bal - $.flashLoanReserves : 0;
        if (amount > available) revert Aura__FlashLoanExceedsBalance();

        uint256 fee = (amount * $.flashLoanFeeBps) / 10_000;

        // 1. Send tokens
        _transferOut(token, address(receiver), amount);

        // 2. Callback
        bytes32 result = receiver.onFlashLoan(msg.sender, token, amount, fee, data);
        if (result != keccak256("ERC3156FlashBorrower.onFlashLoan"))
            revert Aura__FlashLoanCallbackFailed();

        // 3. Pull back principal + fee
        _transferIn(token, address(receiver), amount + fee);

        // 4. Accrue fee to reserves
        if (fee > 0) {
            unchecked { $.flashLoanReserves += fee; }
        }

        emit FlashLoan(address(receiver), token, amount, fee);
        return true;
    }

    /**
     * @notice Withdraw accumulated flash loan fee reserves. Admin only.
     * @param to     Recipient address (e.g. AuraTreasury)
     * @param amount Amount of debt token to withdraw
     */
    function withdrawFlashLoanReserves(address to, uint256 amount) external onlyAdmin {
        if (to == address(0)) revert Aura__InvalidParams();
        if (amount == 0)      revert Aura__ZeroAmount();
        AuraStorage.EngineStorage storage $ = AuraStorage.getStorage();
        if (amount > $.flashLoanReserves) revert Aura__InsufficientReserves();
        unchecked { $.flashLoanReserves -= amount; }
        _transferOut($.debtToken, to, amount);
        emit FlashLoanReservesWithdrawn(to, amount);
    }

    // ------------------------------- Internal: market helpers
    function _requireActiveMarket(
        address registry,
        uint256 marketId
    ) internal view returns (IMarketRegistry.MarketConfig memory cfg) {
        cfg = _getMarketCfg(registry, marketId);
        if (!cfg.isActive)  revert Aura__MarketInactive();
        if (cfg.isFrozen)   revert Aura__MarketFrozen();
    }

    function _getMarketCfg(
        address registry,
        uint256 marketId
    ) internal view returns (IMarketRegistry.MarketConfig memory) {
        if (!IMarketRegistry(registry).marketExists(marketId)) revert Aura__MarketNotFound();
        return IMarketRegistry(registry).getMarket(marketId);
    }

    // ------------------------------- Internal: isolation mode
    function _checkIsolationOnDeposit(
        AuraStorage.EngineStorage storage $,
        address user,
        uint256 marketId,
        bool    isIsolated
    ) internal {
        if (isIsolated) {
            // User must not have other active markets
            uint256[] storage mids = $.userMarketIds[user];
            for (uint256 i = 0; i < mids.length; i++) {
                if (mids[i] != marketId) {
                    AuraStorage.MarketPosition storage p = $.positions[user][mids[i]];
                    if (p.collateralShares > 0 || p.principalDebt > 0) revert Aura__IsolationViolation();
                }
            }
            $.userInIsolation[user]   = true;
            $.userIsolatedMarket[user] = marketId;
        } else {
            // User must not be in isolation mode (unless entering their own isolated market)
            if ($.userInIsolation[user] && $.userIsolatedMarket[user] != marketId)
                revert Aura__IsolationViolation();
        }
    }

    /// @dev Remove market from user tracking when position fully zeroed.
    function _tryExitMarket(
        AuraStorage.EngineStorage storage $,
        address user,
        uint256 marketId
    ) internal {
        AuraStorage.MarketPosition storage pos = $.positions[user][marketId];
        if (pos.collateralShares == 0 && pos.principalDebt == 0) {
            $.userInMarket[user][marketId] = false;
            // Remove from array (swap-and-pop)
            uint256[] storage mids = $.userMarketIds[user];
            uint256 len = mids.length;
            for (uint256 i = 0; i < len; i++) {
                if (mids[i] == marketId) {
                    mids[i] = mids[len - 1];
                    mids.pop();
                    break;
                }
            }
            // Clear isolation if this was the isolated market
            if ($.userInIsolation[user] && $.userIsolatedMarket[user] == marketId) {
                $.userInIsolation[user]    = false;
                $.userIsolatedMarket[user] = 0;
            }
        }
    }

    // ------------------------------- Internal: settle & health
    function _settlePosition(
        AuraStorage.EngineStorage storage $,
        address user,
        uint256 marketId
    ) internal {
        AuraStorage.MarketPosition storage pos = $.positions[user][marketId];
        AuraStorage.MarketState    storage ms  = $.marketStates[marketId];
        uint256 scale   = _effectiveScale(ms);
        uint256 scaleAt = pos.scaleAtLastUpdate == 0 ? AuraStorage.RAY : pos.scaleAtLastUpdate;
        uint256 oldPrincipal = pos.principalDebt;
        uint256 currentDebt  = FixedPoint.currentDebt(oldPrincipal, scale, scaleAt);
        pos.principalDebt     = currentDebt;
        pos.scaleAtLastUpdate = scale;
        uint256 total = ms.totalPrincipalDebt;
        ms.totalPrincipalDebt = oldPrincipal > total ? currentDebt : total - oldPrincipal + currentDebt;
    }

    function _currentDebtInMarket(
        AuraStorage.EngineStorage storage $,
        address user,
        uint256 marketId
    ) internal view returns (uint256) {
        AuraStorage.MarketPosition storage pos = $.positions[user][marketId];
        if (pos.scaleAtLastUpdate == 0 && pos.principalDebt == 0) return 0;
        AuraStorage.MarketState storage ms = $.marketStates[marketId];
        uint256 scale   = _effectiveScale(ms);
        uint256 scaleAt = pos.scaleAtLastUpdate == 0 ? AuraStorage.RAY : pos.scaleAtLastUpdate;
        return FixedPoint.currentDebt(pos.principalDebt, scale, scaleAt);
    }

    /// @dev Cross-collateral health factor:
    ///      HF = Σ(collateralValue_i * liquidationThreshold_i / 10000) / Σ(debt_i)
    function _healthFactor(
        AuraStorage.EngineStorage storage $,
        address user
    ) internal view returns (uint256) {
        uint256[] storage mids = $.userMarketIds[user];
        uint256 totalWeightedCollateral;
        uint256 totalUserDebt;
        uint256 len = mids.length;
        for (uint256 i = 0; i < len; i++) {
            uint256 mid = mids[i];
            AuraStorage.MarketPosition storage pos = $.positions[user][mid];
            if (pos.collateralShares == 0 && pos.principalDebt == 0) continue;
            IMarketRegistry.MarketConfig memory cfg = IMarketRegistry($.marketRegistry).getMarket(mid);
            uint256 assets = IERC4626(cfg.vault).convertToAssets(pos.collateralShares);
            (uint256 price, ) = IOracleRelay(cfg.oracle).getLatestPrice();
            uint256 collateralValue = (assets * price) / AuraStorage.WAD;
            totalWeightedCollateral += (collateralValue * cfg.liquidationThresholdBps) / 10_000;
            totalUserDebt           += _currentDebtInMarket($, user, mid);
        }
        if (totalUserDebt == 0) return type(uint256).max;
        return (totalWeightedCollateral * AuraStorage.WAD) / totalUserDebt;
    }

    function _requireHealthy(AuraStorage.EngineStorage storage $, address user) internal view {
        if (_healthFactor($, user) < AuraStorage.WAD) revert Aura__HealthFactorBelowOne();
    }

    function _requireLtv(
        AuraStorage.EngineStorage storage $,
        address user,
        uint256 marketId,
        IMarketRegistry.MarketConfig memory cfg
    ) internal view {
        uint256 debt = _currentDebtInMarket($, user, marketId);
        if (debt == 0) return;
        AuraStorage.MarketPosition storage pos = $.positions[user][marketId];
        uint256 assets = IERC4626(cfg.vault).convertToAssets(pos.collateralShares);
        (uint256 price, ) = IOracleRelay(cfg.oracle).getLatestPrice();
        uint256 collateralValue = (assets * price) / AuraStorage.WAD;
        if ((debt * 10_000) > (collateralValue * cfg.ltvBps)) revert Aura__ExceedsLTV();
    }

    function _collateralValuePerShare(
        IMarketRegistry.MarketConfig memory cfg
    ) internal view returns (uint256) {
        uint256 assetsPerShare = IERC4626(cfg.vault).convertToAssets(AuraStorage.WAD);
        (uint256 price, ) = IOracleRelay(cfg.oracle).getLatestPrice();
        return (assetsPerShare * price) / AuraStorage.WAD;
    }

    // ------------------------------- Internal: interest accrual

    /**
     * @dev Returns the effective combined scale for a market:
     *      effectiveScale = globalDebtScale * borrowIndex / RAY
     *      Falls back to RAY if either component is uninitialized (== 0).
     */
    function _effectiveScale(
        AuraStorage.MarketState storage ms
    ) internal view returns (uint256) {
        uint256 gds = ms.globalDebtScale == 0 ? AuraStorage.RAY : ms.globalDebtScale;
        uint256 bi  = ms.borrowIndex     == 0 ? AuraStorage.RAY : ms.borrowIndex;
        return (gds * bi) / AuraStorage.RAY;
    }

    /**
     * @dev Accrue interest for a market up to the current block timestamp.
     *      Must be called before any state mutation in a market.
     *      - Initialises borrowIndex / lastAccrualTimestamp on first call.
     *      - Skips when deltaT == 0 or IRM rates are all zero.
     */
    function _accrueInterest(
        AuraStorage.EngineStorage storage $,
        uint256 marketId
    ) internal {
        AuraStorage.MarketState storage ms = $.marketStates[marketId];

        // Initialise on first touch
        if (ms.borrowIndex == 0) {
            ms.borrowIndex          = AuraStorage.RAY;
            ms.lastAccrualTimestamp = block.timestamp;
            return;
        }

        uint256 deltaT = block.timestamp - ms.lastAccrualTimestamp;
        if (deltaT == 0) return;

        ms.lastAccrualTimestamp = block.timestamp;

        // Read IRM params from registry
        IMarketRegistry.MarketConfig memory cfg =
            IMarketRegistry($.marketRegistry).getMarket(marketId);

        // Skip computation if no IRM configured
        if (cfg.baseRate == 0 && cfg.slope1 == 0 && cfg.slope2 == 0) return;

        uint256 utilization = InterestRateModel.getUtilizationRate(
            ms.totalPrincipalDebt,
            cfg.borrowCap
        );
        uint256 ratePerSec = InterestRateModel.getBorrowRate(
            utilization,
            cfg.baseRate,
            cfg.slope1,
            cfg.slope2,
            cfg.kink
        );
        if (ratePerSec == 0) return;

        // borrowIndex grows: newIndex = oldIndex * (1 + rate * deltaT)
        // Using: newIndex = oldIndex + oldIndex * rate * deltaT / RAY
        uint256 interestFactor = (ratePerSec * deltaT); // RAY * seconds
        uint256 indexDelta     = (ms.borrowIndex * interestFactor) / AuraStorage.RAY;
        uint256 newBorrowIndex = ms.borrowIndex + indexDelta;

        // Compute gross interest on total debt (WAD)
        uint256 effectiveDebt = (ms.totalPrincipalDebt * ms.borrowIndex) / AuraStorage.RAY;
        uint256 interestAccrued = (effectiveDebt * interestFactor) / AuraStorage.RAY;

        // Reserve accrual
        uint256 reservesAccrued;
        if (cfg.reserveFactorBps > 0 && interestAccrued > 0) {
            reservesAccrued = (interestAccrued * cfg.reserveFactorBps) / 10_000;
            ms.totalReserves += reservesAccrued;
        }

        ms.borrowIndex = newBorrowIndex;

        emit InterestAccrued(marketId, interestAccrued, reservesAccrued, newBorrowIndex);
    }

    function _transferIn(address token, address from, uint256 amount) internal {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(0x23b872dd, from, address(this), amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert Aura__InvalidParams();
    }

    function _transferOut(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert Aura__InvalidParams();
    }
}
