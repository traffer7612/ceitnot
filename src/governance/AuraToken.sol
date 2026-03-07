// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC20 }       from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import { ERC20Votes }  from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import { Nonces }      from "@openzeppelin/contracts/utils/Nonces.sol";

/**
 * @title  AuraToken
 * @author Sanzhik(traffer7612)
 * @notice Governance token of the Aura Protocol.
 *         ERC-20 with ERC20Votes (snapshot-based voting power) and ERC20Permit (gasless approvals).
 *         Uses timestamp-based clock (EIP-6372) for compatibility with veAURA and Governor.
 * @dev    Phase 7 implementation.
 *         Supply cap: 100,000,000 AURA.
 *         Minting is controlled by a single `minter` address (initially deployer, then governance).
 */
contract AuraToken is ERC20, ERC20Permit, ERC20Votes {
    // ------------------------------- Errors
    error Token__SupplyCapExceeded();
    error Token__Unauthorized();
    error Token__ZeroAddress();

    // ------------------------------- Events
    event MinterUpdated(address indexed previous, address indexed next);

    // ------------------------------- Constants
    uint256 public constant SUPPLY_CAP = 100_000_000 * 1e18; // 100M AURA

    // ------------------------------- State
    address public minter;

    // ------------------------------- Constructor
    constructor(address minter_) ERC20("Aura", "AURA") ERC20Permit("Aura") {
        if (minter_ == address(0)) revert Token__ZeroAddress();
        minter = minter_;
        emit MinterUpdated(address(0), minter_);
    }

    // ------------------------------- Minting
    /**
     * @notice Mint AURA tokens. Only callable by the current `minter`.
     * @param to     Recipient address
     * @param amount Amount to mint (WAD)
     */
    function mint(address to, uint256 amount) external {
        if (msg.sender != minter) revert Token__Unauthorized();
        if (totalSupply() + amount > SUPPLY_CAP) revert Token__SupplyCapExceeded();
        _mint(to, amount);
    }

    /**
     * @notice Transfer the minter role. Only callable by the current minter.
     * @param newMinter New minter address (e.g. TimelockController after governance setup)
     */
    function setMinter(address newMinter) external {
        if (msg.sender != minter) revert Token__Unauthorized();
        if (newMinter == address(0)) revert Token__ZeroAddress();
        emit MinterUpdated(minter, newMinter);
        minter = newMinter;
    }

    // ------------------------------- EIP-6372: timestamp clock
    /**
     * @dev Use block.timestamp as the clock for compatibility with veAURA and Governor.
     */
    function clock() public view override returns (uint48) {
        return uint48(block.timestamp);
    }

    /// @dev EIP-6372 clock mode descriptor.
    // solhint-disable-next-line func-name-mixedcase
    function CLOCK_MODE() public pure override returns (string memory) {
        return "mode=timestamp";
    }

    // ------------------------------- Required overrides
    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Votes)
    {
        super._update(from, to, value);
    }

    function nonces(address owner)
        public
        view
        override(ERC20Permit, Nonces)
        returns (uint256)
    {
        return super.nonces(owner);
    }
}
