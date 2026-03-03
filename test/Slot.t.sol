// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { console } from "forge-std/console.sol";

contract SlotTest is Test {
    function testAuraSlot() public view {
        bytes32 s = keccak256(abi.encode(uint256(keccak256("com.aura.engine.v1")) - 1))
            & ~bytes32(uint256(0xff));
        console.log("Slot:");
        console.logBytes32(s);
    }
}
