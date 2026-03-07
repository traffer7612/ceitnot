// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test }               from "forge-std/Test.sol";
import { AuraEngine }         from "../../src/AuraEngine.sol";
import { AuraProxy }          from "../../src/AuraProxy.sol";
import { AuraMarketRegistry } from "../../src/AuraMarketRegistry.sol";
import { MockERC20 }          from "../mocks/MockERC20.sol";
import { MockVault4626 }      from "../mocks/MockVault4626.sol";
import { MockOracle }         from "../mocks/MockOracle.sol";
import { MockFlashBorrower }  from "../mocks/MockFlashBorrower.sol";

/**
 * @title  GasBenchmarkTest
 * @notice Gas consumption benchmarks for AuraEngine hot paths.
 *
 * Usage:
 *   forge snapshot                    — create / update .gas-snapshot
 *   forge snapshot --diff             — compare against last snapshot
 *   forge test --match-contract GasBenchmarkTest --gas-report
 *
 * Benchmarked operations (each test measures a single, representative call
 * starting from a realistic warm-storage state):
 *   1. depositCollateral  — cold position (first interaction for this user)
 *   2. borrow             — existing position, first borrow
 *   3. repay              — partial repay against outstanding debt
 *   4. liquidate          — full liquidation of an underwater position
 *   5. depositAndBorrow   — compound entrypoint (primary DeFi hot path)
 *   6. repayAndWithdraw   — compound exit path
 *
 * All benchmarks run in legacy mode (no CDP) with a single market at 80% LTV.
 * The oracle price is 1 WAD (1:1 collateral:debt) for deterministic math.
 */
contract GasBenchmarkTest is Test {

    // ---- Constants
    uint256 constant WAD       = 1e18;
    uint256 constant MARKET_ID = 0;

    // ---- Actors
    address public alice     = address(0xA11CE);
    address public bob       = address(0xB0B);
    address public liquidator = address(0x4321);

    // ---- Contracts
    AuraEngine         public engine;
    AuraProxy          public proxy;
    AuraMarketRegistry public registry;
    MockERC20          public assetToken;
    MockERC20          public debtToken;
    MockVault4626      public vault;
    MockOracle         public oracle;

    function setUp() public {
        assetToken = new MockERC20("wstETH", "wstETH", 18);
        debtToken  = new MockERC20("USDC",   "USDC",   18);
        vault      = new MockVault4626(address(assetToken), "aVault", "aV");
        oracle     = new MockOracle();  // price = 1 WAD

        registry = new AuraMarketRegistry(address(this));
        registry.addMarket(
            address(vault), address(oracle),
            uint16(8000), uint16(8500), uint16(500),
            0, 0, false, 0
        );

        AuraEngine impl = new AuraEngine();
        bytes memory init = abi.encodeCall(
            AuraEngine.initialize,
            (address(debtToken), address(registry), 1 days, 2 days)
        );
        proxy  = new AuraProxy(address(impl), init);
        engine = AuraEngine(address(proxy));
        registry.setEngine(address(proxy));

        // Fund engine
        debtToken.mint(address(proxy), 10_000_000 * WAD);

        // Fund actors
        _fund(alice,      100_000 * WAD);
        _fund(bob,        100_000 * WAD);
        _fund(liquidator, 100_000 * WAD);

        // Give liquidator debt tokens for repaying in liquidations
        debtToken.mint(liquidator, 1_000_000 * WAD);
        vm.prank(liquidator);
        debtToken.approve(address(proxy), type(uint256).max);
    }

    function _fund(address user, uint256 assets) internal {
        assetToken.mint(user, assets);
        vm.startPrank(user);
        assetToken.approve(address(vault), type(uint256).max);
        vault.deposit(assets, user);
        vault.approve(address(proxy), type(uint256).max);
        debtToken.approve(address(proxy), type(uint256).max);
        vm.stopPrank();
    }

    // =========================================================================
    // Benchmark 1: depositCollateral — cold position
    // =========================================================================

    /**
     * @notice Measures gas for a first-ever deposit into a market (cold storage paths).
     *         This is the most expensive deposit case because it initialises
     *         `userInMarket`, `userMarketIds`, and `globalDebtScale`.
     */
    function test_gas_depositCollateral() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
    }

    // =========================================================================
    // Benchmark 2: borrow — warm position, first borrow
    // =========================================================================

    /**
     * @notice Measures gas for the first borrow against an existing collateral position.
     *         Storage is warm (position already exists) but debt is zero (cold debt path).
     */
    function test_gas_borrow() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);

        vm.roll(2);

        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 50 * WAD);
    }

    // =========================================================================
    // Benchmark 3: repay — partial repay
    // =========================================================================

    /**
     * @notice Measures gas for a partial debt repayment.
     *         Both storage paths (position and market state) are already warm.
     */
    function test_gas_repay() public {
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
        vm.roll(2);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 50 * WAD);

        vm.roll(3);

        vm.prank(alice);
        engine.repay(alice, MARKET_ID, 25 * WAD);
    }

    // =========================================================================
    // Benchmark 4: liquidate — full liquidation of an underwater position
    // =========================================================================

    /**
     * @notice Measures gas for a full liquidation of an unhealthy position.
     *         The oracle price is dropped to make alice's position underwater
     *         immediately before the benchmark call.
     */
    function test_gas_liquidate() public {
        // Set up alice's position at the limit of safe LTV
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
        vm.roll(2);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 70 * WAD);  // 70% — just under 80% LTV

        // Crash oracle price so alice is liquidatable
        oracle.setPrice(WAD / 2);  // price halved → HF drops to ~60%

        vm.roll(3);

        // Liquidate (this is the benchmarked call)
        vm.prank(liquidator);
        engine.liquidate(alice, MARKET_ID, 70 * WAD);
    }

    // =========================================================================
    // Benchmark 5: depositAndBorrow — compound hot path
    // =========================================================================

    /**
     * @notice Measures gas for the atomic depositAndBorrow entrypoint.
     *         This is the primary DeFi hot path: users open leveraged positions
     *         in a single transaction.
     */
    function test_gas_depositAndBorrow() public {
        vm.prank(alice);
        engine.depositAndBorrow(alice, MARKET_ID, 100 * WAD, 70 * WAD);
    }

    // =========================================================================
    // Benchmark 6: repayAndWithdraw — compound exit path
    // =========================================================================

    /**
     * @notice Measures gas for the atomic repayAndWithdraw entrypoint.
     *         The position is fully set up before the benchmark call, so only
     *         the combined repay + withdraw is measured.
     */
    function test_gas_repayAndWithdraw() public {
        // Open position
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, 100 * WAD);
        vm.roll(2);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, 50 * WAD);

        vm.roll(3);

        // Compound exit — repay all debt and withdraw all collateral
        vm.prank(alice);
        engine.repayAndWithdraw(alice, MARKET_ID, 50 * WAD, 100 * WAD);
    }
}
