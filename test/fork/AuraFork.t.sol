// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test }               from "forge-std/Test.sol";
import { AuraEngine }         from "../../src/AuraEngine.sol";
import { AuraProxy }          from "../../src/AuraProxy.sol";
import { AuraMarketRegistry } from "../../src/AuraMarketRegistry.sol";
import { OracleRelayV2 }      from "../../src/OracleRelayV2.sol";
import { IOracleRelayV2 }     from "../../src/interfaces/IOracleRelayV2.sol";
import { MockERC20 }          from "../mocks/MockERC20.sol";
import { MockVault4626 }      from "../mocks/MockVault4626.sol";
import { MockOracle }         from "../mocks/MockOracle.sol";
import { MockFlashBorrower }  from "../mocks/MockFlashBorrower.sol";

/**
 * @title  AuraForkTest
 * @notice Fork tests against Arbitrum mainnet.
 *         All tests skip silently when ARBITRUM_RPC_URL is not configured.
 *
 * Running locally with a live RPC:
 *   $Env:ARBITRUM_RPC_URL="https://arb-mainnet.g.alchemy.com/v2/..."
 *   forge test --match-contract AuraForkTest -vv
 *
 * Chainlink feeds used (Arbitrum One):
 *   ETH/USD  — 0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612
 *
 * Scope:
 *   1. Chainlink price live     — OracleRelayV2 can read a real Chainlink feed.
 *   2. Deposit + borrow         — Full deposit/borrow flow against a real-price oracle.
 *   3. Liquidation sim          — Price manipulation triggers liquidation on forked state.
 *   4. Flash loan round-trip    — Flash loan + full repay on forked chain.
 */
contract AuraForkTest is Test {

    // ---- Chainlink feed addresses on Arbitrum One
    address constant ARBI_ETH_USD = 0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612;

    // ---- Constants
    uint256 constant WAD       = 1e18;
    uint256 constant MARKET_ID = 0;

    // ---- Actors
    address public alice = address(0xA11CE);
    address public bob   = address(0xB0B);
    address public admin = address(this);

    // ---- Shared state populated in _forkSetup()
    AuraEngine         public engine;
    AuraProxy          public proxy;
    AuraMarketRegistry public registry;
    MockERC20          public assetToken;
    MockERC20          public debtToken;
    MockVault4626      public vault;

    // ---- Internal: skip test when no Arbitrum RPC is configured

    /// @dev Returns true if ARBITRUM_RPC_URL is set in the environment.
    function _hasArbitrumRpc() internal returns (bool) {
        string memory rpc = vm.envOr("ARBITRUM_RPC_URL", string(""));
        return bytes(rpc).length > 0;
    }

    /**
     * @dev Fork Arbitrum and deploy a fresh Aura protocol instance.
     *      Uses a real Chainlink ETH/USD feed as the market oracle so that
     *      prices reflect on-chain reality rather than a hardcoded mock.
     */
    function _forkSetup(bool useRealOracle) internal {
        // Create fork; the "arbitrum" alias is mapped in foundry.toml
        vm.createSelectFork("arbitrum");

        // Deploy collateral and debt mocks (these live in the forked EVM but are
        // freshly deployed — they don't conflict with any existing contracts)
        assetToken = new MockERC20("wstETH", "wstETH", 18);
        debtToken  = new MockERC20("aUSD",   "aUSD",   18);
        vault      = new MockVault4626(address(assetToken), "aVault", "aV");

        address oracleAddr;
        if (useRealOracle) {
            // Build OracleRelayV2 pointing at real Chainlink ETH/USD on Arbitrum
            IOracleRelayV2.FeedConfig[] memory feeds = new IOracleRelayV2.FeedConfig[](1);
            feeds[0] = IOracleRelayV2.FeedConfig({
                feed:        ARBI_ETH_USD,
                isChainlink: true,
                heartbeat:   86_400,  // 24 h; Arbitrum ETH/USD heartbeat is 24h
                enabled:     true
            });
            OracleRelayV2 oracleV2 = new OracleRelayV2(
                feeds,
                0,               // maxDeviationBps = 0 (disabled)
                address(0),      // no sequencer feed for simplicity
                0,               // no grace period
                admin
            );
            oracleAddr = address(oracleV2);
        } else {
            MockOracle mockOracle = new MockOracle();
            oracleAddr = address(mockOracle);
        }

        registry = new AuraMarketRegistry(admin);
        registry.addMarket(
            address(vault),
            oracleAddr,
            uint16(8000),  // ltvBps
            uint16(8500),  // liquidationThresholdBps
            uint16(500),   // liquidationPenaltyBps
            0, 0, false, 0
        );

        AuraEngine impl = new AuraEngine();
        bytes memory init = abi.encodeCall(
            AuraEngine.initialize,
            (address(debtToken), address(registry), 1 days, 2 days)
        );
        proxy  = new AuraProxy(address(impl), init);
        engine = AuraEngine(address(proxy));
        registry.setEngine(address(proxy));
    }

    // ---- Fund helper

    function _fundActor(address user, uint256 shares) internal {
        assetToken.mint(user, shares);
        vm.startPrank(user);
        assetToken.approve(address(vault), type(uint256).max);
        vault.deposit(shares, user);
        vault.approve(address(proxy), type(uint256).max);
        debtToken.approve(address(proxy), type(uint256).max);
        vm.stopPrank();
    }

    // =========================================================================
    // Test 1: Real Chainlink ETH/USD feed returns a positive, fresh price
    // =========================================================================

    /**
     * @notice Validate that OracleRelayV2 can read a live Chainlink feed and
     *         returns a non-zero, non-stale price when forking Arbitrum.
     */
    function test_fork_chainlinkPriceNonZero() public {
        if (!_hasArbitrumRpc()) { vm.skip(true); return; }

        _forkSetup(true); // deploy with real Chainlink oracle

        address oracleAddr = registry.getMarket(MARKET_ID).oracle;
        (uint256 price, uint256 ts) = OracleRelayV2(oracleAddr).getLatestPrice();

        assertGt(price, 0,              "Chainlink price is zero");
        assertGt(ts,    0,              "Chainlink timestamp is zero");
        assertGt(price, 500  * WAD,     "ETH/USD below $500 - sanity check");
        assertLt(price, 100_000 * WAD,  "ETH/USD above $100k - sanity check");
        assertLe(block.timestamp - ts,  86_400, "Price is stale (>24h old)");
    }

    // =========================================================================
    // Test 2: Deposit + borrow using the real ETH/USD price
    // =========================================================================

    /**
     * @notice Full deposit + borrow cycle with real on-chain price data.
     *         Borrows at 50% of the maximum LTV to remain safely collateralised
     *         even if the ETH price fluctuates slightly from block to block.
     */
    function test_fork_depositAndBorrowWithRealPrice() public {
        if (!_hasArbitrumRpc()) { vm.skip(true); return; }

        _forkSetup(true);

        uint256 depositShares = 1 * WAD;  // 1 vault share ≈ 1 wstETH

        // Read the real ETH/USD price to calculate a safe borrow amount
        address oracleAddr = registry.getMarket(MARKET_ID).oracle;
        (uint256 ethPrice, ) = OracleRelayV2(oracleAddr).getLatestPrice();

        // maxBorrow = depositShares * ethPrice * 80% / WAD
        // safeBorrow = maxBorrow / 2 (50% of max → large safety buffer)
        uint256 maxBorrow  = (depositShares * ethPrice / WAD) * 8000 / 10_000;
        uint256 safeBorrow = maxBorrow / 2;
        require(safeBorrow > 0, "safeBorrow rounded to zero");

        // Fund engine with enough debt tokens
        debtToken.mint(address(proxy), safeBorrow * 10);

        // Fund alice
        _fundActor(alice, depositShares);

        // Deposit
        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, depositShares);

        // Borrow (different block)
        vm.roll(block.number + 1);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, safeBorrow);

        // Health factor must be > 1 WAD
        assertGt(engine.getHealthFactor(alice), WAD, "HF should be > 1 after safe borrow");
        assertEq(engine.getPositionCollateralShares(alice, MARKET_ID), depositShares);
        assertEq(engine.getPositionDebt(alice, MARKET_ID), safeBorrow);
    }

    // =========================================================================
    // Test 3: Price drop makes position liquidatable; liquidation succeeds
    // =========================================================================

    /**
     * @notice Simulate a severe oracle price crash that puts a position below
     *         the liquidation threshold, then verify a liquidator can liquidate.
     *         Uses a mock oracle so the price crash is deterministic.
     */
    function test_fork_liquidationAfterPriceDrop() public {
        if (!_hasArbitrumRpc()) { vm.skip(true); return; }

        // Use mock oracle (controlled price) for deterministic liquidation
        _forkSetup(false);

        MockOracle mockOracle = MockOracle(registry.getMarket(MARKET_ID).oracle);
        // Initial price: $2000
        mockOracle.setPrice(2000 * WAD);

        uint256 depositShares = 100 * WAD;
        uint256 borrowAmt     = 150 * WAD;  // well within 80% of $2000 * 100 = $160,000

        debtToken.mint(address(proxy), 10_000_000 * WAD);
        debtToken.mint(bob, 10_000_000 * WAD);  // liquidator funds

        _fundActor(alice, depositShares);

        vm.prank(alice);
        engine.depositCollateral(alice, MARKET_ID, depositShares);
        vm.roll(block.number + 1);
        vm.prank(alice);
        engine.borrow(alice, MARKET_ID, borrowAmt);

        assertGt(engine.getHealthFactor(alice), WAD, "position should be healthy initially");

        // Crash the price: $2000 → $1 — alice is massively underwater
        mockOracle.setPrice(1 * WAD);

        assertLt(engine.getHealthFactor(alice), WAD, "position should be liquidatable after crash");

        // Bob liquidates alice
        vm.roll(block.number + 1);
        vm.prank(bob);
        debtToken.approve(address(proxy), type(uint256).max);
        engine.liquidate(alice, MARKET_ID, borrowAmt);

        // After liquidation, alice's debt should be reduced (or cleared)
        assertLt(
            engine.getPositionDebt(alice, MARKET_ID),
            borrowAmt,
            "debt not reduced after liquidation"
        );
    }

    // =========================================================================
    // Test 4: Flash loan round-trip on forked chain
    // =========================================================================

    /**
     * @notice Verify that an ERC-3156 flash loan executes and repays correctly
     *         in a forked environment, confirming the protocol stack works
     *         end-to-end on a live chain state.
     */
    function test_fork_flashLoanRoundTrip() public {
        if (!_hasArbitrumRpc()) { vm.skip(true); return; }

        _forkSetup(false);

        uint256 flashAmount = 1_000 * WAD;
        debtToken.mint(address(proxy), flashAmount * 2);  // give engine sufficient liquidity

        // Deploy a well-behaved flash borrower
        MockFlashBorrower borrower = new MockFlashBorrower(address(proxy));

        // Seed borrower with enough to repay fee (fee = 0 since flashLoanFeeBps = 0 by default)
        // No extra funding needed when fee is 0

        uint256 engineBalBefore = debtToken.balanceOf(address(proxy));

        engine.flashLoan(borrower, address(debtToken), flashAmount, "");

        uint256 engineBalAfter = debtToken.balanceOf(address(proxy));

        // Engine balance unchanged after a fee-less flash loan
        assertEq(engineBalAfter, engineBalBefore, "engine balance changed after zero-fee flash loan");
        assertEq(borrower.lastAmount(), flashAmount, "borrower received wrong amount");
        assertEq(borrower.lastFee(),    0,           "unexpected fee on zero-fee flash loan");
    }
}
