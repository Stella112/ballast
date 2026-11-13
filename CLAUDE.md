BALLAST — MASTER BUILD CONTRACT FOR CLAUDE CODE
Read this entire file before doing anything. Treat it as the highest-priority repository-level engineering instruction, subject to the human's instructions and safety requirements.

Project: Ballast · Network: Mezo testnet · Hackathon: Mezo Buildathon, Wave 2 · Deadline: November 15, 2026 (verify the exact platform timezone; the supplied AKINDO timeline shows 16:00 in the user's Nigeria context). Primary track: Track 1 — DeFi; secondary relevance: Track 2 — Access & Distribution.

Owner: Maris (human product owner). You are Claude Code, the sole implementation engineer. The human approves product tradeoffs and sensitive transactions. You own research, architecture, code, test execution, testnet deployment, frontend, integration proofs, documentation, and submission preparation. Do not claim you have deployed, tested, or verified anything until your tools have actually done so.

0. Non-negotiable operating contract
Mission: Ship a real, secure-enough-for-a-clearly-labeled-unaudited-testnet-demo Ballast MVP, not an attractive prototype with fake states. Optimize for a reproducible, provable on-chain end-to-end flow by the deadline. There are no prizes for code volume or feature count.

Priority order: (1) avoid fund loss and secret exposure; (2) truthful testnet operation; (3) Mezo integration and correctness; (4) complete end-to-end demo; (5) core UX; (6) P1 expansions; (7) polish and submission.
Absolute mandates
1. No hallucinations. Never invent function selectors, token decimals, chain IDs, deployment addresses, addresses of a Morpho market, actual liquidity, contract existence, oracle behavior, bridge support, transaction hashes, tests passing, users, metrics, or prize requirements. Distinguish VERIFIED, ASSUMED, UNVERIFIED, BLOCKED in your notes. Link each verified external fact to the official URL, source-file path/commit, or explorer transaction.
2. Source-of-truth hierarchy: (a) live on-chain state/bytecode and successful transactions; (b) verified deployed proxy implementation + ABI; (c) official Mezo/Wormhole/Morpho documentation and upstream repos at pinned commits; (d) reproducible source-level tests; (e) third-party repos such as Levada as leads only; (f) earlier conversations or this specification as requirements, not proof. When sources conflict, investigate; do not guess.
3. No fake integration: mock tokens, fake wallets, local-only settlements, hard-coded loan balances, placeholder explorer links, prefilled fake receipts, or mock price shocks must never be represented as public testnet results. A controlled local-fork price-shock simulation is acceptable only in a conspicuously labeled Simulation panel and separate demo segment.
4. No scope creep: Do not add a new stablecoin, token launch, proprietary bridge, new Morpho market, general lending protocol, complex keeper network, yield vault, autonomous AI trading, mainnet deployment, or external database unless specifically required to unblock P0 and authorized by the owner. Do not independently replace Morpho Hedge with a new insurance/option market.
5. No exposed secrets: Use .env.local / .env ignored by git; commit .env.example only. Never print or store private keys, seed phrases, signatures intended to be private, API secrets, or credentials in logs, commits, screenshots, deployment artifacts, or chat. Confirm .gitignore; inspect git diff --cached before any commit. Do not send secrets to public endpoints. Never request the owner's seed phrase.
6. Deploy only to approved testnets. Use a funded disposable test wallet, least-privilege keys, and test assets. Do not deploy to mainnet or spend real funds without specific owner approval. If the human must approve a wallet transaction, give the exact destination, chain, function, value, and expected result; do not pretend it was approved.
7. Every pass has evidence. forge test output, compile status, chain ID checks, contract bytecode, deployed addresses, tx hashes, receipt status, events, before/after reads, and UI build output are required. Code that compiles is NOT a working integration.
8. Never hide failures. After one hypothesis fails, inspect the error and isolate the root cause. Do not retry blindly, flip random flags, or weaken security checks to make tests green. Report true blockers with supporting output and a scoped fallback.
9. Do not stop at scaffolding. Continue executing independently through milestones, running tests and fixing defects. Ask the human only for actions you cannot perform safely (wallet approvals, test funds, inaccessible credentials, final submission, ambiguous material scope changes). Do not repeatedly ask to continue after each routine step.
10. Time discipline. Once P0 is green, stop adding risky features to protect submission. Produce a working deliverable even if optional Base/Hedge features fail.
Output/reporting protocol
Maintain these real repo files as you work:
- docs/VERIFICATION.md — source links, on-chain checks, exact confirmations and dates.
- docs/BUILD_LOG.md — timestamped milestones, decisions, failures, fixes, commands, test output summaries.
- docs/STATUS.md — task checklist (NOT STARTED | IN PROGRESS | VERIFIED | BLOCKED | DEFERRED) with next action.
- docs/DEPLOYMENTS.md — chain, contract addresses, verification links, tx hashes, verified ABIs, commit SHA.
- docs/SECURITY.md — threat model, privileges, trust assumptions, residual risks, unaudited warnings.
- docs/TEST_EVIDENCE.md — test command outputs and at least one public testnet end-to-end proof.
At meaningful milestones, report briefly: what changed, what was tested, exact evidence, what is blocked, and next action. Be precise and never label planned work as completed. Keep a concise resume point after each stage. Do not spend the user's limited time producing speculative essays instead of functioning code.
1. Product contract: exactly what Ballast is
Name: BALLAST

Tagline: Protect your Bitcoin. Strengthen your loan.

One-liner: The cash-flow autopilot for Bitcoin-backed loans: every MUSD payment you receive can make your Mezo loan safer.

Problem: Mezo borrowers with BTC collateral face two different risks: liquidation if their collateral ratio falls sufficiently, and redemption of BTC collateral from lower-ratio troves even if they have not been liquidated. Merchants and freelancers receiving MUSD income currently need separate manual actions to put earnings toward repayment.

Primary customer: A freelancer or business holding BTC, opening a Mezo MUSD loan, and receiving repeat payments.

Core differentiation: Income-driven, policy-controlled automatic MUSD repayment tied to an actual redemption-order simulator. The borrower can see how much repayment is required to move past particular positions and what their completed payment actually changed. The system is reusable by other apps through a small routing interface.

Do not claim: first automated repayment, guaranteed redemption safety, guaranteed liquidation protection, guaranteed positive hedge returns, a verified redemption-hit ratio, or established user demand. Cermin and other projects already provide parts of loan automation.
Intended experience
1. Borrower connects a wallet on Mezo testnet.
2. Borrower creates a Ballast contract account with an ERC-721 account NFT; current NFT holder is the authoritative controller (ownerOf, not an unchangeable original EOA). For hackathon safety, disable transferring an NFT while its account has an active trove by default, and clearly disclose the constraint. Future fully transferrable positions require additional engineering. Never strand account access if an NFT is transferred/disabled.
3. Borrower opens a real Mezo trove owned by the account contract, funded with actual testnet BTC. They can withdraw borrowed testnet MUSD using an owner-authorized function.
4. Borrower chooses one policy preset: Keep my BTC, Get out of debt, Keep cash available. These are transparent default percentages and constraints, not an unexplained AI or optimization engine. Every choice is editable.
5. Borrower creates an MUSD invoice link. Customer pays through BallastRouter on Mezo testnet.
6. Router atomically distributes payment among (a) spendable recipient, (b) configured hedge reserve (liquid MUSD, not active protection), and (c) actual Mezo loan repayment from the contract-owned account. The policy must have clear basis points totaling 10,000, with no underflow, overflow, or rounding losses.
7. A new on-chain read proves actual debt reduction and computes the updated collateral ratio and current redemption-list position. Show exact tx and block number.
8. As feasible, Base Sepolia USDC payment can be converted, bridged, delivered as actual canonical testnet MUSD, and routed to the same account. This is not assumed available; prove all substeps before calling it live.
9. As feasible, an optional Morpho BTC short hedge operates on verified Mezo testnet markets with borrowable BTC ERC-20, genuine liquidity, suitable MUSD collateral, correct oracle, and real settlement. If these do not exist, label Hedge Simulation / Planned integration and never represent it as working on-chain.
Existing Mezo troves: Cannot be assumed movable into a smart account. Provide a read-only existing-trove path and, if time allows, an explicitly signed one-off repayment path using Mezo's verified signature interface. Never suggest it has perpetual permission.

Track: Track 1 is primary; describe Track 2 relevance from payment distribution if permitted by AKINDO. Actual chain integrations, not tab labels, decide claims.
2. Sources and testnet configuration: inspect; never blindly trust
Before writing integration code, read these sources. Record access date, current commit/ref, contracts and exact verified selectors in docs/VERIFICATION.md:

Official Mezo
- Developer guide/network: https://mezo.org/docs/developers/getting-started/
- Developer environment: https://mezo.org/docs/developers/getting-started/configure-environment/
- MUSD integration: https://mezo.org/docs/developers/musd/
- MUSD redemption mechanics: https://mezo.org/docs/developers/musd/musd-redemptions/
- MUSD source: https://github.com/mezo-org/musd
- Official contracts reference: https://mezo.org/docs/users/resources/contracts-reference/
- Borrow and debt floor: https://mezo.org/docs/users/borrow/mint-musd/
- Mezo Pools: https://mezo.org/docs/developers/features/mezo-pools/
- MUSD bridge: https://mezo.org/docs/developers/bridge/wormhole-musd-bridge/
- Testnet app: https://testnet.mezo.org
- Testnet faucet: https://faucet.test.mezo.org/
- Explorer: https://explorer.test.mezo.org/
- Documentation index: https://mezo.org/docs/llms.txt
- Buildathon: https://app.akindo.io/wave-hacks/OVOO0gdrVU8379D10?tab=overview
Wormhole / Morpho
- Wormhole docs: https://wormhole.com/docs/
- NTT docs: https://wormhole.com/docs/products/token-transfers/native-token-transfers/overview/
- Morpho docs: https://docs.morpho.org/
- Morpho source: https://github.com/morpho-org
- Morpho markets require actual supported ERC-20 collateral/loan assets, an accepted oracle and available borrow liquidity. A token wrapper alone is not a hedge.
Known Mezo testnet network values, still verify via RPC:
- Chain ID: 31611; RPC: https://rpc.test.mezo.org; explorer: https://explorer.test.mezo.org/; native gas currency: BTC, 18 decimals; recommended Foundry EVM version: london unless deployed opcode/library needs dictate otherwise.
- Base Sepolia chain ID: 84532 (verify before use).
- Mezo testnet MUSD (documentation): 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503 (verify token bytecode and decimals(), expected 18).
- Candidate Mezo testnet proxies from official redemption docs (VERIFY AGAINST LIVE EXPLORER AND IMPLEMENTATION, NOT ASSUMED CONSTANTS):
  - BorrowerOperations: 0xCdF7028ceAB81fA0C6971208e83fa7872994beE5
  - TroveManager: 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0
  - SortedTroves: 0x722E4D24FD6Ff8b0AC679450F3D91294607268fA
  - HintHelpers: 0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6
  - PriceFeed: 0x86bCF0841622a5dAC14A313a15f96A95421b9366
- MUSD borrow floor shown in official docs: 1,800 MUSD borrowed principal plus 200 MUSD gas-compensation deposit = at least 2,000 MUSD opening debt. Validate exact live protocol constants, interest, borrowing fee and repayment restrictions. Never equate 2,000 total debt with a 2,000 spendable balance.
- Mezo documentation shows mainnet MUSD NTT contracts for Base/Ethereum/Mezo; this is NOT evidence of a supported Base Sepolia USDC → Mezo testnet MUSD route.
Verification steps (mandatory):
1. eth_chainId resolves to 31611; check block height. If no RPC connectivity, state a blocker.
2. eth_getCode is non-empty at all required deployed addresses. Confirm proxy address versus implementation; retrieve matching ABI from explorer or pinned source/artifacts.
3. Read MUSD name, symbol, decimals, and contract ABI, and reconcile with docs.
4. Inspect BorrowerOperations.openTrove, repayMUSD, withdrawMUSD, relevant signed operations, trove status read methods, hints, debt/interest, and protocol modes in actual source. Do not fabricate callable interfaces or ABI strings.
5. Verify how contract-owned troves behave with internal msg.sender, coin transfer/gas handling, and account contract payable receive semantics, using real tests.
6. Validate any candidate price feed's units, decimal precision, staleness/failure flags and whether it can be treated as public oracle data.
7. Write a machine-readable config/deployments.mezo-testnet.json with provenance comments in the adjacent docs, not unsourced guessed addresses.
3. Locked scope, priorities, and hard acceptance gates
P0 — Must complete; submit even if P1 fails
P0-A — Contract-owned loan
- Factory deploys account; mints corresponding ERC-721 account NFT.
- Only NFT owner can open a loan, change policy, withdraw free funds, close a loan, or approve external integrations.
- Account itself owns a real Mezo trove. Show TroveManager's key = account address.
- Account can perform a valid partial repayment under an already stored approved policy without a new owner signature for each receipt.
- Prove actual MUSD mint/borrow, owner withdrawal capability, actual partial repayment and refreshed state.
Gate A: Confirmed public testnet tx(s), a real account-owned trove, a debt decrease, correct permissions, and reproducible integration test. If it fails, repair this before building a polished UI.

P0-B — Atomic incoming-payment split and repayment
- Router accepts ERC-20 transferFrom from a payer only through an explicit payInvoice/`pay` call; an arbitrary direct ERC-20 transfer is not a trigger.
- Amounts and payment targets come from account-owned config, NOT payer-supplied arbitrary addresses.
- Policy splits in integer basis points, exact accounting for rounding remainder, independent spendable/repay/hedge-reserve balances.
- Rule update requires NFT owner, limited to bounds; no router admin power to drain a loan account.
- Router is not allowed broad or arbitrary account execution. Use one narrow repay entry point with account binding and input constraints.
- Any failure in the repayment path must revert the whole payment for the initial atomic MVP. Later reserve/retry is a different design requiring owner approval.
- Must handle remaining minimum loan size, full closure special case, fees and current balance correctly.
Gate B: A different wallet pays 100 testnet MUSD, an example 20/5/75 split is proven by token balance deltas, and a fresh Mezo read proves real loan debt decreased by the actual accepted repayment amount. All part of a clear, atomic or explicitly documented transaction sequence; do not imply atomic if there were multiple transactions.

P0-C — Redemption Radar
- Read on-chain SortedTroves ordering and relevant TroveManager data at a known block/snapshot.
- Show exact current index/rank only if traversal and membership are verified; otherwise show order relative to verified neighbors. Avoid rank = index assumptions, reversed sort order and double-counting.
- Use official nominal ICR (NICR) vs current price-based ICR correctly. Determine how the sorted list actually orders positions (include tie handling). Do not mistake health ratio for redemption probability.
- Calculate how much debt must be repaid to pass the next position / selected neighbor / configurable 10 or 50 positions using live state, fees, total debt and Mezo minimum debt. Beware numerator/denominator precision, rounding up, and the 200 MUSD gas-compensation component.
- Display liquidation-price estimate using verified threshold and debt read; distinguish estimate from guaranteed safe price, and note execution lag/redemption risks.
- Recompute hints and simulate before repayment; re-read after receipt; display tx and block numbers, actual before/after state and freshness.
- Handle empty list, one trove, ties, untraversable/unavailable slots, many positions, pagination, rate limits and chain reorg/stale responses. No expensive full-chain synchronous browser loops; use server-side read/indexing if needed, still verify against chain.
Gate C: Show a repayment target quote, actual payment, new Mezo debt and verified change in ordering, or accurately show 'no rank change' if that is the actual result. Do not stage a false move in line.

P0-D — Sample invoice/payment integration
- Generate simple unique invoice link with amount, account reference and merchant metadata. For MVP, immutable invoice metadata can be in signed server-side storage or encoded safely; no second on-chain registry unless necessary.
- Validate expiry and replay protection. Track paid/unpaid/partial according to explicit policy; for MVP restrict to single exact payment if simpler.
- Separate wallet pays invoice on Mezo using actual MUSD and can view explorer receipt; merchant sees actual split, before/after debt and policy.
Gate D: A judge with two wallets and test MUSD can follow docs/DEMO.md to reproduce the flow without administrative keys or fake state.

P0-E — Tests, deployed frontend, docs, submission
- Responsive, accessible, usable app; exact testnet and wallet wrong-chain handling.
- Foundry tests + integration evidence; public GitHub, deployed testnet app, clear architecture/deployment/security/readme and two-minute recorded pitch + deck content.
- Make submission form copy ready in docs/AKINDO_SUBMISSION.md including all fields.
P1 — Investigate and implement only after Gates A–D are green
P1-Base — Pay from Base Sepolia
- Goal: genuine testnet USDC on Base Sepolia becomes actual spendable canonical Mezo testnet MUSD, then the same Ballast router receives/routes/repays.
- Perform separate feasibility gates: (1) identify genuine Base Sepolia USDC contract and exact issuer/faucet; (2) find an actual swap path or clearly identify that none exists; (3) find compatible live Wormhole NTT bridge peers for these exact testnets and tokens; (4) verify source/destination addresses, token decimals, peers, transceiver and relayer/config, redemption, fees and finality; (5) execute and independently verify a low-value transfer; (6) route received MUSD into Ballast.
- Inspect the Levada README/repo, if supplied or discoverable, as an untrusted lead; do not assume its claims are true. Require transaction links and contract bytecode. No mainnet token or mainnet contract in testnet transactions.
- If canonical route does not exist, record BLOCKED: no verified Base Sepolia USDC-to-Mezo testnet MUSD path. Do not invent a bridge or substitute a centrally held liquidity relayer while claiming Wormhole functionality. A distinct experimental relay requires explicit approval and fully truthful labeling, and must never replace P0.
P1-Hedge — Verify Morpho short before implementing
- Proposed optional method: collateralize MUSD on a Morpho market where the loan asset is a recognized BTC ERC-20, borrow BTC with actual lender liquidity, sell for MUSD through a real testnet pool, and later buy BTC to close the short. Evaluate risk and show actual P/L including borrow interest, fees, swap slippage, liquidations, oracles and repayment.
- A known Mezo Morpho BTC/mUSDC BTC collateral / mUSDC loan market is the reverse direction; it does not prove borrowable BTC.
- Check Morpho deployment, exact market parameters, loan asset, collateral asset, LLTV, IRM, oracle, market ID, supply, available liquidity, token approval behavior and accepted price. Inspect official docs / Morpho source / live chain.
- Be particularly careful: BTC on Mezo can be a native gas asset or special token representation. Morpho requires a standard accepted ERC-20 loan asset; a 'thin wrapper' requires actual backing, liquidity and correct accounting. Do not fabricate BTC liquidity. Creating and funding a new lending market is out of MVP scope unless human authorizes it and economic/security validation is possible.
- If the market or oracle is missing, mark Hedge Simulation and make its UI use explicitly synthetic numbers only. Show the roadmap, not pretend the short executed. No falsely risk-free or 'losses only a little' claims: a short can be liquidated even if the BTC loan collateral elsewhere gains value.
- No risky live leverage or mainnet positions.
P2 — After hackathon
- Transferable indebted account NFTs after security work, generalized cross-chain settlement, invoice NFTs, public SDK, advanced hedge liquidity, mainnet hardening and audits. None may block P0.
4. Contract architecture (minimal; verify against deployed ABI)
Prefer Solidity 0.8.24 or compatible version verified from upstream + toolchain, Foundry, OpenZeppelin audited primitives at pinned versions, custom errors, NatSpec for externally callable financial methods, no upgradeable proxy unless truly necessary. Use london EVM in Foundry config to match Mezo documentation, if compatible.
BallastFactory.sol
- Deploy deterministic/simple BallastAccount instances; store mapping tokenId -> account and account -> tokenId.
- Mint the ERC-721 controller NFT to the borrower; safely initialize owner/account relation.
- Avoid predictability-based authority. Emit AccountCreated(tokenId, account, owner).
- Verify no one can initialize an account twice or mint another NFT controlling an existing account.
BallastAccountNFT.sol
- ERC-721 with ownerOf(tokenId) used by BallastAccount as the authorization oracle.
- Restrict active-loan transfers until a deliberately implemented safe-transfer mechanism exists. Test mint, transfer restriction, burn restriction, access after attempted transfer and never permit NFTs to be transferred to an inaccessible contract by default.
- UI disclosure: account NFT controls BTC-backed financial assets; avoid suggesting safe unrestricted sale/transfer.
BallastAccount.sol
- Has immutable trusted addresses (factory/NFT/router/Mezo contracts/token) or tightly controlled initialization; optional emergency pause cannot confiscate funds.
- onlyController checks current NFT owner for owner actions; do not cache old owner as permanent authority.
- onlyRouter for a narrow applyRepayment(...) function only; no router arbitrary execution or collateral withdrawal.
- receive() and payable ownership operations correctly handle BTC native gas/collateral. Distinguish free BTC balance from BTC locked inside Mezo.
- Open Mezo trove from account address with payable collateral; use dynamic hints and proper fee/debt calculations. Verify msg.sender ownership model.
- Owner can withdraw only available free MUSD/BTC (never direct drain of trove collateral via router), pause Payback, change policy, request close, and recover supported stray ERC-20 tokens safely.
- Default router configuration and policy cannot be changed by payer. Repay only into its own trove; no arbitrary borrower destination.
- Mezo repayments use exact deployed interfaces; never store a privileged EOA key on server for automated repayment.
- Runtime checks cover active trove, available MUSD, amount zero, minimum remaining net debt, total debt and interest, and protocol recovery behavior.
BallastRouter.sol
- Exact MUSD ERC-20 balance/transfer accounting with SafeERC20, reentrancy guard and appropriate invoice replay protection.
- Compute repay = amount*bps/10000, hedgeReserve = amount*bps/10000, and spendable = amount - repay - hedgeReserve; define rounding recipient. Require repayBps + hedgeBps <= 10000.
- payInvoice takes account identifier, invoice identifier and amount; identifies account from factory, pulls token from payer, forwards remaining balances and invokes narrow account repayment. Do not trust merchant wallet or payer target supplied in unverified calldata.
- Any external callback/approval and downstream Mezo operation is an attack surface. Use check-effects-interactions, bounded allowance, reentrancy controls, and tests for malicious ERC-20 behavior.
- No protocol fee unless owner explicitly approves; transparent exact fee display if later enabled.
- If the router cannot safely trigger direct repayment with transferred MUSD, study token allowance/custody and repayment call context; change to a two-step pre-funded account pattern only if semantics are accurately represented and approved.
- Emit events with invoice identifier, payer, account, split amounts, Mezo tx (if same chain event), actual repaid value and relevant metadata. Avoid sensitive metadata on-chain.
Radar read model (prefer read-only TypeScript, not an on-chain contract)
- No new protocol contract unless unavoidable. A deterministic client/server read package uses viem and verified ABIs to read Mezo's SortedTroves / TroveManager / HintHelpers / PriceFeed.
- All financial math uses bigint or verified full-precision utilities, never JS floating point for wei-based action amounts. Format UI with precision only at display boundaries.
- Protect against stale quote execution, paging errors, out-of-gas traversal, and chain tip differences. Store the block number and query timestamp; use fresh hints before transaction.
- In simulated calculations, enforce post-repayment floor and show if target cannot be reached without full closure.
Existing trove one-off support (optional)
- Read an existing EOA trove and support repayMUSDWithSignature ONLY after verifying deployed EIP-712 domain, parameter types, signer, nonce, deadline, hint logic, token source and transaction simulation. No reusable signature claim. Put behind a separate path if it competes with P0 time.
5. Security and mathematical correctness requirements
Produce a concise threat model before deploying any financial contract. Enumerate assets, trusted parties, controls and likely attacker entry points: payer, invoice, merchant, NFT holder, router, third-party external calls, Mezo contracts, token callbacks, relayer, oracle, forged off-chain data, Web2 server, and compromised hot wallet.

Required security properties
- Unauthorized user cannot open/reconfigure/recover/withdraw/close a trove or change destination.
- Router can repay only its designated account's trove; cannot transfer its BTC collateral or withdraw owner-controlled assets.
- Active-trove NFT cannot be transferred or burned unexpectedly.
- One invoice cannot be paid twice if it is specified single-use. invoiceId must be scoped to account/chain and bound to amount, expiry, and recipient.
- No reentrancy withdrawals/repayment double counting.
- Split transfers conserve exact token amount. Failed atomic payment cannot credit successful partial state.
- Repayment must obey min remaining debt and handle debt/interest changes. borrowed principal, total debt, net debt, gas compensation, and repayable amount are not interchangeable.
- A receipt does not mark success until mined with status=1 and post-state verified at sufficient confirmation depth for the demo.
- Quotes are not guarantees; transaction can revert or use a different tip if on-chain ordering changes. Display failed/replaced transactions accurately.
- Access control must not be based on frontend visibility, wallet connection UI or an unsafe server token.
- Backend cannot unilaterally drain assets or open positions; no hidden privileged operator or arbitrary owner bypass.
- Zero/repeated/slippage token anomalies and decimal mismatch handled. Do not assume fee-on-transfer tokens are supported; if MUSD is standard, verify.
- Only disposable testnet accounts hold deployer/operator keys; never use user's production wallet for deployment.
Risk reporting: Redemption may affect healthy loans; queue placement is not a guarantee; liquidation is possible in volatile markets; borrowing costs accrue; testnet is not an audit; cross-chain funds can be delayed or fail; Morpho shorts can lose money and be liquidated.
6. UX and frontend specification
Stack: Next.js (App Router), TypeScript strict, Tailwind CSS, shadcn/ui, wagmi, viem, a concise open-source chart library if needed, Foundry for contracts. Add only necessary packages and pin versions after compatibility checks. Prefer small readable functions over giant generated files.

Design: serious financial product; responsive mobile and desktop; clean light/dark surfaces; strong contrast; a muted BTC-gold accent; no AI-generated fake balances or overly animated dashboards. Have accessible labels, loading states, error states, explicit chains, readable transaction confirmations and meaningful empty states.

Routes
1. / — value proposition, real testnet badge, Connect Wallet, how it works, risks.
2. /app — account overview: NFT/account address, controller wallet, actual trove, BTC collateral, MUSD debt, ICR, interest/risk warnings, free BTC and MUSD, strategy status. Provide create/open/withdraw/repay actions.
3. /app/payback — presets, custom percentages, minimum cash reserve, hedge reserve explicitly labeled uninvested MUSD, paused status, recent receipts.
4. /app/radar — current sorted queue neighbor display, 10/50 target estimator if safely queryable, repayment needed, liquidation price estimate, verified before/after transaction results and live chain block.
5. /app/invoices — create link; payer-friendly separate /pay/[invoiceId] with clear MUSD amount, connected chain, merchant, approval/pay state and receipt.
6. /app/activity — events and explorer links, real status and filters.
7. /app/hedge — enabled only if a real verified Morpho market exists. Otherwise prominent SIMULATION — NO REAL HEDGE OPENED, source/assumptions and roadmap.
8. /demo — linear judge instructions including funded-wallet prerequisites and example real transaction history; label past demos vs runnable fresh ones.
Network errors: Identify wrong chain and offer add/switch to Mezo testnet. Detect missing MUSD balance and BTC gas. Show explorer links formed only from the VERIFIED explorer base and actual hashes. All deployed addresses come from generated deployment config, not manually copied into many components.

Key UI states: no wallet, no account, NFT minted but no trove, active loan, repayment pending, invoice pending, paid, payout reserve uninvested, closed trove, stale RPC, insufficient gas, min debt restriction, bridge not available, real hedge unverified. Never display fabricated demo data in a live dashboard.
7. Architecture, repository layout, development scripts
Create or preserve this structure, adapting only to existing repo conventions:
ballast/
  CLAUDE.md
  README.md
  package.json
  pnpm-lock.yaml
  .env.example
  .gitignore
  foundry.toml
  app/
    page.tsx
    app/page.tsx
    app/payback/page.tsx
    app/radar/page.tsx
    app/invoices/page.tsx
    app/activity/page.tsx
    app/hedge/page.tsx
    pay/[invoiceId]/page.tsx
    demo/page.tsx
  components/
  lib/
    chains.ts
    config.ts
    contracts/
    mezo/
    radar/
    invoices/
  contracts/
    src/BallastFactory.sol
    src/BallastAccountNFT.sol
    src/BallastAccount.sol
    src/BallastRouter.sol
    interfaces/
    test/
    script/
  config/
    deployments.mezo-testnet.json
  docs/
    VERIFICATION.md
    BUILD_LOG.md
    STATUS.md
    DEPLOYMENTS.md
    SECURITY.md
    TEST_EVIDENCE.md
    ARCHITECTURE.md
    DEMO.md
    AKINDO_SUBMISSION.md
    ROADMAP.md
Preferred commands after setup (adjust to real scripts; do not fabricate successes):
pnpm install
forge --version
forge build
forge test -vvv
forge fmt --check
pnpm lint
pnpm typecheck
pnpm build
# Optional if installed: slither ., test coverage and invariant/fuzz runs
Use a local Foundry chain/fork for reproducible tests. Separate local unit tests, Mezo fork tests and LIVE public testnet tests with environment guards so ordinary CI cannot broadcast transactions.

Keep upstream source outside contracts/src or pin library dependency, to avoid accidental edits to Mezo protocol source.

Environment example only (do not fill with guessed secrets):
NEXT_PUBLIC_MEZO_RPC_URL=https://rpc.test.mezo.org
NEXT_PUBLIC_MEZO_CHAIN_ID=31611
NEXT_PUBLIC_MEZO_EXPLORER=https://explorer.test.mezo.org
NEXT_PUBLIC_MEZO_MUSD_ADDRESS= # verified from explorer before filling
MEZO_TESTNET_RPC_URL=https://rpc.test.mezo.org
DEPLOYER_PRIVATE_KEY= # disposable TESTNET-only key, never commit
BASE_SEPOLIA_RPC_URL= # only if working on P1 Base
# optional public backend/indexer URLs once actually implemented
Create clean deployment scripts with dry-run/preflight logs, per-chain confirmation, bytecode validation, transaction simulations where possible, and JSON outputs. Never overwrite verified deployment metadata with unverified results.
8. Test matrix and proof obligations
Unit / fuzz / invariant tests
Factory/NFT/account
- Factory creates unique account; cannot reinitialize; token controls correct account.
- Nonholder cannot open, pause, change rule, withdraw, close or redirect MUSD.
- Active-loan NFT transfer/burn blocked; holder retains permissions; no orphaned accounts.
- Contract receives BTC correctly; only legitimate free funds withdrawable; owner can withdraw borrowed MUSD safely.
- Reject nonexistent account, incorrect router, malicious router caller, zero address, duplicate invoice and invalid bps.
Router
- Example 100 MUSD with 20% repayment, 5% reserve, 75% spendable reconciles exactly in wei.
- All 0%, 100%, odd/dust amounts, minimum viable payment, rounding and overflow.
- Reentrancy/attempted token callback cannot double spend.
- Payment with insufficient allowance or balance reverts without partial state.
- Repayment failure reverts entire payment; invalid debt floor is surfaced explicitly.
- Invoice expiry/replay/payer manipulations fail.
Mezo/Radar
- Fork test account open/partial repay and resulting debt delta.
- Interest/gas compensation correctly accounted for.
- Hints fresh enough or failure handled; next/prev traversal in the right direction.
- Compare calculations to actual Mezo protocol methods and on-chain list.
- Correct ICR and NICR distinction, rounding and estimated liquidation price.
- Empty sorted list, large list, boundaries, dynamic ordering, stale snapshots, no movement and a successful movement.
P1 security
- If Base included: source/destination chain, token, decimal, replay, settlement confirmation and provenance checks.
- If Hedge included: correct asset orientation, live liquidity, oracle freshness, price unit and LLTV, slippage bounds, liquidations, cost, unwind test. No unsafe profit assumption.
Mandatory live public testnet receipts
1. Factory/account/NFT deployment and account creation tx, plus NFT owner and account address read.
2. Account opens genuine Mezo testnet trove; log Mezo protocol trove state before income.
3. Actual payer wallet funds and pays a testnet MUSD invoice.
4. Actual MUSD split is visible by recipient/account balance deltas/events.
5. Actual repayment changed protocol debt; confirm post-state at a fresh block.
6. Redemption Radar displays truthful before/after list state; if no move occurred, say so and demonstrate correct quote, not a fabricated position improvement.
7. Optional Base/Hedge separate evidence; if unavailable, mark as unavailable on UI and in submission.
docs/TEST_EVIDENCE.md needs hashes, linked explorer pages, addresses, exact commands, the block numbers for each read and pass/fail interpretation. No transaction hash = no claim of a verified transaction.
9. Work order: execute without drifting
Stage 0 — Repo and dependency audit (first action)
1. Inspect pwd, existing repository contents, git status, package scripts and installed tools. Preserve existing useful code; don't overwrite uncommitted changes.
2. Read CLAUDE.md; list requirements and acceptance gates in docs/STATUS.md.
3. Verify official docs/source/deployed proxy ABIs and live RPC chain. Keep exact evidence in docs/VERIFICATION.md.
4. Identify deployment signer and whether it has enough testnet-only BTC; do not request secrets in chat.
5. Write a terse implementation plan and threat model; then start coding.
Stage 1 — First hard gate: contract-owned trove
1. Write smallest BallastAccount capable of receiving test BTC, calling verified BorrowerOperations.openTrove, withdrawing free MUSD to controller, and doing a correct partial repayment. Avoid NFT/router until proven if that speeds verification.
2. Unit + Mezo fork tests; check exact method signature using official ABI; compile.
3. Deploy the minimal test account to Mezo testnet and open a real trove; record source and explorer proof.
4. Make a real partial repayment and confirm changed Mezo debt.
5. Only after Gate A, attach factory/NFT control and retest. If contract-owned trove doesn't work, diagnose exact revert and check account value/caller constraints before changing architecture.
Stage 2 — End-to-end Payback
1. Implement NFT/factory/account privileges and narrow router role.
2. Implement policy and atomic MUSD split with exact conservation.
3. Create one invoice payable by second testnet wallet.
4. Prove real split and debt repayment; save before/after reads and event logs.
Stage 3 — Signature feature: Redemption Radar
1. Determine verified sorted-list ordering and optional pagination strategy.
2. Implement neighbor/target debt quote, liquidation estimate and block-aware state.
3. Demonstrate true pre/post position. If the list is too small, show honest positioning and don't fabricate a 50-trove example.
Stage 4 — UX/Deployment/Demo (must start before P1)
1. Build pages and wallet flow; integrate all real reads/actions.
2. Test desktop/mobile UI and wrong-chain/error behavior.
3. Deploy site, verify release build, publish README, contracts and reproducible demo.
4. Prepare two-minute video script, pitch deck outline, submission copy.
Stage 5 — Optional, time-gated P1 spikes
- Check Base feasibility in isolation, then Morpho hedge, with a strict requirement to preserve the working P0 branch.
- Do not pause core bug fixes to chase unverified testnet bridge or unused market creation.
- Every optional feature needs a full end-to-end proof or is marked DEFERRED/`SIMULATED`. Do not show a partially implemented bridge or uncollateralized hedge as working.
Final freeze
- Stop adding features when the deadline is close. Re-run full tests, build, smoke test public deployment, confirm correct addresses, record video, finish docs and submit.
- Determine exact AKINDO cutoff/timezone on the platform, not assumed from chat. Plan earlier internal freeze.
- If the platform requires human upload/submission, create all required files and give the human the exact upload checklist; never claim a submission was made without platform confirmation.
10. Submission content (must be generated from verified implementation)
Write docs/AKINDO_SUBMISSION.md with these completed fields (use TODO — NEEDS VERIFIED RESULT instead of invented data):
- Project name: BALLAST
- Category: Automated BTC Debt Repayment
- Track: Track 1 — DeFi; Track 2 only if appropriate and accepted.
- One-line: The cash-flow autopilot for Bitcoin-backed loans: every MUSD payment you receive can make your Mezo loan safer.
- TL;DR, user problem, how it works, Mezo integration, technical architecture.
- Target users, why this is useful for Mezo, measured proof and limitations.
- Chain deployed: Mezo testnet (31611). If Base demo works, cite separate Base Sepolia details, never confuse it with Mezo deployment.
- Status/readiness, GitHub repo URL, live frontend URL, explorer addresses and transactions.
- Tech stack, security tests and assumptions, two-minute demo video URL, product deck URL.
- Team member(s)/roles using only owner-provided verified details; no invented collaborators.
- Three future milestones with timelines, mainnet security review, distribution via invoice SDK, conditional cross-chain and hedge development.
- Honest disclaimer: testnet, unaudited, no guaranteed redemption/liquidation protection, no verified product demand yet.
Suggested two-minute demo structure
- 0–15 sec: Mezo borrowing gives BTC holders liquidity, but redemptions and price drops remain risks.
- 15–35 sec: Show Ballast NFT controlling a real contract-owned Mezo trove; display real debt, collateral and current redemption position.
- 35–55 sec: Configure borrower-owned 20% Payback / 5% hedge reserve / 75% spendable allocation and create invoice.
- 55–85 sec: From second wallet, pay actual testnet MUSD; show transfers, Mezo repayment, actual tx hash.
- 85–105 sec: Fresh chain read confirms new debt/ratio and actual updated redemption position; show before/after evidence.
- 105–120 sec: Explain developer router composability and honestly display Base/Hedge status: verified live if proven, otherwise in roadmap. Never substitute slides for on-chain evidence.
README quality bar
Provide one-sentence explanation, screenshot, verified live demo, sample test wallets/how to get test MUSD, developer setup, deployed addresses, exact forge test/`pnpm build` commands, architecture, security limitations, and short roadmap. Public code must be runnable from a clean clone.
11. Rules for resolving uncertainty and blockers
For each external dependency, log:
Requirement	Source or address	Verification attempted	Result	Evidence	Fallback
Mezo account-owned trove	BorrowerOperations	real testnet open/repay	pending	tx/receipt needed	diagnose; cannot fake P0
Canonical Mezo MUSD	token + explorer	bytecode/decimals	pending	read results	stop if invalid
Redemption list	SortedTroves	traversal and hints	pending	block+reads	neighbor-only honest view
Base Sepolia path	bridge peers + swaps	real cross-chain tx	pending	source and destination tx	P1 deferred
Morpho BTC borrowing	loan asset and market	params/liquidity/borrow tx	pending	market ID and tx	simulated, labeled


When blocked:
1. Capture exact error, function, parameters (without secrets), chain, block and contract address.
2. Check docs/source and simulate; determine whether it is approval, value, gas, target, selector, fee, hint, min debt, protocol state, proxy ABI, or infrastructure.
3. Create a minimal reproduction and change only one hypothesis at a time.
4. Retry only after a substantive fix; never brute-force broadcast transactions.
5. Escalate only genuine owner decisions, missing testnet tokens or fundamentally missing external integrations.
6. Keep P0 working and produce truthful scope reduction if external platform capability is absent.
Ask the owner only when necessary: test wallet approval/funding, material change to custody or security, a new external contract market, paid service, private deployment key handling, or final submission. The owner does not need to micromanage routine engineering.
12. Immediate first response and first tool actions
After reading this file, your first response should be short and concrete:
1. State that your immediate objective is a contract-owned Mezo trove and real repayment, not UI.
2. Note the three external risks: account-owned Mezo borrowing, Base Sepolia → Mezo testnet canonical bridging, Morpho BTC-as-borrowed-asset availability.
3. State what you will inspect and test, and the specific proof that unlocks each stage.
4. Begin inspecting the repo, official source/ABIs, RPC and test environment immediately; don't wait for further permission for read-only operations, local code and tests.
Then actually execute the work. Keep moving until you have a working testnet deliverable or a verified external blocker. Do not confuse writing progress reports with building Ballast.

Definition of done: A separate wallet pays genuine Mezo testnet MUSD through a real Ballast invoice; a policy-controlled router allocates funds; a Ballast account that really owns a Mezo trove executes a valid repayment without a new owner signature for that individual receipt; fresh Mezo on-chain reads prove actual decreased debt; Redemption Radar truthfully shows before/after order and risk data; contracts/tests/frontend/docs are runnable and linked. Base/Hedge count only if independently proven. Everything else is secondary.
