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

For a borrower this is protection, not a bet. Borrowing stays small so the hedge itself sits far from liquidation. Opening and closing the hedge are real transactions. A BTC price drop cannot be caused on testnet, so the app and demo show no drop scenario: everything shown is live chain data or a real transaction.

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
5. 1:30 Open and close the hedge, with the real transactions.
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

## Implementation status and evidence (v3, Mezo testnet chain 31611, 15 Nov 2026)

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
| Redemption-line simulator (all six metrics, read live from Mezo) | **Live** | Radar page; numbers equal Mezo's own reads; [quote → repay → position moved](https://explorer.test.mezo.org/tx/0xea07e53b0a2664cffc796b8e1063c0174979068ef0f200ccd5d810c3bd798c75) (v1 account) |
| Shareable pay link for each account | **Live** | `/pay/a/<accountId>` in the app |
| Hedge: MUSD collateral on Morpho Blue, borrow BTC, sell on Mezo Pools, close, proceeds to the account | **Live** | [open](https://explorer.test.mezo.org/tx/0x806d0be570381b8d17030c7d1a577ae1200415b9c0b40de5c403e959b6b3720e), [close](https://explorer.test.mezo.org/tx/0xcf2c939a407618ed7d12f69f80f6e09d273951cf5ed34482654dae975c42c2f9), [to account](https://explorer.test.mezo.org/tx/0xdacf1c2a355e978821c9b418f21be314c3e203cb576f3f1b3ce5780c88c6cfa7) |
| Pay from Base Sepolia to a Mezo loan | **MUSD over NTT: deployed, live run pending. USDC route: live** | See differences below |

Rows above that link v2 transactions (14 Nov) describe behaviour that is unchanged in v3; the v3 re-runs are in [TEST_EVIDENCE.md](TEST_EVIDENCE.md).

### Where the testnet build differs from the text

1. **Pay from Base (MUSD over Wormhole NTT, as described): built and deployed; live end-to-end run pending.** An earlier check concluded from Mezo's docs that the MUSD NTT bridge was mainnet-only. That was wrong: on-chain reads on 14 Nov found MUSD's canonical NTT managers on Mezo testnet and Base Sepolia, registered as each other's peers (addresses in [VERIFICATION.md](VERIFICATION.md)). `BallastBaseGateway` on Base Sepolia ([`0x8Da2…298C`](https://base-sepolia.blockscout.com/address/0x8Da29e84f88F35f87549b5d8a8EF54e4aD1c298C), source verified) takes the payer's MUSD and sends it through that bridge with the Ballast Account as the recipient on Mezo; a keeper then applies the policy. It passes 4 tests against live Base Sepolia state. **Not yet proven live:** the demo payer needs MUSD on Base first, and the transfer that brings it there ([Mezo tx](https://explorer.test.mezo.org/tx/0x7455fef58ba587c270c635432b263b6792e64a2ea15fe9c2c315c1513a0a6c25), 30 MUSD, bridge message #90) has not been signed by the Wormhole testnet guardian; the previous message from the same bridge (#89, another user, 19:13 UTC) is also unsigned. The earlier USDC route (Wormhole token bridge + a pool seeded by Ballast) remains live on invoice links and is proven with two payments.
2. **Morpho Blue on Mezo testnet was deployed by Ballast**, from Morpho's unmodified v1.0.0 source, and **its BTC lending liquidity (0.0012 BTC) was supplied by Ballast**. Morpho's own deployment exists on Mezo mainnet only.
3. **The hedge is opened and closed by the account (v3).** `account.openHedge` takes the collateral from the account's hedge reserve; `account.closeHedge` brings everything back into the account, repays the loan with any gain and returns the rest to the reserve. The Morpho position itself sits in the account's hedge module, a small contract only the account and its NFT holder can use. Live: [open](https://explorer.test.mezo.org/tx/0x09d17ce366ce7ef78439386f04b6238476f19d99a51a4a74651cf3c66c3cc447), [close](https://explorer.test.mezo.org/tx/0xd6a52ed49876862609d15578cf56b51b5372a38a2f45065aa8337675363ded54).
4. **The NFT can be sold whole (v3).** It can go to a wallet, or to any contract that accepts NFTs (a marketplace escrow, a multisig) through `safeTransferFrom`. Live: [listed in an escrow contract](https://explorer.test.mezo.org/tx/0x2d8e01521db67bb4542be4383d3f1a053f219c17a890c19f99995ccd630f857a) with the loan open, then [released to the buyer](https://explorer.test.mezo.org/tx/0x43626e6369e6e8304ee33348492fe1b0c45f08333d404e8937a36bd5c208b8d9). A plain `transferFrom` to a contract is still rejected so the account cannot be stranded in a contract that never expected it.
5. **`pay()` without position hints costs about 4 million gas** on today's list of about 325 loans; the app and integrators should use `payWithHints`, which does the same thing with hints computed off-chain.
6. **The hedge share is held as a MUSD reserve** in the account until the owner opens a hedge; it is not invested automatically.
7. **"MUSD ahead of you" now counts only what a redemption can take** (each loan's debt minus its 200 MUSD gas deposit, as in Mezo's `_redeemCollateralFromTrove`), so a redemption up to that size is absorbed by the loans ahead at that block. It is still a snapshot: interest accrues, loans below 110% are skipped, and other borrowers move.
8. **The USDC route from Base is limited by the size of that seeded pool** (about 8 MUSD / 8 USDC on 14 Nov after rebalancing). Measured on 14 Nov: about 1:1 up to 2 MUSD, and within 10% extra up to roughly 4.5 MUSD. The app refuses to quote anything that would cost more than 10% extra and tells the payer to pay in MUSD on Mezo instead.
