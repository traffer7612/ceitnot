// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { CeitnotMarketRegistry } from "../src/CeitnotMarketRegistry.sol";
import { OracleRelay } from "../src/OracleRelay.sol";
import { SimpleERC4626Vault } from "../src/vaults/SimpleERC4626Vault.sol";

/**
 * @title  AddUSDTMarketArbitrum
 * @notice Deploy SimpleERC4626Vault over canonical Arbitrum USDT,
 *         deploy OracleRelay(Chainlink USDT/USD), call addMarket on an existing registry.
 *
 * When registry.admin() is the Timelock, do NOT use this with broadcast — deploy vault+oracle only
 * (see DeployMarketVaultOracleArbitrum.s.sol) then governance `addMarket` via Governor.
 *
 * Required env:
 *   REGISTRY_ADDRESS — CeitnotMarketRegistry where msg.sender is `admin`
 *
 * Optional env:
 *   USDT_ADDRESS         — default canonical USDT on Arbitrum One
 *   CHAINLINK_USDT_USD   — default Chainlink USDT/USD on Arbitrum One (verify on data.chain.link)
 *   USDT_SEED_RAW        — optional first `deposit` into vault (6 decimals for USDT); deployer must hold USDT
 *   LTV_BPS              — default 9000
 *   LIQ_THRESHOLD_BPS    — default 9300
 *   LIQ_PENALTY_BPS      — default 300
 *
 * Usage (EOA admin):
 *   REGISTRY_ADDRESS=0x... forge script script/AddUSDTMarketArbitrum.s.sol:AddUSDTMarketArbitrum \
 *     --rpc-url https://arb1.arbitrum.io/rpc --broadcast
 */
contract AddUSDTMarketArbitrum is Script {
    /// @dev Canonical USDT on Arbitrum One
    address public constant USDT_ARB_DEFAULT = 0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9;
    /// @dev Chainlink USDT / USD (Standard proxy) on Arbitrum One — data.chain.link/feeds/arbitrum/mainnet/usdt-usd
    address public constant CHAINLINK_USDT_USD_ARB = 0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7;

    function run() external {
        address registryAddr = vm.envAddress("REGISTRY_ADDRESS");
        address usdt = vm.envOr("USDT_ADDRESS", USDT_ARB_DEFAULT);
        address feed = vm.envOr("CHAINLINK_USDT_USD", CHAINLINK_USDT_USD_ARB);
        uint256 seed = vm.envOr("USDT_SEED_RAW", uint256(0));
        uint16 ltv = uint16(vm.envOr("LTV_BPS", uint256(9000)));
        uint16 liq = uint16(vm.envOr("LIQ_THRESHOLD_BPS", uint256(9300)));
        uint16 pen = uint16(vm.envOr("LIQ_PENALTY_BPS", uint256(300)));

        vm.startBroadcast();

        address deployer = msg.sender;

        SimpleERC4626Vault vault_ = new SimpleERC4626Vault(
            IERC20(usdt),
            "Ceitnot USDT Vault",
            "lUSDT"
        );
        address vault = address(vault_);

        OracleRelay oracle = new OracleRelay(feed, address(0), 0);

        if (seed > 0) {
            uint256 bal = IERC20(usdt).balanceOf(deployer);
            require(bal >= seed, "AddUSDT: insufficient USDT for USDT_SEED_RAW");
            require(IERC20(usdt).approve(vault, seed), "AddUSDT: approve failed");
            vault_.deposit(seed, deployer);
        }

        uint256 marketId = CeitnotMarketRegistry(registryAddr).addMarket(
            vault,
            address(oracle),
            ltv,
            liq,
            pen,
            0,
            0,
            false,
            0
        );

        vm.stopBroadcast();

        console.log("=== ADD USDT MARKET (Arbitrum) ===");
        console.log("REGISTRY:     %s", registryAddr);
        console.log("VAULT:        %s", vault);
        console.log("ORACLE:       %s", address(oracle));
        console.log("USDT asset:   %s", usdt);
        console.log("CHAINLINK:    %s", feed);
        console.log("marketId:     %s", marketId);
        console.log("seed used:    %s", seed);
    }
}
