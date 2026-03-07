// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test }               from "forge-std/Test.sol";
import { AuraEngine }         from "../../src/AuraEngine.sol";
import { AuraProxy }          from "../../src/AuraProxy.sol";
import { AuraMarketRegistry } from "../../src/AuraMarketRegistry.sol";
import { MockERC20 }          from "../mocks/MockERC20.sol";
import { MockVault4626 }      from "../mocks/MockVault4626.sol";
import { MockOracle }         from "../mocks/MockOracle.sol";

/**
 * @title  AuraSymbolicTest
 * @notice Symbolic execution checks for critical AuraEngine safety properties.
 *
 *   Execution modes:
 *   ─────────────────────────────────────────────────────────────────────────
 *   1. Halmos symbolic execution (preferred for full coverage):
 *         pip install halmos
 *         halmos --contract AuraSymbolicTest
 *      Halmos treats function parameters as fully symbolic (all possible values)
 *      and uses SAT/SMT solving to prove the assert statements hold for ALL inputs.
 *
 *   2. Foundry property-based fuzzing (always available, no extra tooling):
 *         forge test --match-contract AuraSymbolicTest
 *      Foundry treats the `check_*` functions as fuzz tests and runs them for
 *      the configured number of runs (1000 by default, set in foundry.toml).
 *      The `check_` prefix is valid in Foundry — it runs the functions as tests.
 *
 *   The `check_` prefix is the Halmos convention (mirrors Foundry's `test_` prefix).
 *   Under Halmos, function parameters are symbolic; under Foundry they are fuzz inputs.
 *
 * Properties verified:
 *   1. LTV always enforced   — if borrow() succeeds, health factor >= 1.
 *   2. Deposit always stored — after depositCollateral(), position shares >= deposited.
 *   3. Repay never over-pulls — after repay(), position debt is 0 and engine never
 *                               deducts more tokens than the original principal.
 */
contract AuraSymbolicTest is Test {

    // ---- Constants
    uint256 constant WAD       = 1e18;
    uint256 constant MARKET_ID = 0;

    // Known actor with deterministic address (no private key needed for these checks)
    address constant ALICE = address(0xA11CE);

    // ---- Shared setup helper

    struct Env {
        AuraEngine         engine;
        AuraProxy          proxy;
        AuraMarketRegistry registry;
        MockERC20          assetToken;
        MockERC20          debtToken;
        MockVault4626      vault;
        MockOracle         oracle;
    }

    /**
     * @dev Fresh deployment for each check (isolated state — symbolic inputs
     *      cannot affect other tests via shared state).
     */
    function _deploy() internal returns (Env memory e) {
        e.assetToken = new MockERC20("wstETH", "wstETH", 18);
        e.debtToken  = new MockERC20("USDC",   "USDC",   18);
        e.vault      = new MockVault4626(address(e.assetToken), "aV", "aV");
        e.oracle     = new MockOracle();  // price = 1 WAD

        e.registry = new AuraMarketRegistry(address(this));
        e.registry.addMarket(
            address(e.vault), address(e.oracle),
            uint16(8000), uint16(8500), uint16(500),
            0, 0, false, 0
        );

        AuraEngine impl = new AuraEngine();
        bytes memory init = abi.encodeCall(
            AuraEngine.initialize,
            (address(e.debtToken), address(e.registry), 1 days, 2 days)
        );
        e.proxy  = new AuraProxy(address(impl), init);
        e.engine = AuraEngine(address(e.proxy));
        e.registry.setEngine(address(e.proxy));

        e.debtToken.mint(address(e.proxy), 10_000_000 * WAD);
    }

    function _fund(Env memory e, address user, uint256 assets) internal {
        e.assetToken.mint(user, assets);
        vm.startPrank(user);
        e.assetToken.approve(address(e.vault), type(uint256).max);
        e.vault.deposit(assets, user);
        e.vault.approve(address(e.proxy), type(uint256).max);
        e.debtToken.approve(address(e.proxy), type(uint256).max);
        vm.stopPrank();
    }

    // =========================================================================
    // Check 1: LTV always enforced — borrow() can only succeed if HF >= 1
    // =========================================================================

    /**
     * @notice Symbolic property: whenever borrow() does not revert, the resulting
     *         health factor for the borrower is at least 1 WAD (>= 1.0).
     *
     * This proves the LTV check in _requireLtv is exhaustive: there is no
     * combination of (shares, borrowAmount) that bypasses the health constraint.
     *
     * Halmos bounds: uint128 inputs keep the value space tractable for SMT solving.
     *                In Foundry fuzz mode, these are just bounded random values.
     */
    function check_ltvAlwaysEnforced(uint128 shares, uint128 borrowAmount) public {
        // Reject trivial / zero inputs
        vm.assume(shares > 0);
        vm.assume(borrowAmount > 0);

        Env memory e = _deploy();
        _fund(e, ALICE, uint256(shares));

        // Deposit
        vm.prank(ALICE);
        e.engine.depositCollateral(ALICE, MARKET_ID, uint256(shares));

        // Advance one block (noSameBlock guard)
        vm.roll(block.number + 1);

        // Attempt borrow — if it succeeds, HF must be >= WAD
        vm.prank(ALICE);
        try e.engine.borrow(ALICE, MARKET_ID, uint256(borrowAmount)) {
            uint256 hf = e.engine.getHealthFactor(ALICE);
            assert(hf >= WAD);  // core safety property
        } catch {
            // Borrow correctly reverted (e.g. ExceedsLTV) — nothing to assert
        }
    }

    // =========================================================================
    // Check 2: depositCollateral always increases position shares
    // =========================================================================

    /**
     * @notice Symbolic property: for any non-zero shares input, a successful
     *         depositCollateral() increases the user's position by exactly `shares`
     *         and the engine's vault balance by exactly `shares`.
     *
     * This proves the accounting in _depositCollateralCore is correct and that
     * there is no rounding, aliasing, or off-by-one that could allow a deposit
     * to be lost or counted twice.
     */
    function check_depositAlwaysRecorded(uint128 shares) public {
        vm.assume(shares > 0);

        Env memory e = _deploy();
        _fund(e, ALICE, uint256(shares));

        uint256 sharesBefore  = e.engine.getPositionCollateralShares(ALICE, MARKET_ID);
        uint256 vaultBalBefore = e.vault.balanceOf(address(e.proxy));

        vm.prank(ALICE);
        e.engine.depositCollateral(ALICE, MARKET_ID, uint256(shares));

        uint256 sharesAfter   = e.engine.getPositionCollateralShares(ALICE, MARKET_ID);
        uint256 vaultBalAfter  = e.vault.balanceOf(address(e.proxy));

        // Position must increase by exactly the deposited amount
        assert(sharesAfter == sharesBefore + uint256(shares));
        // Engine vault balance must increase by exactly the deposited amount
        assert(vaultBalAfter == vaultBalBefore + uint256(shares));
    }

    // =========================================================================
    // Check 3: repay never over-pulls — position debt reaches exactly 0
    // =========================================================================

    /**
     * @notice Symbolic property: after calling repay() with an amount >= outstanding debt,
     *         the position debt is zero regardless of the repay amount.
     *         The engine caps the repay amount internally; it must never pull more
     *         tokens than the borrower actually owes.
     *
     * This proves the capping logic in _repayCore is safe and complete.
     */
    function check_repayNeverExceedsDebt(uint128 principalDebt, uint128 extraRepay) public {
        vm.assume(principalDebt > 0 && principalDebt <= 79 * WAD);  // within 80% LTV of 100 WAD collateral
        vm.assume(extraRepay <= 1_000 * WAD);

        Env memory e = _deploy();
        _fund(e, ALICE, 100 * WAD);   // 100 WAD collateral

        // Deposit 100 WAD shares
        vm.prank(ALICE);
        e.engine.depositCollateral(ALICE, MARKET_ID, 100 * WAD);

        vm.roll(block.number + 1);

        // Borrow the symbolic principal
        vm.prank(ALICE);
        e.engine.borrow(ALICE, MARKET_ID, uint256(principalDebt));

        uint256 debt = e.engine.getPositionDebt(ALICE, MARKET_ID);

        // Fund alice with enough to over-repay
        e.debtToken.mint(ALICE, uint256(extraRepay) + debt);

        uint256 aliceBalBefore = e.debtToken.balanceOf(ALICE);
        uint256 repayAmt       = debt + uint256(extraRepay);

        vm.roll(block.number + 1);
        vm.prank(ALICE);
        e.engine.repay(ALICE, MARKET_ID, repayAmt);

        uint256 debtAfter      = e.engine.getPositionDebt(ALICE, MARKET_ID);
        uint256 aliceBalAfter  = e.debtToken.balanceOf(ALICE);

        // Debt must be fully cleared (not negative — impossible in uint256, but ensuring 0)
        assert(debtAfter == 0);

        // Engine must have pulled exactly `debt` tokens (not `repayAmt` which is larger)
        assert(aliceBalBefore - aliceBalAfter == debt);
    }
}
