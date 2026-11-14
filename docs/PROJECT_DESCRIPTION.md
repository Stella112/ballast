# BALLAST — The Cash-Flow Autopilot for Bitcoin-Backed Loans

**Tagline:** Protect your Bitcoin. Strengthen your loan.

**One-liner:** Ballast turns incoming MUSD payments into automatic debt repayment, helping Bitcoin-backed borrowers improve their loan health and manage redemption exposure without selling their BTC.

- **Blockchain:** Mezo Testnet (chain 31611). Base payments are planned, not built.
- **Primary track:** DeFi — Borrowing, Lending & Risk Management
- **Secondary track:** Access & Distribution for MUSD
- **Core assets:** BTC and MUSD (USDC only in the planned cross-chain flow)
- **Live app:** https://ballast-tawny.vercel.app · **Code:** https://github.com/Stella112/ballast

> Status legend used below: **Live** = deployed on Mezo testnet and proven with transactions; **Planned** = not built.

## The problem

Mezo lets Bitcoin holders borrow MUSD against BTC without selling it. Borrowing against BTC carries two risks:

1. **Redemption risk.** MUSD holders can redeem MUSD for BTC. Mezo takes the BTC from eligible loans with the lowest nominal collateral ratio first. A borrower can lose part of their BTC this way even though their loan is not liquidatable.
2. **Liquidation risk.** If BTC falls and a loan's collateral ratio drops below 110%, it can be liquidated.

Borrowers have to monitor both, calculate repayments and move funds by hand. Freelancers and businesses who earn MUSD have no automatic way to send part of that income to their loan.

Ballast connects incoming cash flow to the health of a Bitcoin-backed loan.

## The solution

### 1. Ballast Account — an NFT-controlled Mezo loan (**Live**)

A Ballast Account is a smart contract that owns a real Mezo loan (trove). An NFT identifies who controls it: whoever currently holds the NFT is the controller, read live from `ownerOf`.

The controller can deposit BTC, open the loan and borrow MUSD, add or withdraw collateral, borrow more, withdraw free MUSD, BTC and the reserve, repay, close the loan, claim leftover collateral, and set the repayment policy.

Because the account owns the loan, it can apply the controller's stored policy to each payment without a new signature per payment. The payment router can only trigger a repayment of this account's own loan. It cannot move collateral, withdraw funds or change the policy.

The NFT cannot be transferred while the loan is open, and it can never be sent to a contract address.

Loans opened outside Ballast cannot be moved into an account. A signed one-off repayment flow for them is **Planned**.

### 2. Payback — automatic repayment from income (**Live**)

The controller decides how each incoming MUSD payment is split between loan repayment, an MUSD reserve and spendable income, in basis points. A payment through the Ballast Router is split and repaid in **one transaction**. If any part fails, for example a repayment that would push the loan under Mezo's minimum debt, the whole payment reverts.

**Proven on testnet:** a separate wallet paid a 100 MUSD invoice. 75 MUSD went to the merchant, 5 MUSD to the reserve and 20 MUSD repaid the loan, which fell by exactly 20 MUSD in the same transaction.

Three editable starting presets:

| Preset | Repay | Reserve | Spendable |
|---|---|---|---|
| Keep my BTC | 40% | 10% | 50% |
| Get out of debt | 75% | 0% | 25% |
| Keep cash available | 10% | 5% | 85% |

Payback starts paused. While paused, the repayment share is paid out as spendable income. The reserve is plain, uninvested MUSD that the controller can withdraw at any time.

### 3. Redemption Radar — your place in the redemption line (**Live**)

Radar reads Mezo's sorted list of loans at a single block on the server. It checks the list is consistent, and shows ranks only if every check passes.

It answers:

- Where is my loan in the redemption order, counting all loans and only eligible ones?
- Which loans sit directly around mine?
- How much MUSD must I repay to pass the next 1, 10 or 50 loans? Interest is included, and it says when a target is out of reach without closing the loan.
- What would my collateral ratio be after that repayment?
- How much can I repay before hitting Mezo's minimum debt?
- What is my estimated liquidation price?
- What happens if BTC falls 10%, 20% or 30%? It shows my collateral ratio, whether I'd be liquidatable, my redemption rank, and the system-wide ratio and recovery-mode status read from Mezo at each price.
- How did my position change after a real repayment? It shows before and after at both block numbers, with the transaction link.

**Proven on testnet:** Radar quoted 12.756783 MUSD to pass the next loan. The account repaid that, and its position moved from #165 to #166 from the tail.

Live example (block 16764464): *"Repay 24.00 MUSD to pass the next 10 loans; your collateral ratio would go from 151.68% to 153.39%."* Passing 50 loans needed 164.02 MUSD, more than the 159.25 MUSD allowed before the minimum-debt floor, so Radar marks it unreachable without closing the loan.

The interface separates live chain data from projections. Rankings change constantly, and a better position never guarantees protection from redemption.

### 4. Pay From Anywhere — cross-chain payments (**Planned**)

The goal is that a customer pays USDC on Base and the merchant receives genuine MUSD on Mezo, routed through the same Payback policy. Mezo uses Wormhole Native Token Transfers for MUSD, but a Base Sepolia → Mezo testnet route has not been investigated or verified. Ballast will not present a simulated bridge or a self-funded relay as a real Wormhole transfer.

### 5. Hedge — optional BTC downside protection (**Planned**; simulation page only)

One proposed design uses Morpho: post MUSD as collateral, borrow tokenized BTC, sell it, and buy it back later. That needs a funded BTC-borrowing market, a reliable price oracle and a swap path on Mezo testnet, none of which have been verified. The app's Hedge page is labelled **SIMULATION — NO REAL HEDGE OPENED**. A short like this can lose money and be liquidated even while BTC rises.

### 6. Ballast Router — infrastructure for other apps (**Live** contract; SDK **Planned**)

The router is a public contract on Mezo testnet. Any invoice tool, checkout or billing app can submit payments through it, and the router enforces the merchant's own on-chain policy.

The first integration is a working MUSD invoice link. The merchant signs the invoice in their wallet (EIP-712, no gas). The payer pays it from another wallet, and each invoice can be paid only once.

## Technical architecture

**Smart contracts** (Solidity 0.8.24, Foundry, OpenZeppelin; no admin or upgrade keys; source-verified on the Mezo explorer)
- `BallastFactory` deploys accounts and mints the controller NFT.
- `BallastAccount` owns the Mezo loan, holds the policy and performs repayments.
- `BallastAccountNFT` represents control and blocks transfers while the loan is open.
- `BallastRouter` takes invoice payments, splits them and calls the account's repayment.

**Mezo integrations:** BorrowerOperations (open, adjust, repay, close), TroveManager (debt, collateral, ratios, system ratio, recovery mode), SortedTroves (redemption order), HintHelpers (hints for reinserting the loan in the list), PriceFeed, and the MUSD token.

**App:** Next.js, TypeScript, Tailwind CSS, wagmi and viem, hosted on Vercel. Radar uses a server-side read route with no database. All money maths uses integers (bigint), never floating point.

**Tests:** 15 Foundry unit and fuzz tests, 4 tests against a copy of the live Mezo testnet chain, and 12 TypeScript tests for the Radar maths.

## Why Ballast is different

Ballast is not the first tool to automate Mezo repayments or monitor loan health. What it combines:

- **Income-driven repayment:** real MUSD payments reduce a real Bitcoin-backed loan in the same transaction.
- **Redemption-aware decisions:** borrowers see exactly how much to repay to pass other loans, and what actually changed afterwards.
- **Contract-controlled automation:** the account owns the loan, so a stored policy works without a signature per payment.
- **Distribution:** other MUSD apps can route payments through the router.

## Viability

Ballast targets Mezo borrowers with recurring MUSD income: merchants, freelancers and small businesses. It would grow through apps that already process MUSD payments. Possible revenue: disclosed routing fees, and premium integrations for payment apps.

Demand is unvalidated. It is not yet known how many Mezo borrowers earn enough recurring MUSD income, or whether they prefer automated repayment over manual control.

## Security and limitations

- Testnet only and **not audited**.
- No guarantee against redemption or liquidation.
- Repayments depend on the policy, available funds and Mezo's rules, such as minimum debt.
- An NFT-controlled loan carries ownership risk; transfers are blocked while a loan is open.
- Cross-chain payments and hedging are not built. If built, they would add bridge, settlement, market and liquidation risk.

## Roadmap

1. **Mezo Buildathon (done):** NFT-controlled loan accounts, automatic MUSD repayment, Redemption Radar with price-drop scenarios, a real invoice integration, and verifiable testnet transactions.
2. **Ecosystem integration:** router SDK, signed one-off repayment for existing Mezo loans, more payment sources, and Base → Mezo payments once a route is verified.
3. **Risk protection:** a funded downside-protection design (Morpho or fully collateralized options) after market and security validation.
4. **Production:** security audit, demand validation, controlled mainnet pilot, and merchant integrations.

## Final submission summary

- **Project:** Ballast
- **Category:** Bitcoin-Backed Loan Risk Management
- **Primary track:** DeFi · **Secondary track:** Access & Distribution
- **TL;DR:** Ballast is a cash-flow and risk-management layer for Mezo. It turns incoming MUSD payments into automatic loan repayment in one transaction, and shows exactly how each repayment changes a borrower's place in the redemption line and their safety if BTC falls. It's live on Mezo testnet; cross-chain payments and BTC hedging are planned.
