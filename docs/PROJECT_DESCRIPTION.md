# Ballast — Full Project Description

14 Nov 2026 · @maris

> The description below is the owner's text. The section **Implementation status and evidence** at the end maps each part to what runs on testnet, with transaction links, and lists the places where the testnet build differs from the text.
>
> **Live app:** https://ballast-tawny.vercel.app · **Code:** https://github.com/Stella112/ballast

## Summary

Ballast is the cash-flow autopilot for Bitcoin-backed loans: every MUSD payment a borrower receives can make their Mezo loan safer.

A Ballast Account is an NFT-controlled smart account that owns a real Mezo MUSD loan. Incoming payments, on Mezo or from Base, are split by the owner's policy: part repays the loan, part can fund an optional BTC hedge, and the rest goes to the owner. A live redemption-line simulator shows how each repayment moves the loan further from redemption and liquidation.

| Field | Answer |
|---|---|
| Project name | Ballast |
| Category | Bitcoin-backed loan automation |
| TL;DR | Ballast routes MUSD income into automatic repayment of a Mezo loan, so borrowers move back in the redemption line without lifting a finger. |
| Tracks | Track 1: DeFi (primary), Track 2: Access & Distribution |
| Chains | Mezo testnet, Base Sepolia |
| Status | New project built during the hackathon |
| Readiness | Testnet deployment |
| Submission deadline | 15 Nov 2026, 16:00 Lagos time |

## The problem

A Mezo borrower can lose their position in two ways, and today they guard against both by hand.

- **Redemption.** Any MUSD holder can swap MUSD with the protocol for BTC at $1, minus a fee of 0.75% (Mezo docs). That BTC is taken from the loans with the lowest collateral ratio first, even healthy ones. Another buildathon team counted 1,310 redemption hits against 28 liquidations on mainnet (Frontline; their figure, not verified by us).
- **Liquidation.** If the collateral ratio falls below 110%, the loan is closed and the collateral is lost.

Meanwhile, the money a borrower earns never touches the loan unless they move it themselves.

## Who it's for

Businesses and freelancers who hold BTC, borrow MUSD against it on Mezo, and receive regular payments.

- **Primary users:** BTC-holding merchants, freelancers and small companies paid in MUSD or USDC.
- **Integrators:** MUSD payment apps (invoicing, checkout, subscriptions) that want to offer "put part of your earnings toward your loan".
- **Experience level:** comfortable with a crypto wallet; no DeFi expertise needed once the account is set up.
- **Devices and region:** desktop and mobile web, global (subject to the buildathon's excluded jurisdictions).

## How it works

One account holds the loan; a policy decides where every incoming payment goes.

1. **Open a Ballast Account.** A contract that opens and owns a real Mezo MUSD loan, minted as an NFT. Whoever holds the NFT controls the account, so it can be transferred or sold whole.
2. **Choose a goal.** Each preset sets a default split the owner can adjust:
   - Keep my BTC: 20% repay, 5% hedge, 75% to owner.
   - Get out of debt: 60% repay, 40% to owner.
   - Keep cash available: 10% repay, 90% to owner, with a minimum cash buffer.
3. **Get paid anywhere.** Payers send MUSD on Mezo, or MUSD from Base through the Wormhole bridge that MUSD already uses.
4. **The router splits each payment.** Repay share, hedge share and owner share, emitted on-chain with the before and after collateral ratio.
5. **Repayment runs automatically.** Because the account owns the loan, no signature is needed per payment. A keeper can trigger the policy but can never redirect funds. Existing loans that can't move in use Mezo's signed one-off repayment instead.
6. **Optional hedge.** The account can open a small BTC short that pays toward the loan if BTC falls (see Hedge module).

Repayments stop at Mezo's minimum debt (about 2,000 MUSD); anything above that cap goes to the owner.

Payments from Mezo go straight to the router; payments from Base cross the Wormhole bridge first. The router then sends each share to the loan, the hedge reserve or the owner.

## Signature feature: the redemption-line simulator

It turns "am I safe?" into numbers read live from Mezo's own sorted list of loans.

| Metric | What the borrower learns |
|---|---|
| Position in the redemption line | Where the loan sits, counting from the next one to be redeemed |
| MUSD ahead of you | Total debt in loans that would be redeemed first; a smaller redemption cannot reach you |
| MUSD to pass the next 10 or 50 loans | How much repayment moves the loan back |
| Liquidation price | The BTC price at which the ratio hits 110% |
| Largest valid repayment now | The maximum allowed before hitting the minimum debt |
| Before and after | What each real repayment changed, with the transaction link |

The position is a snapshot, not a guarantee: the order changes as BTC moves and other borrowers act.

## Pay from Base and the router

Payers on Base can pay a Mezo borrower directly, and any MUSD app can plug in with one call.

**Pay from Base**

- A payer on Base sends MUSD through Ballast's Base gateway.
- The gateway uses Wormhole Native Token Transfers, the bridge MUSD already uses between Mezo, Ethereum and Base, with the Ballast Account itself as the recipient on Mezo.
- When the MUSD lands, the keeper applies the account's policy.
- The demo runs on Base Sepolia to Mezo testnet. Paying with USDC (swapped to MUSD on Base) is the mainnet design and is out of scope for the testnet build unless a MUSD/USDC test pool exists.

**Router for other apps**

- `BallastRouter.pay(accountId, amount, reference)` pulls MUSD, applies the policy and emits a payment event.
- Invoicing, checkout or subscription apps can offer borrowers "put part of your earnings toward your loan" without building any lending logic.
- The demo includes one integration: a shareable pay link for each account.

## Hedge module (optional)

A small BTC short inside the account that pays toward the loan when BTC falls, which is exactly when the loan needs help.

1. The account posts MUSD as collateral in a Morpho Blue market on Mezo, the lending system behind Mezo's own USDC Lending Vault (Mezo docs).
2. It borrows a small amount of BTC and sells it for MUSD on Mezo Pools.
3. If BTC falls, buying the BTC back costs less; on close, the difference goes toward the loan.
4. If BTC rises, the hedge loses a little, while the BTC backing the loan gains more.

For a borrower this is protection, not a bet. Borrowing stays small so the hedge itself sits far from liquidation. A BTC price drop cannot be caused on testnet, so the drop scenario in the demo is clearly labelled SIMULATED; opening and closing the hedge are real transactions.

## Mezo integration and what's new

Ballast touches five pieces of Mezo, and ties incoming income to measurable redemption safety, which no entry we found does.

| Mezo piece | How Ballast uses it |
|---|---|
| MUSD loan contracts | Open, own, repay and close a real loan from the account |
| Sorted loan list and redemption order | Read live for the simulator |
| Mezo Pools | Swap between MUSD and BTC for the hedge |
| Wormhole bridging for MUSD | Payments arriving from Base |
| Morpho Blue on Mezo | The hedge's MUSD-collateral, BTC-loan market |

**Judging criteria fit**

- Mezo Integration (30%): real loans, the redemption queue, pools, bridge and Morpho; no wrapper around MUSD.
- Product & Business Viability (30%): solves the redemption pain Mezo itself documents, and gives MUSD payment apps a reason to integrate.
- Technical Implementation (20%): NFT-controlled accounts, permissionless keeper that cannot redirect funds, tested contracts.
- User Experience (10%): goal presets instead of DeFi settings; one screen shows safety in plain numbers.
- Submission Materials (10%): every demo step backed by a transaction link.

**What's different from other entries**

- Cermin, Bulwark and Lifeline react when BTC falls; Ballast acts on income, before trouble.
- Frontline and Keel build new markets to dodge redemptions; Ballast works with Mezo's existing loans.
- Ledger and Mezout handle invoices and checkout; Ballast is the layer those apps can route repayments through.

## Demo, limits, blockers and roadmap

The demo shows one real payment travelling from Base to a real Mezo loan, with every step linked on-chain.

**Two-minute demo**

1. 0:00 The problem: the redemption line.
2. 0:20 Mint a Ballast Account and open a loan.
3. 0:40 A payment arrives, splits, repays; the simulator shows the loan moving back.
4. 1:10 The same from Base Sepolia.
5. 1:30 Open and close the hedge, then a labelled SIMULATED BTC drop.
6. 1:50 The router integration and roadmap.

**Limits stated openly**

- Testnet only, unaudited.
- Mezo's minimum loan is about 2,000 MUSD.
- The hedge reduces risk but cannot remove it.
- Redemption position is a snapshot, not a guarantee.
- Demand is unproven: we don't yet know how many borrowers receive regular MUSD income.

**Blockers tested first, in order**

- [x] A contract can open and own a Mezo loan on testnet.
- [ ] The Base to Mezo bridge works for testnet MUSD. **Result: no.** Mezo lists its MUSD bridge (Wormhole NTT) contracts for mainnet only. What does work on testnet is Wormhole's token bridge from Base Sepolia, so the testnet build bridges USDC and swaps it to MUSD on Mezo (see below).
- [ ] Morpho on Mezo testnet accepts BTC as the borrowed asset. **Result: Morpho is not deployed on Mezo testnet.** Ballast deployed the unmodified Morpho Blue v1.0.0 itself; the market borrows Mezo's own BTC token directly, so no wrapped-BTC token was needed.
- [x] Our own BTC/MUSD price feed works in Morpho's format.

**Next three milestones**

| Milestone | Target |
|---|---|
| Audit-lite review and capped mainnet launch | Q1 2027 |
| Invoices as NFTs that feed the account, plus an SDK for MUSD payment apps | Q1 2027 |
| Vault for BTC lenders on the hedge side, with a Mezo Earn gauge | Q2 2027 |

**Team:** Maris, solo builder (GitHub: Stella112).

---

## Implementation status and evidence (v2, Mezo testnet chain 31611, 14 Nov 2026)

Every row marked **Live** has confirmed testnet transactions (status 1). Addresses: [DEPLOYMENTS.md](DEPLOYMENTS.md). Full detail: [TEST_EVIDENCE.md](TEST_EVIDENCE.md).

| Part of the description | Status | Evidence |
|---|---|---|
| NFT-controlled account that opens and owns a real Mezo loan | **Live** | Account [`0x1Ed5…10e0`](https://explorer.test.mezo.org/address/0x1Ed5B7462545b4639d70fE18A300Bdbdb55910e0), [openTrove](https://explorer.test.mezo.org/tx/0xe7d5fb3e00af9963e53554a2b242615a3d63d6e0453aef8adf40cb4fc1baff7f) |
| NFT transfer moves the whole account, loan included | **Live** | [deployer → second wallet with the loan open](https://explorer.test.mezo.org/tx/0x6a0b54177b23632062f185062c70dd2dadd9635c2ab0074efcee38e8eb946bd4), old holder's withdrawal rejected, [and back](https://explorer.test.mezo.org/tx/0x4f91ca3b2c7c1f318af481d0e1c4079c6e4f419c68dccb75a0a724e802b8cb3d) |
| Presets 20/5/75, 60/40, 10/90 with a minimum cash buffer; adjustable | **Live** | Policy on-chain ([setPolicy](https://explorer.test.mezo.org/tx/0x77ebb12b6caa33cd2fad02fff83f48508ee1073914e97043a4082d393144cabf)); buffer covered by tests |
| `BallastRouter.pay(accountId, amount, reference)` splits and emits the ratio before and after | **Live** | [100 MUSD → 75 owner / 5 hedge reserve / 20 repaid; ratio 140.55% → 141.84%](https://explorer.test.mezo.org/tx/0xab0c50dcb704019ecb39117a9b0950d2198fe53ef9a580658fae47d790ca8606) |
| No signature per payment; keeper triggers the policy and cannot redirect funds | **Live** | 50 MUSD sent straight to the account, [policy applied by a non-owner wallet](https://explorer.test.mezo.org/tx/0x8e804aaeb85cb98bbaef90e90994e020d5d66e794f2de6a82d89dd8c72d7c484): 37.5 / 2.5 / 10, ratio 141.27% → 141.92% |
| Repayments stop at Mezo's minimum debt; the excess goes to the owner | **Live** | [300 MUSD at 60% repay: 168.80 repaid (all the room left), 131.20 to the owner; principal now exactly 2,000 MUSD; ratio 140.97% → 152.86%](https://explorer.test.mezo.org/tx/0xb52b86935a203d3fe55ed858d69bbefedb655703b43a1539e2108789dac098a0) |
| Existing loans use Mezo's signed one-off repayment | **Live** | [50 MUSD → 40 to borrower, 10 repaid](https://explorer.test.mezo.org/tx/0x359ee97e8a6964e5354f55576bb667595de5e9f41f453b894d24df94b0462494) |
| Redemption-line simulator (all six metrics, plus BTC −10/−20/−30%) | **Live** | Radar page; numbers equal Mezo's own reads; [quote → repay → position moved](https://explorer.test.mezo.org/tx/0xea07e53b0a2664cffc796b8e1063c0174979068ef0f200ccd5d810c3bd798c75) (v1 account) |
| Shareable pay link for each account | **Live** | `/pay/a/<accountId>` in the app |
| Hedge: MUSD collateral on Morpho Blue, borrow BTC, sell on Mezo Pools, close, proceeds to the account | **Live** | [open](https://explorer.test.mezo.org/tx/0x806d0be570381b8d17030c7d1a577ae1200415b9c0b40de5c403e959b6b3720e), [close](https://explorer.test.mezo.org/tx/0xcf2c939a407618ed7d12f69f80f6e09d273951cf5ed34482654dae975c42c2f9), [to account](https://explorer.test.mezo.org/tx/0xdacf1c2a355e978821c9b418f21be314c3e203cb576f3f1b3ce5780c88c6cfa7) |
| SIMULATED BTC drop, clearly labelled | **Live** | Hedge page, "SIMULATED — not a real price move" |
| Pay from Base Sepolia to a Mezo loan | **Live, with a different bridge asset** | See differences below |

### Where the testnet build differs from the text

1. **Pay from Base uses USDC over Wormhole's token bridge, not MUSD over NTT.** Mezo publishes its MUSD NTT bridge contracts for mainnet only, so MUSD cannot be bridged from Base Sepolia. Wormhole's token bridge does connect Base Sepolia to Mezo testnet. The payer sends USDC on Base Sepolia to Ballast's receiver on Mezo; one Mezo transaction redeems it, swaps it to MUSD and pays through the router (split and repayment). The description allows the USDC route when a MUSD/USDC test pool exists: **that pool was created and seeded by Ballast** (about 8 USDC and 8 MUSD), because none existed.
2. **Morpho Blue on Mezo testnet was deployed by Ballast**, from Morpho's unmodified v1.0.0 source, and **its BTC lending liquidity (0.0012 BTC) was supplied by Ballast**. Morpho's own deployment exists on Mezo mainnet only.
3. **The hedge lives in a per-account hedge module**, a separate contract controlled by the same NFT, not inside the account contract itself. Proceeds are sent to the account as the owner's MUSD.
4. **NFT transfers go to wallet addresses only**, not contracts, so a marketplace escrow sale is not supported yet. A direct wallet-to-wallet transfer moves the whole account.
5. **`pay()` without position hints costs about 4 million gas** on today's list of about 325 loans; the app and integrators should use `payWithHints`, which does the same thing with hints computed off-chain.
6. **The hedge share is held as a MUSD reserve** in the account until the owner opens a hedge; it is not invested automatically.
7. **"MUSD ahead of you" is the total debt of the redemption-eligible loans ahead, including each loan's 200 MUSD gas deposit**, which redemptions do not take. So a redemption slightly smaller than that figure (by up to 200 MUSD per loan ahead) could still reach you; Mezo also skips loans below 110% and the order changes as interest accrues and other borrowers act. The app labels it "Context, not a guarantee".
8. **Pay from Base is limited by the size of that seeded pool** (about 8 MUSD / 8 USDC on 14 Nov after rebalancing). Larger invoices must be paid in MUSD on Mezo; the pay page says so instead of attempting the transfer.
