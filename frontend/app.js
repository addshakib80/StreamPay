// ---------------------------------------------------------------
// SETUP: paste your deployed contract address here after
// running the deploy script (see the README, Step: Deploy).
// ---------------------------------------------------------------
// const CONTRACT_ADDRESS = "0xYOUR_DEPLOYED_ADDRESS_HERE";
const CONTRACT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3"; // Hardhat default

// Only the functions/events our frontend actually calls.
const ABI = [
  "function admin() view returns (address)",
  "function adminFeeBalance() view returns (uint256)",
  "function createStream(address employee, uint256 duration) payable",
  "function withdraw(uint256 streamId)",
  "function cancelStream(uint256 streamId)",
  "function claimAdminFees()",
  "function getStream(uint256 streamId) view returns (tuple(address employer,address employee,uint256 totalDeposit,uint256 startTime,uint256 duration,uint256 endTime,uint256 totalWithdrawn,bool active))",
  "function getEmployerStreams(address employer) view returns (uint256[])",
  "function getEmployeeStreams(address employee) view returns (uint256[])"
];

// Global state we reuse across functions.
let provider;
let signer;
let contract;
let myAddress;

// Every setInterval() we start for a ticking counter is stored here
// so we can stop them all before re-drawing the page.
let tickers = [];

// ---------------------------------------------------------------
// Connect MetaMask
// ---------------------------------------------------------------
document.getElementById("connect-btn").addEventListener("click", connectWallet);

async function connectWallet() {
  if (!window.ethereum) {
    setStatus("MetaMask is not installed.", true);
    return;
  }

  await window.ethereum.request({ method: "eth_requestAccounts" });

  provider = new ethers.BrowserProvider(window.ethereum);
  signer = await provider.getSigner();
  myAddress = await signer.getAddress();
  contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

  document.getElementById("wallet-info").textContent = "Connected: " + myAddress;
  setStatus("");

  await showCorrectView();

  // Simple polling loop: every 3 seconds, redraw whatever view is on
  // screen. This is what makes cancellations/withdrawals from another
  // browser window show up here without needing to reload the page.
  setInterval(showCorrectView, 3000);
}

// ---------------------------------------------------------------
// Decide which view to show (Admin, Employer, or Employee)
// ---------------------------------------------------------------
async function showCorrectView() {
  clearTickers(); // stop last cycle's per-second counters before redrawing

  const adminAddress = await contract.admin();
  const isAdmin = adminAddress.toLowerCase() === myAddress.toLowerCase();

  if (isAdmin) {
    document.getElementById("admin-view").hidden = false;
    document.getElementById("employer-view").hidden = true;
    document.getElementById("employee-view").hidden = true;
    await loadAdminView();
    return;
  }

  // Any non-admin wallet can create streams (be an "employer"),
  // and can also be an "employee" on streams other people created for them.
  document.getElementById("admin-view").hidden = true;
  document.getElementById("employer-view").hidden = false;
  await loadEmployerView();

  const incoming = await contract.getEmployeeStreams(myAddress);
  if (incoming.length > 0) {
    document.getElementById("employee-view").hidden = false;
    await loadEmployeeView();
  } else {
    document.getElementById("employee-view").hidden = true;
  }
}

// ---------------------------------------------------------------
// Admin view
// ---------------------------------------------------------------
async function loadAdminView() {
  const balance = await contract.adminFeeBalance();
  document.getElementById("admin-fee-balance").textContent = ethers.formatEther(balance);
}

document.getElementById("claim-fees-btn").addEventListener("click", async () => {
  try {
    setStatus("Claiming fees...");
    const tx = await contract.claimAdminFees();
    await tx.wait();
    setStatus("Fees claimed.");
    await loadAdminView();
  } catch (err) {
    setStatus(err.reason || err.message, true);
  }
});

// ---------------------------------------------------------------
// Employer view: create stream + list of outgoing streams
// ---------------------------------------------------------------
document.getElementById("create-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const employee = document.getElementById("input-employee").value.trim();
  const duration = document.getElementById("input-duration").value.trim();
  const amount = document.getElementById("input-amount").value.trim();

  try {
    setStatus("Creating stream...");
    const tx = await contract.createStream(employee, duration, {
      value: ethers.parseEther(amount)
    });
    await tx.wait();
    setStatus("Stream created.");
    e.target.reset();
    await loadEmployerView();
  } catch (err) {
    setStatus(err.reason || err.message, true);
  }
});

async function loadEmployerView() {
  const streamIds = await contract.getEmployerStreams(myAddress);
  const container = document.getElementById("employer-streams");
  container.innerHTML = "";

  for (const id of streamIds) {
    const stream = await contract.getStream(id);
    const card = buildStreamCard(id, stream, "employer");
    container.appendChild(card);
  }
}

// ---------------------------------------------------------------
// Employee view: list of incoming streams
// ---------------------------------------------------------------
async function loadEmployeeView() {
  const streamIds = await contract.getEmployeeStreams(myAddress);
  const container = document.getElementById("employee-streams");
  container.innerHTML = "";

  for (const id of streamIds) {
    const stream = await contract.getStream(id);
    const card = buildStreamCard(id, stream, "employee");
    container.appendChild(card);
  }
}

async function withdrawFromStream(streamId) {
  try {
    setStatus("Withdrawing...");
    const tx = await contract.withdraw(streamId);
    await tx.wait();
    setStatus("Withdrawal complete.");
    await loadEmployeeView();
  } catch (err) {
    setStatus(err.reason || err.message, true);
  }
}

async function cancelStream(streamId) {
  try {
    setStatus("Cancelling stream...");
    const tx = await contract.cancelStream(streamId);
    await tx.wait();
    setStatus("Stream cancelled.");
    await loadEmployerView();
  } catch (err) {
    setStatus(err.reason || err.message, true);
  }
}

// ---------------------------------------------------------------
// Build one stream card, and start its per-second ticking counter.
// This is the "real-time" part: we read the stream's numbers ONCE,
// then use setInterval to recompute the unlocked amount locally,
// every second, using the exact same formula as the smart contract.
// ---------------------------------------------------------------
function buildStreamCard(streamId, stream, viewerRole) {
  const card = document.createElement("div");
  card.className = "stream-card";

  const totalDeposit = stream.totalDeposit;     // BigInt (wei)
  const startTime = stream.startTime;           // BigInt (seconds)
  const duration = stream.duration;             // BigInt (seconds)
  const endTime = stream.endTime;                // BigInt (seconds)
  const totalWithdrawn = stream.totalWithdrawn; // BigInt (wei)
  const isActive = stream.active;

  const counterparty = viewerRole === "employer" ? stream.employee : stream.employer;

  card.innerHTML = `
    <strong>Stream #${streamId}</strong> — ${isActive ? "active" : "closed"}<br/>
    <span class="stream-numbers">With: ${counterparty}</span><br/>
    <span class="stream-numbers">Total: ${ethers.formatEther(totalDeposit)} ETH,
      Withdrawn: ${ethers.formatEther(totalWithdrawn)} ETH</span>
    <progress value="0" max="100"></progress>
    <div class="stream-numbers"><span data-claimable>0</span> ETH claimable now</div>
    <div class="stream-actions"></div>
  `;

  const actionsDiv = card.querySelector(".stream-actions");

  if (isActive && viewerRole === "employee") {
    const withdrawBtn = document.createElement("button");
    withdrawBtn.textContent = "Withdraw Vested Funds";
    withdrawBtn.addEventListener("click", () => withdrawFromStream(streamId));
    actionsDiv.appendChild(withdrawBtn);
  }

  if (isActive) {
    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel Stream";
    cancelBtn.addEventListener("click", () => cancelStream(streamId));
    actionsDiv.appendChild(cancelBtn);
  }

  if (isActive) {
    startTicker(card, totalDeposit, startTime, duration, endTime, totalWithdrawn);
  } else {
    // Closed stream: just show its final state, no ticking needed.
    card.querySelector("progress").value = 100;
    card.querySelector("[data-claimable]").textContent = "0";
  }

  return card;
}

// function startTicker(card, totalDeposit, startTime, duration, endTime, totalWithdrawn) {
//   function updateOnce() {
//     const now = BigInt(Math.floor(Date.now() / 1000));

//     // Same formula as the smart contract's getUnlockedAmount():
//     // Unlocked = Total * TimeElapsed / Duration (capped at Total).
//     let unlocked;
//     if (now >= endTime) {
//       unlocked = totalDeposit;
//     } else {
//       const elapsed = now - startTime;
//       unlocked = (totalDeposit * elapsed) / duration;
//     }

//     let claimable = unlocked - totalWithdrawn;
//     if (claimable < 0n) claimable = 0n; // never show a negative number

//     const percent = totalDeposit === 0n ? 0 : Number((unlocked * 100n) / totalDeposit);

//     card.querySelector("progress").value = percent;
//     card.querySelector("[data-claimable]").textContent = ethers.formatEther(claimable);

//     if (now >= endTime) clearInterval(intervalId);
//   }

//   updateOnce(); // show the correct value immediately, don't wait 1 second
//   const intervalId = setInterval(updateOnce, 1000);
//   tickers.push(intervalId);
// }


function startTicker(card, totalDeposit, startTime, duration, endTime, totalWithdrawn) {
  let intervalId; // declared first so updateOnce can safely reference it, even on the very first call

  function updateOnce() {
    const now = BigInt(Math.floor(Date.now() / 1000));

    let unlocked;
    if (now >= endTime) {
      unlocked = totalDeposit;
    } else {
      const elapsed = now - startTime;
      unlocked = (totalDeposit * elapsed) / duration;
    }

    let claimable = unlocked - totalWithdrawn;
    if (claimable < 0n) claimable = 0n;

    const percent = totalDeposit === 0n ? 0 : Number((unlocked * 100n) / totalDeposit);

    card.querySelector("progress").value = percent;
    card.querySelector("[data-claimable]").textContent = ethers.formatEther(claimable);

    if (now >= endTime) clearInterval(intervalId);
  }

  updateOnce(); // paint immediately
  intervalId = setInterval(updateOnce, 1000);
  tickers.push(intervalId);
}

function clearTickers() {
  for (const id of tickers) {
    clearInterval(id);
  }
  tickers = [];
}

// ---------------------------------------------------------------
// Small helper for showing status/error messages
// ---------------------------------------------------------------
function setStatus(message, isError = false) {
  const el = document.getElementById("status");
  el.textContent = message;
  el.style.color = isError ? "#b00020" : "#333";
}
