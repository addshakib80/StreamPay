# StreamPay

A simple decentralized payroll streaming protocol built with **Solidity +
Foundry** (smart contract) and **HTML/CSS/JavaScript + Ethers.js v6**
(frontend). A Company locks ETH for an Employee, and the ETH unlocks
continuously, second by second, until the Employee has withdrawn it all.

This README covers: what to install, how to set the project up locally,
how to run it, and how to push it to GitHub for submission.

---

## 1. What you need to install

| Tool | Purpose | Download |
|---|---|---|
| VS Code | Code editor | https://code.visualstudio.com/ |
| Git | Version control / GitHub upload | https://git-scm.com/ |
| Foundry (forge, anvil, cast) | Compile, test, and deploy the smart contract; run a local blockchain | https://book.getfoundry.sh/getting-started/installation |
| MetaMask | Browser wallet extension used by the DApp | https://metamask.io/ |
| Node.js (optional) | Only used to serve the frontend folder locally | https://nodejs.org/ |

**Windows users:** Foundry's installer (`foundryup`) needs **Git Bash** or
**WSL** — it does not work in PowerShell or Command Prompt. Installing WSL
(`wsl --install` in PowerShell, then restart) is the easiest path and is
what most Foundry tutorials assume. Everything else (VS Code, MetaMask,
Git, the browser) works normally on Windows either way.

**Installing Foundry** (in a terminal — Git Bash / WSL / macOS / Linux):

```bash
curl -L https://getfoundry.sh/install | bash
```

Restart your terminal (or run `source ~/.bashrc`), then:

```bash
foundryup
```

Check it worked:

```bash
forge --version
anvil --version
```

---

## 2. Project structure

```
streampay/
├── foundry.toml           # Foundry configuration
├── src/StreamPay.sol       # the smart contract
├── script/Deploy.s.sol     # deployment script
├── test/StreamPay.t.sol    # tests proving the math/fee/refund logic
├── lib/forge-std/          # Foundry's standard test library (auto-installed)
└── frontend/
    ├── index.html
    ├── style.css
    └── app.js
```

---

## 3. Setting the project up

Unzip this project (or clone your own repo once you've pushed it), then
from inside the `streampay/` folder:

```bash
forge install foundry-rs/forge-std --no-commit
forge build
```

`forge build` should print `Compiler run successful`. If `lib/forge-std`
is already present (e.g. you unzipped a copy that includes it), you can
skip the `forge install` line.

Open the folder in VS Code:

```bash
code .
```

---

## 4. Running a local blockchain (Anvil)

In one terminal tab, start Anvil and **leave it running**:

```bash
anvil
```

It prints 10 test accounts, each with **100 ETH** and a private key.
**Account #0 will become the Protocol Admin** once you deploy — copy its
private key now.

### Connect MetaMask to it

1. MetaMask → network dropdown → *Add network* → *Add a network manually*
2. Network name: `Anvil Local`
3. RPC URL: `http://127.0.0.1:8545`
4. Chain ID: `31337`
5. Currency symbol: `ETH`

### Import test accounts into MetaMask

MetaMask → account icon → *Import account* → paste a private key from the
Anvil output. Import at least three accounts and rename them (Admin,
Employer, Employee) so you don't lose track during testing.

> These are Anvil's publicly known test keys — only ever use them on your
> local Anvil chain, never on a real network.

---

## 5. Running the tests

In a second terminal tab (keep Anvil running in the first one):

```bash
forge test -vv
```

All tests should pass. These tests prove the vesting math, the 1% fee
calculation, and the cancellation refund logic are correct.

---

## 6. Deploying the contract

Using **Account #0's** private key (so it becomes the admin):

```bash
forge script script/Deploy.s.sol:DeployStreamPay \
  --rpc-url http://127.0.0.1:8545 \
  --private-key <ACCOUNT_0_PRIVATE_KEY> \
  --broadcast
```

Copy the printed contract address, then open `frontend/app.js` and paste it
in:

```js
const CONTRACT_ADDRESS = "0xPASTE_YOUR_DEPLOYED_ADDRESS_HERE";
```

---

## 7. Running the frontend

Any static file server works. Simplest option with Node installed:

```bash
npx serve frontend
```

Or with VS Code's *Live Server* extension: right-click
`frontend/index.html` → *Open with Live Server*.

Open the printed local URL in your browser, click **Connect MetaMask**,
and pick whichever imported account you want to act as (Admin, Employer,
or Employee — the app detects your role automatically).

---

## 8. Uploading to GitHub

```bash
git init
git add -A
git commit -m "StreamPay: contract, tests, deploy script, frontend"
git branch -M main
git remote add origin <your-group-repo-url>
git push -u origin main
```

If you used `forge install`, `lib/forge-std` is a git submodule by
default — either commit it as a submodule, or make sure whoever clones
your repo runs `forge install foundry-rs/forge-std --no-commit` before
`forge build`, so the project builds on a fresh clone.

**A `.gitignore` is included** so `out/`, `cache/`, and `broadcast/` (build
artifacts, not source) don't get committed.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| MetaMask stuck / nonce errors after restarting Anvil | Anvil resets its chain state on restart, but MetaMask remembers old nonces. MetaMask → Settings → Advanced → *Clear activity tab data* for that account. |
| `forge test` can't find `forge-std/Test.sol` | Run `forge install foundry-rs/forge-std --no-commit` from the project root. |
| Frontend shows nothing after connecting | Check the browser console — usually `CONTRACT_ADDRESS` in `app.js` wasn't updated after a redeploy, or MetaMask is on the wrong network. |
| Transaction reverts with "Duration must be more than 15 seconds" | The contract requires duration > 15 seconds. Use something like `60` for quick local testing. |
