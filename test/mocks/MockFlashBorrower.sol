// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC3156FlashBorrower } from "../../src/interfaces/IERC3156FlashBorrower.sol";

interface IERC20Min {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @dev Well-behaved flash borrower: approves repayment and returns the correct sentinel.
contract MockFlashBorrower is IERC3156FlashBorrower {
    bytes32 public constant CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");

    address public lender;
    uint256 public lastAmount;
    uint256 public lastFee;
    bytes   public lastData;

    constructor(address lender_) {
        lender = lender_;
    }

    function onFlashLoan(
        address /* initiator */,
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata data
    ) external override returns (bytes32) {
        lastAmount = amount;
        lastFee    = fee;
        lastData   = data;
        // Approve lender to pull back principal + fee
        IERC20Min(token).approve(lender, amount + fee);
        return CALLBACK_SUCCESS;
    }
}

/// @dev Bad flash borrower: returns the correct sentinel but does NOT approve repayment.
contract MockFlashBorrowerBad is IERC3156FlashBorrower {
    bytes32 public constant CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");

    function onFlashLoan(
        address,
        address,
        uint256,
        uint256,
        bytes calldata
    ) external pure override returns (bytes32) {
        // Intentionally skip approval — repayment will fail
        return CALLBACK_SUCCESS;
    }
}

/// @dev Flash borrower that returns the wrong sentinel (simulates a broken callback).
contract MockFlashBorrowerWrongReturn is IERC3156FlashBorrower {
    function onFlashLoan(
        address,
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata
    ) external override returns (bytes32) {
        IERC20Min(token).approve(msg.sender, amount + fee);
        return bytes32(0); // wrong sentinel
    }
}
