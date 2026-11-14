# AKINDO submission — Mezo Buildathon Wave 2

**Project name:** BALLAST
**Category:** Bitcoin-Backed Loan Risk Management
**Track:** Track 1 — DeFi. (Track 2 — Access & Distribution relevance: invoice links route merchant income into loan repayment. Claim only if AKINDO allows secondary tracks — TODO: confirm on platform.)
**One-line:** The cash-flow autopilot for Bitcoin-backed loans: every MUSD payment you receive can make your Mezo loan safer.

## TL;DR
Ballast gives a Mezo borrower a contract account (controlled by an NFT) that owns their trove. They send customers invoice links; each MUSD payment is split atomically by the borrower's policy — spendable, an MUSD reserve, and direct repayment of the trove. Redemption Radar reads Mezo's sorted trove list and shows what a repayment costs and what it actually changed.

## Problem
Mezo borrowers face liquidation if BTC falls, and redemption — lowest-ratio troves are redeemed first, even healthy ones. People who earn MUSD (freelancers, merchants) must manually move income into repayments, and cannot easily see how a repayment changes their redemption exposure.

## How it works
1. Create a Ballast account (NFT minted to you); the account opens a real Mezo trove with your BTC.
2. Choose a policy (e.g. 20% repay / 5% reserve / 75% spendable).
3. Sign invoice links in your wallet; customers pay in MUSD.
4. One transaction: payer → you (spendable), → account reserve, → Mezo `repayMUSD` from the account.
5. Radar: queue position from a verified full-list read, quotes to pass 1/10/50 troves with the collateral ratio after each repayment, liquidation-price estimate, BTC −10/−20/−30% scenarios (your ICR, liquidatable or not, redemption rank, Mezo TCR and recovery mode at each price), before/after.

## Mezo integration
Direct calls to Mezo MUSD `BorrowerOperations` (openTrove, repayMUSD, withdrawMUSD, addColl, withdrawColl, closeTrove, claimCollateral) from the account contract; reads from `TroveManager`, `SortedTroves`, `HintHelpers`, `PriceFeed`. Addresses and implementations verified against explorer-verified source (`mezo-org/musd@da7888a`). Native BTC collateral; MUSD as the payment asset.

## Technical architecture
Solidity 0.8.24 (Factory, Account, NFT, Router; no admin keys), Next.js 15 + wagmi/viem frontend, server-side Radar read model. See docs/ARCHITECTURE.md.

## Target users
BTC holders who borrow MUSD on Mezo and receive recurring MUSD income: freelancers, small merchants, DAOs paying contributors.

## Why this is useful for Mezo
Turns MUSD payment volume into continuous debt reduction, raising borrowers' collateral ratios and making redemption risk visible — with a small router other apps can integrate.

## Measured proof (Mezo testnet, 2026-11-13)
- Account-owned trove opened: tx 0x73e6312cd962106ef5b07f6a2db4e1e8572580c0d9df9b4b404ebd8c26514940 (block 16762136).
- 100 MUSD invoice paid by a separate wallet → 75 / 5 / 20; trove debt −20.000000000000000000 MUSD in the same tx: 0x3b9dce365e1ca8b2e043cc663fbc21c24b5f5364a7c90b2cd68be9571a3e5bc7 (block 16762254).
- Radar quote 12.756783 MUSD → repaid → queue position #165 → #166: 0xea07e53b0a2664cffc796b8e1063c0174979068ef0f200ccd5d810c3bd798c75 (block 16762619).
- Tests: 15 Foundry unit/fuzz, 4 Foundry tests on live Mezo state, 12 Radar math tests.

## Limitations
Testnet only, unaudited. NFT locked while a loan is active. Exact-amount single-use invoices. Repayments that would cross Mezo's 1,800 MUSD net-debt floor revert the whole payment. Queue position is not a guarantee. Base payments and Morpho hedge: **not built / not verified** (UI says so).

## Chain deployed
Mezo testnet (chain 31611). Factory `0x74f918a5C1c8BDDc40CD0Ba8F9935790Fbc5dCCd`, Router `0x2a3Ce214189F62A2f15b58ecFD7c4CfCDa97dF1d`, NFT `0xAa0034E681d208579cFF63A8E2CD298Fc51F3Afa`. No Base Sepolia deployment.

## Status / readiness
Working testnet MVP (Gates A–C verified on-chain; web flow built and tested without a wallet in-browser; wallet flow — TODO: NEEDS VERIFIED RESULT from a browser-wallet run).

- **GitHub repo:** https://github.com/Stella112/ballast
- **Live frontend:** https://ballast-tawny.vercel.app
- **Demo video (2 min):** TODO — NEEDS VERIFIED RESULT
- **Deck:** TODO — NEEDS VERIFIED RESULT

## Tech stack
Solidity 0.8.24, Foundry 1.8.6, OpenZeppelin 5.0.2, Next.js 15.5, React 19, wagmi 2.19, viem 2.38, Tailwind 4, Vitest.

## Security
Threat model and residual risks: docs/SECURITY.md. No admin/upgrade keys; NFT-holder-only control; router limited to crediting reserve + repaying the account's own trove; EIP-712 signed invoices bound to chain/router; replay and expiry checks; reentrancy guards; exact split conservation fuzzed.

## Team
TODO — owner to provide names/roles. (No collaborators are assumed.)

## Future milestones
1. Security review + mainnet readiness (~4–6 weeks).
2. Invoice SDK and merchant integrations (~1–2 months after review).
3. Conditional: Base payments via verified canonical MUSD route; Morpho hedge only if a real market exists.

## Disclaimer
Testnet, unaudited. Ballast does not guarantee protection from redemption or liquidation. No verified product demand yet.

---

## Two-minute demo script
- **0:00–0:15** — "Borrowing on Mezo gives BTC holders liquidity — but redemptions hit the lowest-ratio loans first, and price drops can liquidate."
- **0:15–0:35** — /app: NFT #1 controls account 0xDE61…; show the live trove (collateral, debt, ratio) and /app/radar position.
- **0:35–0:55** — /app/payback: Demo split 20/5/75 → save. /app/invoices: sign a 100 MUSD invoice.
- **0:55–1:25** — Payer wallet opens link → approve → pay. Show receipt: 75 / 5 / 20 and debt before → after; open the explorer tx.
- **1:25–1:45** — /app/radar refresh: new block, new debt and NICR; show the before/after (or "no rank change" if that is the truth).
- **1:45–2:00** — Router is a small interface any checkout can call. Base payments and hedging: not built — on the roadmap.

## Deck outline
1. Title & one-liner · 2. Problem (redemption + liquidation, manual repayment) · 3. Solution (account + invoice + atomic split) · 4. Live proof (three tx links) · 5. Radar · 6. Architecture & security · 7. Roadmap · 8. Ask.
