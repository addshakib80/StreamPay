// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {StreamPay} from "../src/StreamPay.sol";

// A few simple tests that prove the three things Checkpoint 2 asks for:
// 1) the per-second unlock math is correct
// 2) the 1% fee is calculated correctly on withdrawal
// 3) cancelling refunds the right amount to each side
//
// Note: we use address(0x1000)/0x1001/0x1002 instead of address(0x1)/0x2
// because 0x1-0x9 are reserved "precompile" addresses on Ethereum and can't
// reliably receive plain ETH transfers in a test environment.
contract StreamPayTest is Test {
    StreamPay public streamPay;

    address admin = address(0x1000);
    address employer = address(0x1001);
    address employee = address(0x1002);

    uint256 constant DEPOSIT = 100 ether;
    uint256 constant DURATION = 100; // seconds, so 1% unlocks per second

    function setUp() public {
        vm.prank(admin);
        streamPay = new StreamPay();
        vm.deal(employer, 1000 ether); // give the test employer some ETH
    }

    function createTestStream() internal returns (uint256) {
        vm.prank(employer);
        streamPay.createStream{value: DEPOSIT}(employee, DURATION);
        return 0; // first stream always has id 0
    }

    // 1) Vesting math: halfway through the duration, half should be unlocked.
    function test_HalfwayUnlocked() public {
        uint256 id = createTestStream();

        vm.warp(block.timestamp + 50); // move forward 50 out of 100 seconds
        uint256 unlocked = streamPay.getUnlockedAmount(id);

        assertEq(unlocked, 50 ether);
    }

    // Past endTime, everything should be unlocked.
    function test_FullyUnlockedAfterEnd() public {
        uint256 id = createTestStream();

        vm.warp(block.timestamp + 200); // well past the 100 second duration
        uint256 unlocked = streamPay.getUnlockedAmount(id);

        assertEq(unlocked, DEPOSIT);
    }

    // 2) Withdrawal pays 99% to employee, 1% goes to admin fee balance.
    function test_WithdrawTakesOnePercentFee() public {
        uint256 id = createTestStream();
        vm.warp(block.timestamp + 50); // 50 ETH vested

        uint256 balanceBefore = employee.balance;

        vm.prank(employee);
        streamPay.withdraw(id);

        uint256 expectedFee = 50 ether / 100;       // 0.5 ETH
        uint256 expectedNet = 50 ether - expectedFee; // 49.5 ETH

        assertEq(employee.balance - balanceBefore, expectedNet);
        assertEq(streamPay.adminFeeBalance(), expectedFee);
    }

    // 3) Cancelling splits correctly: employee gets vested (minus fee),
    //    employer gets back whatever never unlocked.
    function test_CancelRefundsRemainderToEmployer() public {
        uint256 id = createTestStream();
        vm.warp(block.timestamp + 40); // 40 ETH vested

        uint256 employeeBefore = employee.balance;
        uint256 employerBefore = employer.balance;

        vm.prank(employer);
        streamPay.cancelStream(id);

        uint256 fee = 40 ether / 100;
        uint256 expectedEmployeeNet = 40 ether - fee;
        uint256 expectedRefund = 60 ether; // the other 60% was never unlocked

        assertEq(employee.balance - employeeBefore, expectedEmployeeNet);
        assertEq(employer.balance - employerBefore, expectedRefund);
    }

    // Admin can pull the fees that piled up.
    function test_AdminCanClaimFees() public {
        uint256 id = createTestStream();
        vm.warp(block.timestamp + DURATION);

        vm.prank(employee);
        streamPay.withdraw(id);

        vm.prank(admin);
        streamPay.claimAdminFees();

        assertEq(streamPay.adminFeeBalance(), 0);
    }
}
