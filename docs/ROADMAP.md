# Roadmap

None of the following exists today.

1. **Security review and mainnet readiness (after the buildathon, ~4–6 weeks)** — external review of the four contracts, invariant tests on a Mezo fork, explorer source verification, an overflow mode that forwards repay shares that hit the debt floor instead of reverting (owner-selected).
2. **Distribution: invoice SDK and merchant integrations (~1–2 months after review)** — a small TypeScript package to create and verify Ballast invoices, so checkout pages, payroll and x402-style paywalls can route MUSD income into loan repayment.
3. **Conditional expansions (only if verified on-chain)** — paying from Base via a verified canonical MUSD route; a Morpho-based BTC hedge only where a real market with BTC as the loan asset, liquidity and a sound oracle exist; transferable indebted account NFTs after dedicated security work.
