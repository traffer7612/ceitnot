// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AuraProxy
 * @author Sanzhik(traffer7612)
 * @notice UUPS (EIP-1822) upgradeable proxy. Delegates all calls to the implementation;
 *         implementation slot follows EIP-1967 for tooling compatibility.
 */
contract AuraProxy {
    /// @dev EIP-1967 implementation slot (literal for assembly)
    bytes32 private constant IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    /// @param implementation_ Initial implementation (AuraEngine)
    /// @param data_ Encoded call to initializer (e.g. AuraEngine.initialize(...))
    constructor(address implementation_, bytes memory data_) {
        assembly {
            sstore(IMPLEMENTATION_SLOT, implementation_)
        }
        if (data_.length > 0) {
            (bool ok, ) = implementation_.delegatecall(data_);
            if (!ok) {
                assembly {
                    returndatacopy(0, 0, returndatasize())
                    revert(0, returndatasize())
                }
            }
        }
    }

    fallback() external payable virtual {
        address impl;
        assembly {
            impl := sload(IMPLEMENTATION_SLOT)
        }
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    receive() external payable virtual {}
}
