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
