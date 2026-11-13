# Status — resume point

Deadline: Mezo Buildathon Wave 2, **2026-11-15** (exact cutoff/timezone: verify on AKINDO; plan freeze 2026-11-14 evening UTC).

| Item | State | Next action |
|---|---|---|
| Repo audit / tools | VERIFIED | — |
| Mezo addresses, ABIs, params | VERIFIED | docs/VERIFICATION.md |
| Contracts (Factory/NFT/Account/Router) | IN PROGRESS: compiled; fork tests 4/4 PASS | add local unit/fuzz tests |
| **Gate A** live contract-owned trove + repay | **VERIFIED** (docs/TEST_EVIDENCE.md) | — |
| **Gate B** 100 MUSD invoice 20/5/75 live | **VERIFIED** (docs/TEST_EVIDENCE.md) | — |
| Ballast explorer source verification | NOT STARTED | `forge verify-contract` against Blockscout |
| Local unit/fuzz tests (non-fork) | NOT STARTED | router split fuzz, NFT, access control |
| **Gate C** Redemption Radar | **VERIFIED** (read model + live reorder, docs/TEST_EVIDENCE.md) | wire into UI |
| Gate D invoice link + DEMO.md | NOT STARTED | |
| P0-E frontend/deploy/docs/submission | NOT STARTED | |
| P1 Base Sepolia path | DEFERRED until A–D green | |
| P1 Morpho hedge | DEFERRED until A–D green | |
