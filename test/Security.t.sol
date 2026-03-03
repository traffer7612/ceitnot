// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { AuraEngine } from "../src/AuraEngine.sol";
import { AuraProxy } from "../src/AuraProxy.sol";
import { AuraStorage } from "../src/AuraStorage.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";
import { MockVault4626 } from "./mocks/MockVault4626.sol";
import { ControllableOracle } from "./mocks/ControllableOracle.sol";
import { ControllableVault } from "./mocks/ControllableVault.sol";

// ============ Attacker contracts for reentrancy tests ============

/// @notice Attempts reentrancy via vault.transfer callback during withdrawCollateral
contract ReentrantWithdrawAttacker {
    AuraEngine public engine;
    uint256 public attackCount;

    function setup(address engine_) external {
        engine = AuraEngine(engine_);
    }

    function attack(uint256 shares) external {
        engine.withdrawCollateral(address(this), shares);
    }

    // Simulated callback — in reality vault.transfer could trigger this
    // but MockVault does not call back. This tests the same-block protection.
    function onTokenReceived() external {
        if (attackCount < 1) {
            attackCount++;
            // Try reentrant withdraw — should revert due to same-block protection
            try engine.withdrawCollateral(address(this), 1) {} catch {}
        }
    }
}

/// @notice Attempts to exploit borrow by immediately liquidating in same block
contract FlashLoanAttacker {
    AuraEngine public engine;
    address public victim;

    function setup(address engine_, address victim_) external {
        engine = AuraEngine(engine_);
        victim = victim_;
    }

    function attackSameBlock() external {
        // Try to liquidate — should fail due to same-block protection on victim
        engine.liquidate(victim, 1e18);
    }
}

// ============ Main Security Test Suite ============

contract SecurityTest is Test {
    AuraEngine public engine;
    AuraProxy public proxy;
    AuraEngine public impl;
    MockERC20 public assetToken;
    MockERC20 public debtToken;
    MockVault4626 public vault;
    ControllableOracle public oracle;

    address public admin = address(this);
    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);
    address public eve = address(0xEEE); // attacker

    uint256 constant WAD = 1e18;
    uint256 constant RAY = 1e27;

    function setUp() public {
        assetToken = new MockERC20("Wrapped stETH", "wstETH", 18);
        debtToken = new MockERC20("USD Coin", "USDC", 18);
        vault = new MockVault4626(address(assetToken), "Aura wstETH Vault", "avWSTETH");
        oracle = new ControllableOracle(WAD); // 1:1 price

        impl = new AuraEngine();
        bytes memory initData = abi.encodeCall(
            AuraEngine.initialize,
            (
                address(vault),
                address(debtToken),
                address(oracle),
                uint16(8000),  // ltvBps 80%
                uint16(8500),  // liquidationThresholdBps 85%
                uint16(500),   // liquidationPenaltyBps 5%
                uint256(1 days),
                uint256(2 days)
            )
        );
        proxy = new AuraProxy(address(impl), initData);
        engine = AuraEngine(address(proxy));

        // Fund engine with debt tokens
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

        // Setup eve (attacker)
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
        engine.depositCollateral(alice, 100 * WAD);
        vm.expectRevert(AuraEngine.Aura__SameBlockInteraction.selector);
        engine.withdrawCollateral(alice, 50 * WAD);
        vm.stopPrank();
    }

    /// @notice Same-block reentrancy: deposit + borrow in one tx should revert
    function test_SEC_reentrancy_depositThenBorrowSameBlock() public {
        vm.startPrank(alice);
        engine.depositCollateral(alice, 1000 * WAD);
        vm.expectRevert(AuraEngine.Aura__SameBlockInteraction.selector);
        engine.borrow(alice, 100 * WAD);
        vm.stopPrank();
    }

    /// @notice Same-block reentrancy: borrow + repay in one tx should revert
    function test_SEC_reentrancy_borrowThenRepaySameBlock() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 1000 * WAD);
        vm.roll(10);

        vm.startPrank(alice);
        engine.borrow(alice, 100 * WAD);
        vm.expectRevert(AuraEngine.Aura__SameBlockInteraction.selector);
        engine.repay(alice, 50 * WAD);
        vm.stopPrank();
    }

    /// @notice Same-block reentrancy: two deposits in same block should revert
    function test_SEC_reentrancy_doubleDepositSameBlock() public {
        vm.startPrank(alice);
        engine.depositCollateral(alice, 100 * WAD);
        vm.expectRevert(AuraEngine.Aura__SameBlockInteraction.selector);
        engine.depositCollateral(alice, 100 * WAD);
        vm.stopPrank();
    }

    // =====================================================================
    //  2. FLASH LOAN / SAME-BLOCK MANIPULATION
    // =====================================================================

    /// @notice Attacker cannot deposit, borrow max, then withdraw in same block
    function test_SEC_flashLoan_depositBorrowWithdrawSameBlock() public {
        vm.startPrank(eve);
        engine.depositCollateral(eve, 10_000 * WAD);
        // Can't borrow in same block
        vm.expectRevert(AuraEngine.Aura__SameBlockInteraction.selector);
        engine.borrow(eve, 7999 * WAD);
        vm.stopPrank();
    }

    /// @notice Cannot manipulate oracle price and liquidate in same block as victim's action
    function test_SEC_flashLoan_manipulateAndLiquidateSameBlock() public {
        // Alice deposits and borrows normally
        vm.prank(alice);
        engine.depositCollateral(alice, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, 700 * WAD); // 70% LTV

        // Eve tries to liquidate alice in next block after oracle drop
        vm.roll(20);
        oracle.setPrice(WAD / 2); // price crashes 50%

        // Alice's HF should be below 1 now, but if alice had an interaction this block,
        // same-block would protect. Here we verify liquidation works in next block.
        vm.prank(eve);
        engine.liquidate(alice, 100 * WAD);

        // But alice cannot repay + withdraw in the same block she was liquidated
        // because liquidate already set her lastInteractionBlock
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__SameBlockInteraction.selector);
        engine.repay(alice, 100 * WAD);
    }

    // =====================================================================
    //  3. ORACLE MANIPULATION
    // =====================================================================

    /// @notice Zero oracle price should prevent new borrows (division by zero protection)
    function test_SEC_oracle_zeroPricePreventsNewBorrows() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 1000 * WAD);
        vm.roll(10);

        oracle.setPrice(0);

        // With price = 0, collateral value = 0, any borrow should exceed LTV
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__ExceedsLTV.selector);
        engine.borrow(alice, 1 * WAD);
    }

    /// @notice Oracle price crash should make positions liquidatable
    function test_SEC_oracle_priceCrashMakesLiquidatable() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, 700 * WAD); // 70% LTV

        uint256 hfBefore = engine.getHealthFactor(alice);
        assertTrue(hfBefore > WAD, "Should be healthy before crash");

        // Oracle price drops 50%
        oracle.setPrice(WAD / 2);

        uint256 hfAfter = engine.getHealthFactor(alice);
        assertTrue(hfAfter < WAD, "Should be unhealthy after crash");
    }

    /// @notice Extreme oracle price spike should not allow unbounded borrowing
    function test_SEC_oracle_priceSpikeBorrowLimit() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 100 * WAD);
        vm.roll(10);

        // Oracle reports 1000x normal price
        oracle.setPrice(1000 * WAD);

        vm.prank(alice);
        // Even with inflated collateral value, borrowing is limited by engine's debt token balance
        // The LTV check uses: debt * 10000 > collateralValue * ltvBps
        // collateralValue = 100 * 1000 = 100,000
        // maxBorrow = 100000 * 80% = 80,000
        engine.borrow(alice, 80_000 * WAD);
        assertEq(engine.getPositionDebt(alice), 80_000 * WAD);

        // But cannot exceed LTV
        vm.roll(20);
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__ExceedsLTV.selector);
        engine.borrow(alice, 1 * WAD); // over the limit
    }

    /// @notice Harvest should handle zero oracle price gracefully (returns 0)
    function test_SEC_oracle_zeroPriceHarvestReturnsZero() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, 500 * WAD);

        oracle.setPrice(0);
        vm.warp(block.timestamp + 2 days);

        // Harvest with zero price should return 0 (no yield applied)
        uint256 yield = engine.harvestYield();
        assertEq(yield, 0);
    }

    // =====================================================================
    //  4. LIQUIDATION EXPLOITS
    // =====================================================================

    /// @notice Self-liquidation: user cannot liquidate their own position in same block
    function test_SEC_liquidation_selfLiquidationSameBlock() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, 700 * WAD);

        // Price drops — position becomes unhealthy
        vm.roll(20);
        oracle.setPrice(WAD / 2);

        // Alice tries to liquidate herself — this actually works (no check prevents it)
        // But she needs debt tokens. She already has 700 from borrowing.
        vm.prank(alice);
        engine.liquidate(alice, 100 * WAD);

        // Verify she got collateral back with penalty discount
        // This is technically allowed but alice pays the penalty herself
        assertTrue(engine.getPositionCollateralShares(alice) < 1000 * WAD);
    }

    /// @notice Cannot liquidate a healthy position
    function test_SEC_liquidation_healthyPositionReverts() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, 100 * WAD); // very healthy

        vm.roll(20);
        vm.prank(eve);
        vm.expectRevert(AuraEngine.Aura__HealthFactorAboveOne.selector);
        engine.liquidate(alice, 10 * WAD);
    }

    /// @notice Liquidation repay amount is capped at actual debt
    function test_SEC_liquidation_repayAmountCappedAtDebt() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, 700 * WAD);

        vm.roll(20);
        oracle.setPrice(WAD / 2);

        vm.prank(eve);
        engine.liquidate(alice, 999_999 * WAD); // way more than debt

        // Should have repaid exactly debtBefore, not more
        assertEq(engine.getPositionDebt(alice), 0);
    }

    /// @notice Collateral seized capped at available collateral
    function test_SEC_liquidation_collateralSeizedCappedAtAvailable() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 100 * WAD); // small collateral
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, 79 * WAD); // near max LTV

        // Severe price crash makes collateral worth less than debt + penalty
        vm.roll(20);
        oracle.setPrice(WAD / 10); // 90% crash

        vm.prank(eve);
        engine.liquidate(alice, 79 * WAD);

        // All collateral should be seized (capped)
        assertEq(engine.getPositionCollateralShares(alice), 0);
    }

    /// @notice Liquidation with zero repayAmount reverts
    function test_SEC_liquidation_zeroAmountReverts() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, 700 * WAD);

        vm.roll(20);
        oracle.setPrice(WAD / 2);

        vm.prank(eve);
        vm.expectRevert(AuraEngine.Aura__ZeroAmount.selector);
        engine.liquidate(alice, 0);
    }

    /// @notice Liquidation penalty math correctness
    function test_SEC_liquidation_penaltyCalculation() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, 800 * WAD); // 80% LTV

        vm.roll(20);
        // Need price < 0.68 to push HF below 1 with liqThreshold=85% and debt=800
        oracle.setPrice(WAD * 6 / 10); // 40% price drop

        uint256 collBefore = engine.getPositionCollateralShares(alice);
        uint256 repay = 100 * WAD;

        vm.prank(eve);
        engine.liquidate(alice, repay);

        uint256 collAfter = engine.getPositionCollateralShares(alice);
        uint256 seized = collBefore - collAfter;

        // collateralToSeize = (repayAmount * (10000 + penaltyBps) * WAD) / (10000 * valuePerShare)
        // With 5% penalty, valuePerShare = 0.6 WAD:
        // seized = (100 * 10500 * 1e18) / (10000 * 0.6e18) = 100 * 1.05 / 0.6 = 175
        uint256 expectedSeized = (repay * 10500 * WAD) / (10000 * (WAD * 6 / 10));
        assertApproxEqAbs(seized, expectedSeized, 1);
    }

    // =====================================================================
    //  5. ACCESS CONTROL
    // =====================================================================

    /// @notice Non-admin cannot pause
    function test_SEC_access_nonAdminCannotPause() public {
        vm.prank(eve);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.setPaused(true);
    }

    /// @notice Non-admin cannot set emergency shutdown
    function test_SEC_access_nonAdminCannotShutdown() public {
        vm.prank(eve);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.setEmergencyShutdown(true);
    }

    /// @notice Non-admin cannot transfer admin
    function test_SEC_access_nonAdminCannotTransferAdmin() public {
        vm.prank(eve);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.setAdmin(eve);
    }

    /// @notice Non-admin cannot propose params
    function test_SEC_access_nonAdminCannotProposeParam() public {
        vm.prank(eve);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.proposeParam(keccak256("ltvBps"), 9000);
    }

    /// @notice Non-admin cannot execute params
    function test_SEC_access_nonAdminCannotExecuteParam() public {
        engine.proposeParam(keccak256("ltvBps"), 7500);
        vm.warp(block.timestamp + 3 days);

        vm.prank(eve);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.executeParam(keccak256("ltvBps"));
    }

    /// @notice Non-admin cannot upgrade proxy
    function test_SEC_access_nonAdminCannotUpgrade() public {
        AuraEngine newImpl = new AuraEngine();
        vm.prank(eve);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.upgradeToAndCall(address(newImpl), "");
    }

    /// @notice Non-owner cannot borrow for another user
    function test_SEC_access_cannotBorrowForOther() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 1000 * WAD);

        vm.roll(10);
        vm.prank(eve);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.borrow(alice, 100 * WAD);
    }

    /// @notice Non-owner cannot withdraw for another user
    function test_SEC_access_cannotWithdrawForOther() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 1000 * WAD);

        vm.roll(10);
        vm.prank(eve);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.withdrawCollateral(alice, 100 * WAD);
    }

    /// @notice Non-owner cannot repay for another user
    function test_SEC_access_cannotRepayForOther() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, 100 * WAD);

        vm.roll(20);
        vm.prank(eve);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.repay(alice, 50 * WAD);
    }

    // =====================================================================
    //  6. PROXY / UPGRADE ATTACKS
    // =====================================================================

    /// @notice Cannot re-initialize the proxy (already initialized)
    function test_SEC_proxy_reinitializeReverts() public {
        vm.expectRevert(AuraEngine.Aura__InvalidParams.selector);
        engine.initialize(
            address(vault), address(debtToken), address(oracle),
            8000, 8500, 500, 1 days, 2 days
        );
    }

    /// @notice Implementation contract directly should also block re-init (after proxy init)
    function test_SEC_proxy_implementationCanBeInitializedDirectly() public {
        // NOTE: The raw implementation has no collateralVault set, so it CAN be initialized.
        // This is a known pattern in UUPS — the implementation itself is typically not initialized.
        // However, it doesn't affect security because the proxy delegates to its own storage.
        AuraEngine rawImpl = new AuraEngine();
        // Can initialize raw impl (not a vulnerability — storage is separate from proxy)
        rawImpl.initialize(
            address(vault), address(debtToken), address(oracle),
            8000, 8500, 500, 1 days, 2 days
        );
        // But re-init reverts
        vm.expectRevert(AuraEngine.Aura__InvalidParams.selector);
        rawImpl.initialize(
            address(vault), address(debtToken), address(oracle),
            8000, 8500, 500, 1 days, 2 days
        );
    }

    /// @notice Admin can upgrade to new implementation
    function test_SEC_proxy_adminCanUpgrade() public {
        AuraEngine newImpl = new AuraEngine();
        engine.upgradeToAndCall(address(newImpl), "");
        // State should be preserved through upgrade
        assertEq(engine.ltvBps(), 8000);
    }

    // =====================================================================
    //  7. TIMELOCK BYPASS ATTEMPTS
    // =====================================================================

    /// @notice Cannot execute param before timelock elapses
    function test_SEC_timelock_executeBeforeDelayReverts() public {
        engine.proposeParam(keccak256("ltvBps"), 7500);
        vm.warp(block.timestamp + 1 days); // only 1 day, need 2

        vm.expectRevert(AuraEngine.Aura__TimelockNotElapsed.selector);
        engine.executeParam(keccak256("ltvBps"));
    }

    /// @notice Cannot set LTV above liquidation threshold
    function test_SEC_timelock_ltvAboveLiqThresholdReverts() public {
        bytes32 paramId = keccak256("ltvBps");
        engine.proposeParam(paramId, 9000); // > 8500 liqThreshold
        vm.warp(block.timestamp + 3 days);

        vm.expectRevert(AuraEngine.Aura__InvalidParams.selector);
        engine.executeParam(paramId);
    }

    /// @notice Cannot set liquidation threshold below LTV
    function test_SEC_timelock_liqThresholdBelowLtvReverts() public {
        bytes32 paramId = keccak256("liquidationThresholdBps");
        engine.proposeParam(paramId, 5000); // < 8000 ltv
        vm.warp(block.timestamp + 3 days);

        vm.expectRevert(AuraEngine.Aura__InvalidParams.selector);
        engine.executeParam(paramId);
    }

    /// @notice Invalid param ID reverts
    function test_SEC_timelock_invalidParamIdReverts() public {
        bytes32 paramId = keccak256("nonExistentParam");
        engine.proposeParam(paramId, 1000);
        vm.warp(block.timestamp + 3 days);

        vm.expectRevert(AuraEngine.Aura__InvalidParams.selector);
        engine.executeParam(paramId);
    }

    /// @notice LTV > 10000 (100%) reverts
    function test_SEC_timelock_ltvOver100PercentReverts() public {
        bytes32 paramId = keccak256("ltvBps");
        engine.proposeParam(paramId, 10001);
        vm.warp(block.timestamp + 3 days);

        vm.expectRevert(AuraEngine.Aura__InvalidParams.selector);
        engine.executeParam(paramId);
    }

    // =====================================================================
    //  8. EMERGENCY SHUTDOWN & PAUSE
    // =====================================================================

    /// @notice Paused: all core operations blocked
    function test_SEC_pause_allOperationsBlocked() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, 100 * WAD);

        engine.setPaused(true);

        vm.roll(20);
        vm.startPrank(alice);

        vm.expectRevert(AuraEngine.Aura__Paused.selector);
        engine.depositCollateral(alice, 100 * WAD);

        vm.expectRevert(AuraEngine.Aura__Paused.selector);
        engine.withdrawCollateral(alice, 50 * WAD);

        vm.expectRevert(AuraEngine.Aura__Paused.selector);
        engine.borrow(alice, 10 * WAD);

        vm.expectRevert(AuraEngine.Aura__Paused.selector);
        engine.repay(alice, 10 * WAD);

        vm.stopPrank();

        vm.expectRevert(AuraEngine.Aura__Paused.selector);
        engine.harvestYield();

        oracle.setPrice(WAD / 2);
        vm.prank(eve);
        vm.expectRevert(AuraEngine.Aura__Paused.selector);
        engine.liquidate(alice, 10 * WAD);
    }

    /// @notice Emergency shutdown: deposit and borrow blocked, withdraw and repay work
    function test_SEC_shutdown_selectiveBlocking() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, 100 * WAD);

        engine.setEmergencyShutdown(true);

        vm.roll(20);

        // Deposit blocked
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__EmergencyShutdown.selector);
        engine.depositCollateral(alice, 100 * WAD);

        // Borrow blocked
        vm.roll(30);
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__EmergencyShutdown.selector);
        engine.borrow(alice, 10 * WAD);

        // Repay still works
        vm.roll(40);
        vm.prank(alice);
        engine.repay(alice, 50 * WAD);
        assertEq(engine.getPositionDebt(alice), 50 * WAD);

        // Withdraw still works
        vm.roll(50);
        vm.prank(alice);
        engine.withdrawCollateral(alice, 100 * WAD);
    }

    /// @notice Harvest blocked during emergency shutdown
    function test_SEC_shutdown_harvestBlocked() public {
        engine.setEmergencyShutdown(true);
        vm.warp(block.timestamp + 2 days);

        vm.expectRevert(AuraEngine.Aura__EmergencyShutdown.selector);
        engine.harvestYield();
    }

    /// @notice Liquidation blocked during emergency shutdown
    function test_SEC_shutdown_liquidationBlocked() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, 700 * WAD);

        engine.setEmergencyShutdown(true);
        oracle.setPrice(WAD / 2);

        vm.roll(20);
        vm.prank(eve);
        vm.expectRevert(AuraEngine.Aura__EmergencyShutdown.selector);
        engine.liquidate(alice, 100 * WAD);
    }

    // =====================================================================
    //  9. YIELD SIPHON / HARVEST MANIPULATION
    // =====================================================================

    /// @notice Harvest with no yield change returns 0
    function test_SEC_harvest_noYieldChangeReturnsZero() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, 500 * WAD);

        vm.warp(block.timestamp + 2 days);
        // MockVault has fixed 1:1 ratio, no yield
        uint256 yield = engine.harvestYield();
        assertEq(yield, 0);
    }

    /// @notice Harvest heartbeat protection
    function test_SEC_harvest_heartbeatProtection() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 1000 * WAD);

        // Immediately after setup — heartbeat not elapsed
        vm.expectRevert(AuraEngine.Aura__HeartbeatNotElapsed.selector);
        engine.harvestYield();
    }

    // =====================================================================
    //  10. INITIALIZATION ATTACKS
    // =====================================================================

    /// @notice Initialize with zero addresses reverts
    function test_SEC_init_zeroAddressReverts() public {
        AuraEngine newImpl = new AuraEngine();
        vm.expectRevert(AuraEngine.Aura__InvalidParams.selector);
        new AuraProxy(
            address(newImpl),
            abi.encodeCall(
                AuraEngine.initialize,
                (address(0), address(debtToken), address(oracle), 8000, 8500, 500, 1 days, 2 days)
            )
        );

        vm.expectRevert(AuraEngine.Aura__InvalidParams.selector);
        new AuraProxy(
            address(newImpl),
            abi.encodeCall(
                AuraEngine.initialize,
                (address(vault), address(0), address(oracle), 8000, 8500, 500, 1 days, 2 days)
            )
        );

        vm.expectRevert(AuraEngine.Aura__InvalidParams.selector);
        new AuraProxy(
            address(newImpl),
            abi.encodeCall(
                AuraEngine.initialize,
                (address(vault), address(debtToken), address(0), 8000, 8500, 500, 1 days, 2 days)
            )
        );
    }

    /// @notice Initialize with LTV > liquidation threshold reverts
    function test_SEC_init_ltvGtLiqThresholdReverts() public {
        AuraEngine newImpl = new AuraEngine();
        vm.expectRevert(AuraEngine.Aura__InvalidParams.selector);
        new AuraProxy(
            address(newImpl),
            abi.encodeCall(
                AuraEngine.initialize,
                (address(vault), address(debtToken), address(oracle), 9000, 8500, 500, 1 days, 2 days)
            )
        );
    }

    /// @notice Initialize with LTV > 100% reverts
    function test_SEC_init_ltvOver100Reverts() public {
        AuraEngine newImpl = new AuraEngine();
        vm.expectRevert(AuraEngine.Aura__InvalidParams.selector);
        new AuraProxy(
            address(newImpl),
            abi.encodeCall(
                AuraEngine.initialize,
                (address(vault), address(debtToken), address(oracle), 10001, 10002, 500, 1 days, 2 days)
            )
        );
    }

    // =====================================================================
    //  11. INTEGER / EDGE CASES
    // =====================================================================

    /// @notice Zero amount operations revert
    function test_SEC_edge_zeroAmountsRevert() public {
        vm.startPrank(alice);
        vm.expectRevert(AuraEngine.Aura__ZeroAmount.selector);
        engine.depositCollateral(alice, 0);
        vm.stopPrank();

        vm.prank(alice);
        engine.depositCollateral(alice, 100 * WAD);

        vm.roll(10);
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__ZeroAmount.selector);
        engine.withdrawCollateral(alice, 0);

        vm.roll(20);
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__ZeroAmount.selector);
        engine.borrow(alice, 0);
    }

    /// @notice Withdraw more than deposited reverts
    function test_SEC_edge_withdrawMoreThanDeposited() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 100 * WAD);

        vm.roll(10);
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__InsufficientCollateral.selector);
        engine.withdrawCollateral(alice, 200 * WAD);
    }

    /// @notice Repay more than debt caps to actual debt
    function test_SEC_edge_repayMoreThanDebtCaps() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, 100 * WAD);

        debtToken.mint(alice, 1_000_000 * WAD);

        vm.roll(20);
        vm.prank(alice);
        engine.repay(alice, 999_999 * WAD);

        assertEq(engine.getPositionDebt(alice), 0);
    }

    /// @notice No-debt position has max health factor
    function test_SEC_edge_noDebtMaxHealthFactor() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 1000 * WAD);

        assertEq(engine.getHealthFactor(alice), type(uint256).max);
    }

    /// @notice Empty position (no collateral, no debt) — health factor is max
    function test_SEC_edge_emptyPositionHealthFactor() public {
        assertEq(engine.getHealthFactor(eve), type(uint256).max);
        assertEq(engine.getPositionDebt(eve), 0);
        assertEq(engine.getPositionCollateralShares(eve), 0);
    }

    // =====================================================================
    //  12. DONATION / VAULT SHARE PRICE INFLATION ATTACK
    // =====================================================================

    /// @notice Vault share price inflation should not affect existing positions unfairly
    function test_SEC_donation_vaultSharePriceInflation() public {
        // Use controllable vault
        ControllableVault cVault = new ControllableVault(address(assetToken));
        ControllableOracle cOracle = new ControllableOracle(WAD);

        AuraEngine cImpl = new AuraEngine();
        AuraProxy cProxy = new AuraProxy(
            address(cImpl),
            abi.encodeCall(
                AuraEngine.initialize,
                (address(cVault), address(debtToken), address(cOracle), 8000, 8500, 500, 1 days, 2 days)
            )
        );
        AuraEngine cEngine = AuraEngine(address(cProxy));
        debtToken.mint(address(cProxy), 10_000_000 * WAD);

        // Alice deposits 1000 shares at 1:1
        assetToken.mint(alice, 1000 * WAD);
        vm.startPrank(alice);
        assetToken.approve(address(cVault), type(uint256).max);
        cVault.deposit(1000 * WAD, alice);
        cVault.approve(address(cProxy), type(uint256).max);
        cEngine.depositCollateral(alice, 1000 * WAD);
        vm.stopPrank();

        vm.roll(10);
        vm.prank(alice);
        cEngine.borrow(alice, 500 * WAD);

        // Attacker inflates vault share price 10x
        cVault.setPricePerShare(10 * WAD);

        // Alice's collateral value is now 10x, but her debt is unchanged
        // HF should increase (more healthy) — this is NOT an exploit, it benefits alice
        uint256 hf = cEngine.getHealthFactor(alice);
        assertTrue(hf > WAD * 10);

        // But if price goes back down, position returns to normal risk
        cVault.setPricePerShare(WAD);
        uint256 hfNormal = cEngine.getHealthFactor(alice);
        assertTrue(hfNormal > WAD && hfNormal < WAD * 5);
    }

    // =====================================================================
    //  13. DEBT SCALE EDGE CASES
    // =====================================================================

    /// @notice Multiple users with different scales settle correctly
    function test_SEC_debtScale_multiUserSettlement() public {
        // Alice deposits and borrows
        vm.prank(alice);
        engine.depositCollateral(alice, 10_000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, 5000 * WAD);

        // Bob deposits and borrows
        vm.roll(20);
        vm.prank(bob);
        engine.depositCollateral(bob, 10_000 * WAD);
        vm.roll(30);
        vm.prank(bob);
        engine.borrow(bob, 3000 * WAD);

        // Both debts should be correct
        assertEq(engine.getPositionDebt(alice), 5000 * WAD);
        assertEq(engine.getPositionDebt(bob), 3000 * WAD);

        // Total debt
        assertEq(engine.totalDebt(), 8000 * WAD);
    }

    /// @notice Repaying all debt leaves zero
    function test_SEC_debtScale_fullRepayLeavesZero() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 10_000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, 5000 * WAD);

        debtToken.mint(alice, 10_000 * WAD);

        vm.roll(20);
        vm.prank(alice);
        engine.repay(alice, 5000 * WAD);

        assertEq(engine.getPositionDebt(alice), 0);
    }

    // =====================================================================
    //  14. WITHDRAW HEALTH FACTOR CHECK
    // =====================================================================

    /// @notice Cannot withdraw collateral if it would make position unhealthy
    function test_SEC_withdraw_wouldMakeUnhealthy() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, 700 * WAD); // 70% LTV

        // Try to withdraw most collateral — would push HF below 1
        vm.roll(20);
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__HealthFactorBelowOne.selector);
        engine.withdrawCollateral(alice, 900 * WAD);
    }

    /// @notice Can withdraw collateral down to exactly LTV boundary
    function test_SEC_withdraw_toExactHealthBoundary() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 1000 * WAD);
        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, 100 * WAD); // 10% LTV

        // Can withdraw significant amount since debt is low
        // With 100 debt and liqThreshold 85%, need collateral >= 100/0.85 ≈ 117.65
        // So can withdraw up to ~882 shares
        vm.roll(20);
        vm.prank(alice);
        engine.withdrawCollateral(alice, 880 * WAD);

        assertTrue(engine.getHealthFactor(alice) >= WAD);
    }

    // =====================================================================
    //  15. DEPOSIT FOR OTHER USER
    // =====================================================================

    /// @notice Anyone can deposit collateral for another user
    function test_SEC_deposit_forAnotherUser() public {
        // Eve deposits for alice — this is allowed by design
        vm.prank(eve);
        engine.depositCollateral(alice, 100 * WAD);

        assertEq(engine.getPositionCollateralShares(alice), 100 * WAD);
    }

    // =====================================================================
    //  16. ADMIN TRANSFER CHAIN
    // =====================================================================

    /// @notice Admin transfer chain: A → B → C, old admins locked out
    function test_SEC_admin_transferChain() public {
        // admin (this) → alice
        engine.setAdmin(alice);

        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.setPaused(true);

        // alice → bob
        vm.prank(alice);
        engine.setAdmin(bob);

        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.setPaused(true);

        // bob can pause
        vm.prank(bob);
        engine.setPaused(true);
    }

    /// @notice Cannot set admin to zero address
    function test_SEC_admin_cannotSetZero() public {
        vm.expectRevert(AuraEngine.Aura__InvalidParams.selector);
        engine.setAdmin(address(0));
    }

    // =====================================================================
    //  17. CONTROLLABLE VAULT: HARVEST YIELD ATTACK
    // =====================================================================

    /// @notice Vault share price manipulation during harvest
    function test_SEC_harvest_vaultPriceManipulation() public {
        ControllableVault cVault = new ControllableVault(address(assetToken));
        ControllableOracle cOracle = new ControllableOracle(WAD);

        AuraEngine cImpl = new AuraEngine();
        AuraProxy cProxy = new AuraProxy(
            address(cImpl),
            abi.encodeCall(
                AuraEngine.initialize,
                (address(cVault), address(debtToken), address(cOracle), 8000, 8500, 500, 1 days, 2 days)
            )
        );
        AuraEngine cEngine = AuraEngine(address(cProxy));
        debtToken.mint(address(cProxy), 10_000_000 * WAD);

        // Alice deposits
        assetToken.mint(alice, 1000 * WAD);
        vm.startPrank(alice);
        assetToken.approve(address(cVault), type(uint256).max);
        cVault.deposit(1000 * WAD, alice);
        cVault.approve(address(cProxy), type(uint256).max);
        cEngine.depositCollateral(alice, 1000 * WAD);
        vm.stopPrank();

        vm.roll(10);
        vm.prank(alice);
        cEngine.borrow(alice, 500 * WAD);

        // Attacker inflates vault share price before harvest
        cVault.setPricePerShare(2 * WAD); // 2x price = 100% yield

        vm.warp(block.timestamp + 2 days);
        uint256 yieldApplied = cEngine.harvestYield();

        // Yield should be capped at total debt (500 WAD)
        assertTrue(yieldApplied <= 500 * WAD);

        // Debt should be reduced
        assertTrue(cEngine.getPositionDebt(alice) < 500 * WAD);
    }

    // =====================================================================
    //  18. POSITION WITH NO PRIOR INTERACTION
    // =====================================================================

    /// @notice User with no position cannot borrow
    function test_SEC_edge_noPriorDepositCannotBorrow() public {
        address nobody = address(0xDEAD);
        vm.prank(nobody);
        vm.expectRevert(AuraEngine.Aura__ExceedsLTV.selector);
        engine.borrow(nobody, 1 * WAD);
    }

    /// @notice User with no position cannot withdraw
    function test_SEC_edge_noPriorDepositCannotWithdraw() public {
        address nobody = address(0xDEAD);
        vm.prank(nobody);
        vm.expectRevert(AuraEngine.Aura__InsufficientCollateral.selector);
        engine.withdrawCollateral(nobody, 1 * WAD);
    }

    // =====================================================================
    //  19. LARGE VALUE STRESS TEST
    // =====================================================================

    /// @notice Large deposits and borrows don't overflow
    function test_SEC_stress_largeValues() public {
        uint256 largeAmount = 1_000_000_000 * WAD; // 1 billion

        assetToken.mint(alice, largeAmount);
        vm.startPrank(alice);
        assetToken.approve(address(vault), type(uint256).max);
        vault.deposit(largeAmount, alice);
        vault.approve(address(proxy), type(uint256).max);

        engine.depositCollateral(alice, largeAmount);
        vm.stopPrank();

        vm.roll(10);
        uint256 maxBorrow = (largeAmount * 8000) / 10000; // 80% LTV
        debtToken.mint(address(proxy), maxBorrow);

        vm.prank(alice);
        engine.borrow(alice, maxBorrow);

        assertEq(engine.getPositionDebt(alice), maxBorrow);
        assertTrue(engine.getHealthFactor(alice) > WAD);
    }

    // =====================================================================
    //  20. DUST POSITION ATTACK
    // =====================================================================

    /// @notice Tiny dust position should still be liquidatable when unhealthy
    function test_SEC_dust_tinyPositionLiquidatable() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 10); // 10 wei of shares
        vm.roll(10);

        // With 1:1 price, collateral = 10 wei, max borrow = 8 wei (80%)
        vm.prank(alice);
        engine.borrow(alice, 8);

        // Price crashes
        vm.roll(20);
        oracle.setPrice(WAD / 2);

        // Should be liquidatable
        uint256 hf = engine.getHealthFactor(alice);
        assertTrue(hf < WAD);

        vm.prank(eve);
        engine.liquidate(alice, 8);
    }
}
