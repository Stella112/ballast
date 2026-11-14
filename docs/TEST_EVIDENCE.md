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

## Existing (wallet-held) Mezo loan: signed one-off repayment via BallastRepaymentAdapter (2026-11-14)
- `MEZO_TESTNET_RPC_URL=https://rpc.test.mezo.org forge test` → **27 passed, 0 failed** (15 unit/fuzz; 4 `BallastForkTest`; 8 `BallastAdapterForkTest`: wiring/headroom, repay funded by another wallet + signature cannot be reused, wrong-key signature rejected, 100 MUSD invoice → 80 / 20 with debt −20 in one tx + replay rejected, tampered repayAmount rejected, wrong-amount Mezo signature reverts everything with no partial state, over-headroom reverts, zero-repay invoice and expiry).
- `pnpm test` → 18 passed (Radar math 12, hedge simulator 6). `pnpm typecheck` clean, `pnpm build` OK.
- Deploy: BallastRepaymentAdapter `0x096f8C705fce216bdBAEc7f86022117682A9f7DC`, tx `0x8fefd7dd8602116059eabbac2c575f16fdcbc21856b8cd0b8cb203a2b578afd5`, block 16764880, status 1; Blockscout "Pass - Verified". `forge create` lost the receipt poll (null RPC response); deployment confirmed by deployer nonce 9 → that address, creator = deployer, runtime 6,795 bytes = local build, immutables = Mezo BorrowerOperationsSignatures / BorrowerOperations / TroveManager / MUSD, `DIRECT_INVOICE_TYPEHASH` matches.
- Borrower with its own wallet trove: payer wallet `0xCBCd26d717CEe0305b92FDC1E50A398608A4d857` opened a trove (1,800 MUSD, 0.045 BTC): tx `0x765193b68c9e46886144494a0028269afee879d2039776f7586a5c4a48d8536d`, block 16764935, debt 2,001.8. A minimum-size loan leaves only ~1.8 MUSD repayable above the 2,000 floor, so it borrowed 100 MUSD more: tx `0xe0f556bae91f1836e62adf38b2b0afc58d5c19274a4ade367131f1026cf66a0a`, block 16764957 → repayable 101.9.
- **Invoice 1 (signatures made with `cast wallet sign`)**: customer `0x4ff0…a5fA` pays 50 MUSD, repay 10. tx `0x359ee97e8a6964e5354f55576bb667595de5e9f41f453b894d24df94b0462494`, block 16765017, status 1. `DirectInvoicePaid` event: amount 50, repaid 10, toMerchant 40, debtBefore 2101.900225573940094086 → debtAfter 2091.900225573940094086 (**−10.000000000000000000** in the same tx). Customer MUSD 75 → 25; borrower MUSD 1,950 → 1,990; adapter balance 0; Mezo nonce 0 → 1; `invoicePaid` true.
- **Invoice 2 (link signed with viem exactly like `/app/existing`, `scripts/make-direct-invoice.ts`)**: pay page in the browser showed *Signatures: Valid*, split 8 / 2, no console errors. Paid by `scripts/live.sh pay-direct-link`: tx `0xcce41c98e012f25f786857cc7706b12ef1dcb69580f4b9b1f00f20615d56ea0b`, block 16772053, status 1. Borrower MUSD 1,990 → 1,998; debt 2091.9196 → 2089.9196 (reads at blocks 16772046 / 16772060, difference includes accrued interest); Mezo nonce 1 → 2.
- Not verified: the `/app/existing` create flow and the pay page *with a browser wallet extension* (needs a human wallet); the signing code is the same viem call proven above.

## Hedge simulator (2026-11-14)
- `/app/hedge` renders the synthetic simulator (defaults: 300 MUSD short, BTC −20%, 8% APR, 30 days, 0.3% per swap → +56.80 MUSD; liquidation price 193,660). No console errors; no horizontal overflow at 375 px. Every number on the page is labelled synthetic; no transaction is possible from it.


## Live hedge on Mezo testnet (2026-11-14)
- Fork tests `BallastHedgeForkTest` 6/6 (real Morpho Blue + AdaptiveCurveIrm bytecode, real Mezo Pools pool, real MUSD/PriceFeed; Mezo's BTC token is a native precompile Foundry cannot execute, so a plain ERC-20 stands in at its address with the pool's live reserve balance): oracle scale `1e54/price`; open → close with real interest + fees (close without top-up reverts `NotEnoughBtcToRepay`, with 5 MUSD top-up succeeds); controller-only; no double open / no send while open; borrow above 86% LLTV rejected by Morpho; BTC +40% on Mezo's feed → third-party `liquidate` succeeds.
- Oracle: `price()` 1.4887e31 = 1e54 / 67,169.595e18 (Mezo PriceFeed) at deployment.
- **Open** [`0xb7aee27a…`](https://explorer.test.mezo.org/tx/0xb7aee27a1e192bbfd6572e1e318f6f4ceae4dd0c44f2a36ebcbd05a98f08c2e8) block 16772971: 80 MUSD collateral, borrowed 0.0005 BTC, sold in Mezo's MUSD/BTC pool for 39.089265 MUSD (pool ≈ 78k MUSD/BTC vs oracle ≈ 67k). Market after: totalBorrow 5e14.
- **Close** [`0xca0dc77c…`](https://explorer.test.mezo.org/tx/0xca0dc77c2504403300cf3fa402430469248b27d04d8ebacc186c80797b259161) block 16772993 (after `accrueInterest` [`0xf0f663ba…`](https://explorer.test.mezo.org/tx/0xf0f663bafe02912723f3244da3f2c068bb5118c981174c28850cee255b708c30)): owed 0.000500023472937 BTC (≈3 min of interest); spent 39.871022 MUSD (incl. 0.781756 top-up) buying BTC; debt 0, collateral 80 MUSD back; 0.0000095917 BTC left over.
- **Send to account** [`0x377c9dee…`](https://explorer.test.mezo.org/tx/0x377c9dee8012a76b785602c1d32b96e8c27e8cb3ea09f9bda9ffc64cf4a3a9ff) block 16773006: account #1 MUSD 1,732.24 → 1,812.24 (+80) and +0.0000096 BTC. Net P/L of the round trip ≈ −0.03 MUSD (two pool fees; BTC barely moved).

## LIVE: invoice paid with USDC from Base Sepolia via Wormhole Token Bridge (2026-11-14)
- Attest Base USDC: Base tx 0x97c4a44b6d792911a070964dd18d384e24f7430e655654c41d803d2f2b038894 (seq 3742) → Mezo createWrapped 0xcb6151edc546abaa60d2b222b94b30726a8622d9ba8a6368d6f44b648509f8bc (block 16774530). Wrapped USDC on Mezo 0x48AE9354c560F2D4f26e41760e67fdd3f2E8C4F0: isWrappedAsset=true, chainId 10004, nativeContract = Base Sepolia USDC.
- Seed: 8 USDC bridged (Base 0xce663e542fc62c53e2c12015bb5916a865783fa2942cbc089f06578de5ffb3b4, seq 3743 → Mezo completeTransfer 0x9192b56536c790d2674d748e7737b625d413469001771cb653ae21abf851abe2). Stable pool wUSDC/MUSD 0x55a317f5DDC12C7F52922775f56930e5036c0047 created via Mezo PoolFactory (0x6e97799d…) and seeded 8 USDC + 8 MUSD by Ballast (0x9df20d28…).
- **Payment**: merchant-signed 3 MUSD invoice (account #1). Base Sepolia transferTokensWithPayload 3.090002 USDC → BallastBridgeReceiver: 0x8fa1dd4aaaf1639cb24f3779060d41f5d1ee9b0a145af5edde74be3cc7728b41 (block 58673821, seq 3744). Guardians signed ~17 min later. **Mezo settle 0x92ad49b57d9e311bb0fd1f438201a71a8a6089e206130bfe57452a509b46137f (block 16774910, status 1)** — one tx: TransferRedeemed(10004, seq 3744); swap 3.090002 USDC → 3.006076634479038381 MUSD; InvoicePaid 3 MUSD → 2.25 spendable / 0.15 reserve / 0.60 repay; Repaid debt 2159.279534408606086148 → 2158.679534408606086148 (**−0.600000 exactly**); change 0.006076634479038381 MUSD to the customer on Mezo; receiver balance 0.
- Tests: BallastBridgeForkTest 7/7, BallastHedgeForkTest 6/6, BallastAdapterForkTest 8/8, BallastForkTest 4/4, unit 15/15 — each passes; running all fork suites in parallel against the public RPC caused setUp reverts (rate limiting), single-suite runs pass.
