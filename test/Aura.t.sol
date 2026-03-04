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
