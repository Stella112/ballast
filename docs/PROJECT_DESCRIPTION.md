# BALLAST — The Cash-Flow Autopilot for Bitcoin-Backed Loans

> This is the owner's project description, verbatim. The section **Implementation status and evidence** at the end maps each part to what is deployed on Mezo testnet, with transaction proof.
>
> **Live app:** https://ballast-tawny.vercel.app · **Code:** https://github.com/Stella112/ballast

**Tagline:** Protect your Bitcoin. Strengthen your loan.

**One-liner:** Ballast turns incoming MUSD payments into automatic debt repayment, helping Bitcoin-backed borrowers improve their loan health, manage redemption exposure, and protect their BTC without selling it.

- **Blockchain:** Mezo Testnet, with planned Base integration
- **Primary Track:** DeFi — Borrowing, Lending & Risk Management
- **Secondary Track:** Access & Distribution for MUSD
- **Core Assets:** BTC, MUSD, and USDC for cross-chain payments

## The Problem

Mezo allows Bitcoin holders to borrow MUSD against their BTC without selling it. This unlocks liquidity while allowing borrowers to maintain their Bitcoin exposure.

But borrowing against Bitcoin creates two important risks.

**1. Redemption risk**

MUSD holders can redeem their stablecoins for BTC through Mezo's redemption mechanism. The protocol prioritizes eligible borrowing positions with the lowest collateral ratios.

This means a borrower can lose part of their BTC collateral through redemption even if their loan is not eligible for liquidation.

Borrowers who want to preserve their Bitcoin exposure must actively manage their collateral ratios and redemption positions.

**2. Liquidation risk**

When Bitcoin's price falls, the dollar value of the BTC securing a loan decreases while the MUSD debt remains outstanding.

If the collateral ratio falls below the protocol's liquidation threshold, the borrower risks liquidation.

Today, borrowers must monitor these risks, calculate repayments, and move funds manually.

Meanwhile, businesses and freelancers may receive MUSD income without having an automated way to use part of those earnings to strengthen their outstanding loans.

The missing infrastructure is a connection between incoming cash flow and the health of a Bitcoin-backed loan.

## The Solution

Ballast is a programmable loan-management and payment infrastructure layer built directly on Mezo.

It connects three things that are normally separate:

- Money borrowers receive.
- The health of their Bitcoin-backed borrowing positions.
- Automated financial actions that reduce debt and manage risk.

Instead of requiring borrowers to constantly monitor their loans, Ballast enables them to define rules that automatically allocate part of their incoming MUSD payments toward debt repayment.

It also introduces a redemption-line simulator that shows how much MUSD a borrower needs to repay to improve their position relative to other borrowers.

Ballast is designed around five interconnected components.

### 1. Ballast Account — An NFT-Controlled Bitcoin Loan

Users create a Ballast Account, a smart contract capable of owning and managing a real borrowing position on Mezo.

The account holds the borrowing position, while an NFT identifies the wallet authorized to control it.

The account owner can:

- Deposit BTC collateral.
- Open a Mezo loan and borrow MUSD.
- Withdraw available borrowed funds.
- Configure automatic repayment policies.
- Receive MUSD through payment integrations.
- Monitor debt, collateral, and redemption exposure.
- Manage permitted loan operations.
- Close the position when applicable requirements are satisfied.

Because the smart contract owns the underlying loan, it can execute authorized repayment rules without requiring the user to sign every individual repayment.

The account enforces permissions on-chain. The payment router cannot arbitrarily withdraw BTC collateral or redirect borrowed funds.

The initial implementation can restrict NFT transfers while debt remains outstanding to avoid transferring control of an active borrowing obligation without adequate safeguards.

Existing Mezo borrowers whose loans cannot be moved into a Ballast Account can use a separate signed repayment flow.

### 2. Payback — Automatic Debt Repayment From Income

Payback is Ballast's core feature.

Borrowers choose how incoming MUSD payments should be allocated between repayment, savings reserved for future protection, and spendable income.

For example, a borrower receives a 500 MUSD invoice payment. Their policy might allocate:

- 20% — 100 MUSD: Repay their Mezo loan.
- 5% — 25 MUSD: Reserve funds for optional BTC downside protection.
- 75% — 375 MUSD: Transfer to their spendable wallet.

When a payment is made through the Ballast Router, the smart contracts enforce the allocation and attempt the authorized repayment.

After the transaction, Ballast reads the borrower's actual position from Mezo and displays the new debt, collateral ratio, and redemption-order position.

Repayments must respect minimum outstanding debt, protocol restrictions, and the borrower's configured limits.

Users can choose between three simple goals:

- **Keep My BTC:** Prioritize reducing exposure to redemptions while preserving a chosen amount of spendable income.
- **Get Out of Debt:** Direct a larger share of eligible earnings toward reducing the outstanding MUSD principal.
- **Keep Cash Available:** Maintain a higher spendable balance while making smaller repayments when valid.

These goals provide starting policies that users can customize.

### 3. Redemption Radar — See Your Place in the Redemption Line

Redemption Radar is Ballast's signature intelligence feature.

Mezo's redemption mechanism uses collateral-ratio ordering to determine which eligible loans are reached first.

Ballast reads the real on-chain borrowing positions and visualizes where the user currently sits in that ordering.

Rather than providing generic risk warnings, Redemption Radar answers actionable questions:

- Where is my loan in the current redemption ordering?
- Which positions are immediately ahead of mine?
- How much MUSD would I need to repay to move above the next 10 or 50 positions?
- What would my collateral ratio become after that repayment?
- How much can I repay without violating the protocol's minimum-debt rules?
- What happens to my position if BTC falls by 10%, 20%, or 30%?
- How did my position actually change after my latest repayment?

The simulator calculates projected results using current protocol data.

When a real repayment executes, it refreshes the on-chain state and shows verified before-and-after results, including transaction evidence.

A borrower might see: *"Repaying 45 MUSD would move your position above five other loans in the current redemption ordering."*

This turns an otherwise technical DeFi metric into a specific financial action.

The interface distinguishes between live on-chain facts and projections. Redemption rankings change over time, and improving a position never guarantees protection from future redemptions.

### 4. Pay From Anywhere — Cross-Chain MUSD Distribution

Ballast aims to make debt repayment possible wherever users earn money, rather than restricting payments to the Mezo application itself.

The initial supported flow uses native testnet MUSD payments on Mezo.

Ballast also targets a cross-chain payment experience in which a customer can pay USDC on Base and the recipient receives MUSD on Mezo.

The intended flow is:

1. A merchant creates a Ballast payment request.
2. A customer pays USDC on Base.
3. The payment is converted into the appropriate bridgeable asset.
4. Value moves to Mezo through a verified cross-chain transfer mechanism.
5. The recipient receives genuine MUSD on Mezo.
6. The Ballast Router applies the recipient's repayment policy.
7. The borrower receives spendable income while part of the payment reduces their actual loan debt.

Mezo uses Wormhole Native Token Transfers infrastructure for supported MUSD transfers between chains.

However, the exact Base Sepolia-to-Mezo-testnet route, USDC conversion, token availability, and settlement process must be verified before implementation is considered complete.

Ballast will not present a simulated bridge or an independently funded relayer as a successful native Wormhole transfer.

The objective is to make MUSD more useful by allowing borrowers to earn from customers beyond Mezo while managing their loan obligations on Mezo.

### 5. Hedge — Optional BTC Downside Protection

Payback strengthens loans when borrowers receive income.

Hedge is designed to provide additional protection when BTC falls.

The proposed hedge allows a Ballast Account to allocate MUSD toward a BTC downside position through a compatible lending or derivatives mechanism.

One possible implementation uses Morpho:

1. The account supplies eligible MUSD collateral.
2. It borrows a limited quantity of tokenized BTC.
3. It sells the borrowed BTC for MUSD.
4. If BTC falls, the account can potentially repurchase the required BTC at a lower price.
5. After repaying the BTC loan and associated costs, any remaining profit can be directed toward reducing the borrower's Mezo debt.

If BTC rises, the hedge can lose money, incur additional costs, or be liquidated independently of the main Mezo loan.

This means Hedge reduces selected price exposure rather than guaranteeing safety.

The Morpho integration is conditional on verifying a compatible funded BTC-borrowing market, supported collateral, pricing and execution infrastructure on the relevant network.

If those requirements are not met during the hackathon, Ballast will present Hedge as a clearly labeled simulation and future integration, not an operational live short.

An alternative future implementation could use fully collateralized downside-protection contracts with explicitly defined premiums, payouts and expiry conditions.

### 6. Ballast Router — Infrastructure for Other Applications

Ballast is not intended to operate only as a standalone dashboard.

Its payment router can become reusable infrastructure for other MUSD applications.

Developers can integrate Ballast into:

- Invoice and payment-link platforms.
- Merchant checkout systems.
- Subscription billing applications.
- Freelancer payment tools.
- Treasury-management systems.
- MUSD-native marketplaces.

An external application can offer its users the ability to automatically direct a portion of eligible payments toward their Bitcoin-backed debt.

For example, an invoice platform could add: *"Put 20% of every invoice payment toward my Mezo loan."*

The external application submits the payment through the Ballast Router, which enforces the borrower's configured policy.

Ballast's initial developer integration will be a working MUSD invoice-payment link. Another wallet can pay an invoice, and the payment will trigger a real split and authorized repayment.

This creates a path for Ballast to become shared MUSD infrastructure rather than another isolated DeFi application.

## Technical Architecture

**Smart contracts**

- `BallastFactory`: Deploys account contracts and coordinates account creation.
- `BallastAccount`: Owns the Mezo loan and applies borrower-authorized financial actions.
- `BallastAccountNFT`: Represents account control and enforces transfer restrictions.
- `BallastRouter`: Receives MUSD payments, executes splits and initiates repayments.
- `BallastRepaymentAdapter`: Integrates account repayments and signed repayments with Mezo's lending contracts.
- Optional Hedge integration module, deployed only after the required market infrastructure is verified.

**Mezo integrations**

- BorrowerOperations for opening and repaying loans.
- TroveManager for debt and collateral data.
- SortedTroves for redemption ordering.
- HintHelpers for valid trove reordering.
- MUSD ERC-20 for payments and repayments.
- Mezo pricing infrastructure for loan-health calculations.
- Wormhole infrastructure for verified cross-chain transfers.
- Morpho where supported markets and liquidity are available.

**Application stack**

- Next.js and TypeScript.
- Tailwind CSS and shadcn/ui.
- Solidity and Foundry.
- wagmi and viem.
- Mezo testnet RPC and blockchain explorer.
- Vercel hosting.
- An optional backend/indexer for efficient reading of borrowing-position data and transaction history.

All financial actions must be authorized, all transaction claims verifiable, and all failures handled without misrepresenting the state of user funds.

## Why Ballast Is Different

Ballast does not claim to be the first protocol to automate Mezo repayments or protect borrowers from liquidation.

Existing applications already provide repayment automation, loan-health monitoring and liquidation-related tools.

Ballast's differentiation is the combination of:

- **Income-driven repayment:** Cash flow from real MUSD payments can directly reduce an existing Bitcoin-backed debt position.
- **Redemption-aware decision-making:** Borrowers can see the measurable effect of repayments on their relative exposure to Mezo's redemption process.
- **Contract-controlled automation:** New Ballast accounts can own their Mezo loans, making constrained recurring repayment policies possible without requiring a signature for every payment.
- **Cross-application distribution:** Other MUSD products can use the router to offer debt repayment as part of their payment experience.
- **Optional downside hedging:** Future or verified live hedge integrations can connect BTC price-risk management to the same loan.

The product's core value is not another borrowing dashboard. It is the connection between earning MUSD, reducing debt, and understanding the resulting improvement in borrowing-position health.

## Product Viability

Ballast initially targets Mezo borrowers who receive recurring MUSD income, especially merchants, freelancers and small businesses.

Its growth strategy is based on integration with applications that already process MUSD payments.

A potential business model includes disclosed routing fees, premium integrations for payment applications, and optional protection-service fees.

The early implementation focuses on proving technical viability and borrower usefulness.

Demand remains unvalidated. Ballast will need to determine how many Mezo borrowers receive sufficient recurring MUSD income and whether they prefer automated repayment over manually controlling their debt.

## Security and Limitations

Ballast's initial deployment is on Mezo testnet and is not audited.

The product cannot guarantee that borrowers will avoid redemption or liquidation.

Automatic repayments are subject to borrower policies, available funds, contract authorization, gas availability, and Mezo's protocol restrictions.

An NFT-controlled loan account carries security and ownership risks, particularly if transfers are enabled while debt exists.

Cross-chain transactions introduce bridge and settlement risks.

BTC hedge positions may lose money or be liquidated.

All simulated outcomes must be distinguished from live on-chain transactions, and no integration is considered operational without successful testnet execution.

## Roadmap

**Phase 1 — Mezo Buildathon:** Deliver NFT-controlled loan accounts, automatic MUSD repayment, Redemption Radar, a real invoice integration, and verifiable testnet transactions. Investigate and implement Base payments and the Morpho hedge only where their required infrastructure can be proven.

**Phase 2 — Ecosystem Integration:** Develop a payment-router SDK, expand supported MUSD payment sources, improve repayment automation and evaluate account transfer mechanisms.

**Phase 3 — Risk Protection:** Introduce funded downside protection, expanded account policies, and more sophisticated borrower-risk management after appropriate technical and security reviews.

**Phase 4 — Production:** Conduct security audits, validate borrower demand, introduce controlled mainnet pilots, and pursue integrations with MUSD merchants and financial applications.

## Long-Term Vision

Mezo makes it possible to access the value of Bitcoin without selling it.

Ballast aims to make those Bitcoin-backed loans easier to manage after borrowing.

A borrower should be able to receive payments, allocate income, reduce outstanding debt, and understand their redemption exposure without constantly switching between financial applications or performing calculations manually.

Over time, Ballast can become a programmable financial layer that connects Bitcoin-backed credit with MUSD commerce.

Mezo unlocks your Bitcoin's liquidity. Ballast helps you manage the loan that makes that liquidity possible.

## Final Submission Summary

- **Project:** Ballast
- **Category:** Bitcoin-Backed Loan Risk Management
- **Primary Track:** DeFi
- **Secondary Track:** Access & Distribution
- **TL;DR:** Ballast is a programmable cash-flow and risk-management layer for Mezo that turns incoming MUSD payments into automatic debt repayment, shows how each repayment affects redemption exposure, and aims to extend access through cross-chain payments and optional BTC downside hedging.

---

## Implementation status and evidence (Mezo testnet, chain 31611)

Status as of 2026-11-14. Every **Live** item has a confirmed testnet transaction (status 1). Full detail: [TEST_EVIDENCE.md](TEST_EVIDENCE.md), [DEPLOYMENTS.md](DEPLOYMENTS.md).

| Part of the description | Status | Evidence |
|---|---|---|
| Ballast Account owns a real Mezo loan; NFT controls it; NFT locked while debt is open | **Live** | [openTrove](https://explorer.test.mezo.org/tx/0x73e6312cd962106ef5b07f6a2db4e1e8572580c0d9df9b4b404ebd8c26514940); 15 unit/fuzz + 4 fork tests |
| Payback: invoice paid by another wallet, split and repaid in one transaction | **Live** | [100 MUSD → 75 / 5 / 20, debt −20.000000](https://explorer.test.mezo.org/tx/0x3b9dce365e1ca8b2e043cc663fbc21c24b5f5364a7c90b2cd68be9571a3e5bc7) |
| Presets Keep My BTC / Get Out of Debt / Keep Cash Available, editable | **Live** | 40/10/50, 75/0/25 and 10/5/85 (repay/reserve/spendable), any custom split; Payback starts paused |
| Repayment respects Mezo minimum debt and configured limits | **Live** | Over-limit repayment reverts the whole payment (fork test `repayBeyondFloorRevertsWholePayment`) |
| Redemption Radar: position, neighbours, cost to pass 1/10/50, ratio after repayment, max repayable, BTC −10/−20/−30%, verified before/after | **Live** | [Quote → repay → #165 → #166](https://explorer.test.mezo.org/tx/0xea07e53b0a2664cffc796b8e1063c0174979068ef0f200ccd5d810c3bd798c75); scenario numbers equal Mezo's `getCurrentICR` / `getTCR` exactly at block 16764464 |
| Existing Mezo borrowers: separate signed repayment flow | **Live** | `BallastRepaymentAdapter` + Mezo's one-off `repayMUSDWithSignature`: [50 MUSD → 40 to borrower, 10 repaid, debt −10.000000](https://explorer.test.mezo.org/tx/0x359ee97e8a6964e5354f55576bb667595de5e9f41f453b894d24df94b0462494); [app-signed link: 8 / 2](https://explorer.test.mezo.org/tx/0xcce41c98e012f25f786857cc7706b12ef1dcb69580f4b9b1f00f20615d56ea0b); 8 fork tests |
| `BallastRepaymentAdapter` | **Live** | [0x096f…f7DC](https://explorer.test.mezo.org/address/0x096f8C705fce216bdBAEc7f86022117682A9f7DC), source-verified. Ballast accounts repay their own loans directly inside `BallastAccount`; the adapter adds signed repayment for wallet-held loans and a repayable-amount read (`maxRepayable`) that works for both kinds |
| Router as infrastructure; working invoice-payment link | **Live** | Public `BallastRouter` and adapter; invoice links paid by a second wallet. SDK is Phase 2 |
| Pay From Anywhere (Base USDC → Mezo MUSD) | **Not available — route not verified** | Mezo's contracts reference lists Wormhole NTT bridge contracts for **mainnet only**; no Mezo testnet or Base Sepolia deployment is listed (checked 2026-11-14). As the description requires, no simulated bridge is presented. Shown as planned in the app |
| Hedge (Morpho short) | **Simulation, clearly labelled** | No Morpho deployment on Mezo testnet; the Mezo mainnet Morpho market is BTC collateral / mUSDC loan (the opposite direction). `/app/hedge` is an interactive simulator using stated assumptions only |
| Stack | Live | Next.js, TypeScript, Tailwind CSS, Solidity/Foundry, wagmi/viem, Vercel, server-side Radar read route. UI components are hand-built on Tailwind; shadcn/ui is not used |
