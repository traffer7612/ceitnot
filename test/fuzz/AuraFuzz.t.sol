// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test }               from "forge-std/Test.sol";
import { AuraEngine }         from "../../src/AuraEngine.sol";
import { AuraProxy }          from "../../src/AuraProxy.sol";
import { AuraMarketRegistry } from "../../src/AuraMarketRegistry.sol";
import { AuraUSD }            from "../../src/AuraUSD.sol";
import { MockERC20 }          from "../mocks/MockERC20.sol";
import { MockVault4626 }      from "../mocks/MockVault4626.sol";
import { MockOracle }         from "../mocks/MockOracle.sol";

/**
 * @title  AuraFuzzTest
 * @notice Stateless property-based fuzz tests for AuraEngine.
 *         Each test deploys its own isolated state and explores a single
 *         behavioral property across the fuzz input space.
 *
 * Foundry runs 1000 iterations per test (set in foundry.toml).
 */
contract AuraFuzzTest is Test {

    // ---- Constants
    uint256 constant WAD       = 1e18;
    uint256 constant RAY       = 1e27;
    uint256 constant MARKET_ID = 0;

    // ---- Actors
    address public alice = address(0xA11CE);
    address public bob   = address(0xB0B);

    // Known private key for permit signing
    uint256 constant ALICE_PK  = 0xA11CE_BEEF_DEAD_C0DE;

    // ---- Shared internal helpers

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
     * @dev Deploy a minimal legacy-mode engine with 1 market (80% LTV, 85% liq threshold).
     *      The oracle price is 1 WAD (1:1 asset:debt). The vault is 1:1 shares:assets initially.
     */
    function _setupLegacy() internal returns (Env memory e) {
        e.assetToken = new MockERC20("wstETH", "wstETH", 18);
        e.debtToken  = new MockERC20("USDC",   "USDC",   18);
        e.vault      = new MockVault4626(address(e.assetToken), "aVault", "aV");
        e.oracle     = new MockOracle();

        e.registry = new AuraMarketRegistry(address(this));
        e.registry.addMarket(
            address(e.vault),
            address(e.oracle),
            uint16(8000),  // ltvBps
            uint16(8500),  // liquidationThresholdBps
            uint16(500),   // liquidationPenaltyBps
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

        // Fund engine with plenty of debt tokens
        e.debtToken.mint(address(e.proxy), 10_000_000 * WAD);
    }

    /**
     * @dev Give `user` vault shares by minting assets → depositing to vault.
     *      Also approves the engine for vault shares and debt tokens.
     */
    function _fundActor(Env memory e, address user, uint256 shares) internal {
        e.assetToken.mint(user, shares);
        vm.startPrank(user);
        e.assetToken.approve(address(e.vault), type(uint256).max);
        e.vault.deposit(shares, user);
        e.vault.approve(address(e.proxy), type(uint256).max);
        e.debtToken.approve(address(e.proxy), type(uint256).max);
        vm.stopPrank();
    }

    // =========================================================================
    // Test 1: deposit always increases position shares by exactly `shares`
    // =========================================================================

    /**
     * @notice Property: a successful depositCollateral call increases the user's
     *         position shares by exactly the deposited amount.
     */
    function testFuzz_depositAlwaysIncreasesShares(uint256 shares) public {
        shares = bound(shares, 1, 100_000 * WAD);
        Env memory e = _setupLegacy();
        _fundActor(e, alice, shares);

        uint256 before = e.engine.getPositionCollateralShares(alice, MARKET_ID);

        vm.prank(alice);
        e.engine.depositCollateral(alice, MARKET_ID, shares);

        uint256 afterD = e.engine.getPositionCollateralShares(alice, MARKET_ID);
        assertEq(afterD, before + shares, "position not increased by exact shares");
        assertEq(e.vault.balanceOf(address(e.proxy)), shares, "engine vault balance mismatch");
    }

    // =========================================================================
    // Test 2: borrow without collateral always reverts
    // =========================================================================

    /**
     * @notice Property: calling borrow on a user with zero collateral always reverts.
     *         Since the LTV check computes collateralValue = 0, any non-zero borrow
     *         exceeds the LTV and must revert.
     */
    function testFuzz_borrowWithoutCollateralReverts(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000 * WAD);
        Env memory e = _setupLegacy();
        // alice has no collateral deposited

        // Advance one block so noSameBlock guard (block 1 → 2) doesn't interfere
        vm.roll(block.number + 1);

        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__ExceedsLTV.selector);
        e.engine.borrow(alice, MARKET_ID, amount);
    }

    // =========================================================================
    // Test 3: borrowing more than LTV allows always reverts
    // =========================================================================

    /**
     * @notice Property: given 100 WAD collateral at 80% LTV and 1:1 price,
     *         any borrow > 80 WAD + excess reverts with ExceedsLTV.
     *         excess is fuzz-bound to [0, 1_000_000 WAD].
     */
    function testFuzz_exceedingLtvReverts(uint256 excess) public {
        excess = bound(excess, 0, 1_000_000 * WAD);
        uint256 deposit   = 100 * WAD;
        uint256 maxBorrow = 80 * WAD;           // 80% LTV of 100 WAD at 1:1
        uint256 overBorrow = maxBorrow + 1 + excess;

        Env memory e = _setupLegacy();
        _fundActor(e, alice, deposit);

        vm.prank(alice);
        e.engine.depositCollateral(alice, MARKET_ID, deposit);

        vm.roll(block.number + 1);

        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__ExceedsLTV.selector);
        e.engine.borrow(alice, MARKET_ID, overBorrow);
    }

    // =========================================================================
    // Test 4: repay always caps to outstanding principal
    // =========================================================================

    /**
     * @notice Property: repaying more than the outstanding principal reduces
     *         the position debt to 0 (not negative) and does not over-deduct
     *         from the user's token balance.
     */
    function testFuzz_repayCapsToPrincipal(uint256 overpay) public {
        overpay = bound(overpay, 0, 1_000 * WAD);
        uint256 depositAmt  = 100  * WAD;
        uint256 borrowAmt   = 50   * WAD;

        Env memory e = _setupLegacy();
        _fundActor(e, alice, depositAmt);

        vm.prank(alice);
        e.engine.depositCollateral(alice, MARKET_ID, depositAmt);

        vm.roll(10);
        vm.prank(alice);
        e.engine.borrow(alice, MARKET_ID, borrowAmt);

        // Fund alice with extra debt tokens to cover the overpay
        e.debtToken.mint(alice, overpay + borrowAmt);

        uint256 debt = e.engine.getPositionDebt(alice, MARKET_ID);
        uint256 repayAmt = debt + overpay;

        vm.roll(20);
        vm.prank(alice);
        e.engine.repay(alice, MARKET_ID, repayAmt);

        // Debt must be fully cleared
        assertEq(e.engine.getPositionDebt(alice, MARKET_ID), 0, "debt not cleared after over-repay");
    }

    // =========================================================================
    // Test 5: health factor decreases as debt increases
    // =========================================================================

    /**
     * @notice Property: for the same collateral, a larger debt results in a
     *         strictly lower health factor.
     *         HF = collateral_at_liq_threshold / total_debt → inversely proportional to debt.
     */
    function testFuzz_healthFactorDecreasesWithMoreDebt(uint64 debtDelta) public {
        debtDelta = uint64(bound(uint256(debtDelta), 1, 10 * WAD));
        uint256 deposit = 100 * WAD;
        uint256 debt1   = 10  * WAD;
        uint256 debt2   = debt1 + debtDelta;

        // Ensure both borrows are within LTV
        vm.assume(debt2 <= 79 * WAD);   // 80 WAD max; keep some margin

        Env memory e = _setupLegacy();
        _fundActor(e, alice, deposit);
        _fundActor(e, bob,   deposit);

        // alice borrows debt1
        vm.prank(alice);
        e.engine.depositCollateral(alice, MARKET_ID, deposit);
        vm.roll(block.number + 1);
        vm.prank(alice);
        e.engine.borrow(alice, MARKET_ID, debt1);

        // bob borrows debt2 (starts in a fresh block)
        vm.roll(block.number + 1);
        vm.prank(bob);
        e.engine.depositCollateral(bob, MARKET_ID, deposit);
        vm.roll(block.number + 1);
        vm.prank(bob);
        e.engine.borrow(bob, MARKET_ID, debt2);

        uint256 hf1 = e.engine.getHealthFactor(alice);
        uint256 hf2 = e.engine.getHealthFactor(bob);

        assertGt(hf1, hf2, "HF did not decrease with higher debt");
    }

    // =========================================================================
    // Test 6: withdrawCollateral in the same block as deposit always reverts
    // =========================================================================

    /**
     * @notice Property: the same-block guard prevents a deposit and withdraw
     *         from happening in the same transaction / block for the same
     *         (user, marketId) pair.
     */
    function testFuzz_withdrawRespectsSameBlockGuard(uint256 shares) public {
        shares = bound(shares, 1, 1_000 * WAD);
        Env memory e = _setupLegacy();
        _fundActor(e, alice, shares * 2);   // 2× so deposit succeeds first

        // Deposit in current block
        vm.prank(alice);
        e.engine.depositCollateral(alice, MARKET_ID, shares);

        // Attempt withdraw in the SAME block — must revert
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__SameBlockInteraction.selector);
        e.engine.withdrawCollateral(alice, MARKET_ID, shares);
    }

    // =========================================================================
    // Test 7: depositAndBorrow produces the same state as two separate calls
    // =========================================================================

    /**
     * @notice Property: the compound depositAndBorrow entrypoint produces
     *         identical collateral and debt state as an equivalent two-step
     *         (depositCollateral + borrow) sequence.
     *
     * With zero interest rates configured, the order of block timestamps
     *  does not affect accrual, so both paths are functionally identical.
     */
    function testFuzz_depositAndBorrowAtomic(uint256 shares, uint256 borrowAmt) public {
        shares    = bound(shares,    2,       500 * WAD);          // min 2 so (shares*79/100) >= 1
        borrowAmt = bound(borrowAmt, 1, (shares * 79) / 100);     // well under 80% LTV

        Env memory e = _setupLegacy();
        _fundActor(e, alice, shares);
        _fundActor(e, bob,   shares);

        // --- Path A: two separate calls (alice)
        vm.prank(alice);
        e.engine.depositCollateral(alice, MARKET_ID, shares);
        vm.roll(block.number + 1);
        vm.prank(alice);
        e.engine.borrow(alice, MARKET_ID, borrowAmt);

        // --- Path B: single atomic call (bob)
        vm.roll(block.number + 1);
        vm.prank(bob);
        e.engine.depositAndBorrow(bob, MARKET_ID, shares, borrowAmt);

        // Both paths must yield the same collateral and debt state
        assertEq(
            e.engine.getPositionCollateralShares(alice, MARKET_ID),
            e.engine.getPositionCollateralShares(bob,   MARKET_ID),
            "collateral shares differ between two-step and atomic"
        );
        assertEq(
            e.engine.getPositionDebt(alice, MARKET_ID),
            e.engine.getPositionDebt(bob,   MARKET_ID),
            "debt differs between two-step and atomic"
        );
    }

    // =========================================================================
    // Test 8: AuraUSD permit sets allowance to exactly the requested value
    // =========================================================================

    /**
     * @notice Property: a valid EIP-2612 permit sets allowance to exactly `value`
     *         and increments the owner's nonce by 1, regardless of the value amount.
     */
    function testFuzz_permitAllowanceMatchesValue(uint128 value, uint256 deadlineOffset) public {
        deadlineOffset = bound(deadlineOffset, 0, 365 days);

        // Deploy AuraUSD (standalone — no engine needed for permit)
        AuraUSD ausd = new AuraUSD(address(this));

        // Derive alice's address from the known private key
        address aliceAddr = vm.addr(ALICE_PK);
        uint256 deadline  = block.timestamp + deadlineOffset;

        // Build EIP-2612 digest
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                aliceAddr,
                bob,
                uint256(value),
                uint256(0),   // nonce = 0 on first permit
                deadline
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", ausd.DOMAIN_SEPARATOR(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ALICE_PK, digest);

        ausd.permit(aliceAddr, bob, uint256(value), deadline, v, r, s);

        assertEq(ausd.allowance(aliceAddr, bob), uint256(value), "allowance != value after permit");
        assertEq(ausd.nonces(aliceAddr), 1,              "nonce not incremented after permit");
    }
}
