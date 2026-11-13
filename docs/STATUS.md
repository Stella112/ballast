# Status — resume point

Deadline: Mezo Buildathon Wave 2, **2026-11-15** (exact cutoff/timezone: verify on AKINDO; plan freeze 2026-11-14 evening UTC).

| Item | State | Next action |
|---|---|---|
| Repo audit / tools | VERIFIED | — |
| Mezo addresses, ABIs, params | VERIFIED | docs/VERIFICATION.md |
| Contracts (Factory/NFT/Account/Router) | IN PROGRESS: compiled; fork tests 4/4 PASS | add local unit/fuzz tests |
| **Gate A** live contract-owned trove + repay | BLOCKED: wallets unfunded | owner funds `0x4ff0D7c712B109dE476f21Ed443Ef0928d52a5fA` (≥0.075 BTC) and `0xCBCd26d717CEe0305b92FDC1E50A398608A4d857` (gas) → `scripts/live.sh deploy/create-account/open-trove 2100 0.07/repay 10` |
| **Gate B** 100 MUSD invoice 20/5/75 live | NOT STARTED (fork PASS) | `fund-payer 150`, `set-policy 2000 500`, `pay-invoice 100` |
| Gate C Redemption Radar | NOT STARTED | TS read model (viem) |
| Gate D invoice link + DEMO.md | NOT STARTED | |
| P0-E frontend/deploy/docs/submission | NOT STARTED | |
| P1 Base Sepolia path | DEFERRED until A–D green | |
| P1 Morpho hedge | DEFERRED until A–D green | |
