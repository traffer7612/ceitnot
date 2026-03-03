// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IERC4626
 * @author Sanzhik(traffer7612)
 * @notice Minimal ERC-4626 view interface for yield-bearing vault collateral
 */
interface IERC4626 {
    function asset() external view returns (address);
    function totalAssets() external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function convertToShares(uint256 assets) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}
