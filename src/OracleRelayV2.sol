// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IOracleRelayV2 } from "./interfaces/IOracleRelayV2.sol";

// Chainlink V3 Aggregator interface (used by both primary Chainlink feeds and RedStone adapters)
interface IChainlinkV3 {
    function latestRoundData()
        external
        view
        returns (
            uint80  roundId,
            int256  answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80  answeredInRound
        );
    function decimals() external view returns (uint8);
}

// Generic fallback feed (e.g. Pyth/RedStone custom adapters, TWAP oracles)
interface IFallbackFeed {
    function getLatestPrice() external view returns (uint256 value, uint256 timestamp);
}

// Chainlink L2 Sequencer Uptime Feed (same latestRoundData shape, answer = 0 means UP)
interface ISequencerFeed {
    function latestRoundData()
        external
        view
        returns (
            uint80  roundId,
            int256  answer,    // 0 = sequencer up, 1 = sequencer down
            uint256 startedAt, // timestamp of most recent status change
            uint256 updatedAt,
            uint80  answeredInRound
        );
}

/**
 * @title  OracleRelayV2
 * @author Sanzhik(traffer7612)
 * @notice Phase 8: Multi-source median oracle.
 *
 *   8.1 Price Deviation Circuit Breaker
 *         Keepers call `updatePrice()` after each epoch. If the new median deviates
 *         from the previous accepted price by more than `maxDeviationBps` (e.g. 15%),
 *         the circuit breaker is tripped, `circuitBroken` is set, and
 *         `getLatestPrice()` reverts until an admin calls `resetCircuitBreaker()`.
 *         This prevents liquidation cascades from oracle manipulation.
 *
 *   8.2 Sequencer Uptime Feed (L2)
 *         When `sequencerFeed` is configured, `getLatestPrice()` reverts if the
 *         sequencer is reported down OR if the uptime elapsed since the last
 *         restart is still within `sequencerGracePeriod` (default 3600 s).
 *         Prevents liquidations during sequencer outages / restarts on L2.
 *
 *   8.3 Multi-Source Median
 *         Supports 1–MAX_FEEDS price sources. On each `getLatestPrice()` call,
 *         all enabled, non-stale, non-zero prices are collected; the median is
 *         returned. With an even count, the lower of the two middle values is
 *         chosen (conservative). Provides resilience against a single faulty feed.
 *         Feed types: Chainlink V3 (auto-normalised to WAD) and generic fallback.
 *
 *   8.4 Per-Market Oracle
 *         Each market in AuraMarketRegistry points to its own OracleRelayV2
 *         instance configured with the appropriate sources and heartbeats for
 *         that collateral type. No engine changes required.
 */
contract OracleRelayV2 is IOracleRelayV2 {
    // ------------------------------- Constants
    uint256 public constant MAX_FEEDS      = 8;
    uint256 public constant MAX_DEVIATION_CAP = 10_000; // 100% max configurable deviation
    uint256 public constant WAD            = 1e18;

    // ------------------------------- State
    FeedConfig[] private _feeds;

    uint256 public maxDeviationBps;
    uint256 public lastPrice;
    bool    public circuitBroken;

    address public sequencerFeed;
    uint256 public sequencerGracePeriod;

    address public admin;

    // ------------------------------- Constructor
    /**
     * @param initialFeeds_         Initial feed configurations (1–MAX_FEEDS)
     * @param maxDeviationBps_      Max allowed price deviation per update (bps). 0 = disabled.
     * @param sequencerFeed_        Chainlink L2 Sequencer Uptime Feed (address(0) = disabled)
     * @param sequencerGracePeriod_ Seconds to wait after sequencer restart
     * @param admin_                Admin address
     */
    constructor(
        FeedConfig[]  memory initialFeeds_,
        uint256              maxDeviationBps_,
        address              sequencerFeed_,
        uint256              sequencerGracePeriod_,
        address              admin_
    ) {
        if (admin_ == address(0)) revert OracleV2__ZeroAddress();
        if (initialFeeds_.length == 0 || initialFeeds_.length > MAX_FEEDS)
            revert OracleV2__InvalidParams();
        if (maxDeviationBps_ > MAX_DEVIATION_CAP) revert OracleV2__InvalidParams();

        admin                = admin_;
        maxDeviationBps      = maxDeviationBps_;
        sequencerFeed        = sequencerFeed_;
        sequencerGracePeriod = sequencerGracePeriod_;

        for (uint256 i = 0; i < initialFeeds_.length; i++) {
            if (initialFeeds_[i].feed == address(0)) revert OracleV2__ZeroAddress();
            _feeds.push(initialFeeds_[i]);
            emit FeedAdded(i, initialFeeds_[i].feed, initialFeeds_[i].isChainlink, initialFeeds_[i].heartbeat);
        }

        // Initialise lastPrice so the first updatePrice() call has a baseline
        (uint256 p, ) = _computePrice();
        lastPrice = p;
    }

    // ------------------------------- IOracleRelay

    /**
     * @notice Returns the median price from all valid feeds.
     * @dev Reverts if circuit breaker is tripped, sequencer is down/grace, or all feeds invalid.
     * @return value     Median price normalised to WAD (1e18)
     * @return timestamp Timestamp of the median feed's last update
     */
    function getLatestPrice() external view returns (uint256 value, uint256 timestamp) {
        if (circuitBroken) revert OracleV2__CircuitBroken();
        _requireSequencerUp();
        return _computePrice();
    }

    /**
     * @notice Returns the TWAP price (V2: identical to median, no separate accumulator).
     * @dev Reverts under the same conditions as `getLatestPrice()`.
     */
    function getTwapPrice() external view returns (uint256 value) {
        if (circuitBroken) revert OracleV2__CircuitBroken();
        _requireSequencerUp();
        (value, ) = _computePrice();
    }

    /// @notice Returns true if the primary feed (index 0) is enabled and reports a fresh price.
    function isPrimaryValid() external view returns (bool) {
        if (_feeds.length == 0) return false;
        FeedConfig storage fc = _feeds[0];
        if (!fc.enabled) return false;
        (bool ok, uint256 v, uint256 ts) = _tryReadFeed(fc);
        return ok && v > 0 && (block.timestamp - ts) <= fc.heartbeat;
    }

    /// @notice Returns true if at least one non-primary feed is enabled and reports a fresh price.
    function isFallbackValid() external view returns (bool) {
        // Returns true if at least one non-primary enabled feed is valid
        for (uint256 i = 1; i < _feeds.length; i++) {
            FeedConfig storage fc = _feeds[i];
            if (!fc.enabled) continue;
            (bool ok, uint256 v, uint256 ts) = _tryReadFeed(fc);
            if (ok && v > 0 && (block.timestamp - ts) <= fc.heartbeat) return true;
        }
        return false;
    }

    // ------------------------------- IOracleRelayV2: circuit breaker

    /**
     * @notice Keeper-callable: read current median, check deviation, update lastPrice.
     *         Trips the circuit breaker (and emits PriceDeviationBreached) when deviation
     *         exceeds `maxDeviationBps`. Benign when `maxDeviationBps == 0`.
     */
    function updatePrice() external {
        (uint256 current, ) = _computePrice();

        if (maxDeviationBps > 0 && lastPrice > 0) {
            uint256 diff = current > lastPrice ? current - lastPrice : lastPrice - current;
            uint256 deviationBps = (diff * 10_000) / lastPrice;
            if (deviationBps > maxDeviationBps) {
                circuitBroken = true;
                emit PriceDeviationBreached(lastPrice, current, deviationBps);
                return; // do NOT update lastPrice when breaching
            }
        }

        lastPrice = current;
        emit PriceUpdated(current, block.timestamp);
    }

    /**
     * @notice Admin-only: clear the circuit breaker and adopt the current median
     *         as the new baseline price.
     */
    function resetCircuitBreaker() external {
        if (msg.sender != admin) revert OracleV2__Unauthorized();
        (uint256 p, ) = _computePrice();
        circuitBroken = false;
        lastPrice     = p;
        emit CircuitBreakerReset(msg.sender, p);
    }

    function isCircuitBroken() external view returns (bool) {
        return circuitBroken;
    }

    function setMaxDeviation(uint256 newBps) external {
        if (msg.sender != admin) revert OracleV2__Unauthorized();
        if (newBps > MAX_DEVIATION_CAP)  revert OracleV2__InvalidParams();
        emit MaxDeviationUpdated(maxDeviationBps, newBps);
        maxDeviationBps = newBps;
    }

    // ------------------------------- IOracleRelayV2: sequencer

    /**
     * @notice Returns true iff the sequencer is reported UP and past the grace period.
     *         Always true when `sequencerFeed == address(0)`.
     */
    function isSequencerUp() external view returns (bool) {
        if (sequencerFeed == address(0)) return true;
        try ISequencerFeed(sequencerFeed).latestRoundData() returns (
            uint80, int256 answer, uint256 startedAt, uint256, uint80
        ) {
            if (answer != 0) return false; // 1 = down
            if (block.timestamp - startedAt < sequencerGracePeriod) return false;
            return true;
        } catch {
            return false; // treat unresponsive feed as down
        }
    }

    function setSequencerFeed(address feed, uint256 gracePeriod) external {
        if (msg.sender != admin) revert OracleV2__Unauthorized();
        sequencerFeed        = feed;
        sequencerGracePeriod = gracePeriod;
        emit SequencerFeedUpdated(feed, gracePeriod);
    }

    // ------------------------------- IOracleRelayV2: feed management

    function addFeed(address feed, bool isChainlink, uint256 heartbeat) external {
        if (msg.sender != admin)         revert OracleV2__Unauthorized();
        if (feed == address(0))          revert OracleV2__ZeroAddress();
        if (_feeds.length >= MAX_FEEDS)  revert OracleV2__MaxFeedsReached();
        _feeds.push(FeedConfig({ feed: feed, isChainlink: isChainlink, heartbeat: heartbeat, enabled: true }));
        emit FeedAdded(_feeds.length - 1, feed, isChainlink, heartbeat);
    }

    function setFeedEnabled(uint256 index, bool enabled) external {
        if (msg.sender != admin)     revert OracleV2__Unauthorized();
        if (index >= _feeds.length)  revert OracleV2__FeedNotFound();
        _feeds[index].enabled = enabled;
        emit FeedEnabledChanged(index, enabled);
    }

    function feedCount() external view returns (uint256) {
        return _feeds.length;
    }

    function getFeed(uint256 index) external view returns (FeedConfig memory) {
        if (index >= _feeds.length) revert OracleV2__FeedNotFound();
        return _feeds[index];
    }

    // ------------------------------- IOracleRelayV2: admin

    function setAdmin(address newAdmin) external {
        if (msg.sender != admin)       revert OracleV2__Unauthorized();
        if (newAdmin == address(0))    revert OracleV2__ZeroAddress();
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }

    // ------------------------------- Internal: core price logic

    /**
     * @dev Collect all valid prices from enabled feeds, sort them, and return the median.
     *      Median for even counts returns the lower of the two middle values (conservative).
     *      Reverts when zero valid prices are found.
     */
    function _computePrice() internal view returns (uint256 value, uint256 timestamp) {
        uint256[MAX_FEEDS] memory prices;
        uint256[MAX_FEEDS] memory timestamps;
        uint256 count;

        uint256 len = _feeds.length;
        for (uint256 i = 0; i < len; i++) {
            FeedConfig storage fc = _feeds[i];
            if (!fc.enabled) continue;
            (bool ok, uint256 p, uint256 ts) = _tryReadFeed(fc);
            if (!ok || p == 0) continue;
            if (fc.heartbeat > 0 && (block.timestamp - ts) > fc.heartbeat) continue;
            prices[count]     = p;
            timestamps[count] = ts;
            count++;
        }

        if (count == 0) revert OracleV2__AllFeedsInvalid();

        // Insertion sort (O(n²) is fine for n ≤ 8)
        _insertionSort(prices, timestamps, count);

        uint256 mid = count / 2;
        if (count % 2 == 1) {
            value     = prices[mid];
            timestamp = timestamps[mid];
        } else {
            // Conservative: take the lower middle value
            value     = prices[mid - 1];
            timestamp = timestamps[mid - 1];
        }
    }

    /**
     * @dev Read a single feed, returning (ok, priceWAD, updatedAt).
     *      Chainlink: normalises from feedDecimals to 18dp.
     *      Fallback: assumed to already be in WAD.
     */
    function _tryReadFeed(FeedConfig storage fc)
        internal
        view
        returns (bool ok, uint256 priceWAD, uint256 updatedAt)
    {
        if (fc.isChainlink) {
            try IChainlinkV3(fc.feed).latestRoundData() returns (
                uint80, int256 answer, uint256, uint256 ts, uint80
            ) {
                if (answer <= 0) return (true, 0, ts); // invalid answer
                try IChainlinkV3(fc.feed).decimals() returns (uint8 dec) {
                    uint256 p = uint256(answer);
                    if (dec < 18) {
                        p = p * (10 ** (18 - dec));
                    } else if (dec > 18) {
                        p = p / (10 ** (dec - 18));
                    }
                    return (true, p, ts);
                } catch {
                    // fallback: assume 8 decimals (standard Chainlink)
                    uint256 p = uint256(answer) * (10 ** (18 - 8));
                    return (true, p, ts);
                }
            } catch {
                return (false, 0, 0);
            }
        } else {
            try IFallbackFeed(fc.feed).getLatestPrice() returns (uint256 v, uint256 ts) {
                return (true, v, ts);
            } catch {
                return (false, 0, 0);
            }
        }
    }

    /**
     * @dev In-place insertion sort of the first `n` elements in `arr` and `tss`.
     *      Both arrays are sorted together to maintain the (price, timestamp) pairing.
     */
    function _insertionSort(
        uint256[MAX_FEEDS] memory arr,
        uint256[MAX_FEEDS] memory tss,
        uint256 n
    ) internal pure {
        for (uint256 i = 1; i < n; i++) {
            uint256 keyP = arr[i];
            uint256 keyT = tss[i];
            uint256 j    = i;
            while (j > 0 && arr[j - 1] > keyP) {
                arr[j] = arr[j - 1];
                tss[j] = tss[j - 1];
                j--;
            }
            arr[j] = keyP;
            tss[j] = keyT;
        }
    }

    /**
     * @dev Internal sequencer check — reverts instead of returning bool.
     *      Called from getLatestPrice() and getTwapPrice().
     */
    function _requireSequencerUp() internal view {
        if (sequencerFeed == address(0)) return;
        try ISequencerFeed(sequencerFeed).latestRoundData() returns (
            uint80, int256 answer, uint256 startedAt, uint256, uint80
        ) {
            if (answer != 0) revert OracleV2__SequencerDown();
            if (block.timestamp - startedAt < sequencerGracePeriod)
                revert OracleV2__SequencerGracePeriod();
        } catch {
            revert OracleV2__SequencerDown(); // treat unresponsive feed as down
        }
    }
}
