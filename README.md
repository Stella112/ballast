# Ballast

**Protect your Bitcoin. Strengthen your loan.**
Ballast is the cash-flow autopilot for Bitcoin-backed loans: every MUSD payment you receive can make your Mezo loan safer.

**Live app:** https://ballast-tawny.vercel.app · [Judge walkthrough](docs/DEMO.md)

> Mezo **testnet** only (chain 31611). Unaudited. No guarantee of redemption or liquidation protection.

## What works today (verified on Mezo testnet)
| | Evidence |
|---|---|
| A Ballast contract account owns a real Mezo trove (TroveManager keyed by the account address) | [openTrove tx](https://explorer.test.mezo.org/tx/0x73e6312cd962106ef5b07f6a2db4e1e8572580c0d9df9b4b404ebd8c26514940) |
| A separate wallet pays a 100 MUSD invoice → 75 spendable / 5 reserve / 20 repaid, debt −20.000000 exactly, in **one transaction** | [payInvoice tx](https://explorer.test.mezo.org/tx/0x3b9dce365e1ca8b2e043cc663fbc21c24b5f5364a7c90b2cd68be9571a3e5bc7) |
| Redemption Radar quotes 12.756783 MUSD to pass the next trove → repaid → queue position #165 → #166 | [repay tx](https://explorer.test.mezo.org/tx/0xea07e53b0a2664cffc796b8e1063c0174979068ef0f200ccd5d810c3bd798c75) |
| An **existing** Mezo borrower (loan held by their own wallet) is paid a 50 MUSD invoice → 40 to them, 10 repays their loan via Mezo's one-off signed repayment, debt −10.000000, **one transaction** | [payDirectInvoice tx](https://explorer.test.mezo.org/tx/0x359ee97e8a6964e5354f55576bb667595de5e9f41f453b894d24df94b0462494) |

Full evidence with block numbers and before/after reads: [docs/TEST_EVIDENCE.md](docs/TEST_EVIDENCE.md).

Not available: paying from Base (Mezo documents its MUSD bridge for mainnet only — no testnet route, checked 2026-11-14) and a live Morpho hedge (no Morpho market on Mezo testnet; `/app/hedge` is a clearly labelled simulator). How each part of the project description maps to evidence: [docs/PROJECT_DESCRIPTION.md](docs/PROJECT_DESCRIPTION.md).

## How it works
1. **Account** — `BallastFactory` deploys a `BallastAccount` and mints an NFT to you. Whoever holds the NFT (`ownerOf`, read live) controls the account. The NFT is locked while the trove is active.
2. **Loan** — the account calls Mezo `BorrowerOperations.openTrove` with your BTC, so the trove belongs to the account.
3. **Policy** — you choose repay % / reserve % (basis points, ≤ 100% total). The reserve is plain uninvested MUSD.
4. **Invoice** — you sign an EIP-712 invoice in your wallet (no gas, no server). The link carries the signed data.
5. **Payment** — the payer calls `BallastRouter.payInvoice`. In one transaction the router pulls MUSD, sends the spendable share to you, and the account repays its own trove. Any failure reverts everything.
6. **Existing loans** — a borrower whose Mezo loan is in their own wallet signs an invoice plus Mezo's own one-off `RepayMUSD` message (no gas). `BallastRepaymentAdapter` takes the payer's MUSD, repays that exact amount through Mezo's `repayMUSDWithSignature`, and pays the borrower the rest, in one transaction.
7. **Radar** — reads Mezo `SortedTroves` at one block, verifies the list, and shows your position, the repayment needed to pass 1/10/50 troves and the resulting collateral ratio, what a 10/20/30% BTC drop would do to your loan and the system, and the before/after of each repayment.

Architecture and trust model: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/SECURITY.md](docs/SECURITY.md).

## Deployed (Mezo testnet)
| Contract | Address |
|---|---|
| BallastFactory | [`0x74f918a5C1c8BDDc40CD0Ba8F9935790Fbc5dCCd`](https://explorer.test.mezo.org/address/0x74f918a5C1c8BDDc40CD0Ba8F9935790Fbc5dCCd) |
| BallastRouter | [`0x2a3Ce214189F62A2f15b58ecFD7c4CfCDa97dF1d`](https://explorer.test.mezo.org/address/0x2a3Ce214189F62A2f15b58ecFD7c4CfCDa97dF1d) |
| BallastAccountNFT | [`0xAa0034E681d208579cFF63A8E2CD298Fc51F3Afa`](https://explorer.test.mezo.org/address/0xAa0034E681d208579cFF63A8E2CD298Fc51F3Afa) |
| BallastRepaymentAdapter | [`0x096f8C705fce216bdBAEc7f86022117682A9f7DC`](https://explorer.test.mezo.org/address/0x096f8C705fce216bdBAEc7f86022117682A9f7DC) |
| Demo account #1 | [`0xDE61A300ca381463FD6FeCc6b2602980a2Db6323`](https://explorer.test.mezo.org/address/0xDE61A300ca381463FD6FeCc6b2602980a2Db6323) |

Mezo contracts used (verified against explorer source = `mezo-org/musd@da7888a`): see [docs/VERIFICATION.md](docs/VERIFICATION.md). All addresses are read from `config/deployments.mezo-testnet.json`.

## Run it
Requirements: Node 20+, pnpm 10, Foundry.
```bash
pnpm install
pnpm build && pnpm start          # http://localhost:3000
```
Get testnet BTC at https://faucet.test.mezo.org/. A merchant needs ~0.05 BTC to open a minimum trove (1,800 MUSD net debt + 200 MUSD gas deposit at ~150% ratio). The payer needs MUSD: the merchant can borrow it and send it. Walkthrough: [docs/DEMO.md](docs/DEMO.md).

## Tests
```bash
forge build
forge test                                                            # 15 local unit/fuzz tests (fork tests skip without RPC)
MEZO_TESTNET_RPC_URL=https://rpc.test.mezo.org forge test -vv         # + 12 tests on live Mezo state (4 account/router, 8 adapter)
pnpm test                                                             # 18 tests: Radar math + hedge simulator (vitest)
pnpm typecheck
pnpm radar                                                            # live verified Radar snapshot (read-only)
```
Live testnet runbook (broadcasts; needs `.env.local` with disposable testnet keys): `BALLAST_LIVE=1 scripts/live.sh <command>`.

## Limitations
Unaudited; testnet only. The NFT cannot be transferred while a loan is active. One account per wallet is shown in the UI. Invoices are exact-amount, single-use. A repayment that would take net debt below Mezo's 1,800 MUSD floor reverts the whole payment. Queue position is not a guarantee against redemption; liquidation is possible below 110% ICR.

## Roadmap
See [docs/ROADMAP.md](docs/ROADMAP.md).
