// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC4626 }  from "./interfaces/IERC4626.sol";
import { IAuraUSD }  from "./interfaces/IAuraUSD.sol";
import { IERC2612 }  from "./interfaces/IERC2612.sol";

/// @dev Minimal AuraEngine interface needed by the router.
interface IAuraEngineRouter {
    function depositCollateral(address user, uint256 marketId, uint256 shares) external;
    function depositAndBorrow(address user, uint256 marketId, uint256 shares, uint256 borrowAmount) external;
    function repayAndWithdraw(address user, uint256 marketId, uint256 repayAmount, uint256 withdrawShares) external;
    function repay(address user, uint256 marketId, uint256 amount) external;
}

/**
 * @title  AuraRouter
 * @author Sanzhik(traffer7612)
 * @notice Stateless, user-friendly wrapper around AuraEngine that adds:
 *         - Atomic depositAndBorrow / repayAndWithdraw in a single tx
 *         - EIP-2612 permit support so users never need a separate approve tx
 *         - leverageUp / leverageDown convenience aliases
 *
 *         Prerequisites for delegated flows:
 *           1. User calls `engine.setDelegate(address(router), true)` once.
 *           2. User approves `engine` for aUSD (for repay) once:
 *              `ausd.approve(address(engine), type(uint256).max)`.
 *
 * @dev    Phase 10 — DX & Composability.
 */
contract AuraRouter {

    // ------------------------------- Errors
    error Router__ZeroAddress();
    error Router__ZeroAmount();
    error Router__TransferFailed();

    // ------------------------------- Events

    /// @notice Emitted when a user deposits collateral and borrows via the router.
    event DepositAndBorrowed(
        address indexed user,
        uint256 indexed marketId,
        uint256 shares,
        uint256 borrowed
    );

    /// @notice Emitted when a user repays debt and withdraws collateral via the router.
    event RepaidAndWithdrawn(
        address indexed user,
        uint256 indexed marketId,
        uint256 repaid,
        uint256 shares
    );

    // ------------------------------- Immutables

    /// @notice AuraEngine proxy address.
    address public immutable engine;

    /// @notice AuraUSD address (used for permit-based repay flows).
    address public immutable ausd;

    // ------------------------------- Constructor
    constructor(address engine_, address ausd_) {
        if (engine_ == address(0) || ausd_ == address(0)) revert Router__ZeroAddress();
        engine = engine_;
        ausd   = ausd_;
    }

    // ------------------------------- Deposit helpers

    /**
     * @notice Pull vault shares from msg.sender and deposit as collateral on their behalf.
     *         Requires: vault.approve(router, shares) by the caller.
     * @param marketId  Target market.
     * @param vault     Collateral vault address.
     * @param shares    Amount of vault shares to deposit.
     */
    function depositCollateral(
        uint256 marketId,
        address vault,
        uint256 shares
    ) external {
        if (shares == 0) revert Router__ZeroAmount();
        if (!IERC4626(vault).transferFrom(msg.sender, address(this), shares)) revert Router__TransferFailed();
        if (!IERC4626(vault).approve(engine, shares)) revert Router__TransferFailed();
        IAuraEngineRouter(engine).depositCollateral(msg.sender, marketId, shares);
    }

    /**
     * @notice Same as depositCollateral but uses an EIP-2612 permit for the vault token,
     *         removing the need for a prior approve call.
     *         Only works when the collateral vault token supports EIP-2612.
     * @param marketId  Target market.
     * @param vault     Collateral vault address (must support IERC2612).
     * @param shares    Amount of vault shares to deposit.
     * @param deadline  Permit expiry timestamp.
     * @param v,r,s     Signature from the vault-token's permit.
     */
    function depositCollateralWithPermit(
        uint256 marketId,
        address vault,
        uint256 shares,
        uint256 deadline,
        uint8   v,
        bytes32 r,
        bytes32 s
    ) external {
        if (shares == 0) revert Router__ZeroAmount();
        IERC2612(vault).permit(msg.sender, address(this), shares, deadline, v, r, s);
        if (!IERC4626(vault).transferFrom(msg.sender, address(this), shares)) revert Router__TransferFailed();
        if (!IERC4626(vault).approve(engine, shares)) revert Router__TransferFailed();
        IAuraEngineRouter(engine).depositCollateral(msg.sender, marketId, shares);
    }

    // ------------------------------- Compound helpers

    /**
     * @notice Deposit vault shares and borrow in one transaction.
     *         Requires:
     *           - vault.approve(router, shares) by the caller.
     *           - engine.setDelegate(router, true) by the caller.
     * @param marketId     Target market.
     * @param vault        Collateral vault address.
     * @param shares       Vault shares to deposit.
     * @param borrowAmount Amount of aUSD to borrow.
     */
    function depositAndBorrow(
        uint256 marketId,
        address vault,
        uint256 shares,
        uint256 borrowAmount
    ) external {
        if (shares == 0 || borrowAmount == 0) revert Router__ZeroAmount();
        // Pull vault shares from user into this router, then approve engine
        if (!IERC4626(vault).transferFrom(msg.sender, address(this), shares)) revert Router__TransferFailed();
        if (!IERC4626(vault).approve(engine, shares)) revert Router__TransferFailed();
        // Engine pulls shares from router (msg.sender = router) and borrows for user
        IAuraEngineRouter(engine).depositAndBorrow(msg.sender, marketId, shares, borrowAmount);
        emit DepositAndBorrowed(msg.sender, marketId, shares, borrowAmount);
    }

    /**
     * @notice Repay debt and withdraw collateral in one transaction.
     *         Requires:
     *           - ausd.approve(engine, repayAmount) by the caller (or infinite approval).
     *           - engine.setDelegate(router, true) by the caller.
     * @param marketId      Target market.
     * @param repayAmount   Amount of aUSD to repay (0 = skip repay).
     * @param withdrawShares Vault shares to withdraw (0 = skip withdrawal).
     */
    function repayAndWithdraw(
        uint256 marketId,
        uint256 repayAmount,
        uint256 withdrawShares
    ) external {
        if (repayAmount == 0 && withdrawShares == 0) revert Router__ZeroAmount();
        IAuraEngineRouter(engine).repayAndWithdraw(msg.sender, marketId, repayAmount, withdrawShares);
        emit RepaidAndWithdrawn(msg.sender, marketId, repayAmount, withdrawShares);
    }

    /**
     * @notice Repay debt using a gasless EIP-2612 permit on aUSD instead of a prior approve.
     *         The permit sets ausd.allowance[user][engine], then repay burns from user.
     *         Requires: engine.setDelegate(router, true) by the caller.
     * @param marketId Target market.
     * @param amount   Amount of aUSD to repay.
     * @param deadline Permit expiry timestamp.
     * @param v,r,s    Signature from ausd.permit.
     */
    function repayWithPermit(
        uint256 marketId,
        uint256 amount,
        uint256 deadline,
        uint8   v,
        bytes32 r,
        bytes32 s
    ) external {
        if (amount == 0) revert Router__ZeroAmount();
        // Set engine's allowance on user's aUSD via permit, then repay burns from user
        IAuraUSD(ausd).permit(msg.sender, engine, amount, deadline, v, r, s);
        IAuraEngineRouter(engine).repay(msg.sender, marketId, amount);
    }

    // ------------------------------- Leverage aliases

    /**
     * @notice Leverage up: deposit more collateral and borrow more in one transaction.
     *         This is an alias for depositAndBorrow with leverage-oriented naming.
     * @param marketId     Target market.
     * @param vault        Collateral vault address.
     * @param shares       Additional vault shares to deposit.
     * @param borrowAmount Additional aUSD to borrow.
     */
    function leverageUp(
        uint256 marketId,
        address vault,
        uint256 shares,
        uint256 borrowAmount
    ) external {
        if (shares == 0 || borrowAmount == 0) revert Router__ZeroAmount();
        if (!IERC4626(vault).transferFrom(msg.sender, address(this), shares)) revert Router__TransferFailed();
        if (!IERC4626(vault).approve(engine, shares)) revert Router__TransferFailed();
        IAuraEngineRouter(engine).depositAndBorrow(msg.sender, marketId, shares, borrowAmount);
        emit DepositAndBorrowed(msg.sender, marketId, shares, borrowAmount);
    }

    /**
     * @notice Leverage down: repay debt and withdraw collateral in one transaction.
     *         This is an alias for repayAndWithdraw with leverage-oriented naming.
     * @param marketId       Target market.
     * @param repayAmount    Amount of aUSD to repay.
     * @param withdrawShares Vault shares to withdraw.
     */
    function leverageDown(
        uint256 marketId,
        uint256 repayAmount,
        uint256 withdrawShares
    ) external {
        if (repayAmount == 0 && withdrawShares == 0) revert Router__ZeroAmount();
        IAuraEngineRouter(engine).repayAndWithdraw(msg.sender, marketId, repayAmount, withdrawShares);
        emit RepaidAndWithdrawn(msg.sender, marketId, repayAmount, withdrawShares);
    }
}
