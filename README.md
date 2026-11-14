# Ballast

**Protect your Bitcoin. Strengthen your loan.**
Ballast is the cash-flow autopilot for Bitcoin-backed loans: every MUSD payment you receive can make your Mezo loan safer.

**Live app:** https://ballast-tawny.vercel.app · [Project description + evidence](docs/PROJECT_DESCRIPTION.md) · [Judge walkthrough](docs/DEMO.md)

> Mezo **testnet** (chain 31611) and Base Sepolia only. Unaudited. No guarantee of redemption or liquidation protection.

## What works today (real testnet transactions)
| | Evidence |
|---|---|
| A Ballast account (controlled by an NFT) opens and owns a real Mezo loan | [openTrove](https://explorer.test.mezo.org/tx/0xe7d5fb3e00af9963e53554a2b242615a3d63d6e0453aef8adf40cb4fc1baff7f) |
| `BallastRouter.pay(accountId, amount, reference)`: 100 MUSD → 75 to owner / 5 hedge reserve / 20 repaid, collateral ratio 140.55% → 141.84%, **one transaction** | [pay](https://explorer.test.mezo.org/tx/0xab0c50dcb704019ecb39117a9b0950d2198fe53ef9a580658fae47d790ca8606) |
| Keeper: MUSD sent straight to the account; a non-owner wallet applies the owner's policy and cannot redirect anything | [processIncome](https://explorer.test.mezo.org/tx/0x8e804aaeb85cb98bbaef90e90994e020d5d66e794f2de6a82d89dd8c72d7c484) |
| The NFT moves the whole account, open loan included | [transfer](https://explorer.test.mezo.org/tx/0x6a0b54177b23632062f185062c70dd2dadd9635c2ab0074efcee38e8eb946bd4) |
| Pay from Base Sepolia: USDC crosses Wormhole's token bridge, is swapped to MUSD on Mezo and pays the invoice (split + repayment) in one Mezo transaction | [Base tx](https://base-sepolia.blockscout.com/tx/0x8fa1dd4aaaf1639cb24f3779060d41f5d1ee9b0a145af5edde74be3cc7728b41) → [Mezo settle](https://explorer.test.mezo.org/tx/0x92ad49b57d9e311bb0fd1f438201a71a8a6089e206130bfe57452a509b46137f) |
| Hedge: post MUSD on Morpho Blue, borrow BTC, sell it on Mezo Pools, close, proceeds back to the account | [open](https://explorer.test.mezo.org/tx/0x806d0be570381b8d17030c7d1a577ae1200415b9c0b40de5c403e959b6b3720e) · [close](https://explorer.test.mezo.org/tx/0xcf2c939a407618ed7d12f69f80f6e09d273951cf5ed34482654dae975c42c2f9) |
| Existing Mezo loan held by a wallet: one-off signed repayment (50 MUSD → 40 to borrower, 10 repaid) | [payDirectInvoice](https://explorer.test.mezo.org/tx/0x359ee97e8a6964e5354f55576bb667595de5e9f41f453b894d24df94b0462494) |
| Redemption-line simulator: quote to pass the next loan → repaid → position moved | [repay](https://explorer.test.mezo.org/tx/0xea07e53b0a2664cffc796b8e1063c0174979068ef0f200ccd5d810c3bd798c75) |

Full evidence with block numbers and before/after reads: [docs/TEST_EVIDENCE.md](docs/TEST_EVIDENCE.md).

### Things Ballast had to create on testnet (disclosed in the app)
- **Morpho Blue is not deployed on Mezo testnet.** Ballast deployed Morpho's unmodified v1.0.0 contracts and supplied the market's BTC lending liquidity itself.
- **No USDC/MUSD pool existed.** Ballast created one with Mezo's pool factory and seeded it (about 8 USDC + 8 MUSD), so only small Base payments fit.
- **MUSD itself cannot be bridged from Base Sepolia** (Mezo's MUSD bridge is mainnet-only), so the Base route carries USDC over Wormhole's token bridge instead.

## How it works
1. **Account** — `BallastFactory` deploys a `BallastAccount` and mints an NFT to you. Whoever holds the NFT (`ownerOf`, read live) controls the whole account, and it can be transferred to another wallet.
2. **Loan** — the account calls Mezo `BorrowerOperations.openTrove` with your BTC, so the loan belongs to the account.
3. **Policy** — presets *Keep my BTC* (20% repay / 5% hedge / 75% you), *Get out of debt* (60 / 40), *Keep cash available* (10 / 90 with a minimum cash buffer); every number is editable.
4. **Payments** — `BallastRouter.pay(accountId, amount, reference)` (pay link `/pay/a/<id>`, or any app), signed single-use invoices, or USDC from Base Sepolia. The router splits each payment by your policy and emits the collateral ratio before and after.
5. **Keeper** — MUSD that lands in the account directly waits as "income"; anyone can call `processIncome` to apply your policy. The caller chooses nothing.
6. **Cap** — repayments stop at Mezo's minimum debt (about 2,000 MUSD); the excess goes to you.
7. **Radar** — reads Mezo's sorted loan list at one block and shows your position, the MUSD ahead of you, the repayment needed to pass 1 / 10 / 50 loans, your liquidation price, and what each real repayment changed.
8. **Hedge (optional)** — a per-account module posts MUSD on Morpho Blue, borrows BTC and sells it on Mezo Pools; closing buys it back and returns the proceeds to your account. A BTC drop is shown only as a labelled SIMULATED calculation.
9. **Existing loans** — a loan held by your wallet can't move in; Ballast uses Mezo's own one-off signed repayment for it.

## Deployed (Mezo testnet, v2)
See [docs/DEPLOYMENTS.md](docs/DEPLOYMENTS.md) for every address and deploy transaction. All Ballast contracts are source-verified on the explorer and have no admin or upgrade keys. Addresses are read from `config/deployments.mezo-testnet.json`.

## Run it
Requirements: Node 20+, pnpm 10, Foundry.
```bash
pnpm install
pnpm build && pnpm start          # http://localhost:3000
```
Get testnet BTC at https://faucet.test.mezo.org/. Opening a minimum loan needs about 0.05 BTC. Walkthrough: [docs/DEMO.md](docs/DEMO.md).

## Tests
```bash
forge build
forge test                                    # 20 local unit/fuzz tests (fork tests skip without RPC)
scripts/fetch-morpho.sh                       # one-time: fetch + build pinned Morpho Blue for the hedge tests
export MEZO_TESTNET_RPC_URL=https://rpc.test.mezo.org
forge test --match-contract BallastForkTest          # 5 tests on live Mezo state
forge test --match-contract BallastAdapterForkTest   # 8
forge test --match-contract BallastBridgeForkTest    # 7
forge test --match-contract BallastHedgeForkTest     # 6
pnpm test && pnpm typecheck                   # 12 Radar maths tests
```
Run the fork suites one at a time: together they overload the public RPC. Live testnet runbook (broadcasts; needs `.env.local` with disposable testnet keys): `BALLAST_LIVE=1 scripts/live.sh <command>`.

## Limitations
Unaudited; testnet only. Transferring the NFT hands over the loan, collateral and funds, and only wallet addresses can receive it. `pay()` without position hints costs about 4M gas on today's loan list; use `payWithHints`. The hedge can lose money and be liquidated. Queue position is a snapshot, not a guarantee; liquidation is possible below 110%. Base payments take several minutes (bridge finality) and are limited by the small seeded pool.

## Roadmap
See [docs/ROADMAP.md](docs/ROADMAP.md).
