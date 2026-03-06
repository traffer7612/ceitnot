// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title  IERC3156FlashBorrower
 * @notice EIP-3156 flash loan borrower callback interface.
 * @dev    The receiver must implement this interface and return the success sentinel
 *         `keccak256("ERC3156FlashBorrower.onFlashLoan")` to confirm repayment intent.
 */
interface IERC3156FlashBorrower {
    /**
     * @notice Receive a flash loan.
     * @param initiator The initiator of the flash loan (msg.sender on flashLoan call).
     * @param token     The token being flash-loaned.
     * @param amount    The amount of tokens being flash-loaned.
     * @param fee       The fee to be repaid on top of `amount`.
     * @param data      Arbitrary data passed by the initiator.
     * @return          `keccak256("ERC3156FlashBorrower.onFlashLoan")` on success.
     */
    function onFlashLoan(
        address initiator,
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata data
    ) external returns (bytes32);
}
