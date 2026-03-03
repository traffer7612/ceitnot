// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script } from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";
import { AuraEngine } from "../src/AuraEngine.sol";
import { AuraProxy } from "../src/AuraProxy.sol";
import { MockERC20 } from "../test/mocks/MockERC20.sol";
import { MockVault4626 } from "../test/mocks/MockVault4626.sol";
import { MockOracle } from "../test/mocks/MockOracle.sol";

contract DeployScript is Script {
    function run() external returns (address proxy) {
        vm.startBroadcast();

        MockERC20 assetToken = new MockERC20("Wrapped stETH", "wstETH", 18);
        MockERC20 debtToken = new MockERC20("USD Coin", "USDC", 18);
        MockVault4626 collateralVault = new MockVault4626(address(assetToken), "Aura wstETH Vault", "wstETH");
        MockOracle oracle = new MockOracle();

        AuraEngine implementation = new AuraEngine();
        bytes memory initData = abi.encodeCall(
            AuraEngine.initialize,
            (
                address(collateralVault),
                address(debtToken),
                address(oracle),
                uint16(8000),
                uint16(8500),
                uint16(500),
                uint256(1 days),
                uint256(2 days)
            )
        );
        AuraProxy proxyContract = new AuraProxy(address(implementation), initData);
        proxy = address(proxyContract);

        debtToken.mint(proxy, 1_000_000 * 1e18);
        assetToken.mint(msg.sender, 10_000 * 1e18);

        vm.stopBroadcast();

        console.log("AURA_ENGINE_ADDRESS=%s", proxy);
        console.log("AURA_VAULT_4626_ADDRESS=%s", address(collateralVault));
        console.log("MOCK_ASSET_ADDRESS=%s", address(assetToken));
    }
}
