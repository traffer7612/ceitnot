// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test }                from "forge-std/Test.sol";
import { IGovernor }           from "@openzeppelin/contracts/governance/IGovernor.sol";
import { TimelockController }  from "@openzeppelin/contracts/governance/TimelockController.sol";
import { IVotes }              from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import { AuraToken }           from "../src/governance/AuraToken.sol";
import { VeAura }              from "../src/governance/VeAura.sol";
import { AuraGovernor }        from "../src/governance/AuraGovernor.sol";
import { MockERC20 }           from "./mocks/MockERC20.sol";

/**
 * @title  GovernanceTest
 * @notice Phase 7 — Governance contracts test suite.
 *         Covers AuraToken, VeAura (lock/withdraw/revenue), and AuraGovernor
 *         (propose → vote → queue → execute full cycle).
 *
 *  Actor layout:
 *    address(this) = DEPLOYER — initial minter & veAura admin, handing off to timelock in setUp
 *    alice         = 2 M AURA — primary voter / proposer
 *    bob           = 1 M AURA — beneficiary of governance minting in full-cycle test
 */
contract GovernanceTest is Test {
    // ── contracts ────────────────────────────────────────────────────────────
    AuraToken           public auraToken;
    VeAura              public veAura;
    AuraGovernor        public governor;
    TimelockController  public timelock;
    MockERC20           public revenueToken;

    // ── actors ────────────────────────────────────────────────────────────────
    address public alice = address(0xA11CE);
    address public bob   = address(0xB0B);

    // ── constants ─────────────────────────────────────────────────────────────
    uint256 constant WAD             = 1e18;
    uint256 constant ONE_MILLION     = 1_000_000 * WAD;
    uint256 constant TWO_MILLION     = 2_000_000 * WAD;
    uint256 constant PROPOSAL_THRESH = 100_000  * WAD;
    uint256 constant MAX_LOCK        = 4 * 365 days;  // 4 years
    uint256 constant EPOCH           = 1 weeks;

    // ── setUp ─────────────────────────────────────────────────────────────────
    function setUp() public {
        // Anchor block.timestamp to a realistic value (avoids clock()-1 underflow)
        vm.warp(1_700_000_000);

        revenueToken = new MockERC20("Revenue", "REV", 18);

        // 1. AuraToken — minter = address(this)
        auraToken = new AuraToken(address(this));

        // 2. VeAura — admin = address(this) initially
        veAura = new VeAura(address(auraToken), address(this), address(revenueToken));

        // 3. TimelockController — minDelay 48h, no initial proposers,
        //    open executor (address(0) gets EXECUTOR_ROLE → anyone can execute)
        address[] memory proposers = new address[](0);
        address[] memory executors = new address[](1);
        executors[0] = address(0);
        timelock = new TimelockController(48 hours, proposers, executors, address(this));

        // 4. AuraGovernor
        governor = new AuraGovernor(IVotes(address(veAura)), timelock);

        // 5. Grant Governor the PROPOSER + CANCELLER roles on the timelock
        timelock.grantRole(timelock.PROPOSER_ROLE(),   address(governor));
        timelock.grantRole(timelock.CANCELLER_ROLE(),  address(governor));

        // 6. Mint tokens to test actors while address(this) is still minter
        auraToken.mint(alice, TWO_MILLION);
        auraToken.mint(bob,   ONE_MILLION);

        // 7. Hand off minter & admin control to the timelock
        auraToken.setMinter(address(timelock));
        veAura.setAdmin(address(timelock));
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /**
     * @dev Lock `amount` AURA for alice at maximum lock duration, then
     *      vm.warp(+1 second) so getPastVotes works at the lock timestamp.
     */
    function _aliceLockMaxAndWarp(uint256 amount) internal {
        uint256 unlock = (block.timestamp + MAX_LOCK) / EPOCH * EPOCH;
        vm.startPrank(alice);
        auraToken.approve(address(veAura), amount);
        veAura.lock(amount, unlock);
        vm.stopPrank();
        vm.warp(block.timestamp + 1);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // AuraToken
    // ══════════════════════════════════════════════════════════════════════════

    /// Supply cap constant is correct.
    function test_token_supplyCap() public view {
        assertEq(auraToken.SUPPLY_CAP(), 100_000_000 * WAD);
    }

    /// EIP-6372 clock uses block.timestamp.
    function test_token_clockModeIsTimestamp() public view {
        assertEq(auraToken.CLOCK_MODE(), "mode=timestamp");
        assertEq(auraToken.clock(), uint48(block.timestamp));
    }

    /// Constructor mints were received by alice and bob.
    function test_token_initialBalances() public view {
        assertEq(auraToken.balanceOf(alice), TWO_MILLION);
        assertEq(auraToken.balanceOf(bob),   ONE_MILLION);
    }

    /// Non-minter cannot mint.
    function test_token_mintByNonMinter_reverts() public {
        vm.prank(alice);
        vm.expectRevert(AuraToken.Token__Unauthorized.selector);
        auraToken.mint(alice, WAD);
    }

    /// Minting beyond the supply cap reverts.
    function test_token_mintExceedsCap_reverts() public {
        AuraToken fresh = new AuraToken(address(this));
        fresh.mint(alice, 99_999_999 * WAD);
        vm.expectRevert(AuraToken.Token__SupplyCapExceeded.selector);
        fresh.mint(alice, 2 * WAD); // would push totalSupply to 100_000_001e18
    }

    /// Non-minter cannot change the minter.
    function test_token_setMinterByNonMinter_reverts() public {
        vm.prank(alice);
        vm.expectRevert(AuraToken.Token__Unauthorized.selector);
        auraToken.setMinter(alice);
    }

    /// Minter role cannot be transferred to address(0).
    function test_token_setMinterZeroAddress_reverts() public {
        AuraToken fresh = new AuraToken(address(this));
        vm.expectRevert(AuraToken.Token__ZeroAddress.selector);
        fresh.setMinter(address(0));
    }

    /// Constructor rejects zero minter.
    function test_token_constructorZeroMinter_reverts() public {
        vm.expectRevert(AuraToken.Token__ZeroAddress.selector);
        new AuraToken(address(0));
    }

    // ══════════════════════════════════════════════════════════════════════════
    // VeAura — lock mechanics
    // ══════════════════════════════════════════════════════════════════════════

    /// Lock stores amount and unlockTime; totalLocked is updated.
    function test_veaura_lock_succeeds() public {
        uint256 amount = ONE_MILLION;
        uint256 unlock = (block.timestamp + MAX_LOCK) / EPOCH * EPOCH;

        vm.startPrank(alice);
        auraToken.approve(address(veAura), amount);
        veAura.lock(amount, unlock);
        vm.stopPrank();

        (uint128 locked, uint48 unlockTime) = veAura.locks(alice);
        assertEq(locked, amount);
        assertEq(unlockTime, unlock);
        assertEq(veAura.totalLocked(), amount);
    }

    /// Locking zero reverts.
    function test_veaura_lock_zeroAmount_reverts() public {
        uint256 unlock = (block.timestamp + MAX_LOCK) / EPOCH * EPOCH;
        vm.prank(alice);
        vm.expectRevert(VeAura.VeAura__ZeroAmount.selector);
        veAura.lock(0, unlock);
    }

    /// A second lock from the same user reverts.
    function test_veaura_lock_existingLock_reverts() public {
        _aliceLockMaxAndWarp(ONE_MILLION);

        uint256 unlock = (block.timestamp + MAX_LOCK) / EPOCH * EPOCH;
        vm.startPrank(alice);
        auraToken.approve(address(veAura), ONE_MILLION);
        vm.expectRevert(VeAura.VeAura__LockExists.selector);
        veAura.lock(ONE_MILLION, unlock);
        vm.stopPrank();
    }

    /// Voting power is non-zero after a lock and a block advance.
    function test_veaura_votingPower_nonZeroAfterLock() public {
        _aliceLockMaxAndWarp(ONE_MILLION);
        uint256 vp = veAura.getPastVotes(alice, block.timestamp - 1);
        assertGt(vp, 0);
        assertGt(veAura.getVotes(alice), 0);
    }

    /// increaseAmount adds to the existing lock.
    function test_veaura_increaseAmount_succeeds() public {
        _aliceLockMaxAndWarp(ONE_MILLION);

        uint256 extra = 500_000 * WAD;
        vm.startPrank(alice);
        auraToken.approve(address(veAura), extra);
        veAura.increaseAmount(extra);
        vm.stopPrank();

        (uint128 locked,) = veAura.locks(alice);
        assertEq(locked, ONE_MILLION + extra);
        assertEq(veAura.totalLocked(), ONE_MILLION + extra);
    }

    /// extendLock increases the unlock time.
    function test_veaura_extendLock_succeeds() public {
        uint256 amount  = ONE_MILLION;
        // Initial lock for 1 year
        uint256 unlock1 = (block.timestamp + 365 days) / EPOCH * EPOCH;

        vm.startPrank(alice);
        auraToken.approve(address(veAura), amount);
        veAura.lock(amount, unlock1);
        vm.stopPrank();
        vm.warp(block.timestamp + 1);

        // Extend to 2 years from current time (still within MAX_LOCK)
        uint256 unlock2 = (block.timestamp + 2 * 365 days) / EPOCH * EPOCH;

        vm.prank(alice);
        veAura.extendLock(unlock2);

        (, uint48 updated) = veAura.locks(alice);
        assertEq(updated, uint48(unlock2));
    }

    /// Withdraw succeeds after lock expiry and returns tokens.
    function test_veaura_withdraw_afterExpiry() public {
        uint256 amount = ONE_MILLION;
        // Short lock: 2 epochs from now
        uint256 unlock = (block.timestamp + 2 * EPOCH) / EPOCH * EPOCH;

        vm.startPrank(alice);
        auraToken.approve(address(veAura), amount);
        veAura.lock(amount, unlock);
        vm.stopPrank();

        vm.warp(unlock + 1);

        uint256 before = auraToken.balanceOf(alice);
        vm.prank(alice);
        veAura.withdraw();

        assertEq(auraToken.balanceOf(alice), before + amount);
        assertEq(veAura.totalLocked(), 0);
        (uint128 locked,) = veAura.locks(alice);
        assertEq(locked, 0);
    }

    /// Withdraw before expiry reverts.
    function test_veaura_withdraw_beforeExpiry_reverts() public {
        _aliceLockMaxAndWarp(ONE_MILLION);
        vm.prank(alice);
        vm.expectRevert(VeAura.VeAura__LockNotExpired.selector);
        veAura.withdraw();
    }

    // ══════════════════════════════════════════════════════════════════════════
    // VeAura — revenue distribution
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * @dev Use a fresh VeAura instance (admin = address(this)) so that the
     *      test contract can call distributeRevenue without going through
     *      governance.
     */
    function test_veaura_revenue_distributeAndClaim() public {
        VeAura ve2 = new VeAura(address(auraToken), address(this), address(revenueToken));

        uint256 lockAmt = ONE_MILLION;
        uint256 revAmt  = 1_000 * WAD;
        uint256 unlock  = (block.timestamp + MAX_LOCK) / EPOCH * EPOCH;

        // Alice locks into ve2
        vm.startPrank(alice);
        auraToken.approve(address(ve2), lockAmt);
        ve2.lock(lockAmt, unlock);
        vm.stopPrank();

        // Distribute revenue — address(this) is admin & pre-approves ve2
        revenueToken.mint(address(this), revAmt);
        revenueToken.approve(address(ve2), revAmt);
        ve2.distributeRevenue(revAmt);

        // Alice holds 100% of totalLocked → earns the full revAmt
        assertEq(ve2.pendingRevenue(alice), revAmt);

        // Claim
        vm.prank(alice);
        ve2.claimRevenue();

        assertEq(revenueToken.balanceOf(alice), revAmt);
        assertEq(ve2.pendingRevenue(alice), 0);
    }

    /// Non-admin cannot distribute revenue.
    function test_veaura_revenue_nonAdmin_reverts() public {
        VeAura ve2 = new VeAura(address(auraToken), address(this), address(revenueToken));
        uint256 unlock = (block.timestamp + MAX_LOCK) / EPOCH * EPOCH;

        vm.startPrank(alice);
        auraToken.approve(address(ve2), ONE_MILLION);
        ve2.lock(ONE_MILLION, unlock);
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert(VeAura.VeAura__Unauthorized.selector);
        ve2.distributeRevenue(100 * WAD);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // AuraGovernor — parameters & configuration
    // ══════════════════════════════════════════════════════════════════════════

    function test_governor_parameters() public view {
        assertEq(governor.votingDelay(),       1 days);
        assertEq(governor.votingPeriod(),      7 days);
        assertEq(governor.proposalThreshold(), PROPOSAL_THRESH);
        assertEq(address(governor.timelock()), address(timelock));
        assertEq(governor.name(),              "AuraGovernor");
    }

    function test_governor_quorumFraction() public view {
        assertEq(governor.quorumNumerator(),   4);
        assertEq(governor.quorumDenominator(), 100);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // AuraGovernor — proposal access control
    // ══════════════════════════════════════════════════════════════════════════

    /// Bob has tokens but no veAURA → 0 votes → below proposalThreshold → revert.
    function test_governor_propose_belowThreshold_reverts() public {
        address[] memory targets   = new address[](1);
        targets[0] = address(0x1);
        uint256[] memory values    = new uint256[](1);
        bytes[]   memory calldatas = new bytes[](1);
        calldatas[0] = "";

        vm.prank(bob);
        vm.expectRevert();
        governor.propose(targets, values, calldatas, "Bob proposal");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // AuraGovernor — full governance lifecycle
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Full cycle: Propose → (Active) → Vote → (Succeeded) →
     *         Queue → (Queued) → Execute → verify on-chain effect.
     *
     *         The proposal mints 1000 AURA to bob via the timelock (which is the
     *         token minter after setUp).
     */
    function test_governor_fullCycle_proposeVoteQueueExecute() public {
        // ─── 1. Alice locks 2M AURA for max duration ────────────────────────
        _aliceLockMaxAndWarp(TWO_MILLION);

        // ─── 2. Build proposal: mint 1000 AURA to bob via timelock ──────────
        address[] memory targets   = new address[](1);
        targets[0] = address(auraToken);
        uint256[] memory values    = new uint256[](1);
        bytes[]   memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeWithSignature("mint(address,uint256)", bob, 1_000 * WAD);
        string  memory desc     = "Governance: mint 1000 AURA to bob";
        bytes32 descHash        = keccak256(bytes(desc));

        // ─── 3. Propose (requires votingPower at clock()-1 >= 100K) ─────────
        vm.prank(alice);
        uint256 proposalId = governor.propose(targets, values, calldatas, desc);

        // Immediately after propose: Pending (voteStart not yet reached)
        assertEq(uint8(governor.state(proposalId)), uint8(IGovernor.ProposalState.Pending));

        // ─── 4. Fast-forward past voting delay (1 day) ──────────────────────
        vm.warp(block.timestamp + 1 days + 1);
        assertEq(uint8(governor.state(proposalId)), uint8(IGovernor.ProposalState.Active));

        // ─── 5. Alice votes For ──────────────────────────────────────────────
        vm.prank(alice);
        governor.castVote(proposalId, 1); // 1 = For

        // ─── 6. Fast-forward past voting period (7 days) ────────────────────
        vm.warp(block.timestamp + 7 days + 1);
        assertEq(uint8(governor.state(proposalId)), uint8(IGovernor.ProposalState.Succeeded));

        // ─── 7. Queue in timelock ────────────────────────────────────────────
        governor.queue(targets, values, calldatas, descHash);
        assertEq(uint8(governor.state(proposalId)), uint8(IGovernor.ProposalState.Queued));

        // ─── 8. Fast-forward past timelock delay (48 h) ─────────────────────
        vm.warp(block.timestamp + 48 hours + 1);

        // ─── 9. Execute and verify on-chain effect ───────────────────────────
        uint256 bobBefore = auraToken.balanceOf(bob);
        governor.execute(targets, values, calldatas, descHash);

        assertEq(auraToken.balanceOf(bob), bobBefore + 1_000 * WAD);
    }

    /**
     * @notice Proposal is Defeated when the entire voting window passes with
     *         zero votes cast (quorum not reached).
     */
    function test_governor_proposalDefeated_whenNoVotes() public {
        _aliceLockMaxAndWarp(TWO_MILLION);

        address[] memory targets   = new address[](1);
        targets[0] = address(0x1);
        uint256[] memory values    = new uint256[](1);
        bytes[]   memory calldatas = new bytes[](1);
        calldatas[0] = "";

        vm.prank(alice);
        uint256 proposalId = governor.propose(targets, values, calldatas, "No vote proposal");

        // Let the entire voting window expire without any votes
        vm.warp(block.timestamp + 1 days + 7 days + 2);

        // forVotes = 0 < quorum(4% of 2M) = 80K → Defeated
        assertEq(uint8(governor.state(proposalId)), uint8(IGovernor.ProposalState.Defeated));
    }
}
