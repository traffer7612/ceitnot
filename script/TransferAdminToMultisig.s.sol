// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script }  from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";

interface IProposableAdmin {
    function admin() external view returns (address);
    function proposeAdmin(address newAdmin) external;
}

interface IOracleAdmin {
    function admin() external view returns (address);
    function setAdmin(address newAdmin) external;
}

/**
 * @title  TransferAdminToMultisig
 * @notice Migrates an existing Aura deployment from an EOA admin to a Gnosis Safe.
 *         Calls proposeAdmin() on the engine and registry so the Safe can finalise
 *         the transfer via acceptAdmin(). OracleRelayV2 uses a one-step setAdmin().
 *
 * Required env vars:
 *   ENGINE_PROXY       - AuraEngine proxy address
 *   REGISTRY_ADDRESS   - AuraMarketRegistry address
 *   MULTISIG_ADDRESS   - Gnosis Safe that will become admin
 *
 * Optional env vars:
 *   ORACLE_V2_ADDRESS  - OracleRelayV2 address (if omitted, oracle transfer is skipped)
 *
 * ============================================================================
 * POST-SCRIPT ACTIONS REQUIRED (execute from the Gnosis Safe):
 *   1. engine.acceptAdmin()    target=ENGINE_PROXY    data=0x0e18b681
 *   2. registry.acceptAdmin()  target=REGISTRY        data=0x0e18b681
 *   OracleRelayV2 admin is transferred immediately (one-step).
 * ============================================================================
 */
contract TransferAdminToMultisig is Script {
    function run() external {
        address engineProxy  = vm.envAddress("ENGINE_PROXY");
        address registryAddr = vm.envAddress("REGISTRY_ADDRESS");
        address multisig     = vm.envAddress("MULTISIG_ADDRESS");
        address oracleV2     = vm.envOr("ORACLE_V2_ADDRESS", address(0));

        require(engineProxy  != address(0), "TransferAdmin: ENGINE_PROXY required");
        require(registryAddr != address(0), "TransferAdmin: REGISTRY_ADDRESS required");
        require(multisig     != address(0), "TransferAdmin: MULTISIG_ADDRESS required");

        // Safety checks — ensure current admin is the broadcaster
        IProposableAdmin engine   = IProposableAdmin(engineProxy);
        IProposableAdmin registry = IProposableAdmin(registryAddr);

        address currentEngineAdmin   = engine.admin();
        address currentRegistryAdmin = registry.admin();

        console.log("Current engine admin:    %s", currentEngineAdmin);
        console.log("Current registry admin:  %s", currentRegistryAdmin);
        console.log("Proposing admin to Safe: %s", multisig);

        vm.startBroadcast();

        // Engine: two-step transfer (Safe must call acceptAdmin)
        engine.proposeAdmin(multisig);

        // Registry: two-step transfer (Safe must call acceptAdmin)
        registry.proposeAdmin(multisig);

        // OracleRelayV2: one-step transfer
        if (oracleV2 != address(0)) {
            IOracleAdmin(oracleV2).setAdmin(multisig);
            console.log("OracleRelayV2 admin transferred immediately to %s", multisig);
        }

        vm.stopBroadcast();

        // Print exact calldata for Safe transaction builder
        bytes memory acceptAdminData = abi.encodeWithSignature("acceptAdmin()");
        console.log("\n=== Safe Transaction Builder actions ===");
        console.log(unicode"TX 1 \u2014 Finalise engine admin:");
        console.log("  to:    %s", engineProxy);
        console.logBytes(acceptAdminData);
        console.log(unicode"TX 2 \u2014 Finalise registry admin:");
        console.log("  to:    %s", registryAddr);
        console.logBytes(acceptAdminData);
    }
}
