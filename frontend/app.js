// ---------------------------------------------------------------
// SETUP: contract address and ABI
// ---------------------------------------------------------------
const CONTRACT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

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

let provider;
let signer;
let contract;
let myAddress;

// One card per stream ID, built once and reused. This is what stops
// the list from ever duplicating or flickering: we only ever ADD a
// card the first time we see a stream ID, never destroy and rebuild it.
let employerCards = new Map(); // streamId (string) -> card element
let employeeCards = new Map();

// Only one polling loop should ever run at a time.
let pollingIntervalId = null;

// ---------------------------------------------------------------
// Connect MetaMask
// ---------------------------------------------------------------
document.getElementById("connect-btn").addEventListener("click", connectWallet);

// Switching accounts/networks mid-session is exactly what caused the
// duplicate polling loops before — a full reload is the safe reset.
if (window.ethereum) {
  window.ethereum.on("accountsChanged", () => window.location.reload());
  window.ethereum.on("chainChanged", () => window.location.reload());
}

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

  const connectBtn = document.getElementById("connect-btn");
  connectBtn.disabled = true;
  connectBtn.textContent = "Connected";

  await showCorrectView();

  // Poll every 3 seconds so changes made from another browser window
  // (a cancellation, a withdrawal) show up here without a reload.
  // Guard against ever starting a second loop on top of this one.
  if (pollingIntervalId) clearInterval(pollingIntervalId);
  pollingIntervalId = setInterval(showCorrectView, 3000);
}

// ---------------------------------------------------------------
// Role routing
// ---------------------------------------------------------------
async function showCorrectView() {
  const adminAddress = await contract.admin();
  const isAdmin = adminAddress.toLowerCase() === myAddress.toLowerCase();

  if (isAdmin) {
    document.getElementById("admin-view").hidden = false;
    document.getElementById("employer-view").hidden = true;
    document.getElementById("employee-view").hidden = true;
    await loadAdminView();
    return;
  }

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

document.getElementById("claim-fees-btn").addEventListener("click", async (e) => {
  const btn = e.target;
  btn.disabled = true;
  try {
    setStatus("Claiming fees...");
    const tx = await contract.claimAdminFees();
    await tx.wait();
    setStatus("Fees claimed.");
    await loadAdminView();
  } catch (err) {
    setStatus(err.reason || err.message, true);
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------
// Create Stream
// ---------------------------------------------------------------
document.getElementById("create-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const submitBtn = e.target.querySelector("button[type=submit]");
  submitBtn.disabled = true; // blocks double-submits from creating duplicate streams

  const employee = document.getElementById("input-employee").value.trim();
  const duration = document.getElementById("input-duration").value.trim();
  const amount = document.getElementById("input-amount").value.trim();

  if (!ethers.isAddress(employee)) {
    setStatus("Enter a valid employee address.", true);
    submitBtn.disabled = false;
    return;
  }
  if (employee.toLowerCase() === myAddress.toLowerCase()) {
    setStatus("You cannot create a stream paying your own address.", true);
    submitBtn.disabled = false;
    return;
  }

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
  } finally {
    submitBtn.disabled = false;
  }
});

// ---------------------------------------------------------------
// Employer / Employee stream lists — built once, updated in place
// ---------------------------------------------------------------
async function loadEmployerView() {
  const streamIds = await contract.getEmployerStreams(myAddress);
  await syncStreamList("employer-streams", employerCards, streamIds, "employer");
}

async function loadEmployeeView() {
  const streamIds = await contract.getEmployeeStreams(myAddress);
  await syncStreamList("employee-streams", employeeCards, streamIds, "employee");
}

async function syncStreamList(containerId, cardMap, streamIds, viewerRole) {
  const container = document.getElementById(containerId);

  for (const id of streamIds) {
    const key = id.toString();
    const stream = await contract.getStream(id);

    if (cardMap.has(key)) {
      syncCardData(cardMap.get(key), stream);
    } else {
      const card = buildStreamCard(id, stream, viewerRole);
      container.appendChild(card);
      cardMap.set(key, card);
    }
  }
}

// streamId + a reference to its card — the card carries a "busy" flag
// so the per-second ticker never re-enables a button mid-transaction.
async function withdrawFromStream(streamId, card) {
  card._txPending = true;
  setButtonsDisabled(card, true);
  try {
    setStatus("Withdrawing...");
    const tx = await contract.withdraw(streamId);
    await tx.wait();
    setStatus("Withdrawal complete.");
  } catch (err) {
    setStatus(err.reason || err.message, true);
  } finally {
    card._txPending = false;
    await showCorrectView(); // refreshes numbers and re-evaluates button states
  }
}

async function cancelStream(streamId, card) {
  card._txPending = true;
  setButtonsDisabled(card, true);
  try {
    setStatus("Cancelling stream...");
    const tx = await contract.cancelStream(streamId);
    await tx.wait();
    setStatus("Stream cancelled.");
  } catch (err) {
    setStatus(err.reason || err.message, true);
  } finally {
    card._txPending = false;
    await showCorrectView();
  }
}

function setButtonsDisabled(card, disabled) {
  if (card._withdrawBtn) card._withdrawBtn.disabled = disabled;
  if (card._cancelBtn) card._cancelBtn.disabled = disabled;
}

// ---------------------------------------------------------------
// Building a card (once) and keeping it live
// ---------------------------------------------------------------
function buildStreamCard(streamId, stream, viewerRole) {
  const card = document.createElement("div");
  card.className = "stream-card";

  // The card's own live data. The per-second ticker reads from here;
  // syncCardData() updates these values in place on every poll — so
  // the card never needs to be torn down and rebuilt.
  card._state = {
    totalDeposit: stream.totalDeposit,
    startTime: stream.startTime,
    duration: stream.duration,
    endTime: stream.endTime,
    totalWithdrawn: stream.totalWithdrawn,
    active: stream.active
  };
  card._txPending = false;
  card._withdrawBtn = null;
  card._cancelBtn = null;

  const counterparty = viewerRole === "employer" ? stream.employee : stream.employer;

  card.innerHTML = `
    <strong>Stream #${streamId}</strong> — <span data-status>${stream.active ? "active" : "closed"}</span><br/>
    <span class="stream-numbers">With: ${counterparty}</span><br/>
    <span class="stream-numbers">Total: ${ethers.formatEther(stream.totalDeposit)} ETH,
      Withdrawn: <span data-withdrawn>${ethers.formatEther(stream.totalWithdrawn)}</span> ETH</span>
    <progress value="0" max="100"></progress>
    <div class="stream-numbers"><span data-claimable>0</span> ETH claimable now</div>
    <div class="stream-actions"></div>
  `;

  const actionsDiv = card.querySelector(".stream-actions");

  if (stream.active && viewerRole === "employee") {
    const withdrawBtn = document.createElement("button");
    withdrawBtn.textContent = "Withdraw Vested Funds";
    withdrawBtn.addEventListener("click", () => withdrawFromStream(streamId, card));
    actionsDiv.appendChild(withdrawBtn);
    card._withdrawBtn = withdrawBtn;
  }

  if (stream.active) {
    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel Stream";
    cancelBtn.addEventListener("click", () => cancelStream(streamId, card));
    actionsDiv.appendChild(cancelBtn);
    card._cancelBtn = cancelBtn;
  }

  if (stream.active) {
    startTicker(card);
  } else {
    renderClosedCard(card);
  }

  return card;
}

// The real-time engine: reads card._state every second and recomputes
// the unlocked amount locally, using the same formula as the contract.
// Also keeps the Withdraw/Cancel buttons' enabled state in sync.
function startTicker(card) {
  function updateOnce() {
    const s = card._state;

    if (!s.active) {
      clearInterval(card._tickerId);
      return;
    }

    const now = BigInt(Math.floor(Date.now() / 1000));

    let unlocked;
    if (now >= s.endTime) {
      unlocked = s.totalDeposit;
    } else {
      const elapsed = now - s.startTime;
      unlocked = (s.totalDeposit * elapsed) / s.duration;
    }

    let claimable = unlocked - s.totalWithdrawn;
    if (claimable < 0n) claimable = 0n;

    const percent = s.totalDeposit === 0n ? 0 : Number((unlocked * 100n) / s.totalDeposit);

    card.querySelector("progress").value = percent;
    card.querySelector("[data-claimable]").textContent = ethers.formatEther(claimable);

    // Don't fight with an in-flight transaction — leave buttons alone
    // while one is pending, regardless of what claimable looks like.
    if (!card._txPending) {
      if (card._withdrawBtn) card._withdrawBtn.disabled = claimable <= 0n;

      // Cancel stays usable the whole time there's still something it
      // could meaningfully settle — either unvested funds to return to
      // the employer, or vested-but-unwithdrawn funds to pay out. It
      // only turns off once absolutely everything has been paid out.
      if (card._cancelBtn) card._cancelBtn.disabled = s.totalWithdrawn >= s.totalDeposit;
    }

    if (now >= s.endTime) clearInterval(card._tickerId);
  }

  updateOnce();
  card._tickerId = setInterval(updateOnce, 1000);
}

// Called every poll cycle for a card that already exists on screen.
// Updates the underlying numbers only — never touches the DOM
// structure, so there's nothing to flicker.
function syncCardData(card, stream) {
  const wasActive = card._state.active;

  card._state.totalWithdrawn = stream.totalWithdrawn;
  card._state.active = stream.active;

  card.querySelector("[data-withdrawn]").textContent = ethers.formatEther(stream.totalWithdrawn);

  if (wasActive && !stream.active) {
    // Just got cancelled or fully paid out — from this window or
    // another one. Freeze the card and stop its ticker.
    renderClosedCard(card);
  }
}

function renderClosedCard(card) {
  card.querySelector("[data-status]").textContent = "closed";
  card.querySelector("progress").value = 100;
  card.querySelector("[data-claimable]").textContent = "0";
  card.querySelector(".stream-actions").innerHTML = ""; // nothing more to do on a closed stream

  card._withdrawBtn = null;
  card._cancelBtn = null;

  if (card._tickerId) clearInterval(card._tickerId);
}

// ---------------------------------------------------------------
function setStatus(message, isError = false) {
  const el = document.getElementById("status");
  el.textContent = message;
  el.style.color = isError ? "#b00020" : "#333";
}
