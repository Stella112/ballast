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
- **BallastRepaymentAdapter** — for Mezo loans held by a wallet (not a Ballast account). `payDirectInvoice(DirectInvoice{merchant, invoiceId, amount, repayAmount, expiry}, invoiceSig, MezoRepaySig{deadline, signature, hints})` verifies the merchant's EIP-712 invoice (domain `BallastRepaymentAdapter/1/31611/adapter`), marks it paid, pulls `amount`, calls Mezo `BorrowerOperationsSignatures.repayMUSDWithSignature(repayAmount, …)` (Mezo burns the MUSD from the caller, i.e. the adapter) and sends the rest to the merchant. `repayWithSignature` does the same without an invoice. `maxRepayable(borrower)` works for wallet and Ballast-account troves. No owner, no admin; holds nothing between transactions.
- **BallastRouter** — EIP-712 invoices `Invoice(tokenId, invoiceId, amount, expiry)`, domain `BallastRouter/1/31611/router`. Exact-amount, single-use, expiry-bound. Split: `repay = amt·r/1e4`, `reserve = amt·v/1e4`, `spendable = amt − repay − reserve` (dust → spendable). No fees.

## Off-chain
- **Invoice links** encode `{tokenId, amount, expiry, memo, salt, sig}`; `invoiceId = keccak256(abi.encode(memo, salt))` binds the memo to the signature. No database.
- **Radar** (`lib/radar`) — server route `/api/radar` takes one block, multicalls every trove owner's `getNext/getPrev/getNominalICR/getCurrentICR/getTroveDebt`, rebuilds the list from pointers and verifies count, pointer consistency, NICR monotonicity and tail. Quote math in bigint mirrors Mezo (`NICR = coll·1e20/principal`, interest paid first, strict-greater to pass ties). Quotes and simulations include the post-repayment ICR at the snapshot price. Price-drop scenarios (−10/−20/−30%) recompute your ICR exactly, re-express other troves' ICRs linearly at the new price to find redemption eligibility (ICR ≥ MCR), and read `TroveManager.getTCR(p)` / `checkRecoveryMode(p)` at the same block. Mezo liquidates only on ICR < MCR (musd@da7888a `TroveManager.sol:1148`); redemptions revert when TCR < MCR (`TroveManager.sol:1472`).
- **Frontend** — Next.js 15 App Router, wagmi 2 / viem 2, Tailwind 4. Every write is simulated, then success is shown only for a mined receipt with status 1. Addresses come only from `config/deployments.mezo-testnet.json`.

## Tests
- `contracts/test/BallastUnit.t.sol` — 15 local unit + fuzz tests with minimal stand-ins for Mezo rules.
- `contracts/test/BallastFork.t.sol` — 4 tests against live Mezo testnet state (oracle precompile fed with the live price; see VERIFICATION.md).
- `lib/radar/math.test.ts` — Radar math.
- `scripts/live.sh` — guarded live runbook producing `evidence/`.

## v2 (2026-11-14): what changed
- **BallastAccount**: tracks `ownerMUSD` (borrowed/deposited, withdrawable) separately from `hedgeReserve`; `pendingIncome()` is everything else. `quoteSplit(amount)` = policy percentages → cash buffer (`minCash`) → cap at `maxRepayable()` with the excess to the owner. Entry points: `applyPayment` (router only) and `processIncome` (anyone, keeper). Both emit `PaymentApplied(source, ref, amount, toOwner, toReserve, repaid, icrBefore, icrAfter)`; ICR = `TroveManager.getCurrentICR(account, PriceFeed.fetchPrice())`, 0 if unavailable.
- **BallastRouter**: `pay(accountId, amount, reference)` and `payWithHints(…, upperHint, lowerHint)` for any app; `payInvoice` unchanged for signed single-use invoices. All emit `Payment(accountId, reference, payer, amount, toOwner, toReserve, repaid, icrBefore, icrAfter)`.
- **BallastAccountNFT**: transferable at any time to code-less addresses; calls `account.controllerChanged(to)`.
- **BallastHedge / BallastHedgeFactory**: one module per account, controlled by the NFT holder. `open` = supplyCollateral + borrow on Morpho Blue, sell BTC on Mezo Pools; `close(musdIn, minBtcOut, topUp)` = buy back, repay all, withdraw collateral; `sendToAccount` = `account.depositMUSD` (credited as owner funds).
- **BallastMezoOracle**: Morpho price = `1e54 / PriceFeed.fetchPrice()` (MUSD collateral quoted in 18-decimal BTC).
- **BallastBridgeReceiver**: `settle(vaa, hints)` = Wormhole `completeTransferWithPayload` → swap wrapped USDC → MUSD (stable pool) → `router.payInvoice`; refunds on any failure.

## v3 (2026-11-15): what changed
- **BallastAccountNFT**: wallets can receive it with any transfer; contracts only through `safeTransferFrom` (they must implement `IERC721Receiver`), so it can be listed in an escrow and sold. A plain `transferFrom` to a contract reverts `UseSafeTransferForContracts`.
- **BallastAccount**: `setHedgeModule(module)`, `openHedge(collateral, borrowBtc, minMusdOut)` (collateral comes from `hedgeReserve`, tracked in `hedgePosted`) and `closeHedge(musdIn, minBtcOut, topUp, hints)` (top-up from the reserve, then the owner's MUSD; everything returns to the account; a gain repays the loan up to `maxRepayable()`, the rest goes back to the reserve). Controller-only.
- **BallastHedge**: callable by the account as well as the NFT holder.
- **BallastBaseGateway** (Base Sepolia): `pay(account, amount, reference)` forwards MUSD through MUSD's Wormhole NTT manager with the account as recipient on Mezo; a keeper then calls `processIncome`.
