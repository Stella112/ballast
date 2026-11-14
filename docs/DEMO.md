# Demo — reproduce Ballast on Mezo testnet

Live app: https://ballast-tawny.vercel.app (or run locally with `pnpm install && pnpm dev`).

No admin keys are needed. You need a browser wallet with **two accounts** (merchant, payer) on Mezo Testnet (chain 31611, RPC `https://rpc.test.mezo.org`, explorer `https://explorer.test.mezo.org`). The app offers to add/switch the network.

## Prerequisites
- Merchant: ~0.05 BTC from https://faucet.test.mezo.org/ (collateral + gas). At ~68k MUSD/BTC, a 2,000 MUSD trove at ~150% needs ≈0.048 BTC.
- Payer: a little BTC for gas, and MUSD (the merchant sends some after borrowing, step 2).

## Steps (web app)
1. **Owner → /app**: *Create account* (mints the NFT). *Open trove*: e.g. borrow 2000 MUSD with 0.048 BTC. The page shows the fee, total opening debt and ratio before you send.
2. **Owner → /app**: *Withdraw MUSD* 150 to the payer's address (the payer needs MUSD to pay with).
3. **Owner → /app/payback**: choose *Keep my BTC* (20% repay / 5% hedge / 75% you) → *Save policy on-chain*.
4. **Owner → /app/radar**: note the block, position, MUSD ahead and the quotes.
5. **Owner → /app**: copy *Your pay link* (`/pay/a/<id>`).
6. **Payer** opens the pay link: enter 100 MUSD and a reference → *Approve* → *Pay*. The receipt shows the split and the collateral ratio before and after, from the transaction's event.
7. **Keeper**: send MUSD straight to the account address from any wallet. **/app** shows it under *Income waiting for your policy*; anyone can press *Apply policy now*.
8. **Pay from Base Sepolia**: Owner → /app/invoices signs a small invoice (2–3 MUSD; the seeded pool is small). Payer opens it and uses *Or pay with USDC on Base Sepolia*: approve and send on Base, wait for the guardians (several minutes; the page keeps checking), then *Settle on Mezo*.
9. **Hedge → /app/hedge**: *Create hedge module*, open a short (e.g. 80 MUSD collateral, 0.0005 BTC), close it, *Send to my Ballast account*. The last card is the labelled SIMULATED BTC drop.
10. **Transfer (optional) → /app**: *Transfer this account* hands the NFT, and with it the loan, to another wallet.

## Existing Mezo loan (wallet-held, optional)
Needs a wallet that already has its own Mezo loan (for example opened at testnet.mezo.org) with room above Mezo's 2,000 MUSD minimum debt.
1. **Borrower → /app/existing**: shows debt, ratio and "Repayable now". Enter amount and repay share (e.g. 100 MUSD, 20%) → *Sign & create link*. The wallet asks for two signatures: the invoice, and Mezo's one-off `RepayMUSD` for exactly the repay amount. No gas.
2. **Payer** opens the link: *Signatures: Valid*, split shown (80 to the borrower, 20 to the loan) → *Approve* → *Pay invoice*. The receipt shows debt before/after from the transaction's event.
3. Only one such link can be outstanding at a time: Mezo uses each signature nonce once.

## Expected results
- Payer −100 MUSD; merchant +75; account reserve +5; trove debt −20 (exactly, in the same tx).
- Paying the same link again fails (*already paid*). Editing the memo or amount in the link shows *Invalid* signature and the router rejects it.

## Recorded run (2026-11-13, past — not live state)
See docs/TEST_EVIDENCE.md for every hash and block, and the in-app **/demo** page.

## Command-line alternative
`BALLAST_LIVE=1 scripts/live.sh preflight | create-account | open-trove 2000 0.048 | set-policy 2000 500 | fund-payer 150 | pay-invoice 100 | state` — requires `.env.local` with two disposable testnet keys (see `.env.example`). Never use keys that hold real value.
