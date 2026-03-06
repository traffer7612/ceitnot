// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test }                    from "forge-std/Test.sol";
import { AuraEngine }              from "../src/AuraEngine.sol";
import { AuraProxy }               from "../src/AuraProxy.sol";
import { AuraMarketRegistry }      from "../src/AuraMarketRegistry.sol";
import { IERC3156FlashBorrower }   from "../src/interfaces/IERC3156FlashBorrower.sol";
import { MockERC20 }               from "./mocks/MockERC20.sol";
import { MockVault4626 }           from "./mocks/MockVault4626.sol";
import { MockOracle }              from "./mocks/MockOracle.sol";
import { MockFlashBorrower }       from "./mocks/MockFlashBorrower.sol";
import { MockFlashBorrowerBad }    from "./mocks/MockFlashBorrower.sol";
import { MockFlashBorrowerWrongReturn } from "./mocks/MockFlashBorrower.sol";

contract FlashLoanTest is Test {
    AuraEngine         public engine;
    AuraProxy          public proxy;
    AuraMarketRegistry public registry;
    MockERC20          public debtToken;
    MockERC20          public assetToken;
    MockVault4626      public vault;
    MockOracle         public oracle;

    MockFlashBorrower            public borrower;
    MockFlashBorrowerBad         public borrowerBad;
    MockFlashBorrowerWrongReturn public borrowerWrong;

    address public admin = address(this);
    address public alice = address(0xA11CE);

    uint256 constant WAD        = 1e18;
    uint256 constant MARKET_ID  = 0;
    uint256 constant POOL_SIZE  = 1_000_000 * WAD; // debt tokens in engine
    uint16  constant FEE_BPS    = 9;               // 0.09% like Aave

    // Mirror events
    event FlashLoan(address indexed receiver, address indexed token, uint256 amount, uint256 fee);
    event FlashLoanFeeUpdated(uint16 feeBps);
    event FlashLoanReservesWithdrawn(address indexed to, uint256 amount);

    function setUp() public {
        assetToken = new MockERC20("Wrapped stETH", "wstETH", 18);
        debtToken  = new MockERC20("USD Coin", "USDC", 18);
        vault      = new MockVault4626(address(assetToken), "Aura wstETH Vault", "wstETH");
        oracle     = new MockOracle();

        registry = new AuraMarketRegistry(admin);
        registry.addMarket(
            address(vault), address(oracle),
            uint16(8000), uint16(8500), uint16(500),
            0, 0, false, 0
        );

        AuraEngine impl = new AuraEngine();
        bytes memory initData = abi.encodeCall(
            AuraEngine.initialize,
            (address(debtToken), address(registry), uint256(1 days), uint256(2 days))
        );
        proxy  = new AuraProxy(address(impl), initData);
        engine = AuraEngine(address(proxy));

        registry.setEngine(address(proxy));

        // Fund engine with debt tokens (liquidity pool)
        debtToken.mint(address(proxy), POOL_SIZE);

        // Set flash loan fee to 9 bps (0.09%)
        engine.setFlashLoanFee(FEE_BPS);

        // Deploy borrowers (point to proxy address)
        borrower      = new MockFlashBorrower(address(proxy));
        borrowerBad   = new MockFlashBorrowerBad();
        borrowerWrong = new MockFlashBorrowerWrongReturn();

        // Fund borrowers so they can repay the fee
        debtToken.mint(address(borrower),      10_000 * WAD);
        debtToken.mint(address(borrowerWrong), 10_000 * WAD);
    }

    // ==================== maxFlashLoan / flashFee views ====================

    function test_maxFlashLoan_debtToken() public view {
        uint256 max = engine.maxFlashLoan(address(debtToken));
        assertEq(max, POOL_SIZE);
    }

    function test_maxFlashLoan_unknownToken_returnsZero() public view {
        assertEq(engine.maxFlashLoan(address(vault)), 0);
    }

    function test_flashFee_correct() public view {
        uint256 amount = 100_000 * WAD;
        uint256 fee = engine.flashFee(address(debtToken), amount);
        assertEq(fee, (amount * FEE_BPS) / 10_000);
    }

    function test_flashFee_wrongToken_reverts() public {
        vm.expectRevert(AuraEngine.Aura__FlashLoanUnsupportedToken.selector);
        engine.flashFee(address(vault), 100 * WAD);
    }

    // ==================== flashLoan — success paths ====================

    function test_flashLoan_success() public {
        uint256 amount = 100_000 * WAD;
        uint256 fee    = (amount * FEE_BPS) / 10_000;

        uint256 poolBefore = debtToken.balanceOf(address(proxy));

        vm.expectEmit(true, true, false, true);
        emit FlashLoan(address(borrower), address(debtToken), amount, fee);

        bool ok = engine.flashLoan(borrower, address(debtToken), amount, "");
        assertTrue(ok);

        // Pool balance increased by fee
        assertEq(debtToken.balanceOf(address(proxy)), poolBefore + fee);
        // Reserves tracked
        assertEq(engine.getFlashLoanReserves(), fee);
        // Borrower received and returned correctly (net: spent fee only)
        assertEq(borrower.lastAmount(), amount);
        assertEq(borrower.lastFee(),    fee);
    }

    function test_flashLoan_feeIsCorrect() public {
        uint256 amount = 500_000 * WAD;
        uint256 expectedFee = (amount * FEE_BPS) / 10_000;

        engine.flashLoan(borrower, address(debtToken), amount, "");
        assertEq(engine.getFlashLoanReserves(), expectedFee);
    }

    function test_flashLoan_zeroFee_noReservesAdded() public {
        engine.setFlashLoanFee(0);
        uint256 amount = 100_000 * WAD;

        engine.flashLoan(borrower, address(debtToken), amount, "");

        assertEq(engine.getFlashLoanReserves(), 0);
    }

    function test_flashLoan_reservesGrow_multipleLoan() public {
        uint256 amount = 100_000 * WAD;
        uint256 fee    = (amount * FEE_BPS) / 10_000;

        engine.flashLoan(borrower, address(debtToken), amount, "");
        // Refund borrower for second loan fee
        debtToken.mint(address(borrower), fee);
        engine.flashLoan(borrower, address(debtToken), amount, "");

        assertEq(engine.getFlashLoanReserves(), fee * 2);
    }

    function test_flashLoan_dataPassedThrough() public {
        bytes memory payload = abi.encode(uint256(42), address(alice));
        engine.flashLoan(borrower, address(debtToken), 1 * WAD, payload);
        assertEq(borrower.lastData(), payload);
    }

    // ==================== flashLoan — revert paths ====================

    function test_flashLoan_wrongToken_reverts() public {
        vm.expectRevert(AuraEngine.Aura__FlashLoanUnsupportedToken.selector);
        engine.flashLoan(borrower, address(vault), 100 * WAD, "");
    }

    function test_flashLoan_zeroAmount_reverts() public {
        vm.expectRevert(AuraEngine.Aura__ZeroAmount.selector);
        engine.flashLoan(borrower, address(debtToken), 0, "");
    }

    function test_flashLoan_exceedsBalance_reverts() public {
        uint256 tooBig = POOL_SIZE + 1;
        vm.expectRevert(AuraEngine.Aura__FlashLoanExceedsBalance.selector);
        engine.flashLoan(borrower, address(debtToken), tooBig, "");
    }

    function test_flashLoan_repayFails_reverts() public {
        // borrowerBad doesn't approve repayment — transferFrom will underflow
        vm.expectRevert();
        engine.flashLoan(borrowerBad, address(debtToken), 100 * WAD, "");
    }

    function test_flashLoan_wrongCallbackReturn_reverts() public {
        vm.expectRevert(AuraEngine.Aura__FlashLoanCallbackFailed.selector);
        engine.flashLoan(borrowerWrong, address(debtToken), 100 * WAD, "");
    }

    // ==================== Withdraw reserves ====================

    function test_withdrawFlashLoanReserves_success() public {
        uint256 amount = 100_000 * WAD;
        uint256 fee    = (amount * FEE_BPS) / 10_000;
        engine.flashLoan(borrower, address(debtToken), amount, "");

        uint256 aliceBefore = debtToken.balanceOf(alice);

        vm.expectEmit(true, false, false, true);
        emit FlashLoanReservesWithdrawn(alice, fee);
        engine.withdrawFlashLoanReserves(alice, fee);

        assertEq(debtToken.balanceOf(alice), aliceBefore + fee);
        assertEq(engine.getFlashLoanReserves(), 0);
    }

    function test_withdrawFlashLoanReserves_nonAdmin_reverts() public {
        uint256 amount = 100_000 * WAD;
        engine.flashLoan(borrower, address(debtToken), amount, "");

        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.withdrawFlashLoanReserves(alice, 1 * WAD);
    }

    function test_withdrawFlashLoanReserves_exceedsReserves_reverts() public {
        vm.expectRevert(AuraEngine.Aura__InsufficientReserves.selector);
        engine.withdrawFlashLoanReserves(alice, 1 * WAD);
    }

    // ==================== setFlashLoanFee ====================

    function test_setFlashLoanFee_emitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit FlashLoanFeeUpdated(50);
        engine.setFlashLoanFee(50);
        assertEq(engine.flashFee(address(debtToken), 10_000), 50);
    }

    function test_setFlashLoanFee_nonAdmin_reverts() public {
        vm.prank(alice);
        vm.expectRevert(AuraEngine.Aura__Unauthorized.selector);
        engine.setFlashLoanFee(100);
    }
}
