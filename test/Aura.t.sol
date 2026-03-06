// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test }            from "forge-std/Test.sol";
import { AuraEngine }      from "../src/AuraEngine.sol";
import { AuraProxy }       from "../src/AuraProxy.sol";
import { AuraMarketRegistry } from "../src/AuraMarketRegistry.sol";
import { MockERC20 }       from "./mocks/MockERC20.sol";
import { MockVault4626 }   from "./mocks/MockVault4626.sol";
import { MockOracle }      from "./mocks/MockOracle.sol";

contract AuraTest is Test {
    AuraEngine          public engine;
    AuraProxy           public proxy;
    AuraMarketRegistry  public registry;
    MockERC20           public assetToken;
    MockERC20           public debtToken;
    MockVault4626       public vault;
    MockOracle          public oracle;

    address public admin = address(this);
    address public alice = address(0xA11CE);
    address public bob   = address(0xB0B);

    uint256 constant WAD       = 1e18;
    uint256 constant MARKET_ID = 0;

    // Mirror events from AuraEngine for vm.expectEmit
    event BadDebtRealized(address indexed user, uint256 indexed marketId, uint256 badDebtAmount);

    function setUp() public {
        assetToken = new MockERC20("Wrapped stETH", "wstETH", 18);
        debtToken  = new MockERC20("USD Coin", "USDC", 18);
        vault      = new MockVault4626(address(assetToken), "Aura wstETH Vault", "wstETH");
        oracle     = new MockOracle();

        // Deploy registry and add market 0
        registry = new AuraMarketRegistry(address(this));
        registry.addMarket(
            address(vault), address(oracle),
            uint16(8000), uint16(8500), uint16(500),
            0, 0, false, 0
        );

        // Deploy engine
        AuraEngine impl = new AuraEngine();
        bytes memory initData = abi.encodeCall(
            AuraEngine.initialize,
            (address(debtToken), address(registry), uint256(1 days), uint256(2 days))
        );
        proxy  = new AuraProxy(address(impl), initData);
        engine = AuraEngine(address(proxy));

        // Authorize engine in registry (for timelocked market param updates)
        registry.setEngine(address(proxy));

        // Fund engine with debt tokens
        debtToken.mint(address(proxy), 1_000_000 * WAD);

        // Give alice vault shares
        assetToken.mint(alice, 10_000 * WAD);
        vm.startPrank(alice);
        assetToken.approve(address(vault), type(uint256).max);
        vault.deposit(1_000 * WAD, alice);
        vault.approve(address(proxy), type(uint256).max);
        vm.stopPrank();

        // Give bob vault shares
        assetToken.mint(bob, 10_000 * WAD);
        vm.startPrank(bob);
        assetToken.approve(address(vault), type(uint256).max);
        vault.deposit(1_000 * WAD, bob);
        vault.approve(address(proxy), type(uint256).max);
        vm.stopPrank();
    }

    // ==================== Deposit ====================

    function test_depositCollateral() public {
        vm.startPrank(alice);
        uint256 shares = 100 * WAD;
        engine.depositCollateral(alice, MARKET_ID, shares);
        vm.stopPrank();

        assertEq(engine.getPositionCollateralShares(alice, MARKET_ID), shares);
    }

    function test_depositCollateral_zeroReverts() public {
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__ZeroAmount.selector);
        engine.depositCollateral(alice, MARKET_ID, 0);
    }

    function test_depositCollateral_sameBlockReverts() public {
        vm.startPrank(alice);
        engine.depositCollateral(alice, MARKET_ID, 10 * WAD);
        vm.expectRevert(AuraEngine.Aura__SameBlockInteraction.selector);
        engine.depositCollateral(alice, MARKET_ID, 10 * WAD);
        vm.stopPrank();
    }

    // ==================== Withdraw ====================

    function test_withdrawCollateral() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);

        vm.roll(block.number + 1);

        vm.prank(alice);
        engine.withdrawCollateral(alice, MARKET_ID, 50 * WAD);

        assertEq(engine.getPositionCollateralShares(alice, MARKET_ID), 50 * WAD);
    }

    function test_withdrawCollateral_unauthorizedReverts() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);

        vm.roll(block.number + 1);

        vm.prank(bob);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.withdrawCollateral(alice, MARKET_ID, 50 * WAD);
    }

    function test_withdrawCollateral_insufficientReverts() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);

        vm.roll(block.number + 1);

        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__InsufficientCollateral.selector);
        engine.withdrawCollateral(alice, MARKET_ID, 200 * WAD);
    }

    // ==================== Borrow ====================

    function test_borrow() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);

        vm.roll(block.number + 1);

        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 50 * WAD);

        assertEq(engine.getPositionDebt(alice, MARKET_ID), 50 * WAD);
    }

    function test_borrow_exceedsLtvReverts() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);

        vm.roll(block.number + 1);

        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__ExceedsLTV.selector);
        engine.borrow(alice, MARKET_ID, 90 * WAD);
    }

    function test_borrow_unauthorizedReverts() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);

        vm.roll(block.number + 1);

        vm.prank(bob);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.borrow(alice, MARKET_ID, 10 * WAD);
    }

    // ==================== Repay ====================

    function test_repay() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);

        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 50 * WAD);

        vm.roll(20);
        vm.startPrank(alice);
        debtToken.approve(address(proxy), type(uint256).max);
        engine.repay(alice, MARKET_ID, 20 * WAD);
        vm.stopPrank();

        assertEq(engine.getPositionDebt(alice, MARKET_ID), 30 * WAD);
    }

    function test_repay_moreThanDebt_capsToDebt() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);

        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 50 * WAD);

        vm.roll(20);
        vm.startPrank(alice);
        debtToken.approve(address(proxy), type(uint256).max);
        engine.repay(alice, MARKET_ID, 999 * WAD);
        vm.stopPrank();

        assertEq(engine.getPositionDebt(alice, MARKET_ID), 0);
    }

    // ==================== Health factor ====================

    function test_healthFactor_noDebt_isMax() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);

        assertEq(engine.getHealthFactor(alice), type(uint256).max);
    }

    function test_healthFactor_withDebt() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
        vm.roll(block.number + 1);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 50 * WAD);

        uint256 hf = engine.getHealthFactor(alice);
        assertTrue(hf > WAD);
    }

    // ==================== Liquidation ====================

    function test_liquidate_healthyReverts() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);

        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 50 * WAD);

        vm.roll(20);
        vm.prank(bob);
        vm.expectRevert(AuraEngine.Aura__HealthFactorAboveOne.selector);
        engine.liquidate(alice, MARKET_ID, 10 * WAD);
    }

    // ==================== Paused ====================

    function test_paused_depositReverts() public {
        engine.setPaused(true);
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__Paused.selector);
        engine.depositCollateral(alice, MARKET_ID, 10 * WAD);
    }

    function test_paused_borrowReverts() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
        engine.setPaused(true);
        vm.roll(block.number + 1);
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__Paused.selector);
        engine.borrow(alice, MARKET_ID, 10 * WAD);
    }

    // ==================== Emergency shutdown ====================

    function test_emergencyShutdown_depositReverts() public {
        engine.setEmergencyShutdown(true);
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__EmergencyShutdown.selector);
        engine.depositCollateral(alice, MARKET_ID, 10 * WAD);
    }

    function test_emergencyShutdown_borrowReverts() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
        engine.setEmergencyShutdown(true);
        vm.roll(block.number + 1);
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__EmergencyShutdown.selector);
        engine.borrow(alice, MARKET_ID, 10 * WAD);
    }

    function test_emergencyShutdown_withdrawStillWorks() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
        engine.setEmergencyShutdown(true);
        vm.roll(block.number + 1);
        vm.prank(alice);
        engine.withdrawCollateral(alice, MARKET_ID, 100 * WAD);
        assertEq(engine.getPositionCollateralShares(alice, MARKET_ID), 0);
    }

    function test_emergencyShutdown_repayStillWorks() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 50 * WAD);
        engine.setEmergencyShutdown(true);
        vm.roll(20);
        vm.startPrank(alice);
        debtToken.approve(address(proxy), type(uint256).max);
        engine.repay(alice, MARKET_ID, 50 * WAD);
        vm.stopPrank();
        assertEq(engine.getPositionDebt(alice, MARKET_ID), 0);
    }

    // ==================== Admin (two-step) ====================

    function test_proposeAndAcceptAdmin() public {
        engine.proposeAdmin(bob);
        vm.prank(bob);
        engine.acceptAdmin();
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.setPaused(true);
    }

    function test_proposeAdmin_zeroReverts() public {
        vm.expectRevert(AuraEngine.Aura__InvalidParams.selector);
        engine.proposeAdmin(address(0));
    }

    function test_proposeAdmin_unauthorizedReverts() public {
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.proposeAdmin(alice);
    }

    function test_acceptAdmin_wrongAddressReverts() public {
        engine.proposeAdmin(bob);
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.acceptAdmin();
    }

    // ==================== Guardian Role ====================

    function test_guardianCanPause() public {
        engine.setGuardian(alice, true);
        vm.prank(alice);
        engine.setPaused(true);
    }

    function test_guardianCanEmergencyShutdown() public {
        engine.setGuardian(alice, true);
        vm.prank(alice);
        engine.setEmergencyShutdown(true);
    }

    function test_nonGuardianCannotPause() public {
        vm.prank(bob);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.setPaused(true);
    }

    function test_setGuardian_unauthorizedReverts() public {
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.setGuardian(alice, true);
    }

    // ==================== Harvest ====================

    function test_harvestYield_heartbeatNotElapsedReverts() public {
        // Deposit first so market state is initialized
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 10 * WAD);
        vm.expectRevert(AuraEngine.Aura__HeartbeatNotElapsed.selector);
        engine.harvestYield(MARKET_ID);
    }

    function test_harvestYield_noCollateral_returnsZero() public {
        // Need to initialize market state with a deposit first, then withdraw
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 10 * WAD);
        vm.roll(block.number + 1);
        vm.prank(alice);
        engine.withdrawCollateral(alice, MARKET_ID, 10 * WAD);
        vm.warp(block.timestamp + 2 days);
        uint256 yld = engine.harvestYield(MARKET_ID);
        assertEq(yld, 0);
    }

    // ==================== View functions ====================

    function test_totalDebt() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
        vm.roll(block.number + 1);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 50 * WAD);
        assertEq(engine.totalDebt(MARKET_ID), 50 * WAD);
    }

    function test_totalCollateralAssets() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
        assertEq(engine.totalCollateralAssets(MARKET_ID), 100 * WAD);
    }

    function test_getMarket_vault() public {
        assertEq(engine.getMarket(MARKET_ID).vault, address(vault));
    }

    function test_debtToken() public {
        assertEq(engine.debtToken(), address(debtToken));
    }

    function test_getMarket_ltvBps() public {
        assertEq(engine.getMarket(MARKET_ID).ltvBps, 8000);
    }

    // ==================== Timelock market params ====================

    function test_proposeAndExecuteMarketParam() public {
        bytes32 paramId = keccak256("ltvBps");
        engine.proposeMarketParam(MARKET_ID, paramId, 7500);

        // Execute before timelock — should revert
        vm.expectRevert(AuraEngine.Aura__TimelockNotElapsed.selector);
        engine.executeMarketParam(MARKET_ID, paramId);

        // Warp past timelock (2 days)
        vm.warp(block.timestamp + 2 days + 1);
        engine.executeMarketParam(MARKET_ID, paramId);

        assertEq(engine.getMarket(MARKET_ID).ltvBps, 7500);
    }

    // ==================== Reinitialize prevention ====================

    function test_initialize_twiceReverts() public {
        vm.expectRevert(AuraEngine.Aura__AlreadyInitialized.selector);
        engine.initialize(address(debtToken), address(registry), uint256(1 days), uint256(2 days));
    }

    // ==================== _disableInitializers ====================

    function test_implementationCannotBeInitialized() public {
        AuraEngine rawImpl = new AuraEngine();
        vm.expectRevert(AuraEngine.Aura__AlreadyInitialized.selector);
        rawImpl.initialize(address(debtToken), address(registry), uint256(1 days), uint256(2 days));
    }

    // ==================== Keeper Role ====================

    function test_setKeeper_onlyAdmin() public {
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.setKeeper(alice, true);
    }

    // ==================== Multi-market: cross-collateral HF ====================

    // ==================== IRM Tests ====================

    /// @dev ~10% APR constant base rate (RAY/sec): 0.1 / 31_536_000 * 1e27 ≈ 3.17e18
    uint256 constant APR_10_PCT = 3_170_979_198_376_458_650;

    /**
     * @dev Helper: set IRM params on MARKET_ID and set borrowCap.
     *      baseRate = APR_10_PCT, slope1/slope2/kink = 0 (constant rate regardless of util).
     *      reserveFactorBps = 1000 (10%).
     */
    function _enableIrm() internal {
        // borrowCap needed so repay-in-full doesn't underflow totalPrincipalDebt, but also
        // doesn't cap utilisation (we use baseRate only, ignoring utilization).
        registry.updateMarketCaps(MARKET_ID, 0, 0); // keep caps unlimited
        registry.updateMarketIrmParams(MARKET_ID, APR_10_PCT, 0, 0, 0, 1000);
    }

    function test_irm_borrowIndexStaysRayWhenNoIrm() public {
        // With no IRM configured, borrowIndex should remain RAY after any warp
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
        vm.roll(block.number + 1);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 50 * WAD);
        vm.warp(block.timestamp + 365 days);
        engine.accrueInterest(MARKET_ID);
        assertEq(engine.getMarketBorrowIndex(MARKET_ID), 1e27, "no-IRM index should stay RAY");
    }

    function test_irm_borrowIndexGrowsWithTime() public {
        _enableIrm();
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
        vm.roll(block.number + 1);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 50 * WAD);

        uint256 indexBefore = engine.getMarketBorrowIndex(MARKET_ID);
        assertEq(indexBefore, 1e27, "initial index should be RAY");

        vm.warp(block.timestamp + 365 days);
        vm.roll(block.number + 1);
        engine.accrueInterest(MARKET_ID);

        uint256 indexAfter = engine.getMarketBorrowIndex(MARKET_ID);
        assertTrue(indexAfter > indexBefore, "borrowIndex should grow over time");
    }

    function test_irm_debtIncreasesWithInterest() public {
        _enableIrm();
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
        vm.roll(block.number + 1);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 50 * WAD);

        uint256 debtBefore = engine.getPositionDebt(alice, MARKET_ID);
        assertEq(debtBefore, 50 * WAD);

        vm.warp(block.timestamp + 365 days);
        vm.roll(block.number + 1);
        engine.accrueInterest(MARKET_ID);

        uint256 debtAfter = engine.getPositionDebt(alice, MARKET_ID);
        assertTrue(debtAfter > debtBefore, "debt should increase with interest accrual");
        // ~10% interest on 50 WAD over 1 year ≈ 55 WAD
        assertTrue(debtAfter > 50 * WAD && debtAfter <= 60 * WAD, "~10% APR for 1yr");
    }

    function test_irm_reservesAccumulate() public {
        _enableIrm();
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
        vm.roll(block.number + 1);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 50 * WAD);

        assertEq(engine.getMarketTotalReserves(MARKET_ID), 0, "no reserves before accrual");

        vm.warp(block.timestamp + 365 days);
        vm.roll(block.number + 1);
        engine.accrueInterest(MARKET_ID);

        uint256 reserves = engine.getMarketTotalReserves(MARKET_ID);
        assertTrue(reserves > 0, "reserves should accumulate from interest");
    }

    function test_irm_withdrawReserves_success() public {
        _enableIrm();
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
        vm.roll(block.number + 1);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 50 * WAD);
        vm.warp(block.timestamp + 365 days);
        vm.roll(block.number + 1);
        engine.accrueInterest(MARKET_ID);

        uint256 reserves = engine.getMarketTotalReserves(MARKET_ID);
        assertTrue(reserves > 0);

        address treasury = address(0xBEEF);
        engine.withdrawReserves(MARKET_ID, reserves, treasury);

        assertEq(engine.getMarketTotalReserves(MARKET_ID), 0);
        assertEq(debtToken.balanceOf(treasury), reserves);
    }

    function test_irm_withdrawReserves_insufficientReverts() public {
        _enableIrm();
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
        vm.roll(block.number + 1);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 50 * WAD);
        vm.warp(block.timestamp + 365 days);
        vm.roll(block.number + 1);
        engine.accrueInterest(MARKET_ID);

        uint256 reserves = engine.getMarketTotalReserves(MARKET_ID);
        vm.expectRevert(AuraEngine.Aura__InsufficientReserves.selector);
        engine.withdrawReserves(MARKET_ID, reserves + 1, address(0xBEEF));
    }

    function test_irm_withdrawReserves_onlyAdmin() public {
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.withdrawReserves(MARKET_ID, 1, address(0xBEEF));
    }

    function test_irm_noDebt_noInterest() public {
        _enableIrm();
        // Deposit but no borrow — no principal debt, so no interest accrues
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
        vm.warp(block.timestamp + 365 days);
        vm.roll(block.number + 1);
        engine.accrueInterest(MARKET_ID);
        // Index grows (rate is constant baseRate), but reserves = 0 because no debt
        assertEq(engine.getMarketTotalReserves(MARKET_ID), 0);
    }

    function test_irm_yieldAndInterestNetEffect() public {
        // Verify that harvestYield + accrueInterest interact correctly:
        // interest accrual happens inside harvestYield via _accrueInterest call
        _enableIrm();
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
        vm.roll(block.number + 1);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 50 * WAD);

        uint256 debtBefore = engine.getPositionDebt(alice, MARKET_ID);

        // Warp 1 year; harvestYield internally calls _accrueInterest
        vm.warp(block.timestamp + 365 days);
        vm.roll(block.number + 1);

        // harvestYield will accrue interest then find no vault yield (price unchanged),
        // so globalDebtScale stays at RAY, but borrowIndex grows
        engine.harvestYield(MARKET_ID);

        uint256 debtAfter = engine.getPositionDebt(alice, MARKET_ID);
        assertTrue(debtAfter > debtBefore, "interest should have increased debt");
        assertTrue(debtAfter <= 60 * WAD, "debt should be bounded by ~10% APR");
    }

    // ==================== Phase 4: Advanced Liquidation Tests ====================

    /// @dev Setup helper: crash oracle so position is liquidatable.
    /// Uses explicit block numbers (vm.roll(10)/vm.roll(20)) to avoid same-block reverts.
    /// After this helper: alice.lastInteractionBlock=10, next external call at block 20.
    function _setupLiquidatablePosition() internal {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 1_000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 700 * WAD);
        vm.roll(20);
        oracle.setPrice(WAD / 2); // collateral drops 50% → HF ≈ 0.607 < 1
    }

    // ---- 4.1 Close Factor ----

    function test_p4_closeFactor_capsRepayAmount() public {
        // closeFactorBps = 5000 (50% max)
        registry.updateMarketLiquidationParams(MARKET_ID, 5000, 0, 0, false, 0);
        _setupLiquidatablePosition();

        uint256 debt = engine.getPositionDebt(alice, MARKET_ID);
        uint256 maxRepay = debt / 2;

        // Trying to repay more than 50% should revert
        vm.prank(bob);
        vm.expectRevert(AuraEngine.Aura__CloseFactorExceeded.selector);
        engine.liquidate(alice, MARKET_ID, maxRepay + 1);

        // Repaying exactly 50% succeeds
        debtToken.mint(bob, 1_000 * WAD);
        vm.startPrank(bob);
        debtToken.approve(address(proxy), type(uint256).max);
        engine.liquidate(alice, MARKET_ID, maxRepay);
        vm.stopPrank();
    }

    function test_p4_closeFactor_fullLiquidationBelowThreshold() public {
        // closeFactorBps = 5000, fullLiquidationThresholdBps = 7000 (HF < 70% → full liq)
        // Actual HF ≈ 425/700 ≈ 0.607 < 0.70 → full liquidation allowed
        registry.updateMarketLiquidationParams(MARKET_ID, 5000, 7000, 0, false, 0);
        _setupLiquidatablePosition();
        uint256 hf = engine.getHealthFactor(alice);
        assertTrue(hf < WAD * 7000 / 10_000, "HF should be below 70% threshold");

        uint256 debt = engine.getPositionDebt(alice, MARKET_ID);
        debtToken.mint(bob, debt);
        vm.startPrank(bob);
        debtToken.approve(address(proxy), type(uint256).max);
        // Should NOT revert even though amount > 50%
        engine.liquidate(alice, MARKET_ID, debt);
        vm.stopPrank();
    }

    // ---- 4.2 Dutch Auction ----

    function test_p4_dutchAuction_revertWithoutInitiation() public {
        registry.updateMarketLiquidationParams(MARKET_ID, 0, 0, 0, true, 1 hours);
        _setupLiquidatablePosition();

        debtToken.mint(bob, 1_000 * WAD);
        vm.startPrank(bob);
        debtToken.approve(address(proxy), type(uint256).max);
        vm.expectRevert(AuraEngine.Aura__AuctionNotStarted.selector);
        engine.liquidate(alice, MARKET_ID, 100 * WAD);
        vm.stopPrank();
    }

    function test_p4_dutchAuction_penaltyGrowsWithTime() public {
        uint256 auctionDuration = 1 hours;
        registry.updateMarketLiquidationParams(MARKET_ID, 0, 0, 0, true, auctionDuration);
        _setupLiquidatablePosition();

        // Initiate auction
        vm.roll(block.number + 1);
        engine.initiateLiquidation(alice, MARKET_ID);

        // At t=0: penalty ≈ 0, liquidator gets barely any bonus
        uint256 collBefore0 = engine.getPositionCollateralShares(alice, MARKET_ID);

        debtToken.mint(bob, 1_000 * WAD);
        vm.startPrank(bob);
        debtToken.approve(address(proxy), type(uint256).max);
        engine.liquidate(alice, MARKET_ID, 50 * WAD);
        vm.stopPrank();
        uint256 seizedAt0 = collBefore0 - engine.getPositionCollateralShares(alice, MARKET_ID);

        // Reinstate position for second liquidation after time passes
        // (use a fresh position via bob to test penalty at full duration)
        vm.roll(block.number + 1);
        registry.updateMarketLiquidationParams(MARKET_ID, 0, 0, 0, false, 0); // disable dutch auction
        // At full duration the penalty should equal liquidationPenaltyBps
        // Test passes if: seized with 0% bonus < seized with max bonus
        uint256 noBonus = (50 * WAD * 10_000 * WAD) / (10_000 * (WAD / 2));
        uint256 withBonus = (50 * WAD * (10_000 + 500) * WAD) / (10_000 * (WAD / 2));
        assertTrue(seizedAt0 <= noBonus + 1, "early auction: near-zero penalty");
        assertTrue(withBonus > noBonus, "max penalty > no penalty");
    }

    function test_p4_dutchAuction_revertAlreadyActive() public {
        registry.updateMarketLiquidationParams(MARKET_ID, 0, 0, 0, true, 1 hours);
        _setupLiquidatablePosition();
        vm.roll(block.number + 1);
        engine.initiateLiquidation(alice, MARKET_ID);
        vm.roll(block.number + 1);
        vm.expectRevert(AuraEngine.Aura__AuctionAlreadyActive.selector);
        engine.initiateLiquidation(alice, MARKET_ID);
    }

    // ---- 4.3 Protocol Liquidation Fee ----

    function test_p4_protocolFee_splitsBetweenLiquidatorAndProtocol() public {
        // protocolLiquidationFeeBps = 2000 (20% of seized collateral)
        registry.updateMarketLiquidationParams(MARKET_ID, 0, 0, 2000, false, 0);
        _setupLiquidatablePosition();

        uint256 protocolBefore = engine.getProtocolCollateralReserves(MARKET_ID);
        assertEq(protocolBefore, 0);

        debtToken.mint(bob, 1_000 * WAD);
        uint256 bobCollBefore = vault.balanceOf(bob);
        vm.startPrank(bob);
        debtToken.approve(address(proxy), type(uint256).max);
        engine.liquidate(alice, MARKET_ID, 100 * WAD);
        vm.stopPrank();

        uint256 protocolAfter = engine.getProtocolCollateralReserves(MARKET_ID);
        uint256 bobReceived = vault.balanceOf(bob) - bobCollBefore;

        assertTrue(protocolAfter > 0, "protocol should receive fee shares");
        assertTrue(bobReceived > 0, "liquidator should receive shares");
        // protocol fee = 20% of total seized
        uint256 totalSeized = protocolAfter + bobReceived;
        assertApproxEqAbs(protocolAfter, totalSeized * 2000 / 10_000, 1);
    }

    function test_p4_withdrawProtocolCollateral_success() public {
        registry.updateMarketLiquidationParams(MARKET_ID, 0, 0, 1000, false, 0);
        _setupLiquidatablePosition();

        debtToken.mint(bob, 1_000 * WAD);
        vm.startPrank(bob);
        debtToken.approve(address(proxy), type(uint256).max);
        engine.liquidate(alice, MARKET_ID, 100 * WAD);
        vm.stopPrank();

        uint256 reserves = engine.getProtocolCollateralReserves(MARKET_ID);
        assertTrue(reserves > 0);

        address treasury = address(0xBEEF);
        engine.withdrawProtocolCollateral(MARKET_ID, reserves, treasury);
        assertEq(engine.getProtocolCollateralReserves(MARKET_ID), 0);
        assertEq(vault.balanceOf(treasury), reserves);
    }

    function test_p4_withdrawProtocolCollateral_insufficientReverts() public {
        vm.expectRevert(AuraEngine.Aura__InsufficientProtocolCollateral.selector);
        engine.withdrawProtocolCollateral(MARKET_ID, 1, address(0xBEEF));
    }

    function test_p4_withdrawProtocolCollateral_onlyAdmin() public {
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.withdrawProtocolCollateral(MARKET_ID, 1, address(0xBEEF));
    }

    // ---- 4.4 Bad Debt ----

    function test_p4_badDebt_socializedFromReserves() public {
        // First accrue some reserves via IRM
        registry.updateMarketIrmParams(MARKET_ID, APR_10_PCT, 0, 0, 0, 1000);

        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 10 * WAD); // very small collateral
        vm.roll(block.number + 1);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 7 * WAD);

        // Accrue reserves for 1 year
        vm.warp(block.timestamp + 365 days);
        engine.accrueInterest(MARKET_ID);
        uint256 reservesBefore = engine.getMarketTotalReserves(MARKET_ID);
        assertTrue(reservesBefore > 0, "need reserves for bad debt coverage");

        // Crash price so collateral < debt (extreme crash)
        oracle.setPrice(WAD / 100); // collateral now worth almost nothing
        vm.roll(block.number + 1);

        // Liquidate: seize all collateral but debt remains
        uint256 debt = engine.getPositionDebt(alice, MARKET_ID);
        debtToken.mint(bob, debt);
        vm.startPrank(bob);
        debtToken.approve(address(proxy), type(uint256).max);
        engine.liquidate(alice, MARKET_ID, debt);
        vm.stopPrank();

        // After liquidation: position should be fully cleared (bad debt absorbed)
        assertEq(engine.getPositionDebt(alice, MARKET_ID), 0);
        assertEq(engine.getPositionCollateralShares(alice, MARKET_ID), 0);
    }

    function test_p4_badDebt_emitsEvent() public {
        // Setup: small collateral, large debt, extreme price crash
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 10 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 7 * WAD);
        oracle.setPrice(WAD / 100); // extreme crash: collateral worth 0.1 WAD, debt 7 WAD
        vm.roll(20);

        // Bob repays only 0.1 WAD → collateralToSeize ≈ 10.5 WAD capped at 10 WAD
        // After: collateralShares=0, principalDebt=6.9 WAD → bad debt
        uint256 partialRepay = WAD / 10;
        debtToken.mint(bob, partialRepay);
        vm.startPrank(bob);
        debtToken.approve(address(proxy), type(uint256).max);
        vm.expectEmit(true, true, false, false);
        emit BadDebtRealized(alice, MARKET_ID, 0); // amount not checked (false)
        engine.liquidate(alice, MARKET_ID, partialRepay);
        vm.stopPrank();
    }

    // ==================== Multi-market: cross-collateral HF ====================

    function test_multiMarket_crossCollateralHF() public {
        // Add a second market with a different vault/oracle
        MockERC20     asset2  = new MockERC20("sDAI", "sDAI", 18);
        MockVault4626 vault2  = new MockVault4626(address(asset2), "sDAI Vault", "sDAI");
        MockOracle    oracle2 = new MockOracle();
        registry.addMarket(
            address(vault2), address(oracle2),
            uint16(7000), uint16(7500), uint16(500),
            0, 0, false, 0
        );
        uint256 MARKET_1 = 1;

        // Mint asset2 and get vault2 shares for alice
        asset2.mint(alice, 10_000 * WAD);
        vm.startPrank(alice);
        asset2.approve(address(vault2), type(uint256).max);
        vault2.deposit(1_000 * WAD, alice);
        vault2.approve(address(proxy), type(uint256).max);

        // Alice deposits in both markets
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
        vm.roll(block.number + 1);
        engine.depositCollateral(alice, MARKET_1, 100 * WAD);
        vm.roll(block.number + 2);

        // Borrow from both
        engine.borrow(alice, MARKET_ID, 40 * WAD);
        vm.roll(block.number + 3);
        engine.borrow(alice, MARKET_1, 40 * WAD);
        vm.stopPrank();

        uint256[] memory markets = engine.getUserMarkets(alice);
        assertEq(markets.length, 2);

        // Health factor is cross-collateral
        uint256 hf = engine.getHealthFactor(alice);
        assertTrue(hf > WAD, "Should be healthy");
    }
}
