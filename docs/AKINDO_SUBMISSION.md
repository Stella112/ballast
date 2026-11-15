# AKINDO submission — Mezo Buildathon Wave 2

Deadline: 15 Nov 2026, 16:00 Lagos time (owner's figure; confirm the cutoff shown on the AKINDO page before submitting).

| Field | Answer |
|---|---|
| Project name | Ballast |
| Category | Bitcoin-backed loan automation |
| Tracks | Track 1: DeFi (primary), Track 2: Access & Distribution |
| Chains | Mezo testnet (31611), Base Sepolia (84532) |
| Status | New project built during the hackathon |
| Readiness | Testnet deployment |
| GitHub | https://github.com/Stella112/ballast |
| Live app | https://ballast-tawny.vercel.app |
| Demo video (2:40) | TODO: paste the link once uploaded (YouTube / Loom / Drive). Local file: `docs/video/ballast-demo.mp4` (not in the repo; 48 MB) |
| Deck | TODO — NEEDS VERIFIED RESULT (owner provides) |
| Team | Maris, solo builder (GitHub: Stella112) |

**One-line:** The cash-flow autopilot for Bitcoin-backed loans: every MUSD payment you receive can make your Mezo loan safer.

## TL;DR
Ballast routes MUSD income into automatic repayment of a Mezo loan, so borrowers move back in the redemption line without lifting a finger. A Ballast Account is an NFT-controlled smart account that owns a real Mezo MUSD loan. Incoming payments, on Mezo or from Base Sepolia, are split by the owner's policy: part repays the loan, part is set aside for an optional BTC hedge, the rest goes to the owner. A live redemption-line simulator shows what each repayment changed.

## Problem
A Mezo borrower can lose their position two ways and guards against both by hand. **Redemption:** any MUSD holder can swap MUSD for BTC at $1 minus a 0.75% fee, taken from the lowest-ratio loans first, even healthy ones. **Liquidation:** below a 110% collateral ratio the loan is closed. Meanwhile the money a borrower earns never touches the loan unless they move it themselves.

## Who it's for
BTC-holding merchants, freelancers and small companies who borrow MUSD on Mezo and receive regular payments; and MUSD payment apps (invoicing, checkout, subscriptions) that want to offer "put part of your earnings toward your loan".

## How it works
1. **Open a Ballast Account**: a contract that opens and owns a real Mezo loan, minted as an NFT. Whoever holds the NFT controls the account; it can be transferred to another wallet, or sold whole through a contract that accepts NFTs (a marketplace escrow).
2. **Choose a goal**: Keep my BTC (20% repay / 5% hedge / 75% owner), Get out of debt (60 / 40), Keep cash available (10 / 90 with a minimum cash buffer). All adjustable.
3. **Get paid**: MUSD on Mezo through the pay link or any app calling the router, or from Base Sepolia over Wormhole (USDC through the token bridge, proven live; MUSD through Ballast's Base gateway and MUSD's own NTT bridge, deployed, live run pending).
4. **The router splits each payment** and emits the collateral ratio before and after.
5. **Repayment is automatic**: the account owns the loan, so no signature per payment. A keeper can trigger the policy for MUSD that arrived directly and cannot redirect funds. Loans that can't move in use Mezo's signed one-off repayment.
6. **Optional hedge**: the account opens a small BTC short from its hedge reserve and closes it back into itself; a gain repays the loan.

Repayments stop at Mezo's minimum debt (about 2,000 MUSD); the excess goes to the owner.

## Mezo integration
| Mezo piece | How Ballast uses it |
|---|---|
| MUSD loan contracts (BorrowerOperations, TroveManager) | Open, own, repay and close a real loan from the account; signed one-off repayment for wallet-held loans |
| Sorted loan list (SortedTroves, HintHelpers) | Read live for the redemption-line simulator; position hints for repayments |
| PriceFeed | Collateral ratio before/after in payment events; the hedge market's oracle |
| Mezo Pools | Swap between MUSD and BTC for the hedge; swap bridged USDC to MUSD |
| Wormhole on Mezo testnet | Payments arriving from Base Sepolia: token bridge (USDC) and MUSD's Native Token Transfers bridge (through BallastBaseGateway) |
| Morpho Blue | The hedge's MUSD-collateral, BTC-loan market (deployed on testnet by Ballast, see Limitations) |

## Measured proof (Mezo testnet, v3 deployment, 15 Nov 2026)
- Account-owned loan: openTrove `0x1c12b684ebebac2154275e09462345386ee597cce37f7c4ad13b58fb62dee76e`.
- `pay(1, 100 MUSD, "v3-demo")`: 75 owner / 5 hedge reserve / 20 repaid; ratio 134.15% → 135.33%: `0xbec250c4a877f3b637b8935e1713115d8d5989626614c9e97f3cdf12938bbd5e`.
- Keeper: 50 MUSD sent straight to the account, policy applied by a non-owner wallet (37.5 / 2.5 / 10): `0x93bbadeb9ad67c95f32ca5507ee6b7d9b28cec00d4c327dd857868aaf4b1a9cd`.
- Account sold whole through an escrow contract with the loan open: listed `0x2d8e01521db67bb4542be4383d3f1a053f219c17a890c19f99995ccd630f857a`, released to the buyer `0x43626e6369e6e8304ee33348492fe1b0c45f08333d404e8937a36bd5c208b8d9`.
- Hedge opened and closed by the account from its hedge reserve (80 MUSD posted, 0.0005 BTC borrowed and sold; cost 0.78 MUSD in fees): open `0x09d17ce366ce7ef78439386f04b6238476f19d99a51a4a74651cf3c66c3cc447`, close `0xd6a52ed49876862609d15578cf56b51b5372a38a2f45065aa8337675363ded54`.
- Pay from Base Sepolia (USDC, Wormhole token bridge) on v3: Base `0x9cffb34e7c4173b809ece2f2258d9e15dad6283eaeb522f0d0a7d78746cd0c54` → Mezo settle `0x666b7277e706eef1044e650b138a68247d50e003bfb112758990578180b45c75` (owner +1.5 MUSD, one Mezo transaction).
- Repayment capped at Mezo's minimum debt, excess to the owner (v2 deployment, 14 Nov): `0xb52b86935a203d3fe55ed858d69bbefedb655703b43a1539e2108789dac098a0`.
- Existing wallet-held loan, signed one-off repayment (14 Nov): `0x359ee97e8a6964e5354f55576bb667595de5e9f41f453b894d24df94b0462494`.
- Redemption-line simulator: quote → repay → position moved one place (first deployment, 13 Nov): `0xea07e53b0a2664cffc796b8e1063c0174979068ef0f200ccd5d810c3bd798c75`.
- BallastBaseGateway on Base Sepolia (source verified): `0x8Da29e84f88F35f87549b5d8a8EF54e4aD1c298C`.
- Tests: 21 Foundry unit/fuzz tests, 32 Foundry tests against live Mezo and Base Sepolia state, 12 TypeScript maths tests.

## Technical architecture
Solidity 0.8.24: BallastFactory, BallastAccountNFT, BallastAccount, BallastRouter, BallastRepaymentAdapter, BallastHedge + factory, BallastMezoOracle, BallastBridgeReceiver, and BallastBaseGateway on Base Sepolia. No admin or upgrade keys. Next.js 15 + wagmi/viem frontend on Vercel; server-side read route for the simulator. Details: docs/ARCHITECTURE.md, addresses: docs/DEPLOYMENTS.md.

## Tech stack
Solidity 0.8.24, Foundry, OpenZeppelin 5.0.2, Morpho Blue v1.0.0, Next.js 15.5, React 19, wagmi 2.19, viem 2.38, Tailwind 4, Vitest.

## Security
Threat model: docs/SECURITY.md. NFT-holder-only control; the router and keeper can only apply the owner's stored policy to incoming MUSD; signed invoices bound to chain and router with replay and expiry checks; reentrancy guards; split conservation fuzzed. Unaudited.

## Limitations (stated openly)
- Testnet only, unaudited. Mezo's minimum loan is about 2,000 MUSD.
- **Pay from Base:** the USDC route over Wormhole's token bridge is proven live, but the USDC/MUSD pool on Mezo testnet was **created and seeded by Ballast** and is small (a few MUSD per payment). The MUSD route over Wormhole NTT is built, deployed and tested against live Base Sepolia, but **has not run end to end**: the testnet guardian has not signed the transfer that puts MUSD on Base for the demo payer.
- **Morpho Blue on Mezo testnet was deployed by Ballast** (unmodified v1.0.0) and its BTC liquidity was supplied by Ballast.
- The hedge reduces risk but cannot remove it; it can lose money and be liquidated. The BTC-drop scenario is a labelled SIMULATED calculation.
- The hedge position sits in a small per-account module contract that only the account and its NFT holder can use.
- Redemption position is a snapshot, not a guarantee. Demand is unproven.
- The app's wallet flows have been exercised by scripts and contract tests; a browser-wallet run is the owner's final check.

## Next three milestones
| Milestone | Target |
|---|---|
| Audit-lite review and capped mainnet launch | Q1 2027 |
| Invoices as NFTs that feed the account, plus an SDK for MUSD payment apps | Q1 2027 |
| Vault for BTC lenders on the hedge side, with a Mezo Earn gauge | Q2 2027 |

## Demo video (2:40)
Local file `docs/video/ballast-demo.mp4` (not committed), built from `video/` (Remotion; voiceover: Microsoft Edge TTS, en-US-AndrewMultilingualNeural). Every explorer page in it is a screenshot of the real Mezo testnet explorer; app screens are the live site reading the demo account.
1. **0:00** The problem in one sentence: redemption, liquidation, idle income.
2. **0:11** The pitch: an NFT-controlled account owns the loan; each payment splits three ways and moves the loan back in the redemption line.
3. **0:33** Live proof: 100 MUSD through the router → 75 / 5 / 20, ratio 134.15% → 135.33%, on the explorer.
4. **0:57** Redemption Radar on the live site.
5. **1:13** Keeper, and the cap at Mezo's minimum debt.
6. **1:28** The account sold whole through an escrow contract.
7. **1:43** The hedge opened and closed by the account; the BTC drop labelled SIMULATED.
8. **2:04** Pay from Base: USDC proven live, MUSD over NTT built and waiting on the guardians.
9. **2:23** Limits, then the close.

## Disclaimer
Testnet, unaudited. Ballast does not guarantee protection from redemption or liquidation. No verified product demand yet.
