// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title FixedPoint
 * @author Sanzhik(traffer7612)
 * @notice High-precision fixed-point math (WAD 1e18, RAY 1e27) for debt and yield accounting.
 * @dev All rounding follows protocol-favorable direction: debt rounded up, collateral/value down.
 */
library FixedPoint {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant RAY = 1e27;

    /// @dev RAY * RAY / RAY = RAY
    function rayMul(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a * b + (RAY / 2)) / RAY;
    }

    /// @dev RAY / RAY = RAY (with rounding)
    function rayDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a * RAY + (b / 2)) / b;
    }

    /// @dev WAD * WAD / WAD = WAD
    function wadMul(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a * b + (WAD / 2)) / WAD;
    }

    /// @dev WAD / WAD = WAD
    function wadDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a * WAD + (b / 2)) / b;
    }

    /// @dev Convert WAD to RAY
    function wadToRay(uint256 a) internal pure returns (uint256) {
        return a * (RAY / WAD);
    }

    /// @dev Convert RAY to WAD (round down)
    function rayToWad(uint256 a) internal pure returns (uint256) {
        return a / (RAY / WAD);
    }

    /**
     * @notice Current debt from principal and scale (protocol-favorable: round up)
     * @param principal Principal debt (WAD)
     * @param globalScale Current global debt scale (RAY)
     * @param scaleAtLastUpdate User's scale snapshot (RAY)
     * @return debt Current debt in WAD
     */
    function currentDebt(
        uint256 principal,
        uint256 globalScale,
        uint256 scaleAtLastUpdate
    ) internal pure returns (uint256 debt) {
        if (principal == 0 || scaleAtLastUpdate == 0) return 0;
        // debt = principal * globalScale / scaleAtLastUpdate; round up
        debt = (principal * globalScale + scaleAtLastUpdate - 1) / scaleAtLastUpdate;
    }

    /**
     * @notice New global scale after applying yield to total debt (round down scale to avoid over-application)
     * @param currentScale Current global scale (RAY)
     * @param totalDebt Current total debt (WAD)
     * @param yieldToApply Yield to apply in debt token (WAD)
     * @return newScale New global scale (RAY)
     */
    function scaleAfterYield(
        uint256 currentScale,
        uint256 totalDebt,
        uint256 yieldToApply
    ) internal pure returns (uint256 newScale) {
        if (totalDebt == 0 || yieldToApply == 0) return currentScale;
        if (yieldToApply >= totalDebt) return 1; // near-zero: full debt elimination; avoid 0 which reads as "uninitialized"
        // newTotalDebt = totalDebt - yieldToApply
        // newScale = currentScale * (totalDebt - yieldToApply) / totalDebt
        uint256 newTotalDebt = totalDebt - yieldToApply;
        newScale = (currentScale * newTotalDebt + (totalDebt - 1)) / totalDebt; // round up (protocol-favorable: slightly less debt reduction)
    }
}
