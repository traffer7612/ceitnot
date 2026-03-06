// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title InterestRateModel
 * @author Sanzhik(traffer7612)
 * @notice Compound/Aave-style kink utilization model.
 *         All rates are per-second in RAY (1e27) precision.
 *
 *         utilization = totalBorrows / borrowCap   (0 when borrowCap == 0)
 *
 *         Below kink:
 *           borrowRate = baseRate + utilization * slope1
 *         Above kink:
 *           borrowRate = baseRate + kink * slope1 + (utilization - kink) * slope2
 *
 *         Rates are expressed as RAY fractions per second, e.g. 1% APR ≈ 3.17e17 / 1e27 per second.
 */
library InterestRateModel {
    uint256 internal constant RAY = 1e27;

    /**
     * @notice Compute utilization rate from total borrows and the borrow cap denominator.
     * @param totalBorrows  Total outstanding borrows (WAD)
     * @param borrowCap     Market borrow cap used as denominator (WAD). 0 → utilization = 0.
     * @return utilization  RAY-scaled value in [0, RAY]
     */
    function getUtilizationRate(
        uint256 totalBorrows,
        uint256 borrowCap
    ) internal pure returns (uint256 utilization) {
        if (borrowCap == 0 || totalBorrows == 0) return 0;
        utilization = (totalBorrows * RAY) / borrowCap;
        if (utilization > RAY) utilization = RAY;
    }

    /**
     * @notice Compute the per-second borrow rate for the kink model.
     * @param utilization  RAY-scaled utilization in [0, RAY]
     * @param baseRate     RAY/sec base rate (at 0 utilization)
     * @param slope1       RAY/sec slope below kink
     * @param slope2       RAY/sec slope above kink
     * @param kink         RAY-scaled optimal utilization point
     * @return rate        RAY/sec borrow rate
     */
    function getBorrowRate(
        uint256 utilization,
        uint256 baseRate,
        uint256 slope1,
        uint256 slope2,
        uint256 kink
    ) internal pure returns (uint256 rate) {
        if (utilization <= kink) {
            // rate = baseRate + utilization * slope1 / RAY
            rate = baseRate + (utilization * slope1) / RAY;
        } else {
            uint256 normalRate  = baseRate + (kink * slope1) / RAY;
            uint256 excessUtil  = utilization - kink;
            rate = normalRate + (excessUtil * slope2) / RAY;
        }
    }
}
