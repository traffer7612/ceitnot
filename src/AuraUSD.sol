// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IAuraUSD } from "./interfaces/IAuraUSD.sol";

/**
 * @title  AuraUSD
 * @author Sanzhik(traffer7612)
 * @notice Mintable/burnable ERC-20 stablecoin (aUSD) for the Aura CDP protocol.
 *         Converting the protocol from a lending-market (pre-funded debtToken) to a
 *         Collateralised Debt Position (CDP) model (à la MakerDAO DAI).
 *
 *         Minting is restricted to authorised minter addresses (AuraEngine, AuraPSM).
 *         A global debt ceiling caps the total supply; 0 = unlimited.
 *
 * @dev Phase 9 implementation. Pure custom ERC-20 — no OZ dependency, matching project style.
 */
contract AuraUSD is IAuraUSD {
    // ------------------------------- Errors
    error AuraUSD__Unauthorized();
    error AuraUSD__ZeroAddress();
    error AuraUSD__DebtCeilingExceeded();
    error AuraUSD__InsufficientBalance();
    error AuraUSD__InsufficientAllowance();

    // ------------------------------- Events
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event MinterAdded(address indexed minter);
    event MinterRemoved(address indexed minter);
    event GlobalDebtCeilingSet(uint256 ceiling);
    event AdminProposed(address indexed current, address indexed pending);
    event AdminTransferred(address indexed prev, address indexed next);

    // ------------------------------- ERC-20 metadata
    string public constant name     = "Aura USD";
    string public constant symbol   = "aUSD";
    uint8  public constant decimals = 18;

    // ------------------------------- ERC-20 state
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // ------------------------------- Access control
    address public admin;
    address public pendingAdmin;
    mapping(address => bool) public minters;

    // ------------------------------- Debt ceiling
    /// @notice Maximum aUSD total supply. 0 = unlimited.
    uint256 public globalDebtCeiling;

    // ------------------------------- Constructor
    constructor(address admin_) {
        if (admin_ == address(0)) revert AuraUSD__ZeroAddress();
        admin = admin_;
    }

    // ------------------------------- Modifiers
    modifier onlyAdmin() {
        if (msg.sender != admin) revert AuraUSD__Unauthorized();
        _;
    }

    modifier onlyMinter() {
        if (!minters[msg.sender]) revert AuraUSD__Unauthorized();
        _;
    }

    // ------------------------------- Admin management
    function proposeAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert AuraUSD__ZeroAddress();
        pendingAdmin = newAdmin;
        emit AdminProposed(admin, newAdmin);
    }

    function acceptAdmin() external {
        if (msg.sender != pendingAdmin) revert AuraUSD__Unauthorized();
        emit AdminTransferred(admin, msg.sender);
        admin        = msg.sender;
        pendingAdmin = address(0);
    }

    // ------------------------------- Minter management
    /// @inheritdoc IAuraUSD
    function addMinter(address minter) external onlyAdmin {
        if (minter == address(0)) revert AuraUSD__ZeroAddress();
        minters[minter] = true;
        emit MinterAdded(minter);
    }

    /// @inheritdoc IAuraUSD
    function removeMinter(address minter) external onlyAdmin {
        minters[minter] = false;
        emit MinterRemoved(minter);
    }

    // ------------------------------- Debt ceiling
    /// @inheritdoc IAuraUSD
    function setGlobalDebtCeiling(uint256 ceiling) external onlyAdmin {
        globalDebtCeiling = ceiling;
        emit GlobalDebtCeilingSet(ceiling);
    }

    // ------------------------------- Mint / Burn
    /// @inheritdoc IAuraUSD
    function mint(address to, uint256 amount) external onlyMinter {
        if (to == address(0)) revert AuraUSD__ZeroAddress();
        if (globalDebtCeiling != 0 && totalSupply + amount > globalDebtCeiling)
            revert AuraUSD__DebtCeilingExceeded();
        unchecked { totalSupply += amount; }
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    /// @inheritdoc IAuraUSD
    /// @dev Minter-only; does NOT consume allowance — the minter (engine) is trusted to
    ///      correctly attribute debt repayment. Used by AuraEngine on behalf of users.
    function burn(address from, uint256 amount) external onlyMinter {
        _deductBalance(from, amount);
        emit Transfer(from, address(0), amount);
    }

    /// @inheritdoc IAuraUSD
    /// @dev Open to any caller. Caller must have sufficient allowance from `from`.
    ///      Used by AuraEngine.repay / AuraPSM.swapOut (user approves the contract first).
    function burnFrom(address from, uint256 amount) external {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert AuraUSD__InsufficientAllowance();
            unchecked { allowance[from][msg.sender] = allowed - amount; }
        }
        _deductBalance(from, amount);
        emit Transfer(from, address(0), amount);
    }

    // ------------------------------- ERC-20
    function transfer(address to, uint256 amount) external returns (bool) {
        _deductBalance(msg.sender, amount);
        unchecked { balanceOf[to] += amount; }
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert AuraUSD__InsufficientAllowance();
            unchecked { allowance[from][msg.sender] = allowed - amount; }
        }
        _deductBalance(from, amount);
        unchecked { balanceOf[to] += amount; }
        emit Transfer(from, to, amount);
        return true;
    }

    // ------------------------------- Internal
    function _deductBalance(address from, uint256 amount) internal {
        if (balanceOf[from] < amount) revert AuraUSD__InsufficientBalance();
        unchecked {
            balanceOf[from] -= amount;
            totalSupply     -= amount;
        }
    }
}
