// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {StreamPay} from "../src/StreamPay.sol";

// Deploys StreamPay. Run this with Anvil Account #0's private key so
// Account #0 becomes msg.sender in the constructor, which makes it
// the Protocol Admin.
contract DeployStreamPay is Script {
    function run() external {
        vm.startBroadcast();

        StreamPay streamPay = new StreamPay();

        console.log("StreamPay deployed at:", address(streamPay));
        console.log("Admin address:", streamPay.admin());

        vm.stopBroadcast();
    }
}
