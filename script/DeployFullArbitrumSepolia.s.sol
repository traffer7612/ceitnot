// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script }  from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";

import { CeitnotEngine }         from "../src/CeitnotEngine.sol";
import { CeitnotProxy }          from "../src/CeitnotProxy.sol";
import { CeitnotMarketRegistry } from "../src/CeitnotMarketRegistry.sol";
import { OracleRelay }           from "../src/OracleRelay.sol";
import { CeitnotUSD }            from "../src/CeitnotUSD.sol";
import { CeitnotPSM }            from "../src/CeitnotPSM.sol";
import { CeitnotRouter }         from "../src/CeitnotRouter.sol";
import { CeitnotTreasury }       from "../src/CeitnotTreasury.sol";
import { CeitnotToken }          from "../src/governance/CeitnotToken.sol";
import { VeCeitnot }             from "../src/governance/VeCeitnot.sol";
import { CeitnotGovernor }       from "../src/governance/CeitnotGovernor.sol";
import { MockERC20 }             from "../test/mocks/MockERC20.sol";
import { MockVault4626 }         from "../test/mocks/MockVault4626.sol";

import { IVotes }              from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import { TimelockController }  from "@openzeppelin/contracts/governance/TimelockController.sol";

/// @dev Minimal Chainlink V3 Aggregator mock (8 decimals) so OracleRelay works without a live feed on testnet.
contract MockChainlinkV3Feed {
    int256  public answer;
    uint256 public updatedAt;
    uint8   public dec;

    constructor(int256 answer_, uint8 decimals_, uint256 updatedAt_) {
        answer    = answer_;
        dec       = decimals_;
        updatedAt = updatedAt_;
    }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (1, answer, 0, updatedAt, 1);
    }

    function decimals() external view returns (uint8) { return dec; }
}

/**
 * @title  DeployFullArbitrumSepolia
 * @notice Full Ceitnot stack on **Arbitrum Sepolia** (chainId 421614):
 *         - Mock wstETH + mock USDC + mock Chainlink ETH/USD (OracleRelay)
 *         - CDP engine (proxy), aUSD, PSM, router, treasury
 *         - CeitnotToken + VeCeitnot + TimelockController + CeitnotGovernor
 *
 * @dev    Arbitrum Sepolia does not mirror mainnet token addresses; this script is self-contained like
 *         `DeployFullSepolia.s.sol` on Ethereum Sepolia.
 *
 * Prerequisites:
 *   - Deployer wallet funded with **Arbitrum Sepolia ETH** (e.g. https://faucet.quicknode.com/arbitrum/sepolia)
 *
 * Usage:
 *   forge script script/DeployFullArbitrumSepolia.s.sol:DeployFullArbitrumSepolia \
 *     --rpc-url https://sepolia-rollup.arbitrum.io/rpc \
 *     --broadcast --private-key $DEPLOYER_PRIVATE_KEY
 *
 * Optional env:
 *   MOCK_ETH_USD_8DEC — int256, Chainlink-style 8-decimal USD price for ETH (default: 3000e8)
 */
contract DeployFullArbitrumSepolia is Script {
    function run() external {
        int256 mockEthUsd = int256(uint256(vm.envOr("MOCK_ETH_USD_8DEC", uint256(3000 * 1e8))));

        vm.startBroadcast();

        address deployer = msg.sender;

        MockChainlinkV3Feed clFeed = new MockChainlinkV3Feed(mockEthUsd, 8, block.timestamp);
        OracleRelay   oracle = new OracleRelay(address(clFeed), address(0), 0);
        MockERC20     wstETH = new MockERC20("Wrapped stETH", "wstETH", 18);
        MockERC20     usdc   = new MockERC20("USD Coin", "USDC", 18);
        MockVault4626 vault  = new MockVault4626(address(wstETH), "Ceitnot wstETH Vault", "aWstETH");

        CeitnotUSD ausd = new CeitnotUSD(deployer);

        CeitnotMarketRegistry registry = new CeitnotMarketRegistry(deployer);
        uint256 marketId = registry.addMarket(
            address(vault),
            address(oracle),
            uint16(8000),
            uint16(8500),
            uint16(500),
            0,
            0,
            false,
            0
        );

        CeitnotEngine implementation = new CeitnotEngine();
        bytes memory initData = abi.encodeCall(
            CeitnotEngine.initialize,
            (address(ausd), address(registry), 1 hours, 2 days)
        );
        CeitnotProxy proxyContract = new CeitnotProxy(address(implementation), initData);
        address engine = address(proxyContract);

        registry.setEngine(engine);
        CeitnotEngine(engine).setMintableDebtToken(true);
        ausd.addMinter(engine);

        CeitnotPSM psm = new CeitnotPSM(address(ausd), address(usdc), deployer, uint16(10), uint16(10));
        ausd.addMinter(address(psm));
        usdc.mint(address(psm), 1_000_000 * 1e18);

        CeitnotRouter   router   = new CeitnotRouter(engine, address(ausd));
        CeitnotTreasury treasury = new CeitnotTreasury(deployer);

        CeitnotToken govToken = new CeitnotToken(deployer);
        govToken.mint(deployer, 10_000_000 * 1e18);

        VeCeitnot veLock = new VeCeitnot(address(govToken), deployer, address(ausd));

        address[] memory proposers = new address[](1);
        proposers[0] = deployer;
        address[] memory executors = new address[](1);
        executors[0] = address(0);

        TimelockController timelock = new TimelockController(1 days, proposers, executors, deployer);
        CeitnotGovernor governor = new CeitnotGovernor(IVotes(address(veLock)), timelock);

        // Governor must schedule on timelock; `queue()` calls `scheduleBatch` as the governor contract.
        timelock.grantRole(timelock.PROPOSER_ROLE(), address(governor));
        timelock.grantRole(timelock.CANCELLER_ROLE(), address(governor));

        wstETH.mint(deployer, 100_000 * 1e18);
        usdc.mint(deployer, 100_000 * 1e18);

        vm.stopBroadcast();

        console.log("=== FULL STACK - ARBITRUM SEPOLIA (421614) ===");
        console.log("");
        console.log("--- Core ---");
        console.log("ENGINE (proxy):     %s", engine);
        console.log("REGISTRY:           %s", address(registry));
        console.log("ORACLE (relay):     %s", address(oracle));
        console.log("MOCK CL FEED:       %s", address(clFeed));
        console.log("VAULT (mock):       %s", address(vault));
        console.log("MOCK wstETH:        %s", address(wstETH));
        console.log("");
        console.log("--- CDP ---");
        console.log("AUSD:               %s", address(ausd));
        console.log("PSM:                %s", address(psm));
        console.log("MOCK USDC:          %s", address(usdc));
        console.log("");
        console.log("--- DX ---");
        console.log("ROUTER:             %s", address(router));
        console.log("TREASURY:           %s", address(treasury));
        console.log("");
        console.log("--- Governance ---");
        console.log("CEITNOT_TOKEN:      %s", address(govToken));
        console.log("CEITNOT_VE:         %s", address(veLock));
        console.log("GOVERNOR:           %s", address(governor));
        console.log("TIMELOCK:           %s", address(timelock));
        console.log("");
        console.log("Market ID:          %s", marketId);
        console.log("MOCK_ETH_USD_8DEC:  %s", uint256(mockEthUsd));
        console.log("");
        console.log("Next: set VITE_CHAIN_ID=421614 and VITE_* addresses; verify on https://sepolia.arbiscan.io");
    }
}
