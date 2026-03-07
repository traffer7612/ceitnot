// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title  IAuraUSD
/// @notice Interface for the AuraUSD mintable/burnable CDP stablecoin.
interface IAuraUSD {
    // ------------------------------- Mint / Burn

    /// @notice Mint `amount` aUSD to `to`. Only callable by registered minters.
    function mint(address to, uint256 amount) external;

    /// @notice Burn `amount` aUSD from `from`. Only callable by registered minters.
    ///         Does NOT require allowance — minter is trusted to manage protocol debt.
    function burn(address from, uint256 amount) external;

    /// @notice Burn `amount` aUSD from `from` using the caller's allowance.
    ///         Callable by anyone who has been approved by `from`.
    function burnFrom(address from, uint256 amount) external;

    // ------------------------------- Minter management

    /// @notice Register a new minter. Only callable by admin.
    function addMinter(address minter) external;

    /// @notice Revoke minter status. Only callable by admin.
    function removeMinter(address minter) external;

    // ------------------------------- Debt ceiling

    /// @notice Set the global debt ceiling (max totalSupply). 0 = unlimited. Only admin.
    function setGlobalDebtCeiling(uint256 ceiling) external;

    // ------------------------------- View

    function totalSupply()       external view returns (uint256);
    function globalDebtCeiling() external view returns (uint256);
    function minters(address)    external view returns (bool);
    function admin()             external view returns (address);
    function balanceOf(address)  external view returns (uint256);
}
