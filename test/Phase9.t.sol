// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test }                 from "forge-std/Test.sol";
import { AuraEngine }           from "../src/AuraEngine.sol";
import { AuraProxy }            from "../src/AuraProxy.sol";
import { AuraMarketRegistry }   from "../src/AuraMarketRegistry.sol";
import { AuraUSD }              from "../src/AuraUSD.sol";
import { AuraPSM }              from "../src/AuraPSM.sol";
import { MockERC20 }            from "./mocks/MockERC20.sol";
import { MockVault4626 }        from "./mocks/MockVault4626.sol";
import { MockOracle }           from "./mocks/MockOracle.sol";

/**
 * @title Phase9Test
 * @notice Tests for Phase 9: AuraUSD mintable stablecoin, Engine CDP mode, PSM.
 */
contract Phase9Test is Test {
    // ------------------------------- Constants
    uint256 constant WAD       = 1e18;
    uint256 constant MARKET_ID = 0;

    // ------------------------------- Actors
    address public admin = address(this);
    address public alice = address(0xA11CE);
    address public bob   = address(0xB0B);

    // ------------------------------- Contracts
    AuraUSD           public ausd;
    AuraPSM           public psm;
    AuraEngine        public engine;
    AuraProxy         public proxy;
    AuraMarketRegistry public registry;

    MockERC20    public usdc;        // peggedToken for PSM
    MockERC20    public assetToken;  // collateral underlying
    MockVault4626 public vault;
    MockOracle   public oracle;

    // ------------------------------- Setup
    function setUp() public {
        // 1. Deploy AuraUSD
        ausd = new AuraUSD(admin);

        // 2. Deploy collateral infrastructure
        assetToken = new MockERC20("Wrapped stETH", "wstETH", 18);
        vault      = new MockVault4626(address(assetToken), "Aura wstETH Vault", "wstETH");
        oracle     = new MockOracle();

        // 3. Registry
        registry = new AuraMarketRegistry(admin);
        registry.addMarket(
            address(vault), address(oracle),
            uint16(8000), uint16(8500), uint16(500),
            0, 0, false, 0
        );

        // 4. Engine (AuraUSD as debt token, mintableDebtToken = false initially)
        AuraEngine impl = new AuraEngine();
        bytes memory initData = abi.encodeCall(
            AuraEngine.initialize,
            (address(ausd), address(registry), uint256(1 days), uint256(2 days))
        );
        proxy  = new AuraProxy(address(impl), initData);
        engine = AuraEngine(address(proxy));
        registry.setEngine(address(proxy));

        // 5. Register engine + test-admin as minters in AuraUSD, enable CDP mode
        ausd.addMinter(address(proxy));
        ausd.addMinter(admin);   // test contract can mint directly in unit tests
        engine.setMintableDebtToken(true);

        // 6. Deploy PSM (USDC stable)
        usdc = new MockERC20("USD Coin", "USDC", 18);
        psm  = new AuraPSM(address(ausd), address(usdc), admin, 10, 10); // 0.1% each
        ausd.addMinter(address(psm));

        // 7. Fund actors with collateral
        assetToken.mint(alice, 10_000 * WAD);
        vm.startPrank(alice);
        assetToken.approve(address(vault), type(uint256).max);
        vault.deposit(1_000 * WAD, alice);
        vault.approve(address(proxy), type(uint256).max);
        vm.stopPrank();

        assetToken.mint(bob, 10_000 * WAD);
        vm.startPrank(bob);
        assetToken.approve(address(vault), type(uint256).max);
        vault.deposit(1_000 * WAD, bob);
        vault.approve(address(proxy), type(uint256).max);
        vm.stopPrank();
    }

    // ==========================================================================
    // AuraUSD — ERC-20 & access control
    // ==========================================================================

    function test_ausd_mint_byMinter() public {
        ausd.mint(alice, 100 * WAD);
        assertEq(ausd.balanceOf(alice), 100 * WAD);
        assertEq(ausd.totalSupply(), 100 * WAD);
    }

    function test_ausd_mint_notMinter_reverts() public {
        vm.prank(alice);
        vm.expectRevert(AuraUSD.AuraUSD__Unauthorized.selector);
        ausd.mint(alice, 100 * WAD);
    }

    function test_ausd_burn_byMinter() public {
        ausd.mint(alice, 200 * WAD);
        ausd.burn(alice, 50 * WAD);
        assertEq(ausd.balanceOf(alice), 150 * WAD);
        assertEq(ausd.totalSupply(), 150 * WAD);
    }

    function test_ausd_burnFrom_withAllowance() public {
        ausd.mint(alice, 100 * WAD);
        vm.prank(alice);
        ausd.approve(bob, 60 * WAD);
        vm.prank(bob);
        ausd.burnFrom(alice, 60 * WAD);
        assertEq(ausd.balanceOf(alice), 40 * WAD);
        assertEq(ausd.totalSupply(), 40 * WAD);
    }

    function test_ausd_burnFrom_insufficientAllowance_reverts() public {
        ausd.mint(alice, 100 * WAD);
        vm.prank(alice);
        ausd.approve(bob, 10 * WAD);
        vm.prank(bob);
        vm.expectRevert(AuraUSD.AuraUSD__InsufficientAllowance.selector);
        ausd.burnFrom(alice, 50 * WAD);
    }

    function test_ausd_globalDebtCeiling_enforced() public {
        ausd.setGlobalDebtCeiling(500 * WAD);
        ausd.mint(alice, 500 * WAD); // exactly at ceiling — should pass
        vm.expectRevert(AuraUSD.AuraUSD__DebtCeilingExceeded.selector);
        ausd.mint(alice, 1);         // one wei over ceiling
    }

    function test_ausd_globalDebtCeiling_zero_unlimited() public {
        ausd.setGlobalDebtCeiling(0); // 0 = unlimited
        ausd.mint(alice, 1_000_000 * WAD);
        assertEq(ausd.totalSupply(), 1_000_000 * WAD);
    }

    function test_ausd_addMinter_removeMinter() public {
        address newMinter = address(0x1234);
        ausd.addMinter(newMinter);
        assertTrue(ausd.minters(newMinter));

        ausd.removeMinter(newMinter);
        assertFalse(ausd.minters(newMinter));

        vm.prank(newMinter);
        vm.expectRevert(AuraUSD.AuraUSD__Unauthorized.selector);
        ausd.mint(alice, 1);
    }

    function test_ausd_addMinter_nonAdmin_reverts() public {
        vm.prank(alice);
        vm.expectRevert(AuraUSD.AuraUSD__Unauthorized.selector);
        ausd.addMinter(alice);
    }

    // ==========================================================================
    // Engine — CDP mode (mintableDebtToken = true)
    // ==========================================================================

    function _depositAndBorrow(address user, uint256 collateral, uint256 borrowAmt) internal {
        vm.prank(user);
        engine.depositCollateral(user, MARKET_ID, collateral);
        vm.roll(block.number + 1);
        vm.prank(user);
        engine.borrow(user, MARKET_ID, borrowAmt);
    }

    function test_engine_cdp_borrow_mints_ausd() public {
        _depositAndBorrow(alice, 100 * WAD, 50 * WAD);
        // aUSD should have been minted to alice, NOT transferred from engine
        assertEq(ausd.balanceOf(alice), 50 * WAD);
        assertEq(ausd.totalSupply(), 50 * WAD);
        // Engine holds zero balance
        assertEq(ausd.balanceOf(address(proxy)), 0);
    }

    function test_engine_cdp_repay_burns_ausd() public {
        _depositAndBorrow(alice, 100 * WAD, 50 * WAD);

        vm.roll(block.number + 1);
        vm.startPrank(alice);
        ausd.approve(address(proxy), type(uint256).max);
        engine.repay(alice, MARKET_ID, 20 * WAD);
        vm.stopPrank();

        // 20 WAD burned, 30 WAD remaining in wallet
        assertEq(ausd.balanceOf(alice), 30 * WAD);
        assertEq(ausd.totalSupply(), 30 * WAD);
        assertEq(engine.getPositionDebt(alice, MARKET_ID), 30 * WAD);
    }

    function test_engine_cdp_liquidate_burns_ausd() public {
        // _depositAndBorrow: deposit at block 1, roll to 2, borrow at block 2
        _depositAndBorrow(alice, 100 * WAD, 79 * WAD);

        // Drop price to make position liquidatable
        oracle.setPrice(WAD / 2); // price halved → HF < 1

        // Give bob aUSD to liquidate with (admin is a minter from setUp)
        ausd.mint(bob, 100 * WAD);

        // Roll to block 3 (different from alice's lastInteractionBlock=2)
        vm.roll(3);
        vm.startPrank(bob);
        ausd.approve(address(proxy), type(uint256).max);
        engine.liquidate(alice, MARKET_ID, 10 * WAD);
        vm.stopPrank();

        // Bob spent 10 aUSD (burned), his balance reduced
        assertEq(ausd.balanceOf(bob), 90 * WAD);
    }

    function test_engine_cdp_perMarket_debtCeiling() public {
        // Set per-market debt ceiling of 30 WAD
        registry.updateMarketDebtCeiling(MARKET_ID, 30 * WAD);

        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
        vm.roll(block.number + 1);

        // Borrow 30 WAD — exactly at ceiling (allowed)
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 30 * WAD);

        vm.roll(block.number + 1);
        // Bob tries to borrow 1 more from the same market — should revert
        vm.prank(bob);
        engine.depositCollateral(bob, MARKET_ID, 100 * WAD);
        vm.roll(block.number + 1);

        vm.prank(bob);
        vm.expectRevert(AuraEngine.Aura__DebtCeilingExceeded.selector);
        engine.borrow(bob, MARKET_ID, 1);
    }

    function test_engine_cdp_globalDebtCeiling_blocks_borrow() public {
        // Global ceiling of 40 WAD on AuraUSD
        ausd.setGlobalDebtCeiling(40 * WAD);

        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
        vm.roll(block.number + 1);

        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 40 * WAD); // fills ceiling

        vm.roll(block.number + 1);
        vm.prank(bob);
        engine.depositCollateral(bob, MARKET_ID, 100 * WAD);
        vm.roll(block.number + 1);

        // Any additional borrow should revert inside AuraUSD.mint
        vm.prank(bob);
        vm.expectRevert(AuraUSD.AuraUSD__DebtCeilingExceeded.selector);
        engine.borrow(bob, MARKET_ID, 1);
    }

    function test_engine_cdp_legacyMode_unaffected() public {
        // Deploy a fresh engine in LEGACY mode (mintableDebtToken = false)
        MockERC20 legacyToken = new MockERC20("Legacy Debt", "LD", 18);
        AuraMarketRegistry reg2 = new AuraMarketRegistry(admin);
        reg2.addMarket(address(vault), address(oracle), 8000, 8500, 500, 0, 0, false, 0);

        AuraEngine impl2 = new AuraEngine();
        bytes memory init2 = abi.encodeCall(
            AuraEngine.initialize,
            (address(legacyToken), address(reg2), 1 days, 2 days)
        );
        AuraProxy proxy2 = new AuraProxy(address(impl2), init2);
        AuraEngine engine2 = AuraEngine(address(proxy2));
        reg2.setEngine(address(proxy2));

        // Pre-fund engine (legacy mode)
        legacyToken.mint(address(proxy2), 1_000_000 * WAD);

        vm.prank(alice);
        engine2.depositCollateral(alice, 0, 100 * WAD);
        vm.roll(block.number + 1);

        vm.prank(alice);
        engine2.borrow(alice, 0, 50 * WAD);

        // Token transferred from engine to alice (not minted)
        assertEq(legacyToken.balanceOf(alice), 50 * WAD);
        assertEq(legacyToken.balanceOf(address(proxy2)), 1_000_000 * WAD - 50 * WAD);
    }

    // ==========================================================================
    // PSM — Peg Stability Module
    // ==========================================================================

    function _psmSetup(uint256 usdcAmount) internal {
        usdc.mint(alice, usdcAmount);
        vm.prank(alice);
        usdc.approve(address(psm), type(uint256).max);
    }

    function test_psm_swapIn_basic() public {
        _psmSetup(1000 * WAD);
        vm.prank(alice);
        uint256 out = psm.swapIn(1000 * WAD);

        uint256 fee = (1000 * WAD * 10) / 10_000; // 0.1%
        assertEq(out, 1000 * WAD - fee);
        assertEq(ausd.balanceOf(alice), 1000 * WAD - fee);
        assertEq(usdc.balanceOf(address(psm)), 1000 * WAD);
    }

    function test_psm_swapOut_basic() public {
        // First swapIn to get aUSD into PSM reserves and alice's wallet
        _psmSetup(1000 * WAD);
        vm.prank(alice);
        uint256 ausdOut = psm.swapIn(1000 * WAD);

        // Now swapOut
        vm.startPrank(alice);
        ausd.approve(address(psm), type(uint256).max);
        uint256 stableOut = psm.swapOut(ausdOut);
        vm.stopPrank();

        uint256 toutFee = (ausdOut * 10) / 10_000;
        assertEq(stableOut, ausdOut - toutFee);
        assertEq(usdc.balanceOf(alice), stableOut);
        assertEq(ausd.balanceOf(alice), 0);
    }

    function test_psm_swapIn_fee_accounting() public {
        _psmSetup(1000 * WAD);
        vm.prank(alice);
        psm.swapIn(1000 * WAD);

        uint256 expectedFee = (1000 * WAD * 10) / 10_000;
        assertEq(psm.feeReserves(), expectedFee);
    }

    function test_psm_swapOut_fee_accounting() public {
        _psmSetup(1000 * WAD);
        vm.prank(alice);
        uint256 ausdOut = psm.swapIn(1000 * WAD);
        uint256 feeAfterIn = psm.feeReserves();

        vm.startPrank(alice);
        ausd.approve(address(psm), type(uint256).max);
        psm.swapOut(ausdOut);
        vm.stopPrank();

        uint256 toutFee = (ausdOut * 10) / 10_000;
        assertEq(psm.feeReserves(), feeAfterIn + toutFee);
    }

    function test_psm_ceiling_enforced() public {
        psm.setCeiling(500 * WAD);
        _psmSetup(1000 * WAD);

        vm.prank(alice);
        vm.expectRevert(AuraPSM.PSM__CeilingExceeded.selector);
        psm.swapIn(1000 * WAD); // would mint ~999 aUSD, over 500 WAD ceiling
    }

    function test_psm_ceiling_partial_ok() public {
        psm.setCeiling(999 * WAD);
        // 1000 * (1 - 0.001) = 999 WAD out — exactly at ceiling
        _psmSetup(1000 * WAD);
        vm.prank(alice);
        uint256 out = psm.swapIn(1000 * WAD);
        assertEq(psm.mintedViaPsm(), out);
    }

    function test_psm_insufficientReserves_swapOut() public {
        // Mint aUSD to alice without going through PSM (so PSM holds no USDC)
        ausd.mint(alice, 100 * WAD);
        vm.startPrank(alice);
        ausd.approve(address(psm), type(uint256).max);
        vm.expectRevert(AuraPSM.PSM__InsufficientReserves.selector);
        psm.swapOut(100 * WAD);
        vm.stopPrank();
    }

    function test_psm_withdrawFeeReserves() public {
        _psmSetup(1000 * WAD);
        vm.prank(alice);
        psm.swapIn(1000 * WAD);

        uint256 fee = psm.feeReserves();
        assertTrue(fee > 0);

        uint256 adminBefore = usdc.balanceOf(admin);
        psm.withdrawFeeReserves(admin, fee);
        assertEq(usdc.balanceOf(admin), adminBefore + fee);
        assertEq(psm.feeReserves(), 0);
    }

    function test_psm_setFee_admin() public {
        psm.setFee(50, 25);
        assertEq(psm.tinBps(), 50);
        assertEq(psm.toutBps(), 25);
    }

    function test_psm_setFee_nonAdmin_reverts() public {
        vm.prank(alice);
        vm.expectRevert(AuraPSM.PSM__Unauthorized.selector);
        psm.setFee(50, 25);
    }
}
