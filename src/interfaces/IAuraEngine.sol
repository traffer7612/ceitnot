// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IAuraEngine
 * @author Sanzhik(traffer7612)
 * @notice Main entrypoint for the Autonomous Yield-Backed Credit Engine
 */
interface IAuraEngine {
    // --- Core user functions
    function depositCollateral(address user, uint256 shares) external;
    function withdrawCollateral(address user, uint256 shares) external;
    function borrow(address user, uint256 amount) external;
    function repay(address user, uint256 amount) external;
    function harvestYield() external returns (uint256 yieldApplied);
    function liquidate(address user, uint256 repayAmount) external;
    // --- View functions
    function getPositionDebt(address user) external view returns (uint256);
    function getPositionCollateralShares(address user) external view returns (uint256);
    function getPositionCollateralValue(address user) external view returns (uint256);
    function getHealthFactor(address user) external view returns (uint256);
    function totalDebt() external view returns (uint256);
    function totalCollateralAssets() external view returns (uint256);
    function asset() external view returns (address);
    function debtToken() external view returns (address);
    function ltvBps() external view returns (uint16);
    // --- Admin / governance
    function proposeAdmin(address newAdmin) external;
    function acceptAdmin() external;
    function setGuardian(address guardian, bool status) external;
    function setKeeper(address keeper, bool status) external;
    function setPaused(bool paused_) external;
    function setEmergencyShutdown(bool shutdown_) external;
}
