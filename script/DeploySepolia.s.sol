// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script } from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";
import { AuraEngine }         from "../src/AuraEngine.sol";
import { AuraProxy }          from "../src/AuraProxy.sol";
import { AuraMarketRegistry } from "../src/AuraMarketRegistry.sol";
import { OracleRelay }        from "../src/OracleRelay.sol";
import { MockERC20 }          from "../test/mocks/MockERC20.sol";
import { MockVault4626 }      from "../test/mocks/MockVault4626.sol";

/**
 * Sepolia deploy: mock wstETH + mock USDC + REAL Chainlink ETH/USD oracle.
 * Tests oracle normalization (1e8 → 1e18) with a live price feed.
 *
 * Usage:
 *   forge script script/DeploySepolia.s.sol:DeploySepolia \
 *     --rpc-url https://ethereum-sepolia.publicnode.com \
 *     --broadcast --private-key $PRIVATE_KEY
 */
contract DeploySepolia is Script {
    address constant CHAINLINK_ETH_USD = 0x694AA1769357215DE4FAC081bf1f309aDC325306;

    function run() external returns (address proxy) {
        vm.startBroadcast();

        MockERC20     assetToken = new MockERC20("Wrapped stETH", "wstETH", 18);
        MockERC20     debtToken  = new MockERC20("USD Coin", "USDC", 18);
        MockVault4626 vault      = new MockVault4626(address(assetToken), "Aura wstETH Vault", "wstETH");

        OracleRelay oracle = new OracleRelay(CHAINLINK_ETH_USD, address(0), 0);

        // Registry + first market
        AuraMarketRegistry registry = new AuraMarketRegistry(msg.sender);
        registry.addMarket(
            address(vault),
            address(oracle),
            uint16(8000),
            uint16(8500),
            uint16(500),
            0, 0, false, 0
        );

        // Engine + Proxy
        AuraEngine implementation = new AuraEngine();
        bytes memory initData = abi.encodeCall(
            AuraEngine.initialize,
            (address(debtToken), address(registry), uint256(1 hours), uint256(2 days))
        );
        AuraProxy proxyContract = new AuraProxy(address(implementation), initData);
        proxy = address(proxyContract);
        registry.setEngine(proxy);

        debtToken.mint(proxy, 1_000_000 * 1e18);
        assetToken.mint(msg.sender, 10_000 * 1e18);

        vm.stopBroadcast();

        console.log("AURA_ENGINE_ADDRESS=%s", proxy);
        console.log("AURA_REGISTRY_ADDRESS=%s", address(registry));
        console.log("ORACLE_RELAY_ADDRESS=%s", address(oracle));
        console.log("AURA_VAULT_4626_ADDRESS=%s", address(vault));
        console.log("MOCK_ASSET_ADDRESS=%s", address(assetToken));
        console.log("MOCK_DEBT_ADDRESS=%s", address(debtToken));
        console.log("CHAINLINK_FEED=%s", CHAINLINK_ETH_USD);
    }
}
