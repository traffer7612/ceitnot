// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test }         from "forge-std/Test.sol";
import { AuraTreasury } from "../src/AuraTreasury.sol";
import { MockERC20 }    from "./mocks/MockERC20.sol";

contract TreasuryTest is Test {
    AuraTreasury public treasury;
    MockERC20    public token;

    // Mirror events from AuraTreasury for vm.expectEmit
    event Deposited(address indexed token, address indexed from, uint256 amount);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);
    event Distributed(address indexed token, uint256 totalAmount, uint256 recipientCount);

    address public admin    = address(this);
    address public alice    = address(0xA11CE);
    address public bob      = address(0xB0B);
    address public charlie  = address(0xC0);

    uint256 constant WAD = 1e18;

    function setUp() public {
        token    = new MockERC20("Test Token", "TST", 18);
        treasury = new AuraTreasury(admin);

        // Fund admin (test contract) with tokens
        token.mint(admin, 1_000 * WAD);
        token.approve(address(treasury), type(uint256).max);
    }

    // ==================== Constructor ====================

    function test_constructor_setsAdmin() public view {
        assertEq(treasury.admin(), admin);
    }

    function test_constructor_zeroAdmin_reverts() public {
        vm.expectRevert(AuraTreasury.Treasury__InvalidParams.selector);
        new AuraTreasury(address(0));
    }

    // ==================== Deposit ====================

    function test_deposit_transfersTokensIn() public {
        uint256 amount = 100 * WAD;
        treasury.deposit(address(token), amount);

        assertEq(treasury.balanceOf(address(token)), amount);
    }

    function test_deposit_zeroAmount_reverts() public {
        vm.expectRevert(AuraTreasury.Treasury__InvalidParams.selector);
        treasury.deposit(address(token), 0);
    }

    function test_deposit_zeroToken_reverts() public {
        vm.expectRevert(AuraTreasury.Treasury__InvalidParams.selector);
        treasury.deposit(address(0), 100 * WAD);
    }

    function test_deposit_emitsEvent() public {
        uint256 amount = 50 * WAD;
        vm.expectEmit(true, true, false, true);
        emit Deposited(address(token), admin, amount);
        treasury.deposit(address(token), amount);
    }

    // ==================== Withdraw ====================

    function test_withdraw_sendsFundsToRecipient() public {
        uint256 deposit = 200 * WAD;
        uint256 withdraw = 80 * WAD;
        treasury.deposit(address(token), deposit);

        uint256 aliceBefore = token.balanceOf(alice);
        treasury.withdraw(address(token), withdraw, alice);

        assertEq(token.balanceOf(alice), aliceBefore + withdraw);
        assertEq(treasury.balanceOf(address(token)), deposit - withdraw);
    }

    function test_withdraw_nonAdmin_reverts() public {
        treasury.deposit(address(token), 100 * WAD);

        vm.prank(alice);
        vm.expectRevert(AuraTreasury.Treasury__Unauthorized.selector);
        treasury.withdraw(address(token), 50 * WAD, alice);
    }

    function test_withdraw_insufficientBalance_reverts() public {
        treasury.deposit(address(token), 50 * WAD);

        vm.expectRevert(AuraTreasury.Treasury__InsufficientBalance.selector);
        treasury.withdraw(address(token), 100 * WAD, alice);
    }

    function test_withdraw_zeroAmount_reverts() public {
        treasury.deposit(address(token), 100 * WAD);

        vm.expectRevert(AuraTreasury.Treasury__InvalidParams.selector);
        treasury.withdraw(address(token), 0, alice);
    }

    function test_withdraw_emitsEvent() public {
        uint256 amount = 60 * WAD;
        treasury.deposit(address(token), amount);

        vm.expectEmit(true, true, false, true);
        emit Withdrawn(address(token), alice, amount);
        treasury.withdraw(address(token), amount, alice);
    }

    // ==================== Distribute ====================

    function test_distribute_sendsToMultipleRecipients() public {
        treasury.deposit(address(token), 300 * WAD);

        address[] memory recipients = new address[](3);
        recipients[0] = alice;
        recipients[1] = bob;
        recipients[2] = charlie;

        uint256[] memory amounts = new uint256[](3);
        amounts[0] = 100 * WAD;
        amounts[1] = 80 * WAD;
        amounts[2] = 60 * WAD;

        treasury.distribute(address(token), recipients, amounts);

        assertEq(token.balanceOf(alice),   100 * WAD);
        assertEq(token.balanceOf(bob),      80 * WAD);
        assertEq(token.balanceOf(charlie),  60 * WAD);
        assertEq(treasury.balanceOf(address(token)), 60 * WAD);
    }

    function test_distribute_lengthMismatch_reverts() public {
        treasury.deposit(address(token), 100 * WAD);

        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = bob;

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 50 * WAD;

        vm.expectRevert(AuraTreasury.Treasury__LengthMismatch.selector);
        treasury.distribute(address(token), recipients, amounts);
    }

    function test_distribute_insufficientBalance_reverts() public {
        treasury.deposit(address(token), 50 * WAD);

        address[] memory recipients = new address[](1);
        recipients[0] = alice;

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100 * WAD;

        vm.expectRevert(AuraTreasury.Treasury__InsufficientBalance.selector);
        treasury.distribute(address(token), recipients, amounts);
    }

    function test_distribute_nonAdmin_reverts() public {
        treasury.deposit(address(token), 100 * WAD);

        address[] memory recipients = new address[](1);
        recipients[0] = alice;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 50 * WAD;

        vm.prank(alice);
        vm.expectRevert(AuraTreasury.Treasury__Unauthorized.selector);
        treasury.distribute(address(token), recipients, amounts);
    }

    function test_distribute_emptyArray_reverts() public {
        address[] memory recipients = new address[](0);
        uint256[] memory amounts    = new uint256[](0);

        vm.expectRevert(AuraTreasury.Treasury__InvalidParams.selector);
        treasury.distribute(address(token), recipients, amounts);
    }

    // ==================== Two-step Admin ====================

    function test_twoStepAdmin_transfer() public {
        treasury.proposeAdmin(alice);
        assertEq(treasury.pendingAdmin(), alice);

        vm.prank(alice);
        treasury.acceptAdmin();

        assertEq(treasury.admin(), alice);
        assertEq(treasury.pendingAdmin(), address(0));
    }

    function test_proposeAdmin_nonAdmin_reverts() public {
        vm.prank(alice);
        vm.expectRevert(AuraTreasury.Treasury__Unauthorized.selector);
        treasury.proposeAdmin(bob);
    }

    function test_acceptAdmin_wrongCaller_reverts() public {
        treasury.proposeAdmin(alice);

        vm.prank(bob);
        vm.expectRevert(AuraTreasury.Treasury__Unauthorized.selector);
        treasury.acceptAdmin();
    }
}
