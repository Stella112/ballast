# Status — resume point

Deadline: Mezo Buildathon Wave 2, **2026-11-15** (exact cutoff/timezone: verify on AKINDO; plan freeze 2026-11-14 evening UTC).

| Item | State | Next action |
|---|---|---|
| Repo audit / tools | VERIFIED | — |
| Mezo addresses, ABIs, params | VERIFIED | docs/VERIFICATION.md |
| Contracts (Factory/NFT/Account/Router) | VERIFIED: deployed; 15 unit/fuzz + 4 fork tests PASS | — |
| **Gate A** live contract-owned trove + repay | **VERIFIED** (docs/TEST_EVIDENCE.md) | — |
| **Gate B** 100 MUSD invoice 20/5/75 live | **VERIFIED** (docs/TEST_EVIDENCE.md) | — |
| Ballast explorer source verification | **VERIFIED** (Router, NFT, Factory, Account: Blockscout "Pass - Verified", 2026-11-13) | — |
| Local unit/fuzz tests (non-fork) | VERIFIED (15 pass) | — |
| **Gate C** Redemption Radar | **VERIFIED** (read model + live reorder; post-repay ICR + BTC drop scenarios checked vs chain 2026-11-14) | — |
| Gate D invoice link + DEMO.md | IN PROGRESS: links + pay page built; signature/split checked in browser; DEMO.md written | full browser-wallet run (needs a human wallet) |
| P0-E frontend | **DEPLOYED**: all routes build; tested in browser without wallet, mobile 375px OK | live at https://ballast-tawny.vercel.app (verified 2026-11-14); repo published at https://github.com/Stella112/ballast |
| Docs / submission copy | IN PROGRESS: README, DEMO, ARCHITECTURE, ROADMAP, AKINDO_SUBMISSION written | fill URLs, video, team |
| P1 Base Sepolia path | DEFERRED until A–D green | |
| P1 Morpho hedge | DEFERRED until A–D green | |
