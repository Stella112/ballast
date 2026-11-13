# Architecture

```
 payer wallet ──payInvoice(inv, sig, hints)──▶ BallastRouter (no admin)
                                                 │ verifies EIP-712 sig == account.controller()
                                                 │ marks invoicePaid[tokenId][invoiceId]
                                                 │ reads policy from account (not calldata)
              MUSD.transferFrom(payer → payout)  ├─ spendable
              MUSD.transferFrom(payer → account) ├─ reserve + repay
                                                 ▼
                                   BallastAccount.applyPayment (onlyRouter)
                                     ├─ hedgeReserve += reserve
                                     └─ BorrowerOperations.repayMUSD(repay)  ← msg.sender = account = trove owner
                                                                             (Mezo burns MUSD from the account)

 NFT holder ──▶ BallastAccount (onlyController = nft.ownerOf(tokenId), read live)
                 openTrove / addCollateral / withdrawCollateral / borrow / repay / closeTrove /
                 claimCollateral / setPolicy / withdrawMUSD (free only) / withdrawReserve / withdrawBTC / rescueToken (≠MUSD)

 BallastFactory ──creates──▶ BallastAccount (constructor-wired, immutable) + mints BallastAccountNFT
```

## Contracts (`contracts/src`, solc 0.8.24, EVM london, OZ 5.0.2)
- **BallastFactory** — no owner. Router and NFT addresses are nonce-predicted at deploy; constructor rejects mismatched wiring.
- **BallastAccountNFT** — factory-only mint, no burn path, transfers blocked while the account's trove is active and only to code-less addresses.
- **BallastAccount** — owns the trove. Router entry point is a single function that can only credit the reserve and repay this account's own trove. Pre-checks `maxRepayable = totalDebt − 200 − minNetDebt` and reverts `RepayExceedsHeadroom`; post-checks `balance ≥ hedgeReserve` and that debt decreased.
- **BallastRouter** — EIP-712 invoices `Invoice(tokenId, invoiceId, amount, expiry)`, domain `BallastRouter/1/31611/router`. Exact-amount, single-use, expiry-bound. Split: `repay = amt·r/1e4`, `reserve = amt·v/1e4`, `spendable = amt − repay − reserve` (dust → spendable). No fees.

## Off-chain
- **Invoice links** encode `{tokenId, amount, expiry, memo, salt, sig}`; `invoiceId = keccak256(abi.encode(memo, salt))` binds the memo to the signature. No database.
- **Radar** (`lib/radar`) — server route `/api/radar` takes one block, multicalls every trove owner's `getNext/getPrev/getNominalICR/getCurrentICR/getTroveDebt`, rebuilds the list from pointers and verifies count, pointer consistency, NICR monotonicity and tail. Quote math in bigint mirrors Mezo (`NICR = coll·1e20/principal`, interest paid first, strict-greater to pass ties).
- **Frontend** — Next.js 15 App Router, wagmi 2 / viem 2, Tailwind 4. Every write is simulated, then success is shown only for a mined receipt with status 1. Addresses come only from `config/deployments.mezo-testnet.json`.

## Tests
- `contracts/test/BallastUnit.t.sol` — 15 local unit + fuzz tests with minimal stand-ins for Mezo rules.
- `contracts/test/BallastFork.t.sol` — 4 tests against live Mezo testnet state (oracle precompile fed with the live price; see VERIFICATION.md).
- `lib/radar/math.test.ts` — Radar math.
- `scripts/live.sh` — guarded live runbook producing `evidence/`.
