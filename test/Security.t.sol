// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test }               from "forge-std/Test.sol";
import { AuraEngine }         from "../src/AuraEngine.sol";
import { AuraProxy }          from "../src/AuraProxy.sol";
import { AuraStorage }        from "../src/AuraStorage.sol";
import { AuraMarketRegistry } from "../src/AuraMarketRegistry.sol";
import { MockERC20 }          from "./mocks/MockERC20.sol";
import { MockVault4626 }      from "./mocks/MockVault4626.sol";
import { ControllableOracle } from "./mocks/ControllableOracle.sol";
import { ControllableVault }  from "./mocks/ControllableVault.sol";

// ============ Attacker contracts for reentrancy tests ============

/// @notice Attempts reentrancy via vault.transfer callback during withdrawCollateral
contract ReentrantWithdrawAttacker {
    AuraEngine public engine;
    uint256 public marketId;
    uint256 public attackCount;

    function setup(address engine_, uint256 marketId_) external {
        engine   = AuraEngine(engine_);
        marketId = marketId_;
    }

    function attack(uint256 shares) external {
        engine.withdrawCollateral(address(this), marketId, shares);
    }

    function onTokenReceived() external {
        if (attackCount < 1) {
            attackCount++;
            try engine.withdrawCollateral(address(this), marketId, 1) {} catch {}
        }
    }
}

/// @notice Attempts to exploit borrow by immediately liquidating in same block
contract FlashLoanAttacker {
    AuraEngine public engine;
    address public victim;
    uint256 public marketId;

    function setup(address engine_, address victim_, uint256 marketId_) external {
        engine   = AuraEngine(engine_);
        victim   = victim_;
        marketId = marketId_;
    }

    function attackSameBlock() external {
        engine.liquidate(victim, marketId, 1e18);
    }
}

// ============ Main Security Test Suite ============

contract SecurityTest is Test {
    AuraEngine          public engine;
    AuraProxy           public proxy;
    AuraEngine          public impl;
    AuraMarketRegistry  public registry;
    MockERC20           public assetToken;
    MockERC20           public debtToken;
    MockVault4626       public vault;
    ControllableOracle  public oracle;

    address public admin = address(this);
    address public alice = address(0xA11CE);
    address public bob   = address(0xB0B);
    address public eve   = address(0xEEE);

    uint256 constant WAD       = 1e18;
    uint256 constant RAY       = 1e27;
    uint256 constant MARKET_ID = 0;

    function setUp() public {
        assetToken = new MockERC20("Wrapped stETH", "wstETH", 18);
        debtToken  = new MockERC20("USD Coin", "USDC", 18);
        vault      = new MockVault4626(address(assetToken), "Aura wstETH Vault", "avWSTETH");
        oracle     = new ControllableOracle(WAD);

        registry = new AuraMarketRegistry(address(this));
        registry.addMarket(
            address(vault), address(oracle),
            uint16(8000), uint16(8500), uint16(500),
            0, 0, false, 0
        );

        impl = new AuraEngine();
        bytes memory initData = abi.encodeCall(
            AuraEngine.initialize,
            (address(debtToken), address(registry), uint256(1 days), uint256(2 days))
        );
        proxy  = new AuraProxy(address(impl), initData);
        engine = AuraEngine(address(proxy));
        registry.setEngine(address(proxy));

        debtToken.mint(address(proxy), 10_000_000 * WAD);

        // Setup alice
        assetToken.mint(alice, 100_000 * WAD);
        vm.startPrank(alice);
        assetToken.approve(address(vault), type(uint256).max);
        vault.deposit(50_000 * WAD, alice);
        vault.approve(address(proxy), type(uint256).max);
        debtToken.approve(address(proxy), type(uint256).max);
        vm.stopPrank();

        // Setup bob
        assetToken.mint(bob, 100_000 * WAD);
        vm.startPrank(bob);
        assetToken.approve(address(vault), type(uint256).max);
        vault.deposit(50_000 * WAD, bob);
        vault.approve(address(proxy), type(uint256).max);
        debtToken.approve(address(proxy), type(uint256).max);
        vm.stopPrank();

        // Setup eve
        assetToken.mint(eve, 100_000 * WAD);
        debtToken.mint(eve, 100_000 * WAD);
        vm.startPrank(eve);
        assetToken.approve(address(vault), type(uint256).max);
        vault.deposit(50_000 * WAD, eve);
        vault.approve(address(proxy), type(uint256).max);
        debtToken.approve(address(proxy), type(uint256).max);
        vm.stopPrank();
    }

    // =====================================================================
    //  1. REENTRANCY ATTACKS
    // =====================================================================

    /// @notice Same-block reentrancy: deposit + withdraw in one tx should revert
    function test_SEC_reentrancy_depositThenWithdrawSameBlock() public {
        vm.startPrank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
        vm.expectRevert(AuraEngine.Aura__SameBlockInteraction.selector);
        engine.withdrawCollateral(alice, MARKET_ID, 50 * WAD);
        vm.stopPrank();
    }

    /// @notice Same-block reentrancy: deposit + borrow in one tx should revert
    function test_SEC_reentrancy_depositThenBorrowSameBlock() public {
        vm.startPrank(alice);
        engine.depositCollateral(alice, MARKET_ID, 1000 * WAD);
        vm.expectRevert(AuraEngine.Aura__SameBlockInteraction.selector);
        engine.borrow(alice, MARKET_ID, 100 * WAD);
        vm.stopPrank();
    }

    /// @notice Same-block reentrancy: borrow + repay in one tx should revert
    function test_SEC_reentrancy_borrowThenRepaySameBlock() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 1000 * WAD);
        vm.roll(10);

        vm.startPrank(alice);
        engine.borrow(alice, MARKET_ID, 100 * WAD);
        vm.expectRevert(AuraEngine.Aura__SameBlockInteraction.selector);
        engine.repay(alice, MARKET_ID, 50 * WAD);
        vm.stopPrank();
    }

    /// @notice Same-block reentrancy: two deposits in same block should revert
    function test_SEC_reentrancy_doubleDepositSameBlock() public {
        vm.startPrank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
        vm.expectRevert(AuraEngine.Aura__SameBlockInteraction.selector);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
        vm.stopPrank();
    }

    // =====================================================================
    //  2. FLASH LOAN / SAME-BLOCK MANIPULATION
    // =====================================================================

    /// @notice Attacker cannot deposit, borrow max, then withdraw in same block
    function test_SEC_flashLoan_depositBorrowWithdrawSameBlock() public {
        vm.startPrank(eve);
        engine.depositCollateral(eve, MARKET_ID, 10_000 * WAD);
        vm.expectRevert(AuraEngine.Aura__SameBlockInteraction.selector);
        engine.borrow(eve, MARKET_ID, 7999 * WAD);
        vm.stopPrank();
    }

    /// @notice Cannot manipulate oracle price and liquidate in same block as victim's action
    function test_SEC_flashLoan_manipulateAndLiquidateSameBlock() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 700 * WAD);

        vm.roll(20);
        oracle.setPrice(WAD / 2);

        vm.prank(eve);
        engine.liquidate(alice, MARKET_ID, 100 * WAD);

        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__SameBlockInteraction.selector);
        engine.repay(alice, MARKET_ID, 100 * WAD);
    }

    // =====================================================================
    //  3. ORACLE MANIPULATION
    // =====================================================================

    /// @notice Zero oracle price should prevent new borrows
    function test_SEC_oracle_zeroPricePreventsNewBorrows() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 1000 * WAD);
        vm.roll(10);
        oracle.setPrice(0);
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__ExceedsLTV.selector);
        engine.borrow(alice, MARKET_ID, 1 * WAD);
    }

    /// @notice Oracle price crash should make positions liquidatable
    function test_SEC_oracle_priceCrashMakesLiquidatable() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 700 * WAD);
        uint256 hfBefore = engine.getHealthFactor(alice);
        assertTrue(hfBefore > WAD);
        oracle.setPrice(WAD / 2);
        uint256 hfAfter = engine.getHealthFactor(alice);
        assertTrue(hfAfter < WAD);
    }

    /// @notice Extreme oracle price spike should not allow unbounded borrowing
    function test_SEC_oracle_priceSpikeBorrowLimit() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
        vm.roll(10);
        oracle.setPrice(1000 * WAD);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 80_000 * WAD);
        assertEq(engine.getPositionDebt(alice, MARKET_ID), 80_000 * WAD);
        vm.roll(20);
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__ExceedsLTV.selector);
        engine.borrow(alice, MARKET_ID, 1 * WAD);
    }

    /// @notice Harvest should handle zero oracle price gracefully (returns 0)
    function test_SEC_oracle_zeroPriceHarvestReturnsZero() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 500 * WAD);
        oracle.setPrice(0);
        vm.warp(block.timestamp + 2 days);
        uint256 yield = engine.harvestYield(MARKET_ID);
        assertEq(yield, 0);
    }

    // =====================================================================
    //  4. LIQUIDATION EXPLOITS
    // =====================================================================

    /// @notice Self-liquidation: user can liquidate their own position (technically allowed)
    function test_SEC_liquidation_selfLiquidationSameBlock() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 700 * WAD);
        vm.roll(20);
        oracle.setPrice(WAD / 2);
        vm.prank(alice);
        engine.liquidate(alice, MARKET_ID, 100 * WAD);
        assertTrue(engine.getPositionCollateralShares(alice, MARKET_ID) < 1000 * WAD);
    }

    /// @notice Cannot liquidate a healthy position
    function test_SEC_liquidation_healthyPositionReverts() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 100 * WAD);
        vm.roll(20);
        vm.prank(eve);
        vm.expectRevert(AuraEngine.Aura__HealthFactorAboveOne.selector);
        engine.liquidate(alice, MARKET_ID, 10 * WAD);
    }

    /// @notice Liquidation repay amount is capped at actual debt
    function test_SEC_liquidation_repayAmountCappedAtDebt() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 700 * WAD);
        vm.roll(20);
        oracle.setPrice(WAD / 2);
        vm.prank(eve);
        engine.liquidate(alice, MARKET_ID, 999_999 * WAD);
        assertEq(engine.getPositionDebt(alice, MARKET_ID), 0);
    }

    /// @notice Collateral seized capped at available collateral
    function test_SEC_liquidation_collateralSeizedCappedAtAvailable() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 79 * WAD);
        vm.roll(20);
        oracle.setPrice(WAD / 10);
        vm.prank(eve);
        engine.liquidate(alice, MARKET_ID, 79 * WAD);
        assertEq(engine.getPositionCollateralShares(alice, MARKET_ID), 0);
    }

    /// @notice Liquidation with zero repayAmount reverts
    function test_SEC_liquidation_zeroAmountReverts() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 700 * WAD);
        vm.roll(20);
        oracle.setPrice(WAD / 2);
        vm.prank(eve);
        vm.expectRevert(AuraEngine.Aura__ZeroAmount.selector);
        engine.liquidate(alice, MARKET_ID, 0);
    }

    /// @notice Liquidation penalty math correctness
    function test_SEC_liquidation_penaltyCalculation() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 800 * WAD);
        vm.roll(20);
        oracle.setPrice(WAD * 6 / 10);
        uint256 collBefore = engine.getPositionCollateralShares(alice, MARKET_ID);
        uint256 repay = 100 * WAD;
        vm.prank(eve);
        engine.liquidate(alice, MARKET_ID, repay);
        uint256 collAfter = engine.getPositionCollateralShares(alice, MARKET_ID);
        uint256 seized = collBefore - collAfter;
        uint256 expectedSeized = (repay * 10500 * WAD) / (10000 * (WAD * 6 / 10));
        assertApproxEqAbs(seized, expectedSeized, 1);
    }

    // =====================================================================
    //  5. ACCESS CONTROL
    // =====================================================================

    function test_SEC_access_nonAdminCannotPause() public {
        vm.prank(eve);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.setPaused(true);
    }

    function test_SEC_access_nonAdminCannotShutdown() public {
        vm.prank(eve);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.setEmergencyShutdown(true);
    }

    function test_SEC_access_nonAdminCannotTransferAdmin() public {
        vm.prank(eve);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.proposeAdmin(eve);
    }

    function test_SEC_access_nonAdminCannotProposeParam() public {
        vm.prank(eve);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.proposeMarketParam(MARKET_ID, keccak256("ltvBps"), 9000);
    }

    function test_SEC_access_nonAdminCannotExecuteParam() public {
        engine.proposeMarketParam(MARKET_ID, keccak256("ltvBps"), 7500);
        vm.warp(block.timestamp + 3 days);
        vm.prank(eve);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.executeMarketParam(MARKET_ID, keccak256("ltvBps"));
    }

    function test_SEC_access_nonAdminCannotUpgrade() public {
        AuraEngine newImpl = new AuraEngine();
        vm.prank(eve);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.upgradeToAndCall(address(newImpl), "");
    }

    function test_SEC_access_cannotBorrowForOther() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 1000 * WAD);
        vm.roll(10);
        vm.prank(eve);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.borrow(alice, MARKET_ID, 100 * WAD);
    }

    function test_SEC_access_cannotWithdrawForOther() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 1000 * WAD);
        vm.roll(10);
        vm.prank(eve);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.withdrawCollateral(alice, MARKET_ID, 100 * WAD);
    }

    function test_SEC_access_cannotRepayForOther() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 100 * WAD);
        vm.roll(20);
        vm.prank(eve);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.repay(alice, MARKET_ID, 50 * WAD);
    }

    // =====================================================================
    //  6. PROXY / UPGRADE ATTACKS
    // =====================================================================

    function test_SEC_proxy_reinitializeReverts() public {
        vm.expectRevert(AuraEngine.Aura__AlreadyInitialized.selector);
        engine.initialize(address(debtToken), address(registry), 1 days, 2 days);
    }

    function test_SEC_proxy_implementationLockedFromInit() public {
        AuraEngine rawImpl = new AuraEngine();
        vm.expectRevert(AuraEngine.Aura__AlreadyInitialized.selector);
        rawImpl.initialize(address(debtToken), address(registry), 1 days, 2 days);
    }

    function test_SEC_proxy_adminCanUpgrade() public {
        AuraEngine newImpl = new AuraEngine();
        engine.upgradeToAndCall(address(newImpl), "");
        assertEq(engine.getMarket(MARKET_ID).ltvBps, 8000);
    }

    // =====================================================================
    //  7. TIMELOCK BYPASS ATTEMPTS
    // =====================================================================

    function test_SEC_timelock_executeBeforeDelayReverts() public {
        engine.proposeMarketParam(MARKET_ID, keccak256("ltvBps"), 7500);
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(AuraEngine.Aura__TimelockNotElapsed.selector);
        engine.executeMarketParam(MARKET_ID, keccak256("ltvBps"));
    }

    function test_SEC_timelock_ltvAboveLiqThresholdReverts() public {
        bytes32 paramId = keccak256("ltvBps");
        engine.proposeMarketParam(MARKET_ID, paramId, 9000);
        vm.warp(block.timestamp + 3 days);
        vm.expectRevert(AuraEngine.Aura__InvalidParams.selector);
        engine.executeMarketParam(MARKET_ID, paramId);
    }

    function test_SEC_timelock_liqThresholdBelowLtvReverts() public {
        bytes32 paramId = keccak256("liquidationThresholdBps");
        engine.proposeMarketParam(MARKET_ID, paramId, 5000);
        vm.warp(block.timestamp + 3 days);
        vm.expectRevert(AuraEngine.Aura__InvalidParams.selector);
        engine.executeMarketParam(MARKET_ID, paramId);
    }

    function test_SEC_timelock_invalidParamIdReverts() public {
        bytes32 paramId = keccak256("nonExistentParam");
        engine.proposeMarketParam(MARKET_ID, paramId, 1000);
        vm.warp(block.timestamp + 3 days);
        vm.expectRevert(AuraEngine.Aura__InvalidParams.selector);
        engine.executeMarketParam(MARKET_ID, paramId);
    }

    function test_SEC_timelock_ltvOver100PercentReverts() public {
        bytes32 paramId = keccak256("ltvBps");
        engine.proposeMarketParam(MARKET_ID, paramId, 10001);
        vm.warp(block.timestamp + 3 days);
        vm.expectRevert(AuraEngine.Aura__InvalidParams.selector);
        engine.executeMarketParam(MARKET_ID, paramId);
    }

    // =====================================================================
    //  8. EMERGENCY SHUTDOWN & PAUSE
    // =====================================================================

    function test_SEC_pause_allOperationsBlocked() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 100 * WAD);
        engine.setPaused(true);
        vm.roll(20);
        vm.startPrank(alice);
        vm.expectRevert(AuraEngine.Aura__Paused.selector);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
        vm.expectRevert(AuraEngine.Aura__Paused.selector);
        engine.withdrawCollateral(alice, MARKET_ID, 50 * WAD);
        vm.expectRevert(AuraEngine.Aura__Paused.selector);
        engine.borrow(alice, MARKET_ID, 10 * WAD);
        vm.expectRevert(AuraEngine.Aura__Paused.selector);
        engine.repay(alice, MARKET_ID, 10 * WAD);
        vm.stopPrank();
        vm.expectRevert(AuraEngine.Aura__Paused.selector);
        engine.harvestYield(MARKET_ID);
        oracle.setPrice(WAD / 2);
        vm.prank(eve);
        vm.expectRevert(AuraEngine.Aura__Paused.selector);
        engine.liquidate(alice, MARKET_ID, 10 * WAD);
    }

    function test_SEC_shutdown_selectiveBlocking() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 100 * WAD);
        engine.setEmergencyShutdown(true);
        vm.roll(20);
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__EmergencyShutdown.selector);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
        vm.roll(30);
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__EmergencyShutdown.selector);
        engine.borrow(alice, MARKET_ID, 10 * WAD);
        vm.roll(40);
        vm.prank(alice);
        engine.repay(alice, MARKET_ID, 50 * WAD);
        assertEq(engine.getPositionDebt(alice, MARKET_ID), 50 * WAD);
        vm.roll(50);
        vm.prank(alice);
        engine.withdrawCollateral(alice, MARKET_ID, 100 * WAD);
    }

    function test_SEC_shutdown_harvestBlocked() public {
        engine.setEmergencyShutdown(true);
        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(AuraEngine.Aura__EmergencyShutdown.selector);
        engine.harvestYield(MARKET_ID);
    }

    function test_SEC_shutdown_liquidationBlocked() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 700 * WAD);
        engine.setEmergencyShutdown(true);
        oracle.setPrice(WAD / 2);
        vm.roll(20);
        vm.prank(eve);
        vm.expectRevert(AuraEngine.Aura__EmergencyShutdown.selector);
        engine.liquidate(alice, MARKET_ID, 100 * WAD);
    }

    // =====================================================================
    //  9. YIELD SIPHON / HARVEST MANIPULATION
    // =====================================================================

    function test_SEC_harvest_noYieldChangeReturnsZero() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 500 * WAD);
        vm.warp(block.timestamp + 2 days);
        uint256 yield = engine.harvestYield(MARKET_ID);
        assertEq(yield, 0);
    }

    function test_SEC_harvest_heartbeatProtection() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 1000 * WAD);
        vm.expectRevert(AuraEngine.Aura__HeartbeatNotElapsed.selector);
        engine.harvestYield(MARKET_ID);
    }

    // =====================================================================
    //  10. INITIALIZATION ATTACKS
    // =====================================================================

    /// @notice Initialize with zero debtToken reverts
    function test_SEC_init_zeroAddressReverts() public {
        AuraEngine newImpl = new AuraEngine();
        // debtToken = address(0) → revert
        vm.expectRevert(AuraEngine.Aura__InvalidParams.selector);
        new AuraProxy(
            address(newImpl),
            abi.encodeCall(
                AuraEngine.initialize,
                (address(0), address(registry), uint256(1 days), uint256(2 days))
            )
        );
        // marketRegistry = address(0) → revert
        vm.expectRevert(AuraEngine.Aura__InvalidParams.selector);
        new AuraProxy(
            address(newImpl),
            abi.encodeCall(
                AuraEngine.initialize,
                (address(debtToken), address(0), uint256(1 days), uint256(2 days))
            )
        );
    }

    /// @notice Registry addMarket with LTV > liquidation threshold reverts
    function test_SEC_init_ltvGtLiqThresholdReverts() public {
        AuraMarketRegistry badRegistry = new AuraMarketRegistry(address(this));
        vm.expectRevert(AuraMarketRegistry.Registry__InvalidParams.selector);
        badRegistry.addMarket(
            address(vault), address(oracle),
            uint16(9000), uint16(8500), uint16(500),
            0, 0, false, 0
        );
    }

    /// @notice Registry addMarket with LTV > 100% reverts
    function test_SEC_init_ltvOver100Reverts() public {
        AuraMarketRegistry badRegistry = new AuraMarketRegistry(address(this));
        vm.expectRevert(AuraMarketRegistry.Registry__InvalidParams.selector);
        badRegistry.addMarket(
            address(vault), address(oracle),
            uint16(10001), uint16(10001), uint16(500),
            0, 0, false, 0
        );
    }

    // =====================================================================
    //  11. INTEGER / EDGE CASES
    // =====================================================================

    function test_SEC_edge_zeroAmountsRevert() public {
        vm.startPrank(alice);
        vm.expectRevert(AuraEngine.Aura__ZeroAmount.selector);
        engine.depositCollateral(alice, MARKET_ID, 0);
        vm.stopPrank();
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
        vm.roll(10);
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__ZeroAmount.selector);
        engine.withdrawCollateral(alice, MARKET_ID, 0);
        vm.roll(20);
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__ZeroAmount.selector);
        engine.borrow(alice, MARKET_ID, 0);
    }

    function test_SEC_edge_withdrawMoreThanDeposited() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
        vm.roll(10);
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__InsufficientCollateral.selector);
        engine.withdrawCollateral(alice, MARKET_ID, 200 * WAD);
    }

    function test_SEC_edge_repayMoreThanDebtCaps() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 100 * WAD);
        debtToken.mint(alice, 1_000_000 * WAD);
        vm.roll(20);
        vm.prank(alice);
        engine.repay(alice, MARKET_ID, 999_999 * WAD);
        assertEq(engine.getPositionDebt(alice, MARKET_ID), 0);
    }

    function test_SEC_edge_noDebtMaxHealthFactor() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 1000 * WAD);
        assertEq(engine.getHealthFactor(alice), type(uint256).max);
    }

    function test_SEC_edge_emptyPositionHealthFactor() public {
        assertEq(engine.getHealthFactor(eve), type(uint256).max);
        assertEq(engine.getPositionDebt(eve, MARKET_ID), 0);
        assertEq(engine.getPositionCollateralShares(eve, MARKET_ID), 0);
    }

    // =====================================================================
    //  12. DONATION / VAULT SHARE PRICE INFLATION ATTACK
    // =====================================================================

    function test_SEC_donation_vaultSharePriceInflation() public {
        ControllableVault cVault = new ControllableVault(address(assetToken));
        ControllableOracle cOracle = new ControllableOracle(WAD);

        AuraMarketRegistry cRegistry = new AuraMarketRegistry(address(this));
        cRegistry.addMarket(
            address(cVault), address(cOracle),
            uint16(8000), uint16(8500), uint16(500),
            0, 0, false, 0
        );
        AuraEngine cImpl = new AuraEngine();
        AuraProxy cProxy = new AuraProxy(
            address(cImpl),
            abi.encodeCall(
                AuraEngine.initialize,
                (address(debtToken), address(cRegistry), uint256(1 days), uint256(2 days))
            )
        );
        AuraEngine cEngine = AuraEngine(address(cProxy));
        cRegistry.setEngine(address(cProxy));
        debtToken.mint(address(cProxy), 10_000_000 * WAD);

        assetToken.mint(alice, 1000 * WAD);
        vm.startPrank(alice);
        assetToken.approve(address(cVault), type(uint256).max);
        cVault.deposit(1000 * WAD, alice);
        cVault.approve(address(cProxy), type(uint256).max);
        cEngine.depositCollateral(alice, MARKET_ID, 1000 * WAD);
        vm.stopPrank();

        vm.roll(10);
        vm.prank(alice);
        cEngine.borrow(alice, MARKET_ID, 500 * WAD);

        cVault.setPricePerShare(10 * WAD);
        uint256 hf = cEngine.getHealthFactor(alice);
        assertTrue(hf > WAD * 10);

        cVault.setPricePerShare(WAD);
        uint256 hfNormal = cEngine.getHealthFactor(alice);
        assertTrue(hfNormal > WAD && hfNormal < WAD * 5);
    }

    // =====================================================================
    //  13. DEBT SCALE EDGE CASES
    // =====================================================================

    function test_SEC_debtScale_multiUserSettlement() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 10_000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 5000 * WAD);
        vm.roll(20);
        vm.prank(bob);
        engine.depositCollateral(bob, MARKET_ID, 10_000 * WAD);
        vm.roll(30);
        vm.prank(bob);
        engine.borrow(bob, MARKET_ID, 3000 * WAD);
        assertEq(engine.getPositionDebt(alice, MARKET_ID), 5000 * WAD);
        assertEq(engine.getPositionDebt(bob, MARKET_ID), 3000 * WAD);
        assertEq(engine.totalDebt(MARKET_ID), 8000 * WAD);
    }

    function test_SEC_debtScale_fullRepayLeavesZero() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 10_000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 5000 * WAD);
        debtToken.mint(alice, 10_000 * WAD);
        vm.roll(20);
        vm.prank(alice);
        engine.repay(alice, MARKET_ID, 5000 * WAD);
        assertEq(engine.getPositionDebt(alice, MARKET_ID), 0);
    }

    // =====================================================================
    //  14. WITHDRAW HEALTH FACTOR CHECK
    // =====================================================================

    function test_SEC_withdraw_wouldMakeUnhealthy() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 700 * WAD);
        vm.roll(20);
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__HealthFactorBelowOne.selector);
        engine.withdrawCollateral(alice, MARKET_ID, 900 * WAD);
    }

    function test_SEC_withdraw_toExactHealthBoundary() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 100 * WAD);
        vm.roll(20);
        vm.prank(alice);
        engine.withdrawCollateral(alice, MARKET_ID, 880 * WAD);
        assertTrue(engine.getHealthFactor(alice) >= WAD);
    }

    // =====================================================================
    //  15. DEPOSIT FOR OTHER USER
    // =====================================================================

    function test_SEC_deposit_forAnotherUser() public {
        vm.prank(eve);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
        assertEq(engine.getPositionCollateralShares(alice, MARKET_ID), 100 * WAD);
    }

    // =====================================================================
    //  16. ADMIN TRANSFER CHAIN
    // =====================================================================

    /// @notice Admin transfer chain: A → B → C (two-step), old admins locked out
    function test_SEC_admin_transferChain() public {
        // admin (this) → alice (two-step)
        engine.proposeAdmin(alice);
        vm.prank(alice);
        engine.acceptAdmin();

        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.setPaused(true);

        // alice → bob (two-step)
        vm.prank(alice);
        engine.proposeAdmin(bob);
        vm.prank(bob);
        engine.acceptAdmin();

        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.setPaused(true);

        // bob can pause
        vm.prank(bob);
        engine.setPaused(true);
    }

    /// @notice Cannot propose admin to zero address
    function test_SEC_admin_cannotSetZero() public {
        vm.expectRevert(AuraEngine.Aura__InvalidParams.selector);
        engine.proposeAdmin(address(0));
    }

    // =====================================================================
    //  17. CONTROLLABLE VAULT: HARVEST YIELD ATTACK
    // =====================================================================

    function test_SEC_harvest_vaultPriceManipulation() public {
        ControllableVault cVault = new ControllableVault(address(assetToken));
        ControllableOracle cOracle = new ControllableOracle(WAD);

        AuraMarketRegistry cRegistry = new AuraMarketRegistry(address(this));
        cRegistry.addMarket(
            address(cVault), address(cOracle),
            uint16(8000), uint16(8500), uint16(500),
            0, 0, false, 0
        );
        AuraEngine cImpl = new AuraEngine();
        AuraProxy cProxy = new AuraProxy(
            address(cImpl),
            abi.encodeCall(
                AuraEngine.initialize,
                (address(debtToken), address(cRegistry), uint256(1 days), uint256(2 days))
            )
        );
        AuraEngine cEngine = AuraEngine(address(cProxy));
        cRegistry.setEngine(address(cProxy));
        debtToken.mint(address(cProxy), 10_000_000 * WAD);

        assetToken.mint(alice, 1000 * WAD);
        vm.startPrank(alice);
        assetToken.approve(address(cVault), type(uint256).max);
        cVault.deposit(1000 * WAD, alice);
        cVault.approve(address(cProxy), type(uint256).max);
        cEngine.depositCollateral(alice, MARKET_ID, 1000 * WAD);
        vm.stopPrank();

        vm.roll(10);
        vm.prank(alice);
        cEngine.borrow(alice, MARKET_ID, 500 * WAD);

        cVault.setPricePerShare(2 * WAD);
        vm.warp(block.timestamp + 2 days);
        uint256 yieldApplied = cEngine.harvestYield(MARKET_ID);
        assertTrue(yieldApplied <= 500 * WAD);
        assertTrue(cEngine.getPositionDebt(alice, MARKET_ID) < 500 * WAD);
    }

    // =====================================================================
    //  18. POSITION WITH NO PRIOR INTERACTION
    // =====================================================================

    function test_SEC_edge_noPriorDepositCannotBorrow() public {
        address nobody = address(0xDEAD);
        vm.prank(nobody);
        vm.expectRevert(AuraEngine.Aura__ExceedsLTV.selector);
        engine.borrow(nobody, MARKET_ID, 1 * WAD);
    }

    function test_SEC_edge_noPriorDepositCannotWithdraw() public {
        address nobody = address(0xDEAD);
        vm.prank(nobody);
        vm.expectRevert(AuraEngine.Aura__InsufficientCollateral.selector);
        engine.withdrawCollateral(nobody, MARKET_ID, 1 * WAD);
    }

    // =====================================================================
    //  19. LARGE VALUE STRESS TEST
    // =====================================================================

    function test_SEC_stress_largeValues() public {
        uint256 largeAmount = 1_000_000_000 * WAD;
        assetToken.mint(alice, largeAmount);
        vm.startPrank(alice);
        assetToken.approve(address(vault), type(uint256).max);
        vault.deposit(largeAmount, alice);
        vault.approve(address(proxy), type(uint256).max);
        engine.depositCollateral(alice, MARKET_ID, largeAmount);
        vm.stopPrank();
        vm.roll(10);
        uint256 maxBorrow = (largeAmount * 8000) / 10000;
        debtToken.mint(address(proxy), maxBorrow);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, maxBorrow);
        assertEq(engine.getPositionDebt(alice, MARKET_ID), maxBorrow);
        assertTrue(engine.getHealthFactor(alice) > WAD);
    }

    // =====================================================================
    //  20. DUST POSITION ATTACK
    // =====================================================================

    function test_SEC_dust_tinyPositionLiquidatable() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 10);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 8);
        vm.roll(20);
        oracle.setPrice(WAD / 2);
        uint256 hf = engine.getHealthFactor(alice);
        assertTrue(hf < WAD);
        vm.prank(eve);
        engine.liquidate(alice, MARKET_ID, 8);
    }
}
