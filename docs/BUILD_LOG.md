# Build log

## 2026-11-13
- **Audit**: empty folder; tools: forge/cast/anvil 1.8.6, node 26.4, pnpm 10.34.6, python 3.11. Initialized git, Foundry (solc 0.8.24, london), OZ v5.0.2, forge-std v1.9.4.
- **RPC**: chain 31611 confirmed; all candidate Mezo addresses have bytecode; proxies' implementations explorer-verified and diffed against mezo-org/musd@da7888a (identical). Details in VERIFICATION.md.
- **Decision**: build the real Factory/NFT/Account/Router immediately (instead of a throwaway probe account), because each live trove locks scarce testnet BTC; de-risk with fork tests against live state first. Trove opened in Gate A becomes the demo trove.
- **Decision**: invoices are EIP-712 messages signed by the current controller (no on-chain registry, no server keys). Replay key `(tokenId, invoiceId)`; exact-amount single payment.
- **Decision**: repayment beyond Mezo's min-net-debt headroom reverts the whole payment (`RepayExceedsHeadroom`) — no silent re-routing.
- **Failure → fix**: all fork tests reverted inside `PriceFeed.fetchPrice()` → oracle at precompile `0x7b7c…15` → Foundry `NotActivated`. Fix: mock only the precompile with the live `latestRoundData` fetched by `vm.rpc`. Result: **4/4 fork tests pass** (open/withdraw/repay, 100 MUSD 20/5/75 split, floor revert atomicity, NFT lock + close + transfer).
- Generated two disposable testnet-only keys into git-ignored `.env.local` (keys never printed). Live preflight OK; both wallets at 0 BTC → blocked on faucet.
