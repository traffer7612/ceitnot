// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { MockERC20 } from "./MockERC20.sol";

/// @notice ERC-4626 vault with manipulable share price for donation/inflation attack tests.
contract ControllableVault {
    MockERC20 public immutable ASSET_TOKEN;
    string public name = "Controllable Vault";
    string public symbol = "cVLT";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // Multiplier for convertToAssets: 1e18 = 1:1, 2e18 = 1 share = 2 assets
    uint256 public pricePerShare = 1e18;

    constructor(address asset_) {
        ASSET_TOKEN = MockERC20(asset_);
    }

    function setPricePerShare(uint256 price_) external {
        pricePerShare = price_;
    }

    function asset() external view returns (address) {
        return address(ASSET_TOKEN);
    }

    function totalAssets() external view returns (uint256) {
        return ASSET_TOKEN.balanceOf(address(this));
    }

    function convertToAssets(uint256 shares) external view returns (uint256) {
        return (shares * pricePerShare) / 1e18;
    }

    function convertToShares(uint256 assets) external view returns (uint256) {
        return (assets * 1e18) / pricePerShare;
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        bool ok = ASSET_TOKEN.transferFrom(msg.sender, address(this), assets);
        require(ok, "transferFrom failed");
        shares = (assets * 1e18) / pricePerShare;
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
