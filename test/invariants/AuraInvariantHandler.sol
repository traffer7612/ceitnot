// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { AuraEngine }    from "../../src/AuraEngine.sol";
import { MockVault4626 } from "../mocks/MockVault4626.sol";
import { MockERC20 }     from "../mocks/MockERC20.sol";

/**
 * @title  AuraInvariantHandler
 * @notice Stateful fuzzing handler for AuraEngine invariant tests.
 *         Each public function is a possible state-machine action that
 *         Foundry's invariant runner randomly selects and calls.
 *
 * Design notes:
 *   - Three pre-funded actors interact with a single market (ID = 0).
 *   - Each action calls `_advance()` first to move to a new block, satisfying
 *     the engine's `noSameBlock` guard for per-(user, market) positions.
 *   - `fail_on_revert = false` in foundry.toml so the framework silently
 *     ignores operations that correctly revert (e.g. borrow > LTV).
 *   - Ghost counters let the invariant contract assert the handler was exercised.
 */
contract AuraInvariantHandler is Test {

    // ---- Constants
    uint256 public constant WAD       = 1e18;
    uint256 public constant MARKET_ID = 0;
    uint256 public constant MAX_SHARES = 500 * 1e18;   // max shares per deposit action
    uint256 public constant MAX_BORROW = 380 * 1e18;   // well below 80% LTV on 500-share collateral

    // ---- Protocol references (set in constructor)
    AuraEngine    public engine;
    MockVault4626 public vault;
    MockERC20     public debtToken;

    // ---- Three pre-funded actors
    address public actor0;
    address public actor1;
    address public actor2;

    // ---- Ghost variables tracked across calls
    uint256 public ghost_depositCalls;
    uint256 public ghost_withdrawCalls;
    uint256 public ghost_borrowCalls;
    uint256 public ghost_repayCalls;
    uint256 public ghost_warpCalls;

    // ---- Constructor
    constructor(
        AuraEngine    engine_,
        MockVault4626 vault_,
        MockERC20     debtToken_,
        address       actor0_,
        address       actor1_,
        address       actor2_
    ) {
        engine    = engine_;
        vault     = vault_;
        debtToken = debtToken_;
        actor0    = actor0_;
        actor1    = actor1_;
        actor2    = actor2_;
    }

    // ---- Internal helpers

    /// @dev Map a seed to one of the three actors.
    function _actor(uint256 seed) internal view returns (address) {
        uint256 idx = seed % 3;
        if (idx == 0) return actor0;
        if (idx == 1) return actor1;
        return actor2;
    }

    /**
     * @dev Advance the chain by one block (12-second slot) before every action.
     *      This satisfies the `noSameBlock(user, marketId)` guard, which tracks
     *      `pos.lastInteractionBlock` per (user, marketId) and reverts if the
     *      current block equals the last interaction block.
     */
    function _advance() internal {
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 12);
    }

    // ---- Handler actions

    /**
     * @notice Deposit vault shares as collateral on behalf of an actor.
     *         Shares are pulled from the actor (msg.sender = actor via vm.prank).
     *         Silently returns if the actor has no vault shares.
     */
    function deposit(uint256 actorSeed, uint256 shares) external {
        address actor = _actor(actorSeed);
        uint256 bal = vault.balanceOf(actor);
        if (bal == 0) return;

        shares = bound(shares, 1, bal < MAX_SHARES ? bal : MAX_SHARES);

        _advance();

        vm.prank(actor);
        try engine.depositCollateral(actor, MARKET_ID, shares) {
            ghost_depositCalls++;
        } catch { }
    }

    /**
     * @notice Withdraw collateral shares from an actor's position.
     *         Silently returns if the actor has no collateral deposited.
     */
    function withdraw(uint256 actorSeed, uint256 shares) external {
        address actor = _actor(actorSeed);
        uint256 pos = engine.getPositionCollateralShares(actor, MARKET_ID);
        if (pos == 0) return;

        shares = bound(shares, 1, pos);

        _advance();

        vm.prank(actor);
        try engine.withdrawCollateral(actor, MARKET_ID, shares) {
            ghost_withdrawCalls++;
        } catch { }
    }

    /**
     * @notice Borrow debt tokens against an actor's collateral.
     *         Silently returns if the actor has no collateral.
     *         The engine's LTV check will revert over-borrows; these are silently ignored.
     */
    function borrow(uint256 actorSeed, uint256 amount) external {
        address actor = _actor(actorSeed);
        uint256 pos = engine.getPositionCollateralShares(actor, MARKET_ID);
        if (pos == 0) return;

        amount = bound(amount, 1, MAX_BORROW);

        _advance();

        vm.prank(actor);
        try engine.borrow(actor, MARKET_ID, amount) {
            ghost_borrowCalls++;
        } catch { }
    }

    /**
     * @notice Repay debt for an actor.
     *         Amount is capped to the lesser of the current debt and the actor's
     *         debt-token balance to avoid transferFrom failures.
     *         Silently returns if the actor has no debt or no debt-token balance.
     */
    function repay(uint256 actorSeed, uint256 amount) external {
        address actor = _actor(actorSeed);
        uint256 debt  = engine.getPositionDebt(actor, MARKET_ID);
        if (debt == 0) return;
        uint256 tokenBal = debtToken.balanceOf(actor);
        if (tokenBal == 0) return;

        uint256 cap = debt < tokenBal ? debt : tokenBal;
        amount = bound(amount, 1, cap);

        _advance();

        vm.prank(actor);
        try engine.repay(actor, MARKET_ID, amount) {
            ghost_repayCalls++;
        } catch { }
    }

    /**
     * @notice Warp time forward to simulate interest accrual.
     *         Also advances the block proportionally.
     */
    function warpTime(uint256 secs) external {
        secs = bound(secs, 1, 7 days);
        vm.warp(block.timestamp + secs);
        vm.roll(block.number + secs / 12 + 1);
        ghost_warpCalls++;
    }
}
