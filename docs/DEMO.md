# Demo — reproduce Ballast on Mezo testnet

No admin keys are needed. You need a browser wallet with **two accounts** (merchant, payer) on Mezo Testnet (chain 31611, RPC `https://rpc.test.mezo.org`, explorer `https://explorer.test.mezo.org`). The app offers to add/switch the network.

## Prerequisites
- Merchant: ~0.05 BTC from https://faucet.test.mezo.org/ (collateral + gas). At ~68k MUSD/BTC, a 2,000 MUSD trove at ~150% needs ≈0.048 BTC.
- Payer: a little BTC for gas, and MUSD (the merchant sends some after borrowing, step 2).

## Steps (web app)
1. **Merchant → /app**: *Create account* (mints NFT). Then *Open trove*: e.g. borrow 2000 MUSD with 0.048 BTC. The page shows fee, total opening debt (incl. 200 MUSD gas deposit) and ratio before you send.
2. **Merchant → /app**: *Withdraw MUSD* 150 to the payer's address.
3. **Merchant → /app/payback**: choose *Demo split* (20% repay / 5% reserve / 75% spendable) → *Save policy on-chain*.
4. **Merchant → /app/radar**: note block, queue position, NICR and the quotes.
5. **Merchant → /app/invoices**: 100 MUSD, any memo → *Sign & create link* → copy.
6. **Payer** opens the link: signature shows *Valid*; *Approve 100 MUSD* → *Pay invoice*. The receipt card shows the split and the merchant's debt before/after, decoded from the transaction's events, with the explorer link.
7. **Merchant → /app/activity** and **/app/radar**: the payment and repayment appear; Radar shows the new state at a newer block. Use *Repay from account* on a quote to see a verified before/after rank change (or "No rank change" if that is what happened).

## Expected results
- Payer −100 MUSD; merchant +75; account reserve +5; trove debt −20 (exactly, in the same tx).
- Paying the same link again fails (*already paid*). Editing the memo or amount in the link shows *Invalid* signature and the router rejects it.

## Recorded run (2026-11-13, past — not live state)
See docs/TEST_EVIDENCE.md for every hash and block, and the in-app **/demo** page.

## Command-line alternative
`BALLAST_LIVE=1 scripts/live.sh preflight | create-account | open-trove 2000 0.048 | set-policy 2000 500 | fund-payer 150 | pay-invoice 100 | state` — requires `.env.local` with two disposable testnet keys (see `.env.example`). Never use keys that hold real value.
