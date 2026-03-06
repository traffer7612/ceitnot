// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { MockERC20 } from "./MockERC20.sol";

/// @notice Minimal ERC-4626–style vault for testing: 1 share = 1 asset (adjustable via simulateYield).
contract MockVault4626 {
    MockERC20 public immutable ASSET_TOKEN;
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    /// @dev Price per share in WAD (1e18 = 1:1). Increase via simulateYield to trigger harvest.
    uint256 public pricePerShare = 1e18;

    constructor(address asset_, string memory name_, string memory symbol_) {
        ASSET_TOKEN = MockERC20(asset_);
        name = name_;
        symbol = symbol_;
    }

    function asset() external view returns (address) {
        return address(ASSET_TOKEN);
    }

    function totalAssets() external view returns (uint256) {
        return ASSET_TOKEN.balanceOf(address(this));
    }

    function convertToAssets(uint256 shares) external view returns (uint256) {
        return shares * pricePerShare / 1e18;
    }

    function convertToShares(uint256 assets) external view returns (uint256) {
        return assets * 1e18 / pricePerShare;
    }

    /// @dev Set a new price per share to simulate vault yield (e.g. 2e18 = 2:1 ratio).
    function simulateYield(uint256 newPricePerShare) external {
        pricePerShare = newPricePerShare;
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        bool ok = ASSET_TOKEN.transferFrom(msg.sender, address(this), assets);
        require(ok, "MockVault: transferFrom failed");
        shares = assets;
        totalSupply += shares;
        balanceOf[receiver] += shares;
        return shares;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
