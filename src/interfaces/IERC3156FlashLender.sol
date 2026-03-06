// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC3156FlashBorrower } from "./IERC3156FlashBorrower.sol";

/**
 * @title  IERC3156FlashLender
 * @notice EIP-3156 flash loan lender interface.
 */
interface IERC3156FlashLender {
    /**
     * @notice The amount of currency available to be flash-loaned.
     * @param token The loan currency.
     * @return      The amount of `token` that can be flash-loaned.
     */
    function maxFlashLoan(address token) external view returns (uint256);

    /**
     * @notice The fee to be charged for a given flash loan.
     * @param token  The loan currency.
     * @param amount The amount of tokens lent.
     * @return       The amount of `token` to be charged for the flash loan.
     */
    function flashFee(address token, uint256 amount) external view returns (uint256);

    /**
     * @notice Initiate a flash loan.
     * @param receiver The receiver of the tokens in the flash loan,
     *                 and the receiver of the callback.
     * @param token    The loan currency.
     * @param amount   The amount of tokens lent.
     * @param data     Arbitrary data structure, intended to contain
     *                 user-defined parameters.
     */
    function flashLoan(
        IERC3156FlashBorrower receiver,
        address token,
        uint256 amount,
        bytes calldata data
    ) external returns (bool);
}
