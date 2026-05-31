// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import { ICeitnotUSD } from "./interfaces/ICeitnotUSD.sol";

/**
 * @title  CeitnotPSM
 * @author Sanzhik(traffer7612)
 * @notice Peg Stability Module — allows 1:1 swaps between ceitUSD and a pegged stable
 *         (e.g. USDC or DAI) with independent buy/sell fees (tin / tout).
 *
 *         swapIn:  user sends `peggedToken` → receives `ceitUSD`  (PSM mints ceitUSD)
 *         swapOut: user sends `ceitUSD`     → receives `peggedToken` (PSM burns ceitUSD)
 *
 *         Fee is deducted from the OUTPUT amount (like MakerDAO PSM).
 *         Accumulated fees are kept as `peggedToken` in `feeReserves` and
 *         withdrawable by admin. Main swap liquidity (balance minus feeReserves)
 *         can be withdrawn by admin via `withdrawLiquidity` (e.g. PSM migration).
 *
 *         A `ceiling` caps how much ceitUSD the PSM is permitted to mint cumulatively
 *         (net of burns through the PSM). 0 = unlimited.
 *
 * @dev Phase 9 implementation.
 *      PSM must be registered as a minter in `CeitnotUSD`.
 *
 *      Pegged token decimals are read at deploy time (e.g. USDC = 6 on Arbitrum).
 *      ceitUSD is always 18 decimals; amounts are scaled so 1 unit of pegged nominal
 *      matches 1e18 wei ceitUSD (1:1 dollar peg before fees).
 */
contract CeitnotPSM {
    // ------------------------------- Errors
    error PSM__Unauthorized();
    error PSM__ZeroAddress();
    error PSM__ZeroAmount();
    error PSM__InvalidParams();
    error PSM__CeilingExceeded();
    error PSM__InsufficientReserves();
    error PSM__InsufficientMinted();
    error PSM__TransferFailed();
    error PSM__ExceedsSwapLimit();

    // ------------------------------- Events
    event SwapIn(address indexed user, uint256 stableIn, uint256 ausdOut, uint256 fee);
    event SwapOut(address indexed user, uint256 ausdIn, uint256 stableOut, uint256 fee);
    event CeilingSet(uint256 ceiling);
    event FeeSet(uint16 tinBps, uint16 toutBps);
    event SwapLimitsSet(uint256 maxSwapInPeg, uint256 maxSwapOutAusd);
    event FeeReservesWithdrawn(address indexed to, uint256 amount);
    /// @notice Pegged liquidity withdrawn (not from `feeReserves`); reduces swapOut capacity until refilled.
    event LiquidityWithdrawn(address indexed to, uint256 amount);
    event AdminProposed(address indexed current, address indexed pending);
    event AdminTransferred(address indexed prev, address indexed next);

    // ------------------------------- Immutables
    /// @notice CeitnotUSD contract address.
    address public immutable ausd;
    /// @notice The pegged stable token (USDC / DAI / USDT).
    address public immutable peggedToken;
    /// @notice Decimals of `peggedToken` (read once in constructor).
    uint8 public immutable peggedDecimals;

    uint8 internal constant AUSD_DECIMALS = 18;

    // ------------------------------- State
    address public admin;
    address public pendingAdmin;

    /// @notice Fee on swapIn (user buys ceitUSD), in basis points. Default 10 = 0.1%.
    uint16  public tinBps;
    /// @notice Fee on swapOut (user sells ceitUSD), in basis points. Default 10 = 0.1%.
    uint16  public toutBps;

    /// @notice Max ceitUSD the PSM may mint net of burns. 0 = unlimited.
    uint256 public ceiling;
    /// @notice Net ceitUSD minted by the PSM (increases on swapIn, decreases on swapOut).
    uint256 public mintedViaPsm;

    /// @notice Accumulated fees expressed in `peggedToken`. Excludes main reserves.
    uint256 public feeReserves;

    /// @notice Max `peggedToken` per `swapIn` (native peg decimals). 0 = unlimited.
    uint256 public maxSwapInPeg;
    /// @notice Max ceitUSD per `swapOut` (18 decimals). 0 = unlimited.
    uint256 public maxSwapOutAusd;

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

        uint8 dec = IERC20Metadata(peggedToken_).decimals();
        if (dec > AUSD_DECIMALS) revert PSM__InvalidParams();
        peggedDecimals = dec;
    }

    // ------------------------------- Modifiers
    modifier onlyAdmin() {
        if (msg.sender != admin) revert PSM__Unauthorized();
        _;
    }

    // ------------------------------- Core: swapIn (peggedToken → ceitUSD)
    /**
     * @notice Swap `amount` of `peggedToken` for ceitUSD at 1:1 nominal minus `tinBps` fee.
     * @param  amount Amount of peggedToken in native peg decimals (e.g. 1e6 = 1 USDC).
     * @return ausdOut Amount of ceitUSD minted (18 decimals).
     */
    function swapIn(uint256 amount) external returns (uint256 ausdOut) {
        if (amount == 0) revert PSM__ZeroAmount();
        if (maxSwapInPeg != 0 && amount > maxSwapInPeg) revert PSM__ExceedsSwapLimit();

        uint256 feePeg = (amount * tinBps) / 10_000;
        uint256 netPeg = amount - feePeg;
        ausdOut = _peggedToAusd(netPeg);

        // Ceiling check
        if (ceiling != 0 && mintedViaPsm + ausdOut > ceiling) revert PSM__CeilingExceeded();

        // Effects first (CEI pattern)
        unchecked {
            feeReserves  += feePeg;
            mintedViaPsm += ausdOut;
        }

        // Interactions
        _transferIn(peggedToken, msg.sender, amount);
        ICeitnotUSD(ausd).mint(msg.sender, ausdOut);

        emit SwapIn(msg.sender, amount, ausdOut, feePeg);
    }

    // ------------------------------- Core: swapOut (ceitUSD → peggedToken)
    /**
     * @notice Swap `amount` of ceitUSD for `peggedToken` at 1:1 nominal minus `toutBps` fee.
     *         Caller must have approved this contract for `amount` ceitUSD beforehand.
     * @param  amount Amount of ceitUSD to burn (18 decimals).
     * @return stableOut Amount of peggedToken sent (native peg decimals).
     */
    function swapOut(uint256 amount) external returns (uint256 stableOut) {
        if (amount == 0) revert PSM__ZeroAmount();
        if (maxSwapOutAusd != 0 && amount > maxSwapOutAusd) revert PSM__ExceedsSwapLimit();

        uint256 feeAusd = (amount * toutBps) / 10_000;
        uint256 netAusd = amount - feeAusd;
        stableOut = _ausdToPegged(netAusd);
        uint256 feePeg = _ausdToPegged(feeAusd);
        if (stableOut == 0) revert PSM__ZeroAmount();

        // Need liquidity for user payout + pegged portion of fee booked to reserves
        uint256 bal = _balance(peggedToken);
        if (bal < feeReserves || bal - feeReserves < stableOut + feePeg) revert PSM__InsufficientReserves();

        // Effects first (CEI pattern)
        unchecked {
            if (mintedViaPsm < amount) revert PSM__InsufficientMinted();
            mintedViaPsm  -= amount;
            feeReserves  += feePeg;
        }

        // Interactions
        ICeitnotUSD(ausd).burnFrom(msg.sender, amount);
        _transferOut(peggedToken, msg.sender, stableOut);

        emit SwapOut(msg.sender, amount, stableOut, feePeg);
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
     * @notice Per-transaction swap caps for soft launch (0 = unlimited).
     * @param maxSwapInPeg_  Max pegged token per `swapIn` (e.g. 100e6 = 100 USDC on Arbitrum).
     * @param maxSwapOutAusd_ Max ceitUSD burned per `swapOut` (18 decimals).
     */
    function setSwapLimits(uint256 maxSwapInPeg_, uint256 maxSwapOutAusd_) external onlyAdmin {
        maxSwapInPeg    = maxSwapInPeg_;
        maxSwapOutAusd  = maxSwapOutAusd_;
        emit SwapLimitsSet(maxSwapInPeg_, maxSwapOutAusd_);
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

    /**
     * @notice Withdraw pegged tokens from the main liquidity pool (everything above `feeReserves`).
     * @dev Does not touch `feeReserves`. Reduces how much users can `swapOut` until liquidity is sent back.
     */
    function withdrawLiquidity(address to, uint256 amount) external onlyAdmin {
        if (to == address(0)) revert PSM__ZeroAddress();
        if (amount == 0) revert PSM__ZeroAmount();
        uint256 bal = _balance(peggedToken);
        if (bal < feeReserves || bal - feeReserves < amount) revert PSM__InsufficientReserves();
        _transferOut(peggedToken, to, amount);
        emit LiquidityWithdrawn(to, amount);
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

    /// @dev 1 unit of pegged (10**peggedDecimals) → 1e18 wei ceitUSD.
    function _peggedToAusd(uint256 peggedAmt) internal view returns (uint256) {
        if (peggedDecimals == AUSD_DECIMALS) return peggedAmt;
        return peggedAmt * (10 ** uint256(AUSD_DECIMALS - peggedDecimals));
    }

    /// @dev Rounds down: ceitUSD wei → pegged raw (conservative for protocol).
    function _ausdToPegged(uint256 ausdAmt) internal view returns (uint256) {
        if (peggedDecimals == AUSD_DECIMALS) return ausdAmt;
        return ausdAmt / (10 ** uint256(AUSD_DECIMALS - peggedDecimals));
    }

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
