// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IAuraUSD } from "./interfaces/IAuraUSD.sol";

/**
 * @title  AuraPSM
 * @author Sanzhik(traffer7612)
 * @notice Peg Stability Module — allows 1:1 swaps between aUSD and a pegged stable
 *         (e.g. USDC or DAI) with independent buy/sell fees (tin / tout).
 *
 *         swapIn:  user sends `peggedToken` → receives `aUSD`  (PSM mints aUSD)
 *         swapOut: user sends `aUSD`         → receives `peggedToken` (PSM burns aUSD)
 *
 *         Fee is deducted from the OUTPUT amount (like MakerDAO PSM).
 *         Accumulated fees are kept as `peggedToken` in `feeReserves` and
 *         withdrawable by admin.
 *
 *         A `ceiling` caps how much aUSD the PSM is permitted to mint cumulatively
 *         (net of burns through the PSM). 0 = unlimited.
 *
 * @dev Phase 9 implementation.
 *      PSM must be registered as a minter in `AuraUSD`.
 */
contract AuraPSM {
    // ------------------------------- Errors
    error PSM__Unauthorized();
    error PSM__ZeroAddress();
    error PSM__ZeroAmount();
    error PSM__InvalidParams();
    error PSM__CeilingExceeded();
    error PSM__InsufficientReserves();
    error PSM__TransferFailed();

    // ------------------------------- Events
    event SwapIn(address indexed user, uint256 stableIn, uint256 ausdOut, uint256 fee);
    event SwapOut(address indexed user, uint256 ausdIn, uint256 stableOut, uint256 fee);
    event CeilingSet(uint256 ceiling);
    event FeeSet(uint16 tinBps, uint16 toutBps);
    event FeeReservesWithdrawn(address indexed to, uint256 amount);
    event AdminProposed(address indexed current, address indexed pending);
    event AdminTransferred(address indexed prev, address indexed next);

    // ------------------------------- Immutables
    /// @notice AuraUSD contract address.
    address public immutable ausd;
    /// @notice The pegged stable token (USDC / DAI / USDT).
    address public immutable peggedToken;

    // ------------------------------- State
    address public admin;
    address public pendingAdmin;

    /// @notice Fee on swapIn (user buys aUSD), in basis points. Default 10 = 0.1%.
    uint16  public tinBps;
    /// @notice Fee on swapOut (user sells aUSD), in basis points. Default 10 = 0.1%.
    uint16  public toutBps;

    /// @notice Max aUSD the PSM may mint net of burns. 0 = unlimited.
    uint256 public ceiling;
    /// @notice Net aUSD minted by the PSM (increases on swapIn, decreases on swapOut).
    uint256 public mintedViaPsm;

    /// @notice Accumulated fees expressed in `peggedToken`. Excludes main reserves.
    uint256 public feeReserves;

    // ------------------------------- Constructor
    constructor(
        address ausd_,
        address peggedToken_,
        address admin_,
        uint16  tinBps_,
        uint16  toutBps_
    ) {
        if (ausd_ == address(0) || peggedToken_ == address(0) || admin_ == address(0))
            revert PSM__ZeroAddress();
        if (tinBps_ > 10_000 || toutBps_ > 10_000) revert PSM__InvalidParams();
        ausd        = ausd_;
        peggedToken = peggedToken_;
        admin       = admin_;
        tinBps      = tinBps_;
        toutBps     = toutBps_;
    }

    // ------------------------------- Modifiers
    modifier onlyAdmin() {
        if (msg.sender != admin) revert PSM__Unauthorized();
        _;
    }

    // ------------------------------- Core: swapIn (peggedToken → aUSD)
    /**
     * @notice Swap `amount` of `peggedToken` for aUSD at 1:1 minus `tinBps` fee.
     * @param  amount Amount of peggedToken to deposit (18-decimal assumed).
     * @return ausdOut Amount of aUSD minted to caller.
     */
    function swapIn(uint256 amount) external returns (uint256 ausdOut) {
        if (amount == 0) revert PSM__ZeroAmount();

        uint256 fee = (amount * tinBps) / 10_000;
        ausdOut     = amount - fee;

        // Ceiling check
        if (ceiling != 0 && mintedViaPsm + ausdOut > ceiling) revert PSM__CeilingExceeded();

        // Pull peggedToken from caller
        _transferIn(peggedToken, msg.sender, amount);

        // Accrue fee and track minted
        unchecked {
            feeReserves  += fee;
            mintedViaPsm += ausdOut;
        }

        // Mint aUSD to caller (PSM must be a registered minter)
        IAuraUSD(ausd).mint(msg.sender, ausdOut);

        emit SwapIn(msg.sender, amount, ausdOut, fee);
    }

    // ------------------------------- Core: swapOut (aUSD → peggedToken)
    /**
     * @notice Swap `amount` of aUSD for `peggedToken` at 1:1 minus `toutBps` fee.
     *         Caller must have approved this contract for `amount` aUSD beforehand.
     * @param  amount Amount of aUSD to burn.
     * @return stableOut Amount of peggedToken sent to caller.
     */
    function swapOut(uint256 amount) external returns (uint256 stableOut) {
        if (amount == 0) revert PSM__ZeroAmount();

        uint256 fee = (amount * toutBps) / 10_000;
        stableOut   = amount - fee;

        // Check PSM has enough peggedToken liquidity (total balance minus reserved fees)
        uint256 available = _balance(peggedToken);
        // feeReserves is part of total balance; available for swapOut = balance - feeReserves
        if (available < feeReserves || available - feeReserves < stableOut)
            revert PSM__InsufficientReserves();

        // Burn aUSD from caller (requires prior approve)
        IAuraUSD(ausd).burnFrom(msg.sender, amount);

        // Decrease net minted (floor at 0 to handle cross-source burns)
        unchecked {
            mintedViaPsm  = mintedViaPsm >= amount ? mintedViaPsm - amount : 0;
            feeReserves  += fee;
        }

        // Send peggedToken to caller
        _transferOut(peggedToken, msg.sender, stableOut);

        emit SwapOut(msg.sender, amount, stableOut, fee);
    }

    // ------------------------------- Admin
    function setCeiling(uint256 ceiling_) external onlyAdmin {
        ceiling = ceiling_;
        emit CeilingSet(ceiling_);
    }

    function setFee(uint16 tinBps_, uint16 toutBps_) external onlyAdmin {
        if (tinBps_ > 10_000 || toutBps_ > 10_000) revert PSM__InvalidParams();
        tinBps  = tinBps_;
        toutBps = toutBps_;
        emit FeeSet(tinBps_, toutBps_);
    }

    /**
     * @notice Withdraw accumulated fee reserves (peggedToken) to `to`.
     */
    function withdrawFeeReserves(address to, uint256 amount) external onlyAdmin {
        if (to == address(0)) revert PSM__ZeroAddress();
        if (amount == 0)      revert PSM__ZeroAmount();
        if (amount > feeReserves) revert PSM__InsufficientReserves();
        unchecked { feeReserves -= amount; }
        _transferOut(peggedToken, to, amount);
        emit FeeReservesWithdrawn(to, amount);
    }

    function proposeAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert PSM__ZeroAddress();
        pendingAdmin = newAdmin;
        emit AdminProposed(admin, newAdmin);
    }

    function acceptAdmin() external {
        if (msg.sender != pendingAdmin) revert PSM__Unauthorized();
        emit AdminTransferred(admin, msg.sender);
        admin        = msg.sender;
        pendingAdmin = address(0);
    }

    // ------------------------------- View
    /// @notice peggedToken available for swapOut (excludes feeReserves).
    function availableReserves() external view returns (uint256) {
        uint256 bal = _balance(peggedToken);
        return bal > feeReserves ? bal - feeReserves : 0;
    }

    // ------------------------------- Internal helpers
    function _balance(address token) internal view returns (uint256) {
        (bool ok, bytes memory data) = token.staticcall(
            abi.encodeWithSelector(0x70a08231, address(this)) // balanceOf(address)
        );
        return (ok && data.length >= 32) ? abi.decode(data, (uint256)) : 0;
    }

    function _transferIn(address token, address from, uint256 amount) internal {
        (bool ok, bytes memory ret) = token.call(
            abi.encodeWithSelector(0x23b872dd, from, address(this), amount) // transferFrom
        );
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert PSM__TransferFailed();
    }

    function _transferOut(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory ret) = token.call(
            abi.encodeWithSelector(0xa9059cbb, to, amount) // transfer
        );
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert PSM__TransferFailed();
    }
}
