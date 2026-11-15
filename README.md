# Ballast

**Protect your Bitcoin. Strengthen your loan.**
Ballast is the cash-flow autopilot for Bitcoin-backed loans: every MUSD payment you receive can make your Mezo loan safer.

**Live app:** https://ballast-tawny.vercel.app · [Project description + evidence](docs/PROJECT_DESCRIPTION.md) · [Judge walkthrough](docs/DEMO.md)

> Mezo **testnet** (chain 31611) and Base Sepolia only. Unaudited. No guarantee of redemption or liquidation protection.

## What works today (real testnet transactions)
| | Evidence |
|---|---|
| A Ballast account (controlled by an NFT) opens and owns a real Mezo loan | [openTrove](https://explorer.test.mezo.org/tx/0x1c12b684ebebac2154275e09462345386ee597cce37f7c4ad13b58fb62dee76e) |
| `BallastRouter.pay(accountId, amount, reference)`: 100 MUSD → 75 to owner / 5 hedge reserve / 20 repaid, collateral ratio 134.15% → 135.33%, **one transaction** | [pay](https://explorer.test.mezo.org/tx/0xbec250c4a877f3b637b8935e1713115d8d5989626614c9e97f3cdf12938bbd5e) |
| Keeper: MUSD sent straight to the account; a non-owner wallet applies the owner's policy and cannot redirect anything | [processIncome](https://explorer.test.mezo.org/tx/0x93bbadeb9ad67c95f32ca5507ee6b7d9b28cec00d4c327dd857868aaf4b1a9cd) |
| The NFT moves the whole account, open loan included, and can be sold through an escrow contract | [listed in escrow](https://explorer.test.mezo.org/tx/0x2d8e01521db67bb4542be4383d3f1a053f219c17a890c19f99995ccd630f857a) · [released to buyer](https://explorer.test.mezo.org/tx/0x43626e6369e6e8304ee33348492fe1b0c45f08333d404e8937a36bd5c208b8d9) |
| Pay from Base Sepolia: USDC crosses Wormhole's token bridge, is swapped to MUSD on Mezo and pays the invoice (split + repayment) in one Mezo transaction | [Base tx](https://base-sepolia.blockscout.com/tx/0x8fa1dd4aaaf1639cb24f3779060d41f5d1ee9b0a145af5edde74be3cc7728b41) → [Mezo settle](https://explorer.test.mezo.org/tx/0x92ad49b57d9e311bb0fd1f438201a71a8a6089e206130bfe57452a509b46137f) |
| Hedge: the account takes MUSD from its hedge reserve, posts it on Morpho Blue, borrows BTC, sells it on Mezo Pools, then closes back into itself | [open](https://explorer.test.mezo.org/tx/0x09d17ce366ce7ef78439386f04b6238476f19d99a51a4a74651cf3c66c3cc447) · [close](https://explorer.test.mezo.org/tx/0xd6a52ed49876862609d15578cf56b51b5372a38a2f45065aa8337675363ded54) |
| Existing Mezo loan held by a wallet: one-off signed repayment (50 MUSD → 40 to borrower, 10 repaid) | [payDirectInvoice](https://explorer.test.mezo.org/tx/0x359ee97e8a6964e5354f55576bb667595de5e9f41f453b894d24df94b0462494) |
| Redemption-line simulator: quote to pass the next loan → repaid → position moved | [repay](https://explorer.test.mezo.org/tx/0xea07e53b0a2664cffc796b8e1063c0174979068ef0f200ccd5d810c3bd798c75) |

Full evidence with block numbers and before/after reads: [docs/TEST_EVIDENCE.md](docs/TEST_EVIDENCE.md).

### Things Ballast had to create on testnet (disclosed in the app)
- **Morpho Blue is not deployed on Mezo testnet.** Ballast deployed Morpho's unmodified v1.0.0 contracts and supplied the market's BTC lending liquidity itself.
- **No USDC/MUSD pool existed.** Ballast created one with Mezo's pool factory and seeded it (about 8 USDC + 8 MUSD), so only small Base payments fit.
- **Pay from Base has two routes.** MUSD over its own Wormhole NTT bridge through `BallastBaseGateway` (deployed, tested against live Base Sepolia; the live end-to-end run is waiting on a Wormhole guardian signature), and USDC over Wormhole's token bridge (proven live, limited by the small seeded pool).

## How it works
1. **Account** — `BallastFactory` deploys a `BallastAccount` and mints an NFT to you. Whoever holds the NFT (`ownerOf`, read live) controls the whole account. It can be transferred to another wallet or to a contract that accepts NFTs (a marketplace escrow), so the account can be sold whole.
2. **Loan** — the account calls Mezo `BorrowerOperations.openTrove` with your BTC, so the loan belongs to the account.
3. **Policy** — presets *Keep my BTC* (20% repay / 5% hedge / 75% you), *Get out of debt* (60 / 40), *Keep cash available* (10 / 90 with a minimum cash buffer); every number is editable.
4. **Payments** — `BallastRouter.pay(accountId, amount, reference)` (pay link `/pay/a/<id>`, or any app), signed single-use invoices, or USDC from Base Sepolia. The router splits each payment by your policy and emits the collateral ratio before and after.
5. **Keeper** — MUSD that lands in the account directly waits as "income"; anyone can call `processIncome` to apply your policy. The caller chooses nothing.
6. **Cap** — repayments stop at Mezo's minimum debt (about 2,000 MUSD); the excess goes to you.
7. **Radar** — reads Mezo's sorted loan list at one block and shows your position, the MUSD ahead of you, the repayment needed to pass 1 / 10 / 50 loans, your liquidation price, and what each real repayment changed.
8. **Hedge (optional)** — the account takes MUSD from its hedge reserve, posts it on Morpho Blue, borrows BTC and sells it on Mezo Pools; closing buys it back, repays the loan with any gain and returns the rest to the reserve. A BTC drop is shown only as a labelled SIMULATED calculation.
9. **Existing loans** — a loan held by your wallet can't move in; Ballast uses Mezo's own one-off signed repayment for it.

## Deployed (Mezo testnet, v3)
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
