# Build log

## 2026-11-13
- **Audit**: empty folder; tools: forge/cast/anvil 1.8.6, node 26.4, pnpm 10.34.6, python 3.11. Initialized git, Foundry (solc 0.8.24, london), OZ v5.0.2, forge-std v1.9.4.
- **RPC**: chain 31611 confirmed; all candidate Mezo addresses have bytecode; proxies' implementations explorer-verified and diffed against mezo-org/musd@da7888a (identical). Details in VERIFICATION.md.
- **Decision**: build the real Factory/NFT/Account/Router immediately (instead of a throwaway probe account), because each live trove locks scarce testnet BTC; de-risk with fork tests against live state first. Trove opened in Gate A becomes the demo trove.
- **Decision**: invoices are EIP-712 messages signed by the current controller (no on-chain registry, no server keys). Replay key `(tokenId, invoiceId)`; exact-amount single payment.
- **Decision**: repayment beyond Mezo's min-net-debt headroom reverts the whole payment (`RepayExceedsHeadroom`) — no silent re-routing.
- **Failure → fix**: all fork tests reverted inside `PriceFeed.fetchPrice()` → oracle at precompile `0x7b7c…15` → Foundry `NotActivated`. Fix: mock only the precompile with the live `latestRoundData` fetched by `vm.rpc`. Result: **4/4 fork tests pass** (open/withdraw/repay, 100 MUSD 20/5/75 split, floor revert atomicity, NFT lock + close + transfer).
- Owner funded both wallets with 0.05 BTC each (less than the 0.075 requested). Decision: shrink the trove to 2000 MUSD / 0.048 BTC (ICR ≈149%, ~202 MUSD headroom above the floor) rather than move BTC between wallets.
- Deployed router/NFT/factory (blocks 16762083–87). A one-off null RPC response broke receipt parsing → fixed hash-case matching in live.sh; block numbers confirmed via `cast receipt`.
- **Gate A PASS**: account-owned trove opened (block 16762136); controller repay of 10 MUSD lowers debt by exactly 10e18 (Repaid event); permissions checked live.
- **Gate B PASS**: payer paid a 100 MUSD invoice → 75/5/20 exact; trove debt −20e18 exact in the same tx; replay and tamper rejected.
- Generated two disposable testnet-only keys into git-ignored `.env.local` (keys never printed). Live preflight OK; both wallets at 0 BTC → blocked on faucet.
- Radar: verified sort direction (descending NICR, tail first redeemed, ICR<MCR skipped), NICR precision 1e20, interest-first repayment. Reader rebuilds the list from pointers at one block and self-verifies. Multicall3 is present on Mezo testnet.
- **Gate C PASS**: quote 12.756783 MUSD to pass the next trove → live repay → rank 165 → 166 at block 16762622.
- Frontend: pinned within known-stable majors (next 15.5.29, wagmi 2.19.5, viem 2.38.0, TS 5.9.3, tailwind 4.1.13) rather than latest majors (next 16 / wagmi 3 / TS 7), to limit risk before the deadline. Tailwind only, no shadcn CLI (fewer deps).

## 2026-11-13 — Explorer source verification
`forge verify-contract --verifier blockscout --verifier-url https://api.explorer.test.mezo.org/api/` (solc 0.8.24, london, 200 runs) returned "Pass - Verified" for BallastRouter, BallastAccountNFT, BallastFactory and BallastAccount (0xDE61…6323). Note: the verifier API host is `api.explorer.test.mezo.org`, not `explorer.test.mezo.org/api`.

## 2026-11-14 — Frontend deployed to Vercel
- An earlier CLI deploy had failed without creating a project; root cause was the C: drive at 0 MB free (ENOSPC). Freed space (npm cache, `.next`).
- Added `vercel.json` (framework nextjs, pnpm) because the CLI linked the project with "No framework detected".
- `vercel deploy --prod` → READY, production alias https://ballast-tawny.vercel.app (`dpl_5pi9ErA2NVGuorZqvyiUpxF3Q4Ur`). Project is linked to GitHub, so pushes to `main` redeploy.
- Checks: `/`, `/app`, `/app/radar`, `/app/invoices`, `/app/payback`, `/app/activity`, `/app/hedge`, `/demo`, `/api/radar` all HTTP 200 without login (per-deployment URL is behind Vercel auth; use the production alias).
- `/api/radar` at block 16763926: size 325, tail 0xBAA1…9E05, consistency checks all true; matched `SortedTroves.getSize()`/`getLast()` via cast. Account 0xDE61…6323: coll 0.048 BTC equal to `TroveManager.getTroveColl`; debt 2159.2483 MUSD vs 2159.2483 on-chain (difference = interest accrued between reads); position 166 of 325 from the tail.

## 2026-11-14 — Radar: post-repayment ICR + BTC drop scenarios; corrected project description
- Added post-repayment ICR to quotes/simulation and −10/−20/−30% BTC scenarios (math.ts `droppedPrice`/`scaleIcr`/`eligibilityAtPrice`, snapshot `scenarios` using Mezo `getTCR`/`checkRecoveryMode`). Values match chain exactly at block 16764464 (docs/TEST_EVIDENCE.md).
- Wrote docs/PROJECT_DESCRIPTION.md: the owner's description corrected to match what is built (removed non-existent `BallastRepaymentAdapter` and shadcn/ui; signed repayment for existing troves, Base payments and Hedge marked Planned; real preset percentages and real Radar numbers). Submission category set to the owner's "Bitcoin-Backed Loan Risk Management".
