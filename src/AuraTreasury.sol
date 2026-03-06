// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title  AuraTreasury
 * @author Sanzhik(traffer7612)
 * @notice Accumulates protocol revenue (yield fees, origination fees, liquidation fees,
 *         interest reserves) and exposes admin-controlled withdrawal/distribution.
 * @dev    Phase 5 implementation. Governance integration planned for Phase 7.
 *         Uses a minimal ERC-20 interface for flexibility across any token.
 */
contract AuraTreasury {
    // ------------------------------- Errors
    error Treasury__Unauthorized();
    error Treasury__InvalidParams();
    error Treasury__InsufficientBalance();
    error Treasury__LengthMismatch();
    error Treasury__TransferFailed();

    // ------------------------------- Events
    event Deposited(address indexed token, address indexed from, uint256 amount);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);
    event Distributed(address indexed token, uint256 totalAmount, uint256 recipientCount);
    event AdminProposed(address indexed current, address indexed pending);
    event AdminTransferred(address indexed prev, address indexed next);

    // ------------------------------- State
    address public admin;
    address public pendingAdmin;

    // ------------------------------- Constructor
    constructor(address admin_) {
        if (admin_ == address(0)) revert Treasury__InvalidParams();
        admin = admin_;
    }

    // ------------------------------- Modifiers
    modifier onlyAdmin() {
        if (msg.sender != admin) revert Treasury__Unauthorized();
        _;
    }

    // ------------------------------- Admin transfer (two-step)
    function proposeAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert Treasury__InvalidParams();
        pendingAdmin = newAdmin;
        emit AdminProposed(admin, newAdmin);
    }

    function acceptAdmin() external {
        if (msg.sender != pendingAdmin) revert Treasury__Unauthorized();
        address old = admin;
        admin = msg.sender;
        pendingAdmin = address(0);
        emit AdminTransferred(old, msg.sender);
    }

    // ------------------------------- Core functions

    /**
     * @notice Deposit tokens into the treasury.
     *         The caller must have approved this contract to spend `amount` of `token`.
     * @param token  ERC-20 token address
     * @param amount Amount to deposit (WAD)
     */
    function deposit(address token, uint256 amount) external {
        if (token == address(0)) revert Treasury__InvalidParams();
        if (amount == 0) revert Treasury__InvalidParams();
        bool ok = _erc20TransferFrom(token, msg.sender, address(this), amount);
        if (!ok) revert Treasury__TransferFailed();
        emit Deposited(token, msg.sender, amount);
    }

    /**
     * @notice Withdraw tokens from the treasury to a specific address.
     * @param token  ERC-20 token address
     * @param amount Amount to withdraw
     * @param to     Recipient address
     */
    function withdraw(address token, uint256 amount, address to) external onlyAdmin {
        if (token == address(0) || to == address(0)) revert Treasury__InvalidParams();
        if (amount == 0) revert Treasury__InvalidParams();
        if (balanceOf(token) < amount) revert Treasury__InsufficientBalance();
        bool ok = _erc20Transfer(token, to, amount);
        if (!ok) revert Treasury__TransferFailed();
        emit Withdrawn(token, to, amount);
    }

    /**
     * @notice Distribute tokens to multiple recipients in one transaction.
     * @param token       ERC-20 token address
     * @param recipients  Array of recipient addresses
     * @param amounts     Corresponding amounts (must match recipients length)
     */
    function distribute(
        address token,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external onlyAdmin {
        if (token == address(0)) revert Treasury__InvalidParams();
        if (recipients.length != amounts.length) revert Treasury__LengthMismatch();
        if (recipients.length == 0) revert Treasury__InvalidParams();

        uint256 total;
        for (uint256 i; i < amounts.length; ) {
            unchecked { total += amounts[i]; ++i; }
        }
        if (balanceOf(token) < total) revert Treasury__InsufficientBalance();

        for (uint256 i; i < recipients.length; ) {
            if (recipients[i] == address(0)) revert Treasury__InvalidParams();
            bool ok = _erc20Transfer(token, recipients[i], amounts[i]);
            if (!ok) revert Treasury__TransferFailed();
            unchecked { ++i; }
        }
        emit Distributed(token, total, recipients.length);
    }

    // ------------------------------- View
    /// @notice Returns this treasury's balance of `token`.
    function balanceOf(address token) public view returns (uint256) {
        (bool ok, bytes memory data) = token.staticcall(
            abi.encodeWithSelector(0x70a08231, address(this)) // balanceOf(address)
        );
        if (!ok || data.length < 32) return 0;
        return abi.decode(data, (uint256));
    }

    // ------------------------------- Internal helpers
    function _erc20Transfer(address token, address to, uint256 amount) internal returns (bool) {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(0xa9059cbb, to, amount) // transfer(address,uint256)
        );
        return ok && (data.length == 0 || abi.decode(data, (bool)));
    }

    function _erc20TransferFrom(
        address token,
        address from,
        address to,
        uint256 amount
    ) internal returns (bool) {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(0x23b872dd, from, to, amount) // transferFrom(address,address,uint256)
        );
        return ok && (data.length == 0 || abi.decode(data, (bool)));
    }
}
