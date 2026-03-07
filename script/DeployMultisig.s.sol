// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script }             from "forge-std/Script.sol";
import { console }            from "forge-std/console.sol";
import { AuraEngine }         from "../src/AuraEngine.sol";
import { AuraProxy }          from "../src/AuraProxy.sol";
import { AuraMarketRegistry } from "../src/AuraMarketRegistry.sol";
import { OracleRelayV2 }      from "../src/OracleRelayV2.sol";
import { IOracleRelayV2 }     from "../src/interfaces/IOracleRelayV2.sol";

/**
 * @title  DeployMultisig
 * @notice Production deployment that transfers admin to a pre-existing Gnosis Safe.
 *         Deploys OracleRelayV2 with multisig as oracle admin from construction.
 *         Deploys registry and engine with deployer EOA as temporary admin so the
 *         initial market can be registered on-chain, then proposes admin to the Safe.
 *
 * Required env vars:
 *   MULTISIG_ADDRESS    - Gnosis Safe address (3/5 or 4/7) that will govern the protocol
 *   COLLATERAL_VAULT    - ERC-4626 vault address used as collateral
 *   USDC_ADDRESS        - Debt token address (USDC or AuraUSD)
 *   CHAINLINK_FEED      - Primary Chainlink AggregatorV3Interface for collateral price
 *
 * Optional env vars:
 *   FALLBACK_FEED        - Secondary price feed (address(0) to skip)
 *   SEQUENCER_FEED       - Chainlink L2 Sequencer Uptime Feed (address(0) to skip)
 *   SEQUENCER_GRACE      - Grace period after sequencer restart in seconds (default: 3600)
 *   MAX_DEVIATION_BPS    - Oracle circuit breaker threshold in bps (default: 1500 = 15%)
 *   FEED_HEARTBEAT       - Primary feed staleness threshold in seconds (default: 3600)
 *   TIMELOCK_DELAY       - Engine param-change delay in seconds (default: 2 days)
 *   LTV_BPS              - Loan-to-Value ratio in bps (default: 8000 = 80%)
 *   LIQUIDATION_BPS      - Liquidation threshold in bps (default: 8500 = 85%)
 *   LIQUIDATION_PEN_BPS  - Liquidation penalty in bps (default: 500 = 5%)
 *
 * ===========================================================================
 * POST-DEPLOY ACTIONS REQUIRED (must be executed by the Gnosis Safe):
 *   1. engine.acceptAdmin()   — finalises engine admin transfer to the Safe
 *   2. registry.acceptAdmin() — finalises registry admin transfer to the Safe
 *      Calldata for each: cast calldata "acceptAdmin()"  =>  0x0e18b681
 * ===========================================================================
 */
contract DeployMultisig is Script {
    function run()
        external
        returns (address proxy, address registry, address oracle)
    {
        // ---- Required env vars
        address multisig        = vm.envAddress("MULTISIG_ADDRESS");
        address collateralVault = vm.envAddress("COLLATERAL_VAULT");
        address usdc            = vm.envAddress("USDC_ADDRESS");
        address chainlinkFeed   = vm.envAddress("CHAINLINK_FEED");

        require(multisig        != address(0), "DeployMultisig: MULTISIG_ADDRESS required");
        require(collateralVault != address(0), "DeployMultisig: COLLATERAL_VAULT required");
        require(usdc            != address(0), "DeployMultisig: USDC_ADDRESS required");
        require(chainlinkFeed   != address(0), "DeployMultisig: CHAINLINK_FEED required");

        // ---- Optional env vars
        address fallbackFeed   = vm.envOr("FALLBACK_FEED",        address(0));
        address sequencerFeed  = vm.envOr("SEQUENCER_FEED",       address(0));
        uint256 seqGrace       = vm.envOr("SEQUENCER_GRACE",      uint256(3600));
        uint256 maxDevBps      = vm.envOr("MAX_DEVIATION_BPS",    uint256(1500));
        uint256 feedHeartbeat  = vm.envOr("FEED_HEARTBEAT",       uint256(3600));
        uint256 timelockDelay  = vm.envOr("TIMELOCK_DELAY",       uint256(2 days));
        uint16  ltvBps         = uint16(vm.envOr("LTV_BPS",           uint256(8000)));
        uint16  liqBps         = uint16(vm.envOr("LIQUIDATION_BPS",   uint256(8500)));
        uint16  liqPenBps      = uint16(vm.envOr("LIQUIDATION_PEN_BPS", uint256(500)));

        vm.startBroadcast();

        // ------------------------------------------------------------------ 1. Oracle
        // OracleRelayV2 admin is the multisig from day one.
        IOracleRelayV2.FeedConfig[] memory feeds;
        if (fallbackFeed != address(0)) {
            feeds    = new IOracleRelayV2.FeedConfig[](2);
            feeds[0] = IOracleRelayV2.FeedConfig({
                feed:        chainlinkFeed,
                isChainlink: true,
                heartbeat:   feedHeartbeat,
                enabled:     true
            });
            feeds[1] = IOracleRelayV2.FeedConfig({
                feed:        fallbackFeed,
                isChainlink: false,
                heartbeat:   feedHeartbeat * 2,
                enabled:     true
            });
        } else {
            feeds    = new IOracleRelayV2.FeedConfig[](1);
            feeds[0] = IOracleRelayV2.FeedConfig({
                feed:        chainlinkFeed,
                isChainlink: true,
                heartbeat:   feedHeartbeat,
                enabled:     true
            });
        }
        OracleRelayV2 oracleV2 = new OracleRelayV2(
            feeds, maxDevBps, sequencerFeed, seqGrace, multisig
        );
        oracle = address(oracleV2);

        // ------------------------------------------------------------------ 2. Registry
        // Deployer EOA is initial admin so we can call addMarket + setEngine here.
        // Admin is proposed to multisig at the end of this script.
        AuraMarketRegistry reg = new AuraMarketRegistry(msg.sender);
        registry = address(reg);

        reg.addMarket(
            collateralVault,
            oracle,
            ltvBps,
            liqBps,
            liqPenBps,
            0,     // supplyCap  (uncapped; configure via Safe after deploy)
            0,     // borrowCap  (uncapped)
            false, // isIsolated
            0      // isolatedBorrowCap
        );

        // ------------------------------------------------------------------ 3. Engine
        AuraEngine implementation = new AuraEngine();
        bytes memory initData = abi.encodeCall(
            AuraEngine.initialize,
            (usdc, registry, timelockDelay, timelockDelay)
        );
        AuraProxy proxyContract = new AuraProxy(address(implementation), initData);
        proxy = address(proxyContract);

        // Wire engine into registry
        reg.setEngine(proxy);

        // ------------------------------------------------------------------ 4. Propose admin to multisig
        // Two-step admin transfer: deployer proposes, multisig must call acceptAdmin().
        AuraEngine(proxy).proposeAdmin(multisig);
        reg.proposeAdmin(multisig);

        vm.stopBroadcast();

        // ------------------------------------------------------------------ Log
        console.log("=== Aura Protocol Multisig Deployment ===");
        console.log("AURA_ENGINE_PROXY=%s",     proxy);
        console.log("AURA_REGISTRY=%s",          registry);
        console.log("ORACLE_RELAY_V2=%s",        oracle);
        console.log("MULTISIG=%s",               multisig);
        console.log("");
        console.log(unicode"=== ACTION REQUIRED \u2014 execute from Gnosis Safe ===");
        console.log("1. engine.acceptAdmin()   target=%s  data=0x0e18b681", proxy);
        console.log("2. registry.acceptAdmin() target=%s  data=0x0e18b681", registry);
        console.log("Until acceptAdmin() is called the deployer EOA remains admin.");
    }
}
