# AKINDO submission — Mezo Buildathon Wave 2

Deadline: 15 Nov 2026, 16:00 Lagos time (owner's figure; confirm the cutoff shown on the AKINDO page before submitting).

| Field | Answer |
|---|---|
| Project name | Ballast |
| Category | Bitcoin-backed loan automation |
| Tracks | Track 1: DeFi (primary), Track 2: Access & Distribution |
| Chains | Mezo testnet (31611), Base Sepolia (84532) |
| Status | New project built during the hackathon |
| Readiness | Testnet deployment |
| GitHub | https://github.com/Stella112/ballast |
| Live app | https://ballast-tawny.vercel.app |
| Demo video (2 min) | TODO — NEEDS VERIFIED RESULT (owner records) |
| Deck | TODO — NEEDS VERIFIED RESULT (owner provides) |
| Team | Maris, solo builder (GitHub: Stella112) |

**One-line:** The cash-flow autopilot for Bitcoin-backed loans: every MUSD payment you receive can make your Mezo loan safer.

## TL;DR
Ballast routes MUSD income into automatic repayment of a Mezo loan, so borrowers move back in the redemption line without lifting a finger. A Ballast Account is an NFT-controlled smart account that owns a real Mezo MUSD loan. Incoming payments, on Mezo or from Base Sepolia, are split by the owner's policy: part repays the loan, part is set aside for an optional BTC hedge, the rest goes to the owner. A live redemption-line simulator shows what each repayment changed.

## Problem
A Mezo borrower can lose their position two ways and guards against both by hand. **Redemption:** any MUSD holder can swap MUSD for BTC at $1 minus a 0.75% fee, taken from the lowest-ratio loans first, even healthy ones. **Liquidation:** below a 110% collateral ratio the loan is closed. Meanwhile the money a borrower earns never touches the loan unless they move it themselves.

## Who it's for
BTC-holding merchants, freelancers and small companies who borrow MUSD on Mezo and receive regular payments; and MUSD payment apps (invoicing, checkout, subscriptions) that want to offer "put part of your earnings toward your loan".

## How it works
1. **Open a Ballast Account**: a contract that opens and owns a real Mezo loan, minted as an NFT. Whoever holds the NFT controls the account; it can be transferred to another wallet whole.
2. **Choose a goal**: Keep my BTC (20% repay / 5% hedge / 75% owner), Get out of debt (60 / 40), Keep cash available (10 / 90 with a minimum cash buffer). All adjustable.
3. **Get paid**: MUSD on Mezo through the pay link or any app calling the router, or USDC from Base Sepolia over Wormhole.
4. **The router splits each payment** and emits the collateral ratio before and after.
5. **Repayment is automatic**: the account owns the loan, so no signature per payment. A keeper can trigger the policy for MUSD that arrived directly and cannot redirect funds. Loans that can't move in use Mezo's signed one-off repayment.
6. **Optional hedge**: a small BTC short that pays toward the loan if BTC falls.

Repayments stop at Mezo's minimum debt (about 2,000 MUSD); the excess goes to the owner.

## Mezo integration
| Mezo piece | How Ballast uses it |
|---|---|
| MUSD loan contracts (BorrowerOperations, TroveManager) | Open, own, repay and close a real loan from the account; signed one-off repayment for wallet-held loans |
| Sorted loan list (SortedTroves, HintHelpers) | Read live for the redemption-line simulator; position hints for repayments |
| PriceFeed | Collateral ratio before/after in payment events; the hedge market's oracle |
| Mezo Pools | Swap between MUSD and BTC for the hedge; swap bridged USDC to MUSD |
| Wormhole on Mezo testnet | Payments arriving from Base Sepolia (token bridge) |
| Morpho Blue | The hedge's MUSD-collateral, BTC-loan market (deployed on testnet by Ballast, see Limitations) |

## Measured proof (Mezo testnet, 14 Nov 2026)
- Account-owned loan: openTrove `0xe7d5fb3e00af9963e53554a2b242615a3d63d6e0453aef8adf40cb4fc1baff7f`.
- `pay(1, 100 MUSD, "order-1001")`: 75 owner / 5 hedge reserve / 20 repaid; ratio 140.55% → 141.84%: `0xab0c50dcb704019ecb39117a9b0950d2198fe53ef9a580658fae47d790ca8606`.
- Keeper: 50 MUSD sent straight to the account, policy applied by a non-owner wallet (37.5 / 2.5 / 10): `0x8e804aaeb85cb98bbaef90e90994e020d5d66e794f2de6a82d89dd8c72d7c484`.
- NFT transfer with the loan open, and back: `0x6a0b54177b23632062f185062c70dd2dadd9635c2ab0074efcee38e8eb946bd4`, `0x4f91ca3b2c7c1f318af481d0e1c4079c6e4f419c68dccb75a0a724e802b8cb3d`.
- Pay from Base Sepolia (USDC, Wormhole token bridge): Base `0x8fa1dd4aaaf1639cb24f3779060d41f5d1ee9b0a145af5edde74be3cc7728b41` → Mezo settle `0x92ad49b57d9e311bb0fd1f438201a71a8a6089e206130bfe57452a509b46137f` (swap, split 2.25 / 0.15 / 0.60, debt −0.600000, one Mezo transaction).
- Hedge: open `0x806d0be570381b8d17030c7d1a577ae1200415b9c0b40de5c403e959b6b3720e`, close `0xcf2c939a407618ed7d12f69f80f6e09d273951cf5ed34482654dae975c42c2f9`, proceeds to the account `0xdacf1c2a355e978821c9b418f21be314c3e203cb576f3f1b3ce5780c88c6cfa7`.
- Existing wallet-held loan, signed one-off repayment: `0x359ee97e8a6964e5354f55576bb667595de5e9f41f453b894d24df94b0462494`.
- Redemption-line simulator: quote → repay → position moved one place: `0xea07e53b0a2664cffc796b8e1063c0174979068ef0f200ccd5d810c3bd798c75`.
- Tests: 20 Foundry unit/fuzz tests, 26 Foundry tests against live Mezo state, 12 TypeScript maths tests.

## Technical architecture
Solidity 0.8.24: BallastFactory, BallastAccountNFT, BallastAccount, BallastRouter, BallastRepaymentAdapter, BallastHedge + factory, BallastMezoOracle, BallastBridgeReceiver. No admin or upgrade keys. Next.js 15 + wagmi/viem frontend on Vercel; server-side read route for the simulator. Details: docs/ARCHITECTURE.md, addresses: docs/DEPLOYMENTS.md.

## Tech stack
Solidity 0.8.24, Foundry, OpenZeppelin 5.0.2, Morpho Blue v1.0.0, Next.js 15.5, React 19, wagmi 2.19, viem 2.38, Tailwind 4, Vitest.

## Security
Threat model: docs/SECURITY.md. NFT-holder-only control; the router and keeper can only apply the owner's stored policy to incoming MUSD; signed invoices bound to chain and router with replay and expiry checks; reentrancy guards; split conservation fuzzed. Unaudited.

## Limitations (stated openly)
- Testnet only, unaudited. Mezo's minimum loan is about 2,000 MUSD.
- **Pay from Base uses USDC over Wormhole's token bridge**, because Mezo's MUSD bridge (NTT) has no testnet deployment. The USDC/MUSD pool on Mezo testnet was **created and seeded by Ballast** and is small.
- **Morpho Blue on Mezo testnet was deployed by Ballast** (unmodified v1.0.0) and its BTC liquidity was supplied by Ballast.
- The hedge reduces risk but cannot remove it; it can lose money and be liquidated. The BTC-drop scenario is a labelled SIMULATED calculation.
- The NFT transfers to wallet addresses only (no marketplace escrow yet).
- Redemption position is a snapshot, not a guarantee. Demand is unproven.
- The app's wallet flows have been exercised by scripts and contract tests; a browser-wallet run is the owner's final check.

## Next three milestones
| Milestone | Target |
|---|---|
| Audit-lite review and capped mainnet launch | Q1 2027 |
| Invoices as NFTs that feed the account, plus an SDK for MUSD payment apps | Q1 2027 |
| Vault for BTC lenders on the hedge side, with a Mezo Earn gauge | Q2 2027 |

## Two-minute demo script
1. **0:00** The problem: the redemption line (Radar page, live list).
2. **0:20** Mint a Ballast Account and open a loan (/app).
3. **0:40** A payment arrives through the pay link (/pay/a/1), splits, repays; the receipt shows the ratio before and after; Radar shows the new position.
4. **1:10** The same from Base Sepolia (USDC over Wormhole; show the Base and Mezo transactions — settlement takes several minutes, so use the recorded pair or pre-send).
5. **1:30** Open and close the hedge (/app/hedge), then the card labelled SIMULATED BTC drop.
6. **1:50** `BallastRouter.pay(accountId, amount, reference)` for other apps, and the roadmap.

## Disclaimer
Testnet, unaudited. Ballast does not guarantee protection from redemption or liquidation. No verified product demand yet.
