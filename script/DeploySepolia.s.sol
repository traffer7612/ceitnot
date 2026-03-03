// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script } from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";
import { AuraEngine } from "../src/AuraEngine.sol";
import { AuraProxy } from "../src/AuraProxy.sol";
import { OracleRelay } from "../src/OracleRelay.sol";
import { MockERC20 } from "../test/mocks/MockERC20.sol";
import { MockVault4626 } from "../test/mocks/MockVault4626.sol";

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
    // Chainlink ETH/USD on Sepolia (8 decimals)
    address constant CHAINLINK_ETH_USD = 0x694AA1769357215DE4FAC081bf1f309aDC325306;

    function run() external returns (address proxy) {
        vm.startBroadcast();

        // 1. Mock tokens (no real wstETH/USDC on Sepolia)
        MockERC20 assetToken = new MockERC20("Wrapped stETH", "wstETH", 18);
        MockERC20 debtToken  = new MockERC20("USD Coin", "USDC", 18);
        MockVault4626 vault  = new MockVault4626(address(assetToken), "Aura wstETH Vault", "wstETH");

        // 2. OracleRelay with REAL Chainlink feed (no fallback, no TWAP)
        OracleRelay oracle = new OracleRelay(CHAINLINK_ETH_USD, address(0), 0);

        // 3. Engine + Proxy
        AuraEngine implementation = new AuraEngine();
        bytes memory initData = abi.encodeCall(
            AuraEngine.initialize,
            (
                address(vault),
                address(debtToken),
                address(oracle),
                uint16(8000),   // ltvBps 80%
                uint16(8500),   // liquidationThresholdBps 85%
                uint16(500),    // liquidationPenaltyBps 5%
                uint256(1 hours),
                uint256(2 days)
            )
        );
        AuraProxy proxyContract = new AuraProxy(address(implementation), initData);
        proxy = address(proxyContract);

        // 4. Seed: mint debt tokens to engine, mint asset to deployer
        debtToken.mint(proxy, 1_000_000 * 1e18);
        assetToken.mint(msg.sender, 10_000 * 1e18);

        vm.stopBroadcast();

        console.log("AURA_ENGINE_ADDRESS=%s", proxy);
        console.log("ORACLE_RELAY_ADDRESS=%s", address(oracle));
        console.log("AURA_VAULT_4626_ADDRESS=%s", address(vault));
        console.log("MOCK_ASSET_ADDRESS=%s", address(assetToken));
        console.log("MOCK_DEBT_ADDRESS=%s", address(debtToken));
        console.log("CHAINLINK_FEED=%s", CHAINLINK_ETH_USD);
    }
}
