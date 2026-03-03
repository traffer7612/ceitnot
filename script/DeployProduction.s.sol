// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script } from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";
import { AuraEngine } from "../src/AuraEngine.sol";
import { AuraProxy } from "../src/AuraProxy.sol";
import { OracleRelay } from "../src/OracleRelay.sol";

/**
 * Production deploy: USDC as debt token, existing ERC-4626 vault, Chainlink oracle.
 * No mocks. After deploy, transfer USDC to the proxy so users can borrow.
 *
 * Required env (or set in run():
 *   COLLATERAL_VAULT   - ERC-4626 vault address (e.g. stETH vault)
 *   USDC_ADDRESS      - USDC (or other stable) contract address
 *   CHAINLINK_FEED    - Chainlink aggregator for collateral price in USD (8 decimals → scale to 1e18 in relay if needed)
 *   FALLBACK_FEED     - Optional: RedStone or other fallback (address(0) to skip)
 */
contract DeployProduction is Script {
    function run() external returns (address proxy) {
        address collateralVault = vm.envOr("COLLATERAL_VAULT", address(0));
        address usdc = vm.envOr("USDC_ADDRESS", address(0));
        address chainlinkFeed = vm.envOr("CHAINLINK_FEED", address(0));
        address fallbackFeed = vm.envOr("FALLBACK_FEED", address(0));
        uint256 twapPeriod = vm.envOr("TWAP_PERIOD", uint256(0));

        require(collateralVault != address(0), "COLLATERAL_VAULT");
        require(usdc != address(0), "USDC_ADDRESS");
        require(chainlinkFeed != address(0), "CHAINLINK_FEED");

        vm.startBroadcast();

        OracleRelay oracle = new OracleRelay(chainlinkFeed, fallbackFeed, twapPeriod);

        AuraEngine implementation = new AuraEngine();
        bytes memory initData = abi.encodeCall(
            AuraEngine.initialize,
            (
                collateralVault,
                usdc,
                address(oracle),
                uint16(8000),   // ltvBps 80%
                uint16(8500),  // liquidationThresholdBps 85%
                uint16(500),   // liquidationPenaltyBps 5%
                uint256(1 days),
                uint256(2 days)
            )
        );
        AuraProxy proxyContract = new AuraProxy(address(implementation), initData);
        proxy = address(proxyContract);

        vm.stopBroadcast();

        console.log("AURA_ENGINE_ADDRESS=%s", proxy);
        console.log("ORACLE_RELAY_ADDRESS=%s", address(oracle));
        console.log("Next: transfer USDC to the engine so users can borrow.");
    }
}
