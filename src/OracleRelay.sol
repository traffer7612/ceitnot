// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IOracleRelay } from "./interfaces/IOracleRelay.sol";

interface IChainlinkAggregator {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
    function decimals() external view returns (uint8);
}

interface IFallbackFeed {
    function getLatestPrice() external view returns (uint256 value, uint256 timestamp);
}

/**
 * @title OracleRelay
 * @author Sanzhik(traffer7612)
 * @notice Multi-oracle price discovery: Chainlink primary with optional fallback (e.g. RedStone).
 *         Prevents liquidations driven by a single faulty feed. Uses heartbeat and validity checks.
 */
contract OracleRelay is IOracleRelay {
    uint256 public constant PRICE_DECIMALS = 8;
    uint256 public constant MAX_STALENESS = 24 hours;
    uint256 public twapPeriod;

    address public immutable PRIMARY_FEED;
    address public immutable FALLBACK_FEED;
    uint256 private _twapCumulative;
    uint256 private _twapLastUpdate;
    uint256 private _twapLastPrice;

    error OracleRelay__PrimaryInvalid();
    error OracleRelay__FallbackInvalid();
    error OracleRelay__AllFeedsStale();
    error OracleRelay__ZeroPrice();

    event TwapUpdated(uint256 price, uint256 timestamp);

    error OracleRelay__ZeroPrimaryFeed();

    constructor(address primaryFeed_, address fallbackFeed_, uint256 twapPeriod_) {
        if (primaryFeed_ == address(0)) revert OracleRelay__ZeroPrimaryFeed();
        PRIMARY_FEED = primaryFeed_;
        FALLBACK_FEED = fallbackFeed_;
        twapPeriod = twapPeriod_;
        (_twapLastPrice, _twapLastUpdate) = _readPrice();
        unchecked {
            _twapCumulative = _twapLastPrice * block.timestamp;
        }
    }

    /// @inheritdoc IOracleRelay
    function getLatestPrice() external view returns (uint256 value, uint256 timestamp) {
        return _readPrice();
    }

    /// @inheritdoc IOracleRelay
    function getTwapPrice() external view returns (uint256 value) {
        if (twapPeriod == 0) { (uint256 p, ) = _readPrice(); return p; }
        uint256 now_ = block.timestamp;
        if (now_ <= _twapLastUpdate) return _twapLastPrice;
        uint256 elapsed = now_ - _twapLastUpdate;
        if (elapsed >= twapPeriod) { (uint256 p, ) = _readPrice(); return p; }
        unchecked {
            uint256 cum = _twapCumulative + _twapLastPrice * elapsed;
            return cum / twapPeriod;
        }
    }

    /// @inheritdoc IOracleRelay
    function isPrimaryValid() external view returns (bool) {
        return _isValid(PRIMARY_FEED, true);
    }

    /// @inheritdoc IOracleRelay
    function isFallbackValid() external view returns (bool) {
        if (FALLBACK_FEED == address(0)) return false;
        return _isValid(FALLBACK_FEED, false);
    }

    function _readPrice() internal view returns (uint256 value, uint256 timestamp) {
        (bool okP, uint256 vP, uint256 tP) = _tryChainlink(PRIMARY_FEED);
        if (okP && vP != 0 && _notStale(tP)) return (vP, tP);
        if (FALLBACK_FEED != address(0)) {
            (bool okF, uint256 vF, uint256 tF) = _tryFallback(FALLBACK_FEED);
            if (okF && vF != 0 && _notStale(tF)) return (vF, tF);
        }
        revert OracleRelay__AllFeedsStale();
    }

    function _notStale(uint256 updatedAt) internal view returns (bool) {
        return (block.timestamp - updatedAt) <= MAX_STALENESS;
    }

    function _tryChainlink(address feed) internal view returns (bool ok, uint256 value, uint256 timestamp) {
        if (feed == address(0)) return (false, 0, 0);
        try IChainlinkAggregator(feed).latestRoundData() returns (
            uint80, int256 answer, uint256, uint256 updatedAt, uint80
        ) {
            if (answer <= 0) return (true, 0, updatedAt);
            // Normalize Chainlink 8-decimal price to WAD (1e18)
            uint8 feedDecimals = IChainlinkAggregator(feed).decimals();
            uint256 price = uint256(answer);
            if (feedDecimals < 18) {
                price = price * (10 ** (18 - feedDecimals));
            } else if (feedDecimals > 18) {
                price = price / (10 ** (feedDecimals - 18));
            }
            return (true, price, updatedAt);
        } catch {
            return (false, 0, 0);
        }
    }

    function _tryFallback(address feed) internal view returns (bool ok, uint256 value, uint256 timestamp) {
        try IFallbackFeed(feed).getLatestPrice() returns (uint256 v, uint256 t) {
            return (true, v, t);
        } catch {
            return (false, 0, 0);
        }
    }

    function _isValid(address feed, bool isChainlink) internal view returns (bool) {
        (bool ok, uint256 v, uint256 t) = isChainlink ? _tryChainlink(feed) : _tryFallback(feed);
        return ok && v != 0 && _notStale(t);
    }

    /// @notice Update TWAP accumulator (call from heartbeat or keeper)
    function updateTwap() external {
        (uint256 price, ) = _readPrice();
        uint256 now_ = block.timestamp;
        unchecked {
            _twapCumulative += _twapLastPrice * (now_ - _twapLastUpdate);
        }
        _twapLastPrice = price;
        _twapLastUpdate = now_;
        emit TwapUpdated(price, now_);
    }
}
