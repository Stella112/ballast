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
