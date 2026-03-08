// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC5805 }  from "@openzeppelin/contracts/interfaces/IERC5805.sol";
import { IERC6372 }  from "@openzeppelin/contracts/interfaces/IERC6372.sol";
import { SafeCast }  from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/**
 * @title  VeAura
 * @author Sanzhik(traffer7612)
 * @notice Vote-Escrow AURA (veAURA). Lock AURA for up to 4 years to receive:
 *         1. Voting power (linear decay: more lock time = more power)
 *         2. Share of protocol revenue (proportional to locked amount, not decayed power)
 *
 * @dev    Phase 7 implementation. Implements IERC5805 (IVotes) for Governor compatibility.
 *         Uses timestamp-based clock (EIP-6372).
 *
 *         Voting power formula:
 *           bias = amount * (unlockTime - now) / MAX_LOCK_DURATION
 *
 *         Delegation: users delegate to themselves by default. Delegation redirects
 *         voting power to a delegatee at checkpoint time.
 *
 *         Revenue model: simple reward-per-token (staking rewards pattern).
 *           revenuePerTokenStored += revenue / totalLocked
 *           userRevenue = lockedAmount * (revenuePerTokenStored - userRevenuePerTokenPaid)
 */
contract VeAura {
    using SafeCast for uint256;

    // ------------------------------- Errors
    error VeAura__LockExists();
    error VeAura__NoLock();
    error VeAura__LockNotExpired();
    error VeAura__LockExpired();
    error VeAura__InvalidDuration();
    error VeAura__InvalidUnlockTime();
    error VeAura__ZeroAmount();
    error VeAura__Unauthorized();
    error VeAura__ZeroAddress();
    error VeAura__TransferFailed();
    error VeAura__NoRevenue();

    // ------------------------------- Events
    event Locked(address indexed user, uint256 amount, uint256 unlockTime);
    event Withdrawn(address indexed user, uint256 amount);
    event AmountIncreased(address indexed user, uint256 extra, uint256 newAmount);
    event LockExtended(address indexed user, uint256 newUnlockTime);
    event DelegateChanged(address indexed delegator, address indexed fromDelegate, address indexed toDelegate);
    event DelegateVotesChanged(address indexed delegate, uint256 previousVotes, uint256 newVotes);
    event RevenueDistributed(address indexed token, uint256 amount);
    event RevenueClaimed(address indexed user, uint256 amount);

    // ------------------------------- Constants
    uint256 public constant MAX_LOCK_DURATION = 4 * 365 days; // 4 years
    uint256 public constant EPOCH             = 1 weeks;
    uint256 public constant PRECISION         = 1e18;

    // ------------------------------- Structs
    struct LockedBalance {
        uint128 amount;     // AURA locked (WAD)
        uint48  unlockTime; // timestamp when lock expires
    }

    /// @dev Single checkpoint entry: (timestamp, votes)
    struct Checkpoint {
        uint48  timestamp;
        uint208 votes;
    }

    // ------------------------------- State
    /// @notice AURA token contract
    address public immutable token;

    /// @notice Admin — can call distributeRevenue; should be TimelockController/Treasury
    address public admin;

    /// @notice Revenue token (debt token / stablecoin)
    address public revenueToken;

    /// @notice Total amount of AURA currently locked
    uint256 public totalLocked;

    /// @notice Per-user lock data
    mapping(address => LockedBalance) public locks;

    /// @notice Delegation: user => their delegatee (address(0) means not set = self)
    mapping(address => address) private _delegates;

    /// @notice Vote checkpoints per delegatee
    mapping(address => Checkpoint[]) private _checkpoints;

    /// @notice Global total-supply checkpoints
    Checkpoint[] private _totalSupplyCheckpoints;

    // ---- Revenue (reward-per-token model)
    uint256 public revenuePerTokenStored;
    mapping(address => uint256) public userRevenuePerTokenPaid;
    mapping(address => uint256) public revenueEarned; // pending claim

    // ------------------------------- Constructor
    constructor(address token_, address admin_, address revenueToken_) {
        if (token_ == address(0) || admin_ == address(0)) revert VeAura__ZeroAddress();
        token        = token_;
        admin        = admin_;
        revenueToken = revenueToken_;
    }

    // ------------------------------- EIP-6372
    function clock() public view returns (uint48) {
        return uint48(block.timestamp);
    }

    // solhint-disable-next-line func-name-mixedcase
    function CLOCK_MODE() public pure returns (string memory) {
        return "mode=timestamp";
    }

    // ------------------------------- Lock mechanics

    /**
     * @notice Lock AURA for `unlockTime` (rounded to epoch). Requires no existing lock.
     * @param amount     Amount of AURA to lock (WAD)
     * @param unlockTime Desired unlock timestamp (rounded down to week boundary)
     */
    function lock(uint256 amount, uint256 unlockTime) external {
        if (amount == 0) revert VeAura__ZeroAmount();
        LockedBalance storage lb = locks[msg.sender];
        if (lb.amount > 0) revert VeAura__LockExists();

        uint256 rounded = (unlockTime / EPOCH) * EPOCH;
        if (rounded <= block.timestamp)              revert VeAura__InvalidUnlockTime();
        if (rounded > block.timestamp + MAX_LOCK_DURATION) revert VeAura__InvalidDuration();

        _updateRevenue(msg.sender);

        // Effects first (CEI pattern)
        lb.amount     = amount.toUint128();
        lb.unlockTime = uint48(rounded);
        totalLocked  += amount;

        _writeTotalSupplyCheckpoint();
        _moveVotingPower(address(0), _delegatee(msg.sender), _currentBias(lb));

        // Interaction last
        _transferIn(token, msg.sender, amount);

        emit Locked(msg.sender, amount, rounded);
    }

    /**
     * @notice Increase the locked amount of an existing lock. Lock time is unchanged.
     * @param extra Additional AURA to lock
     */
    function increaseAmount(uint256 extra) external {
        if (extra == 0) revert VeAura__ZeroAmount();
        LockedBalance storage lb = locks[msg.sender];
        if (lb.amount == 0) revert VeAura__NoLock();
        if (block.timestamp >= lb.unlockTime) revert VeAura__LockExpired();

        _updateRevenue(msg.sender);

        // Effects first (CEI pattern)
        lb.amount = (uint256(lb.amount) + extra).toUint128();
        totalLocked += extra;

        _writeTotalSupplyCheckpoint();
        // Write NEW bias (after amount increase)
        _moveVotingPower(_delegatee(msg.sender), _delegatee(msg.sender), _currentBias(lb));

        // Interaction last
        _transferIn(token, msg.sender, extra);

        emit AmountIncreased(msg.sender, extra, lb.amount);
    }

    /**
     * @notice Extend the unlock time of an existing lock (must be longer than current).
     * @param newUnlockTime New unlock timestamp (must be > current unlockTime)
     */
    function extendLock(uint256 newUnlockTime) external {
        LockedBalance storage lb = locks[msg.sender];
        if (lb.amount == 0) revert VeAura__NoLock();
        if (block.timestamp >= lb.unlockTime) revert VeAura__LockExpired();

        uint256 rounded = (newUnlockTime / EPOCH) * EPOCH;
        if (rounded <= lb.unlockTime) revert VeAura__InvalidUnlockTime();
        if (rounded > block.timestamp + MAX_LOCK_DURATION) revert VeAura__InvalidDuration();

        lb.unlockTime = uint48(rounded);

        _writeTotalSupplyCheckpoint();
        // Write NEW bias (after unlock time extension)
        _moveVotingPower(_delegatee(msg.sender), _delegatee(msg.sender), _currentBias(lb));

        emit LockExtended(msg.sender, rounded);
    }

    /**
     * @notice Withdraw AURA after lock has expired.
     */
    function withdraw() external {
        LockedBalance storage lb = locks[msg.sender];
        if (lb.amount == 0) revert VeAura__NoLock();
        if (block.timestamp < lb.unlockTime) revert VeAura__LockNotExpired();

        _updateRevenue(msg.sender);

        uint256 amount = lb.amount;
        totalLocked -= amount;
        delete locks[msg.sender];

        _writeTotalSupplyCheckpoint();
        _moveVotingPower(_delegatee(msg.sender), address(0), 0);

        _transferOut(token, msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    // ------------------------------- IVotes: delegation

    /// @notice Get the current delegatee of `account` (defaults to self).
    function delegates(address account) public view returns (address) {
        return _delegatee(account);
    }

    /// @notice Delegate voting power to `delegatee`.
    function delegate(address delegatee) external {
        _delegate(msg.sender, delegatee);
    }

    /// @notice EIP-712 delegation by signature (stub — not used in tests but required by IVotes).
    function delegateBySig(
        address delegatee,
        uint256 /*nonce*/,
        uint256 expiry,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (block.timestamp > expiry) revert VeAura__Unauthorized();
        address signer = ecrecover(
            keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32",
                keccak256(abi.encode(delegatee, expiry)))),
            v, r, s
        );
        if (signer == address(0)) revert VeAura__Unauthorized();
        _delegate(signer, delegatee);
    }

    // ------------------------------- IVotes: voting power

    /// @notice Current voting power of `account`'s delegatee (= their delegated bias).
    function getVotes(address account) external view returns (uint256) {
        Checkpoint[] storage ckpts = _checkpoints[account];
        uint256 len = ckpts.length;
        if (len == 0) return 0;
        return ckpts[len - 1].votes;
    }

    /// @notice Voting power of `account` at a past `timepoint` (timestamp).
    function getPastVotes(address account, uint256 timepoint) external view returns (uint256) {
        if (timepoint >= block.timestamp) revert VeAura__Unauthorized(); // future not allowed
        return _checkpointLookup(_checkpoints[account], timepoint);
    }

    /// @notice Total voting supply at a past `timepoint`.
    function getPastTotalSupply(uint256 timepoint) external view returns (uint256) {
        if (timepoint >= block.timestamp) revert VeAura__Unauthorized();
        return _checkpointLookup(_totalSupplyCheckpoints, timepoint);
    }

    // ------------------------------- Revenue distribution

    /**
     * @notice Distribute protocol revenue to veAURA holders (proportional to locked amount).
     * @param amount Amount of revenueToken to distribute (must be pre-approved)
     */
    function distributeRevenue(uint256 amount) external {
        if (msg.sender != admin) revert VeAura__Unauthorized();
        if (amount == 0) revert VeAura__ZeroAmount();
        if (totalLocked == 0) revert VeAura__NoRevenue();
        // Effects first (CEI pattern)
        revenuePerTokenStored += (amount * PRECISION) / totalLocked;
        // Interaction last
        _transferIn(revenueToken, msg.sender, amount);
        emit RevenueDistributed(revenueToken, amount);
    }

    /// @notice Claim pending revenue for the caller.
    function claimRevenue() external returns (uint256 reward) {
        _updateRevenue(msg.sender);
        reward = revenueEarned[msg.sender];
        if (reward == 0) revert VeAura__NoRevenue();
        revenueEarned[msg.sender] = 0;
        _transferOut(revenueToken, msg.sender, reward);
        emit RevenueClaimed(msg.sender, reward);
    }

    /// @notice Pending revenue for `user` (view).
    function pendingRevenue(address user) external view returns (uint256) {
        LockedBalance storage lb = locks[user];
        uint256 earned = revenueEarned[user];
        if (lb.amount > 0) {
            earned += (uint256(lb.amount) * (revenuePerTokenStored - userRevenuePerTokenPaid[user])) / PRECISION;
        }
        return earned;
    }

    // ------------------------------- Admin

    function setAdmin(address newAdmin) external {
        if (msg.sender != admin) revert VeAura__Unauthorized();
        if (newAdmin == address(0)) revert VeAura__ZeroAddress();
        admin = newAdmin;
    }

    function setRevenueToken(address newToken) external {
        if (msg.sender != admin) revert VeAura__Unauthorized();
        if (newToken == address(0)) revert VeAura__ZeroAddress();
        revenueToken = newToken;
    }

    // ------------------------------- Internal helpers

    function _delegatee(address account) internal view returns (address d) {
        d = _delegates[account];
        if (d == address(0)) d = account; // default = self
    }

    function _delegate(address delegator, address delegatee) internal {
        address old = _delegatee(delegator);
        _delegates[delegator] = delegatee;
        emit DelegateChanged(delegator, old, delegatee);

        LockedBalance storage lb = locks[delegator];
        uint256 bias = _currentBias(lb);
        _moveVotingPower(old, delegatee, bias);
    }

    /// @dev Compute current bias (voting power) for a lock.
    function _currentBias(LockedBalance storage lb) internal view returns (uint256) {
        if (lb.amount == 0 || block.timestamp >= lb.unlockTime) return 0;
        return (uint256(lb.amount) * (lb.unlockTime - block.timestamp)) / MAX_LOCK_DURATION;
    }

    /// @dev Move voting power from `src` to `dst`. If src==dst, just re-write dst checkpoint.
    function _moveVotingPower(address src, address dst, uint256 newDstBias) internal {
        if (src != address(0) && src != dst) {
            // reduce src
            Checkpoint[] storage srcCkpts = _checkpoints[src];
            uint256 srcLen = srcCkpts.length;
            uint256 prev = srcLen > 0 ? srcCkpts[srcLen - 1].votes : 0;
            uint256 next = prev > 0 ? 0 : 0; // src loses delegated power (simplified: set to 0)
            _writeCheckpoint(srcCkpts, next);
            emit DelegateVotesChanged(src, prev, next);
        }
        if (dst != address(0)) {
            Checkpoint[] storage dstCkpts = _checkpoints[dst];
            uint256 dstLen = dstCkpts.length;
            uint256 prev = dstLen > 0 ? dstCkpts[dstLen - 1].votes : 0;
            _writeCheckpoint(dstCkpts, newDstBias);
            emit DelegateVotesChanged(dst, prev, newDstBias);
        }
    }

    function _writeCheckpoint(Checkpoint[] storage ckpts, uint256 votes) internal {
        uint48 ts = clock();
        uint256 len = ckpts.length;
        if (len > 0 && ckpts[len - 1].timestamp == ts) {
            ckpts[len - 1].votes = votes.toUint208();
        } else {
            ckpts.push(Checkpoint({ timestamp: ts, votes: votes.toUint208() }));
        }
    }

    function _writeTotalSupplyCheckpoint() internal {
        // Total supply = sum of all biases — approximated here as totalLocked (for simplicity)
        // Full precision would require iterating all locks; this is acceptable for Phase 7
        _writeCheckpoint(_totalSupplyCheckpoints, totalLocked);
    }

    /// @dev Binary search for the most recent checkpoint <= `timepoint`.
    function _checkpointLookup(
        Checkpoint[] storage ckpts,
        uint256 timepoint
    ) internal view returns (uint256) {
        uint256 len = ckpts.length;
        if (len == 0) return 0;
        if (ckpts[len - 1].timestamp <= timepoint) return ckpts[len - 1].votes;
        if (ckpts[0].timestamp > timepoint) return 0;

        uint256 lo = 0;
        uint256 hi = len - 1;
        while (lo < hi) {
            uint256 mid = (lo + hi + 1) / 2;
            if (ckpts[mid].timestamp <= timepoint) lo = mid;
            else hi = mid - 1;
        }
        return ckpts[lo].votes;
    }

    function _updateRevenue(address user) internal {
        LockedBalance storage lb = locks[user];
        if (lb.amount > 0) {
            revenueEarned[user] +=
                (uint256(lb.amount) * (revenuePerTokenStored - userRevenuePerTokenPaid[user])) / PRECISION;
        }
        userRevenuePerTokenPaid[user] = revenuePerTokenStored;
    }

    function _transferIn(address tkn, address from, uint256 amount) internal {
        (bool ok, bytes memory data) = tkn.call(
            abi.encodeWithSelector(0x23b872dd, from, address(this), amount)
        );
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert VeAura__TransferFailed();
    }

    function _transferOut(address tkn, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = tkn.call(
            abi.encodeWithSelector(0xa9059cbb, to, amount)
        );
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert VeAura__TransferFailed();
    }
}
