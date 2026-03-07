// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IOracleRelay } from "./IOracleRelay.sol";

/**
 * @title IOracleRelayV2
 * @author Sanzhik(traffer7612)
 * @notice Extended oracle interface for Phase 8:
 *         Multi-source median, price-deviation circuit breaker,
 *         Chainlink L2 sequencer uptime feed, per-market heartbeat.
 */
interface IOracleRelayV2 is IOracleRelay {
    // ------------------------------- Errors
    error OracleV2__AllFeedsInvalid();
    error OracleV2__CircuitBroken();
    error OracleV2__SequencerDown();
    error OracleV2__SequencerGracePeriod();
    error OracleV2__Unauthorized();
    error OracleV2__ZeroAddress();
    error OracleV2__MaxFeedsReached();
    error OracleV2__FeedNotFound();
    error OracleV2__InvalidParams();

    // ------------------------------- Events
    event PriceDeviationBreached(uint256 lastPrice, uint256 newPrice, uint256 deviationBps);
    event CircuitBreakerReset(address indexed admin, uint256 newBaselinePrice);
    event FeedAdded(uint256 indexed index, address feed, bool isChainlink, uint256 heartbeat);
    event FeedEnabledChanged(uint256 indexed index, bool enabled);
    event MaxDeviationUpdated(uint256 oldBps, uint256 newBps);
    event AdminTransferred(address indexed previous, address indexed next);
    event SequencerFeedUpdated(address indexed feed, uint256 gracePeriod);
    event PriceUpdated(uint256 price, uint256 timestamp);

    // ------------------------------- Feed management

    /**
     * @notice Configuration for a single price feed source.
     */
    struct FeedConfig {
        address feed;       // Contract address
        bool    isChainlink; // true = Chainlink V3 AggregatorV3Interface; false = IFallbackFeed
        uint256 heartbeat;  // Maximum acceptable age of data in seconds (e.g. 3600 for 1 hour)
        bool    enabled;    // Can be toggled without removal
    }

    /// @notice Add a new price feed source. Reverts if MAX_FEEDS reached.
    function addFeed(address feed, bool isChainlink, uint256 heartbeat) external;

    /// @notice Enable or disable a feed by its index in the feeds array.
    function setFeedEnabled(uint256 index, bool enabled) external;

    /// @notice Total number of registered feeds (enabled and disabled).
    function feedCount() external view returns (uint256);

    /// @notice Get feed config at `index`.
    function getFeed(uint256 index) external view returns (FeedConfig memory);

    // ------------------------------- Circuit breaker

    /**
     * @notice Keeper-callable function: reads current median price, compares
     *         it against `lastPrice`, and triggers the circuit breaker if
     *         the deviation exceeds `maxDeviationBps`.
     *         Also updates `lastPrice` when no breach occurs.
     */
    function updatePrice() external;

    /**
     * @notice Admin-only: reset the circuit breaker after investigation.
     *         Sets `lastPrice` to the current median and clears `circuitBroken`.
     */
    function resetCircuitBreaker() external;

    /// @notice True if the circuit breaker was tripped (deviation exceeded).
    function isCircuitBroken() external view returns (bool);

    /// @notice Maximum allowed price deviation per `updatePrice()` call (bps, e.g. 1500 = 15%).
    function maxDeviationBps() external view returns (uint256);

    /// @notice Last accepted oracle price (WAD). 0 = not yet initialised.
    function lastPrice() external view returns (uint256);

    /// @notice Update the maximum allowed deviation. Admin only.
    function setMaxDeviation(uint256 newBps) external;

    // ------------------------------- Sequencer uptime (L2)

    /**
     * @notice Returns true when the configured sequencer feed reports the sequencer is up
     *         AND the grace period after the last restart has elapsed.
     *         Always returns true when no sequencer feed is configured.
     */
    function isSequencerUp() external view returns (bool);

    /**
     * @notice Configure or replace the Chainlink L2 Sequencer Uptime Feed.
     * @param feed         Address of the sequencer feed (address(0) = disable check)
     * @param gracePeriod  Seconds to wait after sequencer restart before resuming
     */
    function setSequencerFeed(address feed, uint256 gracePeriod) external;

    // ------------------------------- Admin
    function setAdmin(address newAdmin) external;
    function admin() external view returns (address);
}
