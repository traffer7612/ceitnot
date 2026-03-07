// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script }  from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";

interface IUpgradeable {
    function upgradeToAndCall(address newImplementation, bytes calldata data) external payable;
    function admin() external view returns (address);
}

/**
 * @title  UpgradeEngine
 * @notice UUPS upgrade script for AuraEngine.
 *         Run with DRY_RUN=true to print Safe calldata without broadcasting.
 *         Run without DRY_RUN (or DRY_RUN=false) to broadcast the upgrade directly.
 *
 * Required env vars:
 *   ENGINE_PROXY        - AuraEngine proxy address
 *   NEW_IMPLEMENTATION  - Address of the already-deployed new AuraEngine implementation
 *
 * Optional env vars:
 *   UPGRADE_CALLDATA    - Hex-encoded calldata for post-upgrade initializer (default: 0x)
 *   DRY_RUN             - If "true", only print calldata; do not broadcast (default: false)
 *
 * Pre-conditions (checked in UPGRADE_CHECKLIST.md):
 *   1. script/CheckStorageLayout.sh must exit 0
 *   2. forge test must be green against the new implementation
 *   3. TimelockController delay must have elapsed if upgrade is governance-gated
 *
 * ============================================================================
 * Safe execution flow (when DRY_RUN=true):
 *   forge script script/UpgradeEngine.s.sol --rpc-url $RPC_URL -vv
 *   Copy printed calldata → Gnosis Safe Transaction Builder
 *   Collect required signatures → Execute
 * ============================================================================
 */
contract UpgradeEngine is Script {
    // EIP-1967 implementation slot (for post-upgrade verification)
    bytes32 private constant IMPL_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    function run() external {
        address proxy      = vm.envAddress("ENGINE_PROXY");
        address newImpl    = vm.envAddress("NEW_IMPLEMENTATION");
        bytes   memory cd  = vm.envOr("UPGRADE_CALLDATA", new bytes(0));
        bool    dryRun     = vm.envOr("DRY_RUN", false);

        require(proxy   != address(0), "UpgradeEngine: ENGINE_PROXY required");
        require(newImpl != address(0), "UpgradeEngine: NEW_IMPLEMENTATION required");
        require(newImpl.code.length > 0, "UpgradeEngine: NEW_IMPLEMENTATION has no code");

        IUpgradeable engine = IUpgradeable(proxy);
        address currentAdmin = engine.admin();

        console.log("=== AuraEngine Upgrade ===");
        console.log("Proxy:              %s", proxy);
        console.log("New implementation: %s", newImpl);
        console.log("Current admin:      %s", currentAdmin);
        console.log("Post-upgrade data:  %s", cd.length == 0 ? "(none)" : "provided");

        bytes memory upgradeCalldata = abi.encodeCall(
            IUpgradeable.upgradeToAndCall, (newImpl, cd)
        );

        if (dryRun) {
            // Print calldata for manual Safe execution — do NOT broadcast
            console.log(unicode"\n=== DRY RUN \u2014 Safe Transaction Builder ===");
            console.log("To:    %s", proxy);
            console.log("Value: 0");
            console.log("Data (upgradeToAndCall calldata):");
            console.logBytes(upgradeCalldata);
            console.log("\nAdd the above transaction to the Gnosis Safe,");
            console.log("collect %s / N signatures, then execute.", currentAdmin);
            return;
        }

        // Live broadcast — caller must be the engine admin (EOA or Safe via --sender)
        vm.startBroadcast();
        engine.upgradeToAndCall(newImpl, cd);
        vm.stopBroadcast();

        // Post-upgrade verification: read EIP-1967 slot directly
        bytes32 implSlotValue = vm.load(proxy, IMPL_SLOT);
        address implNow = address(uint160(uint256(implSlotValue)));
        require(
            implNow == newImpl,
            "UpgradeEngine: post-upgrade impl slot mismatch"
        );

        console.log("\n=== Upgrade successful ===");
        console.log("Implementation slot now points to: %s", implNow);
    }
}
