// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test }               from "forge-std/Test.sol";
import { OracleRelayV2 }      from "../src/OracleRelayV2.sol";
import { IOracleRelayV2 }     from "../src/interfaces/IOracleRelayV2.sol";
import { ControllableOracle } from "./mocks/ControllableOracle.sol";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/// @dev Minimal Chainlink V3 Aggregator mock (8 decimals by default).
contract MockChainlinkV3Feed {
    int256  public answer;
    uint256 public updatedAt;
    uint8   public dec;

    constructor(int256 answer_, uint8 decimals_, uint256 updatedAt_) {
        answer    = answer_;
        dec       = decimals_;
        updatedAt = updatedAt_;
    }

    function setAnswer(int256 a, uint256 ts) external { answer = a; updatedAt = ts; }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (1, answer, 0, updatedAt, 1);
    }

    function decimals() external view returns (uint8) { return dec; }
}

/// @dev Chainlink L2 Sequencer Uptime Feed mock.
contract MockSequencerFeed {
    int256  public answer;    // 0 = up, 1 = down
    uint256 public startedAt; // timestamp of last status change

    constructor(int256 answer_, uint256 startedAt_) {
        answer    = answer_;
        startedAt = startedAt_;
    }

    function set(int256 a, uint256 st) external { answer = a; startedAt = st; }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (1, answer, startedAt, block.timestamp, 1);
    }
}

// ─── Test contract ─────────────────────────────────────────────────────────────

/**
 * @title OracleV2Test
 * @notice Phase 8 Oracle Improvements test suite.
 *
 *   8.1 Circuit Breaker   — updatePrice, deviation trip, reset
 *   8.2 Sequencer Uptime  — down / grace period / healthy
 *   8.3 Multi-Source Median — 3 feeds, stale exclusion, Chainlink normalization
 *   8.4 Per-Market Oracle  — per-feed heartbeat config
 */
contract OracleV2Test is Test {
    // ── contracts under test ─────────────────────────────────────────────────
    OracleRelayV2        public oracle;
    ControllableOracle   public feed1;  // $1000
    ControllableOracle   public feed2;  // $1020
    ControllableOracle   public feed3;  // $980
    MockChainlinkV3Feed  public clFeed; // Chainlink 8-decimal $1000 feed
    MockSequencerFeed    public seqFeed;

    address admin = address(this);

    // ── constants ────────────────────────────────────────────────────────────
    uint256 constant WAD           = 1e18;
    uint256 constant MAX_DEVIATION = 1500;  // 15%
    uint256 constant GRACE_PERIOD  = 3600;  // 1 hour
    uint256 constant HEARTBEAT     = 24 hours;

    // ── setUp ────────────────────────────────────────────────────────────────
    function setUp() public {
        vm.warp(1_700_000_000);

        feed1  = new ControllableOracle(1_000 * WAD);
        feed2  = new ControllableOracle(1_020 * WAD);
        feed3  = new ControllableOracle(980   * WAD);
        clFeed = new MockChainlinkV3Feed(1_000 * 1e8, 8, block.timestamp);
        // Sequencer: UP, restarted 2h ago (well past 1h grace period)
        seqFeed = new MockSequencerFeed(0, block.timestamp - 2 hours);

        IOracleRelayV2.FeedConfig[] memory feeds = new IOracleRelayV2.FeedConfig[](3);
        feeds[0] = IOracleRelayV2.FeedConfig({ feed: address(feed1), isChainlink: false, heartbeat: HEARTBEAT, enabled: true });
        feeds[1] = IOracleRelayV2.FeedConfig({ feed: address(feed2), isChainlink: false, heartbeat: HEARTBEAT, enabled: true });
        feeds[2] = IOracleRelayV2.FeedConfig({ feed: address(feed3), isChainlink: false, heartbeat: HEARTBEAT, enabled: true });

        oracle = new OracleRelayV2(feeds, MAX_DEVIATION, address(0), GRACE_PERIOD, admin);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Constructor / Configuration
    // ══════════════════════════════════════════════════════════════════════════

    function test_constructor_setsAdmin() public view {
        assertEq(oracle.admin(), admin);
    }

    function test_constructor_feedCount() public view {
        assertEq(oracle.feedCount(), 3);
    }

    function test_constructor_setsMaxDeviation() public view {
        assertEq(oracle.maxDeviationBps(), MAX_DEVIATION);
    }

    /// Constructor initialises lastPrice from the median of initial feeds (980, 1000, 1020 → 1000).
    function test_constructor_initialisesLastPrice() public view {
        assertEq(oracle.lastPrice(), 1_000 * WAD);
    }

    function test_constructor_zeroAdmin_reverts() public {
        IOracleRelayV2.FeedConfig[] memory f = new IOracleRelayV2.FeedConfig[](1);
        f[0] = IOracleRelayV2.FeedConfig({ feed: address(feed1), isChainlink: false, heartbeat: HEARTBEAT, enabled: true });
        vm.expectRevert(IOracleRelayV2.OracleV2__ZeroAddress.selector);
        new OracleRelayV2(f, MAX_DEVIATION, address(0), 0, address(0));
    }

    function test_constructor_emptyFeeds_reverts() public {
        IOracleRelayV2.FeedConfig[] memory f = new IOracleRelayV2.FeedConfig[](0);
        vm.expectRevert(IOracleRelayV2.OracleV2__InvalidParams.selector);
        new OracleRelayV2(f, MAX_DEVIATION, address(0), 0, admin);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 8.3 Multi-Source Median
    // ══════════════════════════════════════════════════════════════════════════

    /// Median of three prices [980, 1000, 1020] is 1000 (middle).
    function test_median_threeFeeds_returnsMiddle() public view {
        (uint256 price, ) = oracle.getLatestPrice();
        assertEq(price, 1_000 * WAD);
    }

    /// Even count: [1000, 1020] → conservative lower middle = 1000.
    function test_median_twoFeeds_returnsLowerMiddle() public {
        oracle.setFeedEnabled(2, false); // disable feed3 (980)
        (uint256 price, ) = oracle.getLatestPrice();
        assertEq(price, 1_000 * WAD); // sorted [1000, 1020] → prices[0]
    }

    /// Single feed returns that feed's price.
    function test_median_singleFeed() public {
        oracle.setFeedEnabled(1, false);
        oracle.setFeedEnabled(2, false);
        (uint256 price, ) = oracle.getLatestPrice();
        assertEq(price, 1_000 * WAD);
    }

    /// All feeds disabled → revert.
    function test_median_allDisabled_reverts() public {
        oracle.setFeedEnabled(0, false);
        oracle.setFeedEnabled(1, false);
        oracle.setFeedEnabled(2, false);
        vm.expectRevert(IOracleRelayV2.OracleV2__AllFeedsInvalid.selector);
        oracle.getLatestPrice();
    }

    /// Stale feed (updatedAt > heartbeat ago) is excluded from the median.
    function test_median_staleExcluded() public {
        // Make feed1 stale (last updated >24 h ago)
        feed1.setPriceStale(1_000 * WAD, block.timestamp - HEARTBEAT - 1);
        // Valid: feed2=1020, feed3=980 → sorted [980, 1020] → even → lower = 980
        (uint256 price, ) = oracle.getLatestPrice();
        assertEq(price, 980 * WAD);
    }

    /// Chainlink feed with 8 decimals is correctly normalised to WAD.
    function test_median_chainlinkNormalized() public {
        IOracleRelayV2.FeedConfig[] memory f = new IOracleRelayV2.FeedConfig[](1);
        f[0] = IOracleRelayV2.FeedConfig({ feed: address(clFeed), isChainlink: true, heartbeat: HEARTBEAT, enabled: true });
        OracleRelayV2 clOracle = new OracleRelayV2(f, 0, address(0), 0, admin);

        (uint256 price, ) = clOracle.getLatestPrice();
        assertEq(price, 1_000 * WAD); // 1000 * 1e8 with dec=8 → 1000 * 1e18
    }

    /// getTwapPrice() returns the same median as getLatestPrice() in V2.
    function test_twapPrice_equalsMedian() public view {
        uint256 twap = oracle.getTwapPrice();
        assertEq(twap, 1_000 * WAD);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 8.1 Price Deviation Circuit Breaker
    // ══════════════════════════════════════════════════════════════════════════

    function test_circuitBreaker_notTripped_initially() public view {
        assertFalse(oracle.isCircuitBroken());
    }

    /// Small price move (1%) does not trip the circuit breaker.
    function test_circuitBreaker_smallDeviation_noTrip() public {
        feed1.setPrice(1_010 * WAD);
        feed2.setPrice(1_010 * WAD);
        feed3.setPrice(1_010 * WAD);

        oracle.updatePrice();

        assertFalse(oracle.isCircuitBroken());
        assertEq(oracle.lastPrice(), 1_010 * WAD);
    }

    /// 90% price drop exceeds 15% limit → circuit breaker trips.
    function test_circuitBreaker_largeDeviation_trips() public {
        feed1.setPrice(100 * WAD);
        feed2.setPrice(100 * WAD);
        feed3.setPrice(100 * WAD);

        oracle.updatePrice();

        assertTrue(oracle.isCircuitBroken());
    }

    /// getLatestPrice() reverts while circuit breaker is active.
    function test_circuitBreaker_getLatestPrice_reverts() public {
        feed1.setPrice(100 * WAD); feed2.setPrice(100 * WAD); feed3.setPrice(100 * WAD);
        oracle.updatePrice();

        vm.expectRevert(IOracleRelayV2.OracleV2__CircuitBroken.selector);
        oracle.getLatestPrice();
    }

    /// getTwapPrice() also reverts while circuit breaker is active.
    function test_circuitBreaker_getTwapPrice_reverts() public {
        feed1.setPrice(100 * WAD); feed2.setPrice(100 * WAD); feed3.setPrice(100 * WAD);
        oracle.updatePrice();

        vm.expectRevert(IOracleRelayV2.OracleV2__CircuitBroken.selector);
        oracle.getTwapPrice();
    }

    /// lastPrice is NOT updated when a breach is detected.
    function test_circuitBreaker_lastPriceUnchangedOnBreach() public {
        uint256 before = oracle.lastPrice();
        feed1.setPrice(100 * WAD); feed2.setPrice(100 * WAD); feed3.setPrice(100 * WAD);
        oracle.updatePrice();

        assertEq(oracle.lastPrice(), before); // still 1000 WAD
    }

    /// Admin can reset the circuit breaker; afterwards getLatestPrice() works again.
    function test_circuitBreaker_reset_byAdmin() public {
        feed1.setPrice(100 * WAD); feed2.setPrice(100 * WAD); feed3.setPrice(100 * WAD);
        oracle.updatePrice();
        assertTrue(oracle.isCircuitBroken());

        oracle.resetCircuitBreaker();

        assertFalse(oracle.isCircuitBroken());
        assertEq(oracle.lastPrice(), 100 * WAD);
        (uint256 price, ) = oracle.getLatestPrice();
        assertEq(price, 100 * WAD);
    }

    function test_circuitBreaker_reset_nonAdmin_reverts() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(IOracleRelayV2.OracleV2__Unauthorized.selector);
        oracle.resetCircuitBreaker();
    }

    /// maxDeviationBps = 0 disables the circuit breaker entirely.
    function test_circuitBreaker_disabled_whenMaxDeviationZero() public {
        IOracleRelayV2.FeedConfig[] memory f = new IOracleRelayV2.FeedConfig[](1);
        f[0] = IOracleRelayV2.FeedConfig({ feed: address(feed1), isChainlink: false, heartbeat: HEARTBEAT, enabled: true });
        OracleRelayV2 noCb = new OracleRelayV2(f, 0, address(0), 0, admin);

        feed1.setPrice(1 * WAD); // 99.9% drop
        noCb.updatePrice();      // no check → no trip

        assertFalse(noCb.isCircuitBroken());
    }

    /// setMaxDeviation is admin-gated.
    function test_setMaxDeviation_nonAdmin_reverts() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(IOracleRelayV2.OracleV2__Unauthorized.selector);
        oracle.setMaxDeviation(2_000);
    }

    function test_setMaxDeviation_succeeds() public {
        oracle.setMaxDeviation(2_000);
        assertEq(oracle.maxDeviationBps(), 2_000);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 8.2 Sequencer Uptime Feed (L2)
    // ══════════════════════════════════════════════════════════════════════════

    /// When no sequencer feed is configured, isSequencerUp() always returns true.
    function test_sequencer_noFeed_alwaysUp() public view {
        assertTrue(oracle.isSequencerUp()); // oracle has sequencerFeed = address(0)
    }

    /// Sequencer UP and past grace period → getLatestPrice() succeeds.
    function test_sequencer_healthy_priceAvailable() public {
        // seqFeed: answer=0 (up), startedAt = now - 2h (> 1h grace)
        IOracleRelayV2.FeedConfig[] memory f = new IOracleRelayV2.FeedConfig[](1);
        f[0] = IOracleRelayV2.FeedConfig({ feed: address(feed1), isChainlink: false, heartbeat: HEARTBEAT, enabled: true });
        OracleRelayV2 seqOracle = new OracleRelayV2(f, 0, address(seqFeed), GRACE_PERIOD, admin);

        assertTrue(seqOracle.isSequencerUp());
        (uint256 price, ) = seqOracle.getLatestPrice();
        assertEq(price, 1_000 * WAD);
    }

    /// Sequencer DOWN → getLatestPrice() reverts with OracleV2__SequencerDown.
    function test_sequencer_down_reverts() public {
        seqFeed.set(1, block.timestamp - 2 hours); // answer = 1 = down
        IOracleRelayV2.FeedConfig[] memory f = new IOracleRelayV2.FeedConfig[](1);
        f[0] = IOracleRelayV2.FeedConfig({ feed: address(feed1), isChainlink: false, heartbeat: HEARTBEAT, enabled: true });
        OracleRelayV2 seqOracle = new OracleRelayV2(f, 0, address(seqFeed), GRACE_PERIOD, admin);

        assertFalse(seqOracle.isSequencerUp());
        vm.expectRevert(IOracleRelayV2.OracleV2__SequencerDown.selector);
        seqOracle.getLatestPrice();
    }

    /// Sequencer UP but within grace period → reverts with OracleV2__SequencerGracePeriod.
    function test_sequencer_gracePeriod_reverts() public {
        seqFeed.set(0, block.timestamp - 30 minutes); // up, but only 30 min ago (< 1h)
        IOracleRelayV2.FeedConfig[] memory f = new IOracleRelayV2.FeedConfig[](1);
        f[0] = IOracleRelayV2.FeedConfig({ feed: address(feed1), isChainlink: false, heartbeat: HEARTBEAT, enabled: true });
        OracleRelayV2 seqOracle = new OracleRelayV2(f, 0, address(seqFeed), GRACE_PERIOD, admin);

        assertFalse(seqOracle.isSequencerUp()); // grace period not yet elapsed
        vm.expectRevert(IOracleRelayV2.OracleV2__SequencerGracePeriod.selector);
        seqOracle.getLatestPrice();
    }

    /// After grace period elapses, the oracle becomes usable again.
    function test_sequencer_afterGracePeriod_priceAvailable() public {
        seqFeed.set(0, block.timestamp - 30 minutes); // restarted 30 min ago
        IOracleRelayV2.FeedConfig[] memory f = new IOracleRelayV2.FeedConfig[](1);
        f[0] = IOracleRelayV2.FeedConfig({ feed: address(feed1), isChainlink: false, heartbeat: HEARTBEAT, enabled: true });
        OracleRelayV2 seqOracle = new OracleRelayV2(f, 0, address(seqFeed), GRACE_PERIOD, admin);

        // Move past grace period
        vm.warp(block.timestamp + 31 minutes);
        assertTrue(seqOracle.isSequencerUp());
        (uint256 price, ) = seqOracle.getLatestPrice();
        assertEq(price, 1_000 * WAD);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Feed Management
    // ══════════════════════════════════════════════════════════════════════════

    function test_feedManagement_addFeed() public {
        ControllableOracle f4 = new ControllableOracle(1_100 * WAD);
        oracle.addFeed(address(f4), false, HEARTBEAT);
        assertEq(oracle.feedCount(), 4);
    }

    function test_feedManagement_addFeed_nonAdmin_reverts() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(IOracleRelayV2.OracleV2__Unauthorized.selector);
        oracle.addFeed(address(feed1), false, HEARTBEAT);
    }

    function test_feedManagement_maxFeeds_reverts() public {
        for (uint256 i = 0; i < 5; i++) {
            ControllableOracle f = new ControllableOracle(1_000 * WAD);
            oracle.addFeed(address(f), false, HEARTBEAT);
        }
        assertEq(oracle.feedCount(), 8);

        ControllableOracle extra = new ControllableOracle(1_000 * WAD);
        vm.expectRevert(IOracleRelayV2.OracleV2__MaxFeedsReached.selector);
        oracle.addFeed(address(extra), false, HEARTBEAT);
    }

    function test_feedManagement_disableFeed() public {
        oracle.setFeedEnabled(0, false);
        IOracleRelayV2.FeedConfig memory fc = oracle.getFeed(0);
        assertFalse(fc.enabled);
    }

    function test_feedManagement_disableFeed_nonAdmin_reverts() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(IOracleRelayV2.OracleV2__Unauthorized.selector);
        oracle.setFeedEnabled(0, false);
    }

    function test_feedManagement_getFeed_outOfBounds_reverts() public {
        vm.expectRevert(IOracleRelayV2.OracleV2__FeedNotFound.selector);
        oracle.getFeed(99);
    }

    function test_feedManagement_setAdmin() public {
        address newAdmin = address(0xA1);
        oracle.setAdmin(newAdmin);
        assertEq(oracle.admin(), newAdmin);
    }

    function test_feedManagement_setAdmin_nonAdmin_reverts() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(IOracleRelayV2.OracleV2__Unauthorized.selector);
        oracle.setAdmin(address(0xA1));
    }

    // ══════════════════════════════════════════════════════════════════════════
    // IOracleRelay backwards compatibility
    // ══════════════════════════════════════════════════════════════════════════

    function test_iface_isPrimaryValid() public view {
        assertTrue(oracle.isPrimaryValid());
    }

    function test_iface_isFallbackValid() public view {
        assertTrue(oracle.isFallbackValid());
    }

    function test_iface_isPrimaryValid_whenDisabled() public {
        oracle.setFeedEnabled(0, false);
        assertFalse(oracle.isPrimaryValid());
    }
}
