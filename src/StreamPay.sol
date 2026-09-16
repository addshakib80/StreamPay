// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// StreamPay
// A simple contract where a Company locks ETH for an Employee,
// and that ETH unlocks little by little, every second, until the
// full duration has passed. The Employee can withdraw whatever has
// unlocked so far, at any time.
contract StreamPay {

    // The address that deployed this contract.
    // This account is the Protocol Admin and earns a 1% fee.
    address public admin;

    // Total fees collected by the protocol, waiting for the admin to claim.
    uint256 public adminFeeBalance;

    // Simple counter used to give every new stream a unique ID (0, 1, 2, ...).
    uint256 public nextStreamId;

    // All the information we need to store for one salary stream.
    struct Stream {
        address employer;       // who created and funded the stream
        address employee;       // who is allowed to withdraw from it
        uint256 totalDeposit;   // total ETH (in wei) locked in the stream
        uint256 startTime;      // block.timestamp when the stream was created
        uint256 duration;       // how long (in seconds) the stream runs for
        uint256 endTime;        // startTime + duration
        uint256 totalWithdrawn; // how much the employee has withdrawn so far
        bool active;            // false once withdrawn/cancelled fully
    }

    // streamId => Stream details
    mapping(uint256 => Stream) private streams;

    // Keep a simple list of stream IDs per employer and per employee,
    // so the frontend can easily ask "show me all of my streams".
    mapping(address => uint256[]) private employerStreams;
    mapping(address => uint256[]) private employeeStreams;

    // Events let the frontend "hear" when something happens on-chain.
    event StreamCreated(uint256 streamId, address employer, address employee, uint256 totalDeposit, uint256 duration);
    event Withdrawn(uint256 streamId, uint256 amountToEmployee);
    event StreamCancelled(uint256 streamId);

    // Whoever deploys the contract becomes the admin.
    constructor() {
        admin = msg.sender;
    }

    // ------------------------------------------------------------
    // 1. Create Stream
    // ------------------------------------------------------------
    function createStream(address employee, uint256 duration) external payable {
        require(msg.value > 0, "You must send some ETH");
        require(duration > 15, "Duration must be more than 15 seconds");
        require(employee != address(0), "Invalid employee address");
        require(employee != msg.sender, "You cannot create a stream paying your own address");

        uint256 streamId = nextStreamId;
        nextStreamId = nextStreamId + 1;

        streams[streamId] = Stream({
            employer: msg.sender,
            employee: employee,
            totalDeposit: msg.value,
            startTime: block.timestamp,
            duration: duration,
            endTime: block.timestamp + duration,
            totalWithdrawn: 0,
            active: true
        });

        employerStreams[msg.sender].push(streamId);
        employeeStreams[employee].push(streamId);

        emit StreamCreated(streamId, msg.sender, employee, msg.value, duration);
    }

    // ------------------------------------------------------------
    // 2. The Streaming Math
    // Formula from the spec: Unlocked = (Total Deposit * Time Elapsed) / Total Duration
    // If we are past endTime, everything is unlocked.
    // ------------------------------------------------------------
    function getUnlockedAmount(uint256 streamId) public view returns (uint256) {
        Stream memory s = streams[streamId];

        if (block.timestamp >= s.endTime) {
            return s.totalDeposit;
        }

        uint256 timeElapsed = block.timestamp - s.startTime;
        uint256 unlocked = (s.totalDeposit * timeElapsed) / s.duration;
        return unlocked;
    }

    // ------------------------------------------------------------
    // 3. Withdraw Vested Salary
    // ------------------------------------------------------------
    function withdraw(uint256 streamId) external {
        Stream storage s = streams[streamId];

        require(s.active, "This stream is not active");
        require(msg.sender == s.employee, "Only the employee can withdraw");

        uint256 unlocked = getUnlockedAmount(streamId);
        uint256 claimable = unlocked - s.totalWithdrawn;
        require(claimable > 0, "Nothing new to withdraw yet");

        // 1% protocol fee, 99% goes to the employee.
        uint256 fee = (claimable * 1) / 100;
        uint256 amountToEmployee = claimable - fee;

        s.totalWithdrawn = s.totalWithdrawn + claimable;
        adminFeeBalance = adminFeeBalance + fee;

        payable(s.employee).transfer(amountToEmployee);

        emit Withdrawn(streamId, amountToEmployee);
    }

    // ------------------------------------------------------------
    // 4. Cancel Stream
    // Settles unwithdrawn vested ETH to the Employee (minus the 1% fee),
    // refunds all remaining locked (unvested) ETH back to the Employer,
    // and marks the stream Closed. This works correctly no matter how
    // much (if anything) the employee already withdrew earlier, because
    // it's based on totalWithdrawn, not on how much time has passed
    // since the last withdrawal.
    // ------------------------------------------------------------
    function cancelStream(uint256 streamId) external {
        Stream storage s = streams[streamId];

        require(s.active, "This stream is already closed");
        require(
            msg.sender == s.employer || msg.sender == s.employee,
            "Only the employer or employee can cancel"
        );

        uint256 unlocked = getUnlockedAmount(streamId);

        // Vested ETH that the employee earned but never withdrew.
        uint256 vestedNotWithdrawn = unlocked - s.totalWithdrawn;
        uint256 fee = (vestedNotWithdrawn * 1) / 100;
        uint256 amountToEmployee = vestedNotWithdrawn - fee;

        // Whatever was never unlocked goes back to the employer.
        uint256 refundToEmployer = s.totalDeposit - unlocked;

        s.totalWithdrawn = unlocked;
        s.active = false;
        adminFeeBalance = adminFeeBalance + fee;

        if (amountToEmployee > 0) {
            payable(s.employee).transfer(amountToEmployee);
        }
        if (refundToEmployer > 0) {
            payable(s.employer).transfer(refundToEmployer);
        }

        emit StreamCancelled(streamId);
    }

    // ------------------------------------------------------------
    // 5. Admin claims collected fees
    // ------------------------------------------------------------
    function claimAdminFees() external {
        require(msg.sender == admin, "Only admin can claim fees");
        require(adminFeeBalance > 0, "No fees to claim");

        uint256 amount = adminFeeBalance;
        adminFeeBalance = 0;

        payable(admin).transfer(amount);
    }

    // ------------------------------------------------------------
    // View helpers used by the frontend
    // ------------------------------------------------------------
    function getStream(uint256 streamId) external view returns (Stream memory) {
        return streams[streamId];
    }

    function getEmployerStreams(address employer) external view returns (uint256[] memory) {
        return employerStreams[employer];
    }

    function getEmployeeStreams(address employee) external view returns (uint256[] memory) {
        return employeeStreams[employee];
    }
}
