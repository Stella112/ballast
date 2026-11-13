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

## Live Mezo testnet
**None yet** — no transaction hash means no claim. Logs will be written to `evidence/live-*.log` by `scripts/live.sh`.
