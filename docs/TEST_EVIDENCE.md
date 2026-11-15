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


## v2 (2026-11-14 evening): contracts rebuilt to the owner's final description
Changes: `BallastRouter.pay(accountId, amount, reference)` with ratio before/after in the event; permissionless keeper `processIncome`; repayments capped at Mezo's minimum debt with the excess to the owner; minimum cash buffer; NFT transferable with an open loan; hedge proceeds deposited as the owner's MUSD.

**Tests (each suite run on its own against `https://rpc.test.mezo.org`):** unit 20/20; `BallastForkTest` 5/5; `BallastBridgeForkTest` 7/7; `BallastHedgeForkTest` 6/6; `BallastAdapterForkTest` 8/8 — 46 passing. `pnpm typecheck` clean, `pnpm build` OK.

**Live transactions (account #1 `0x1Ed5B7462545b4639d70fE18A300Bdbdb55910e0`):**
- Migration: v1 closeTrove [`0x57df1374…`](https://explorer.test.mezo.org/tx/0x57df13743a8fd7a1f68a7b7102ffd48e02b95b20263f559681a3c17bae05cb2a) (a first attempt, [`0x380fa9fc…`](https://explorer.test.mezo.org/tx/0x380fa9fcec846c86ec4e2be02f4208a6c0d03ea0058e4bf2aca0828dd65ad229), ran out of gas at the estimated limit; no state changed). v2 createAccount [`0x3c6ab6b4…`](https://explorer.test.mezo.org/tx/0x3c6ab6b45bd60bf05d692a757046c4d89268c3103402bcf3a111de62d2bf56d6); openTrove 2,000 MUSD / 0.048 BTC [`0xe7d5fb3e…`](https://explorer.test.mezo.org/tx/0xe7d5fb3e00af9963e53554a2b242615a3d63d6e0453aef8adf40cb4fc1baff7f) block 16783462 → debt 2,202, ICR 140.35%, `ownerMUSD` 2,000, `pendingIncome` 0.
- Policy "Keep my BTC" 20/5/75: [`0x77ebb12b…`](https://explorer.test.mezo.org/tx/0x77ebb12b6caa33cd2fad02fff83f48508ee1073914e97043a4082d393144cabf).
- **`pay(1, 100 MUSD, "order-1001")`** from the payer wallet: [`0xab0c50dc…`](https://explorer.test.mezo.org/tx/0xab0c50dcb704019ecb39117a9b0950d2198fe53ef9a580658fae47d790ca8606) block 16783538. `Payment` event: owner 75.00, reserve 5.00, repaid 20.00, **ICR 140.5468% → 141.8350%**. Debt 2202.0002 → 2182.0002. A first attempt ([`0x561d3e67…`](https://explorer.test.mezo.org/tx/0x561d3e679c114462cf4f30a7699f547b4d3c48c6ed42aea416cf2337be93b85b)) hit my 3M gas limit: without hints Mezo walks its sorted list and the call needs ≈4.08M gas. `payWithHints` avoids that.
- **Keeper:** payer sent 50 MUSD straight to the account ([`0x0f46aac0…`](https://explorer.test.mezo.org/tx/0x0f46aac06209f6de3ef91ffbea697a91f90a219f00a6bd993a816483c3a893c2)); `pendingIncome` 50, `ownerMUSD` unchanged. The payer wallet (not the owner) called `processIncome`: [`0x8e804aae…`](https://explorer.test.mezo.org/tx/0x8e804aaeb85cb98bbaef90e90994e020d5d66e794f2de6a82d89dd8c72d7c484) block 16783582 → owner 37.50, reserve 2.50, repaid 10.00, **ICR 141.2731% → 141.9235%**; `pendingIncome` 0; `ownerMUSD` still 2,000; keeper received nothing.
- **NFT transfer with the loan open:** [`0x6a0b5417…`](https://explorer.test.mezo.org/tx/0x6a0b54177b23632062f185062c70dd2dadd9635c2ab0074efcee38e8eb946bd4) → owner, controller and payout all = second wallet, trove still active; old holder's `withdrawMUSD` simulation reverts (`0x23019e67`, NotController). Returned: [`0x4f91ca3b…`](https://explorer.test.mezo.org/tx/0x4f91ca3b2c7c1f318af481d0e1c4079c6e4f419c68dccb75a0a724e802b8cb3d).
- **Hedge v2:** module [`0xd39db99E4F9C12C3A8933F9A94AFF7869558254a`](https://explorer.test.mezo.org/address/0xd39db99E4F9C12C3A8933F9A94AFF7869558254a); open [`0x806d0be5…`](https://explorer.test.mezo.org/tx/0x806d0be570381b8d17030c7d1a577ae1200415b9c0b40de5c403e959b6b3720e) (80 MUSD collateral, 0.0005 BTC borrowed, sold for 39.082 MUSD); close [`0xcf2c939a…`](https://explorer.test.mezo.org/tx/0xcf2c939a407618ed7d12f69f80f6e09d273951cf5ed34482654dae975c42c2f9) (owed 0.000500016590243 BTC, 0.7816 MUSD top-up, collateral 80 MUSD back); sendToAccount [`0xdacf1c2a…`](https://explorer.test.mezo.org/tx/0xdacf1c2a355e978821c9b418f21be314c3e203cb576f3f1b3ce5780c88c6cfa7) → account `ownerMUSD` 2,000 → 2,080, `pendingIncome` 0.
- Cap (repayment stops at Mezo's minimum debt, excess to owner): proven in `test_fork_repayCappedAtMezoMinimumDebt_excessToOwner` against live Mezo state, not run live so the demo loan keeps room to repay.
- Browser (no wallet): `/pay/a/1` shows the live split 75 / 5 / 20 and ratio 140.22%; `/app/hedge` shows the live market and the card labelled "SIMULATED — not a real price move"; no console errors.
- Not verified: the new pages with a browser wallet extension.

## Full re-check against the owner's description (2026-11-14, 22:30–22:55 UTC)
Commands: `MEZO_TESTNET_RPC_URL=https://rpc.test.mezo.org forge test` → **46 passed, 0 failed** (20 unit/fuzz + 26 on live Mezo state: account, adapter, bridge receiver, hedge); `pnpm test` → 12 passed; `pnpm typecheck` clean; `pnpm build` → 13 routes. Live site https://ballast-tawny.vercel.app: every route 200, `/api/radar` 200.

Fresh live transactions (all status 1):
| What | Tx | Result |
|---|---|---|
| Base Sepolia USDC → Mezo invoice settled (second Base payment) | [0x6ff89726…86e0](https://explorer.test.mezo.org/tx/0x6ff89726e829df38104f2e6f827c0d79e0f938d6d576c4a2bfc32ea36d0a86e0) (block 16783970), Base tx [0x8e4222d6…3f46](https://base-sepolia.blockscout.com/tx/0x8e4222d6c97b1d101f6098547d1b70f63b2047943ee31bff8145afbe39083f46) | owner payout +1.5 MUSD, receiver left holding 0 |
| USDC/MUSD pool rebalanced (payer swaps 2 MUSD in) | [0x4bc31d04…f22d](https://explorer.test.mezo.org/tx/0x4bc31d04f4cd60156530b762fc913ec13a271e39d322b323027e43094a33f22d) | reserves 5.99/10.03 → 7.99 MUSD / 8.01 USDC |
| `router.pay(1, 10 MUSD, "audit-2026-11-14")` by the payer | [0xdf63e235…5f32](https://explorer.test.mezo.org/tx/0xdf63e235ad24c277d0f8947ca631b2435a60f4c2e0b35e9d8e120b8d5fda5f32) (block 16784069) | `Payment`: 7.5 owner / 0.5 reserve / 2.0 repaid; ICR 140.88% → 141.01%; 3.78M gas without hints |
| Keeper: payer sends 4 MUSD to the account, then the payer (not the owner) calls `processIncome` | [0x741e7e32…e937](https://explorer.test.mezo.org/tx/0x741e7e32d66fe0adcd9e458f4c7e5a000d9577b7d068b5c48299a42f6e59e937) (block 16784122) | `PaymentApplied` source = payer: 3.0 owner / 0.2 reserve / 0.8 repaid; ICR 140.83% → 140.88% |
| Floor cap: policy 60/0 ([setPolicy](https://explorer.test.mezo.org/tx/0xd32d39455f8d89b753c4d90ad816ea47efeccc5acf97b04258d6130f6b59d448)), then `pay(300 MUSD)` | [0xb52b8693…98a0](https://explorer.test.mezo.org/tx/0xb52b86935a203d3fe55ed858d69bbefedb655703b43a1539e2108789dac098a0) (block 16784229) | quote before: repay 168.80 (cap), owner 131.20. `Payment`: 131.1978 owner / 168.8022 repaid; principal after = **2000.000000000000000000**; ICR 140.97% → 152.86% |
| Restore demo headroom: controller borrows 100 MUSD; policy back to 20/5/75 | [borrow](https://explorer.test.mezo.org/tx/0x0e02fd2062bbea0d371e98a5436321a9c581b7c527bfa122b38569e18eeaa794), [setPolicy](https://explorer.test.mezo.org/tx/0xc9c0c46839e9a12a93322f94d5d03410ca56fd92d451f1af1e9613e8e7371d8c) | maxRepayable 100.10, ICR 144.94% (BTC 63,708 on the oracle), quoteSplit(100) = 75/5/20 |
Hedge open/close was last run live at 22:03–22:05 UTC (see the hedge section); not repeated (each run costs ~0.8 MUSD in swap fees).

Fix from this check: when an invoice is larger than the USDC/MUSD pool can convert, the Base card said "Quoting…" forever; it now explains that the pool is too small (anything costing more than 10% extra is refused; measured limit about 4.5 MUSD) and to pay in MUSD on Mezo or use a smaller invoice. Checked on the live site with 5 and 10 MUSD invoices. Radar on the live site at block 16784487: 338 loans, all checks true, account #198 from the tail.

## Pay with MUSD from Base over Wormhole NTT (2026-11-14, from 23:20 UTC)
- `BASE_SEPOLIA_RPC_URL=https://sepolia.base.org forge test --match-contract BallastBaseGatewayForkTest` → **4 passed** on a fork of live Base Sepolia: `pay` burns the payer's MUSD through the real NTT manager (total supply −5 MUSD), gateway left holding nothing and no standing approval, unused native fee refunded, zero amount / zero account / dust / missing allowance rejected.
- Gateway deployed and source-verified on Base Sepolia (docs/DEPLOYMENTS.md).
- Mezo → Base, to give the demo payer MUSD on Base: `scripts/live.sh ntt-to-base 30` → [approve](https://explorer.test.mezo.org/tx/0xdcd6d15af8c9873466b29edf9dbce14b871e8b64d258e6a39568fedd45d79cca), [transfer](https://explorer.test.mezo.org/tx/0x7455fef58ba587c270c635432b263b6792e64a2ea15fe9c2c315c1513a0a6c25) (block 16784908, status 1, bridge sequence 90). **Not delivered yet:** no guardian signature as of the last check. The 30 MUSD is locked in the Mezo NTT manager until then.
- **Not yet run:** gateway `pay` on Base → delivery on Mezo → keeper `processIncome`. Commands are ready: `base-musd-pay <MUSD> <ref>`, then `ntt-deliver-mezo <sequence>`.
- Radar: "MUSD ahead of you" now sums `debt − 200` over eligible loans ahead (Mezo's per-loan redeemable amount).

## v3 (2026-11-15, 07:20–08:00 UTC): NFT sale through a contract, hedge opened by the account
Tests: `MEZO_TESTNET_RPC_URL=… BASE_SEPOLIA_RPC_URL=… forge test` → **53 passed, 0 failed** (21 unit/fuzz, 32 on live Mezo / Base Sepolia state). New: sale through an escrow contract with the loan open; the account opens and closes the hedge from its reserve; a fork-only simulated BTC drop where the hedge profit repays the loan. Raw log: `evidence/v3-proofs.out`, `evidence/live-20261115.log`.

| What | Tx | Result (decoded from events) |
|---|---|---|
| v3 account opens its Mezo loan | [0x1c12b684…e76e](https://explorer.test.mezo.org/tx/0x1c12b684ebebac2154275e09462345386ee597cce37f7c4ad13b58fb62dee76e) (block 16791736) | 2,100 MUSD against 0.048 BTC, TroveManager status 1 for `0xe43257DB9B711c29A8e44c5C4F58950752FAf463` |
| `router.pay(1, 100 MUSD, "v3-demo")` by the payer wallet | [0xbec250c4…bd5e](https://explorer.test.mezo.org/tx/0xbec250c4a877f3b637b8935e1713115d8d5989626614c9e97f3cdf12938bbd5e) (block 16791774) | `Payment`: 75.00 owner / 5.00 hedge reserve / 20.00 repaid; ICR 134.15% → 135.33% |
| Keeper: payer sends 50 MUSD to the account, then the payer (not the owner) calls `processIncome` | [0x93bbadeb…a9cd](https://explorer.test.mezo.org/tx/0x93bbadeb9ad67c95f32ca5507ee6b7d9b28cec00d4c327dd857868aaf4b1a9cd) (block 16791808) | `PaymentApplied`: 37.50 owner / 2.50 reserve / 10.00 repaid; ICR 135.26% → 135.85% |
| NFT listed in an escrow **contract** with the loan open (`safeTransferFrom`) | [0x2d8e0152…857a](https://explorer.test.mezo.org/tx/0x2d8e01521db67bb4542be4383d3f1a053f219c17a890c19f99995ccd630f857a) (block 16791829) | owner and `account.controller()` = the escrow; a plain `transferFrom` to it reverts `UseSafeTransferForContracts` (simulated) |
| Escrow releases the NFT to the buyer (payer wallet) | [0x43626e63…b8d9](https://explorer.test.mezo.org/tx/0x43626e6369e6e8304ee33348492fe1b0c45f08333d404e8937a36bd5c208b8d9) (block 16791831) | owner and controller = buyer, loan still open; the old holder's `withdrawMUSD` reverts `NotController` (simulated). Returned afterwards: [0x42d4d58c…222f](https://explorer.test.mezo.org/tx/0x42d4d58ccca7ea7a232a719588946ba0d4c0ab3943bdecd00d8dec4f8ba6222f) |
| Hedge reserve funded by income (policy 0/100 for one 85 MUSD payment, then back to 20/5/75) | [0xbc5fc9da…62a7](https://explorer.test.mezo.org/tx/0xbc5fc9daad3c4d38e8049c53ef8a0a5a53825bd5b557df356e57b3b75b9762a7) | reserve 7.5 → 92.5 MUSD |
| Hedge module created and attached to the account | [create](https://explorer.test.mezo.org/tx/0x2e382080a5134d8ffb5a453f3073bf832002122fbd43c5dbf998370f4c810fd8), [setHedgeModule](https://explorer.test.mezo.org/tx/0x245a8ddeb3d1f5899a0244eceabbc7fc2acde5dddecae701c73af819aebd2486) | `account.hedgeModule()` = `0x5bCB976EF92673ABbc564583155CdC0AC86846CC` |
| **Account** opens the short from its reserve: `account.openHedge` | [0x09d17ce3…c447](https://explorer.test.mezo.org/tx/0x09d17ce366ce7ef78439386f04b6238476f19d99a51a4a74651cf3c66c3cc447) (block 16791891) | `HedgeOpened`: 80.00 MUSD from the reserve posted on Morpho, 0.000500 BTC borrowed and sold |
| **Account** closes it: `account.closeHedge` | [0xd6a52ed4…ed54](https://explorer.test.mezo.org/tx/0xd6a52ed49876862609d15578cf56b51b5372a38a2f45065aa8337675363ded54) (block 16791907) | `HedgeClosed`: 80.0000 MUSD came back for 80.7782 put in (collateral + top-up), 0.0000 repaid to the loan, 80.0000 back to the reserve. The hedge cost 0.7782 MUSD in fees (BTC did not fall) |

Not re-run on v3: the Base USDC invoice route (the v3 receiver is deployed; a run needs a 20–30 minute guardian wait) and the Radar quote → repay → reorder proof (Radar is read-only and unchanged; it reads the v3 account live). MUSD over NTT from Base: still waiting on the guardian (see above).
