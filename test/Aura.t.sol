// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { AuraEngine } from "../src/AuraEngine.sol";
import { AuraProxy } from "../src/AuraProxy.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";
import { MockVault4626 } from "./mocks/MockVault4626.sol";
import { MockOracle } from "./mocks/MockOracle.sol";

contract AuraTest is Test {
    AuraEngine public engine;
    AuraProxy public proxy;
    MockERC20 public assetToken;
    MockERC20 public debtToken;
    MockVault4626 public vault;
    MockOracle public oracle;

    address public admin = address(this);
    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);

    uint256 constant WAD = 1e18;

    function setUp() public {
        assetToken = new MockERC20("Wrapped stETH", "wstETH", 18);
        debtToken = new MockERC20("USD Coin", "USDC", 18);
        vault = new MockVault4626(address(assetToken), "Aura wstETH Vault", "wstETH");
        oracle = new MockOracle();

        AuraEngine impl = new AuraEngine();
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

        // Fund the engine with debt tokens so users can borrow
        debtToken.mint(address(proxy), 1_000_000 * WAD);

        // Give alice some asset tokens and vault shares
        assetToken.mint(alice, 10_000 * WAD);
        vm.startPrank(alice);
        assetToken.approve(address(vault), type(uint256).max);
        vault.deposit(1_000 * WAD, alice);
        vm.stopPrank();

        // Give bob some asset tokens and vault shares
        assetToken.mint(bob, 10_000 * WAD);
        vm.startPrank(bob);
        assetToken.approve(address(vault), type(uint256).max);
        vault.deposit(1_000 * WAD, bob);
        vm.stopPrank();
    }

    // ==================== Deposit ====================

    function test_depositCollateral() public {
        vm.startPrank(alice);
        uint256 shares = 100 * WAD;
        engine.depositCollateral(alice, shares);
        vm.stopPrank();

        assertEq(engine.getPositionCollateralShares(alice), shares);
    }

    function test_depositCollateral_zeroReverts() public {
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__ZeroAmount.selector);
        engine.depositCollateral(alice, 0);
    }

    function test_depositCollateral_sameBlockReverts() public {
        vm.startPrank(alice);
        engine.depositCollateral(alice, 10 * WAD);
        vm.expectRevert(AuraEngine.Aura__SameBlockInteraction.selector);
        engine.depositCollateral(alice, 10 * WAD);
        vm.stopPrank();
    }

    // ==================== Withdraw ====================

    function test_withdrawCollateral() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 100 * WAD);

        vm.roll(block.number + 1);

        vm.prank(alice);
        engine.withdrawCollateral(alice, 50 * WAD);

        assertEq(engine.getPositionCollateralShares(alice), 50 * WAD);
    }

    function test_withdrawCollateral_unauthorizedReverts() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 100 * WAD);

        vm.roll(block.number + 1);

        vm.prank(bob);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.withdrawCollateral(alice, 50 * WAD);
    }

    function test_withdrawCollateral_insufficientReverts() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 100 * WAD);

        vm.roll(block.number + 1);

        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__InsufficientCollateral.selector);
        engine.withdrawCollateral(alice, 200 * WAD);
    }

    // ==================== Borrow ====================

    function test_borrow() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 100 * WAD);

        vm.roll(block.number + 1);

        vm.prank(alice);
        engine.borrow(alice, 50 * WAD); // 50% LTV, under 80% limit

        assertEq(engine.getPositionDebt(alice), 50 * WAD);
    }

    function test_borrow_exceedsLtvReverts() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 100 * WAD);

        vm.roll(block.number + 1);

        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__ExceedsLTV.selector);
        engine.borrow(alice, 90 * WAD); // 90% > 80% LTV limit
    }

    function test_borrow_unauthorizedReverts() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 100 * WAD);

        vm.roll(block.number + 1);

        vm.prank(bob);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.borrow(alice, 10 * WAD);
    }

    // ==================== Repay ====================

    function test_repay() public {
        // Deposit and borrow
        vm.prank(alice);
        engine.depositCollateral(alice, 100 * WAD);

        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, 50 * WAD);

        // Give alice debt tokens to repay (she received 50 WAD from borrow)
        vm.roll(20);

        vm.startPrank(alice);
        debtToken.approve(address(proxy), type(uint256).max);
        engine.repay(alice, 20 * WAD);
        vm.stopPrank();

        assertEq(engine.getPositionDebt(alice), 30 * WAD);
    }

    function test_repay_moreThanDebt_capsToDebt() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 100 * WAD);

        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, 50 * WAD);

        vm.roll(20);

        vm.startPrank(alice);
        debtToken.approve(address(proxy), type(uint256).max);
        engine.repay(alice, 999 * WAD); // more than debt
        vm.stopPrank();

        assertEq(engine.getPositionDebt(alice), 0);
    }

    // ==================== Health factor ====================

    function test_healthFactor_noDebt_isMax() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 100 * WAD);

        assertEq(engine.getHealthFactor(alice), type(uint256).max);
    }

    function test_healthFactor_withDebt() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 100 * WAD);
        vm.roll(block.number + 1);
        vm.prank(alice);
        engine.borrow(alice, 50 * WAD);

        // HF = collateralValue * 10000 * WAD / (liquidationThresholdBps * debt)
        // = 100 * 10000 * WAD / (8500 * 50) = 1000000 / 425000 ≈ 2.35
        uint256 hf = engine.getHealthFactor(alice);
        assertTrue(hf > WAD); // healthy
    }

    // ==================== Liquidation ====================

    function test_liquidate_healthyReverts() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 100 * WAD);

        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, 50 * WAD);

        vm.roll(20);

        vm.prank(bob);
        vm.expectRevert(AuraEngine.Aura__HealthFactorAboveOne.selector);
        engine.liquidate(alice, 10 * WAD);
    }

    // ==================== Paused ====================

    function test_paused_depositReverts() public {
        engine.setPaused(true);

        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__Paused.selector);
        engine.depositCollateral(alice, 10 * WAD);
    }

    function test_paused_borrowReverts() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 100 * WAD);

        engine.setPaused(true);

        vm.roll(block.number + 1);
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__Paused.selector);
        engine.borrow(alice, 10 * WAD);
    }

    // ==================== Emergency shutdown ====================

    function test_emergencyShutdown_depositReverts() public {
        engine.setEmergencyShutdown(true);

        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__EmergencyShutdown.selector);
        engine.depositCollateral(alice, 10 * WAD);
    }

    function test_emergencyShutdown_borrowReverts() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 100 * WAD);

        engine.setEmergencyShutdown(true);

        vm.roll(block.number + 1);
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__EmergencyShutdown.selector);
        engine.borrow(alice, 10 * WAD);
    }

    function test_emergencyShutdown_withdrawStillWorks() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 100 * WAD);

        engine.setEmergencyShutdown(true);

        vm.roll(block.number + 1);
        vm.prank(alice);
        engine.withdrawCollateral(alice, 100 * WAD);

        assertEq(engine.getPositionCollateralShares(alice), 0);
    }

    function test_emergencyShutdown_repayStillWorks() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 100 * WAD);

        vm.roll(10);
        vm.prank(alice);
        engine.borrow(alice, 50 * WAD);

        engine.setEmergencyShutdown(true);

        vm.roll(20);
        vm.startPrank(alice);
        debtToken.approve(address(proxy), type(uint256).max);
        engine.repay(alice, 50 * WAD);
        vm.stopPrank();

        assertEq(engine.getPositionDebt(alice), 0);
    }

    // ==================== Admin ====================

    function test_setAdmin() public {
        engine.setAdmin(bob);
        // Old admin should no longer have access
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.setPaused(true);
    }

    function test_setAdmin_zeroReverts() public {
        vm.expectRevert(AuraEngine.Aura__InvalidParams.selector);
        engine.setAdmin(address(0));
    }

    function test_setAdmin_unauthorizedReverts() public {
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.setAdmin(alice);
    }

    // ==================== Harvest ====================

    function test_harvestYield_heartbeatNotElapsedReverts() public {
        vm.expectRevert(AuraEngine.Aura__HeartbeatNotElapsed.selector);
        engine.harvestYield();
    }

    function test_harvestYield_noCollateral_returnsZero() public {
        vm.warp(block.timestamp + 2 days);
        uint256 yield = engine.harvestYield();
        assertEq(yield, 0);
    }

    // ==================== View functions ====================

    function test_totalDebt() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 100 * WAD);
        vm.roll(block.number + 1);
        vm.prank(alice);
        engine.borrow(alice, 50 * WAD);

        assertEq(engine.totalDebt(), 50 * WAD);
    }

    function test_totalCollateralAssets() public {
        vm.prank(alice);
        engine.depositCollateral(alice, 100 * WAD);

        // MockVault4626 has 1:1 share:asset ratio
        assertEq(engine.totalCollateralAssets(), 100 * WAD);
    }

    function test_asset() public {
        assertEq(engine.asset(), address(vault));
    }

    function test_debtToken() public {
        assertEq(engine.debtToken(), address(debtToken));
    }

    function test_ltvBps() public {
        assertEq(engine.ltvBps(), 8000);
    }

    // ==================== Timelock params ====================

    function test_proposeAndExecuteParam() public {
        bytes32 paramId = keccak256("ltvBps");
        engine.proposeParam(paramId, 7500);

        // Execute before timelock — should revert
        vm.expectRevert(AuraEngine.Aura__TimelockNotElapsed.selector);
        engine.executeParam(paramId);

        // Warp past timelock (2 days)
        vm.warp(block.timestamp + 2 days + 1);
        engine.executeParam(paramId);

        assertEq(engine.ltvBps(), 7500);
    }

    // ==================== Reinitialize prevention ====================

    function test_initialize_twiceReverts() public {
        vm.expectRevert(AuraEngine.Aura__InvalidParams.selector);
        engine.initialize(
            address(vault),
            address(debtToken),
            address(oracle),
            uint16(8000),
            uint16(8500),
            uint16(500),
            uint256(1 days),
            uint256(2 days)
        );
    }
}
