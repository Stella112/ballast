# Test evidence

## Fork tests (live Mezo testnet state, local execution, no broadcast)
Command:
```
MEZO_TESTNET_RPC_URL=https://rpc.test.mezo.org forge test --match-contract BallastForkTest -vv
```
Result 2026-11-13 (fork block ≈16,761,840):
```
[PASS] test_fork_contractOwnedTrove_openWithdrawRepay() (gas: 2190108)
[PASS] test_fork_gateB_invoice_20_5_75() (gas: 2473002)
[PASS] test_fork_nftLockedWhileTroveActive_thenCloseAndTransfer() (gas: 2561486)
[PASS] test_fork_repayBeyondFloorRevertsWholePayment() (gas: 1259466)
Suite result: ok. 4 passed; 0 failed; 0 skipped
```
What these show: trove status 1 keyed by the account address; debt = 2100 + 2.1 fee + 200 gas comp exactly; 100 MUSD invoice → payout +75, reserve +5, trove debt −20 exactly; over-floor repayment reverts with no state change; NFT transfer blocked while active and allowed after close, with control following the NFT.
Caveat: oracle precompile mocked with the live price (see VERIFICATION.md).

## Live Mezo testnet (2026-11-13 UTC) — raw log: `evidence/live-20261113.log`
All via `BALLAST_LIVE=1 scripts/live.sh <cmd>`; every tx receipt status = 1. Every write was simulated with `eth_call` on the live node first.

### Gate A — contract-owned trove — **PASS**
| Step | Tx | Block | Result |
|---|---|---|---|
| Deploy router/NFT/factory | see docs/DEPLOYMENTS.md | 16762083–87 | bytecode present at all 3 |
| `factory.createAccount()` | [0xc8c82af3…7815](https://explorer.test.mezo.org/tx/0xc8c82af3b6baf50c7d516e124e2d7ae91dee2c680274caf1bf2f492cac3c7815) | 16762107 | tokenId 1 → account `0xDE61…6323`; `nft.ownerOf(1)` = `account.controller()` = merchant |
| `account.openTrove(2000 MUSD)` with 0.048 BTC | [0x73e6312c…4940](https://explorer.test.mezo.org/tx/0x73e6312cd962106ef5b07f6a2db4e1e8572580c0d9df9b4b404ebd8c26514940) | 16762136 | before @16762120: status 0. after @16762137: `TroveManager.getTroveStatus(account)`=1, principal 2202e18 (2000+2 fee+200 gas comp), coll 0.048e18, ICR 1.4915e18 @ price 68421.93, account MUSD 2000e18, in SortedTroves |
| `account.repay(10 MUSD)` by controller | [0xa50903d6…92ad](https://explorer.test.mezo.org/tx/0xa50903d6df72f25c049975d07898160ae6230f76f10687f6366eeb79c16692ad) | 16762177 | `Repaid` event: debtBefore 2202000120019195770237 → debtAfter 2192000120019195770237, **delta exactly 10e18**. NICR 2.1798e15→2.1898e15; neighbors changed (prev `0xAB9b…347e`→`0xea2D…1A91`, next `0x6E58…6AF5`→`0xB19b…E277`) |
| `account.withdrawMUSD(payer, 150)` by controller | [0x2083f772…b4d5](https://explorer.test.mezo.org/tx/0x2083f772dcf31d7e88fcbd43860ad8b136fb64f4a1b97358f3c5bc189d56d4b5) | 16762203 | payer MUSD 0 → 150e18 |
Permission checks (eth_call from the payer wallet against live state): `withdrawMUSD`, `setPolicy`, `closeTrove`, `withdrawBTC` → `NotController`; `applyPayment` → `NotRouter` (0x91655201); NFT `transferFrom` while active → `TransferLockedActiveTrove(1)` (0x421d837b).

### Gate B — 100 MUSD invoice, 20% repay / 5% reserve / 75% spendable — **PASS**
| Step | Tx | Block |
|---|---|---|
| `setPolicy(2000, 500, false, 0x0)` | [0x7a4e019a…5e4a](https://explorer.test.mezo.org/tx/0x7a4e019a6461fbeebd998e5083db19e3d493668146249547b85072da2dac5e4a) | 16762223 |
| payer `MUSD.approve(router, 100)` | [0x01bef05a…6a07](https://explorer.test.mezo.org/tx/0x01bef05a4a6fecf7e803d636bc2764f5bd800684bd2e63c6f1d7367fe5a06a07) | 16762251 |
| payer `router.payInvoice(...)` (merchant-signed EIP-712, invoiceId `0xb531a517…4c0f`) | [0x3b9dce36…5bc7](https://explorer.test.mezo.org/tx/0x3b9dce365e1ca8b2e043cc663fbc21c24b5f5364a7c90b2cd68be9571a3e5bc7) | 16762254 |

The sequence is two transactions (approve, then pay). The split and the repayment are **atomic within the single payInvoice tx**.
- `InvoicePaid` event: amount 100e18 = spendable 75e18 + reserve 5e18 + repaid 20e18 (exact).
- `Repaid` event (source = router): debtBefore 2192000341602078136735 → debtAfter 2172000341602078136735, **delta exactly 20e18**.
- Balance deltas (reads @16762233 → @16762255): payer 150 → 50; payout (merchant) 0 → 75; account MUSD 1840 → 1845 with `hedgeReserve` 0 → 5; `invoicePaid(1, id)` = true.
- Ordering: NICR 2.18978e15 → 2.20994e15; neighbors changed (prev `0xea2D…1A91`→`0x2104…8290`, next `0xB19b…E277`→`0x54A5…7ba3`). Rank (index) not yet computed — see Radar.
- Replay (eth_call, same invoice + sig): reverts `AlreadyPaid` (0xf4b76a0e). Tampered invoice: `BadSignature` (0x5cd5d233).

### Gate C — Redemption Radar quote → repay → verified reorder — **PASS**
Read model: `lib/radar/snapshot.ts` (viem, bigint). For one pinned block it multicalls every trove owner's `getNext/getPrev/getNominalICR/getCurrentICR/getTroveDebt`, rebuilds the list head→tail from `getNext`, and verifies count == `getSize`, prev/next pointer consistency, non-increasing NICR, and tail == `getLast`. Ranks are shown only when all four checks pass.
Rank = 1-based position from the tail (tail = lowest NICR = first redeemed; TroveManager.redeemCollateral skips ICR < MCR, so an "eligible rank" is also reported).

| Step | Block | Result |
|---|---|---|
| Snapshot (`pnpm radar`) | 16762559 | 325 troves, all 4 checks true; account rank **#165** from tail; NICR 2209944403811417; neighbors safer `0x2104…8290`, riskier `0x54A5…7ba3` |
| Fresh quote to pass 1 (`scripts/gate-c.ts`) | 16762593 | target `0x2104…8290` NICR 2222999300629433 → repay 12.756782874594186616 MUSD (incl. accrued interest paid first + 10-min interest buffer), rounded up to 12.756783 |
| `account.repay(12.756783 MUSD)` [0xea07e53b…8c75](https://explorer.test.mezo.org/tx/0xea07e53b0a2664cffc796b8e1063c0174979068ef0f200ccd5d810c3bd798c75) | 16762619 | `Repaid`: 2172001385722092709230 → 2159244602722092709230, delta exactly 12.756783e18 |
| Snapshot after | 16762622 | all checks true; rank **#166**; NICR 2222999651798961 > target's 2222999300629433; target is now our riskier neighbor. Quote for 50 positions now correctly reports "NOT REACHABLE without closing" (164.02 > maxRepayable 159.24) |

Note: the live.sh run exited before logging this tx (a receipt wait in `cast send`); the hash was recovered from the explorer and confirmed by receipt. live.sh now submits async, logs the hash first, then polls for the receipt.

## Local unit + fuzz tests (2026-11-13)
`forge test` → `Suite result: ok. 15 passed; 0 failed` (BallastUnitTest; fuzz 256 runs each: split conservation, payInvoice balance conservation incl. floor reverts) and 4 fork tests skipped without RPC. Covered: 20/5/75 exact, dust → spendable, replay, expiry, edited amount, wrong signer, zero amount, unknown account, insufficient allowance (no state), paused policy, repay leg without trove (whole revert), all controller-only functions, router-only entry, invalid bps, reserve vs free MUSD, no MUSD rescue, factory uniqueness/bad wiring, NFT lock/EOA-only/control follows holder (old-holder invoices invalid), BTC receive/withdraw. Stand-ins model only Mezo rules Ballast depends on.

## Radar math (vitest)
`pnpm test` → `Tests 8 passed (8)`.

## Frontend
- `pnpm typecheck` clean; `pnpm build` → 11 routes compiled (Next 15.5.29).
- Browser (built-in, no wallet) against live testnet: `/pay/<link>` for a merchant-signed 10 MUSD invoice resolves account `0xDE61…6323`, signature **Valid** (viem `verifyTypedData` vs live controller), split preview 7.50 / 0.50 / 2.00 from `router.computeSplit`. Same link with edited memo → signature **Invalid**. `/api/radar` → block 16762947, all 4 checks true, rank 166, 11-row window, ~11 s. Mobile 375 px: no horizontal overflow.
- **Not yet verified:** wallet-connected flows in a real browser wallet (needs a human wallet extension).

## Radar: post-repayment ICR and BTC price-drop scenarios (2026-11-14)
- `pnpm test` → 12/12 Radar math tests pass (new: `droppedPrice`, `scaleIcr` vs exact ICR within 2 wei, quote `newTotalDebt`/`newIcr`, `eligibilityAtPrice`). `pnpm typecheck` clean, `pnpm build` OK.
- Live snapshot for account `0xDE61…6323` at **block 16764464** (price 68,234.25 MUSD/BTC): ICR 151.68%, position #166 of 325.
  - Quotes: pass 1 → 0.444240 MUSD, ICR after 151.72%; pass 10 → 23.996926 MUSD, ICR after 153.39%; pass 50 → 164.02 MUSD exceeds max repayable 159.25 (marked unreachable without closing).
  - Scenarios: −10% → ICR 136.52%, eligible rank 154/313, 12 troves below 110%, TCR 220.52%; −20% → ICR 121.35%, rank 39/198, 127 below 110%, TCR 196.01%; −30% → ICR 106.18% → **liquidatable**, TCR 171.51%. No recovery mode or redemption pause at any of these prices.
  - Cross-check with `cast call --block 16764464`: `TroveManager.getCurrentICR(account, p)` and `getTCR(p)` equal the Radar values **exactly** at all four prices (0, −10, −20, −30%).
- Local `/api/radar?simulate=25e18` (block 16764491): ICR 151.73% → 153.51%, position #166 → #187.
- Not verified in the UI with a connected wallet (the Radar cards need a wallet that controls a Ballast account); the page loads with no console errors.
