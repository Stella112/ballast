# Security — threat model (UNAUDITED TESTNET DEMO)

Ballast is unaudited and deployed only on Mezo testnet. It gives no guarantee of redemption or liquidation protection.

## Assets
Native BTC collateral locked in Mezo (owned by a BallastAccount), MUSD held by an account (free + `hedgeReserve`), the account NFT (= control), invoice payments in flight.

## Privileges
| Actor | Can | Cannot |
|---|---|---|
| NFT holder (controller, `nft.ownerOf(tokenId)` read live) | open/adjust/close trove, borrow, repay, withdraw free MUSD / reserve / BTC, set policy & payout, rescue non-MUSD tokens | — |
| BallastRouter (immutable code, no admin) | call `account.applyPayment` → credit reserve + repay **this account's own trove** with MUSD it just delivered | move collateral, withdraw MUSD/BTC, change policy, choose destinations |
| Payer | pay a controller-signed invoice exactly once, supply sorted-list hints | choose amount/recipients/split, replay, pay expired invoice |
| Factory | deploy accounts, mint NFTs | anything on an existing account |
| BallastRepaymentAdapter (immutable, no admin, holds no funds between txs) | pull a payer's MUSD and call Mezo `repayMUSDWithSignature` for a borrower who signed that exact amount, nonce and deadline; pay the rest of a signed invoice to the merchant | repay without a valid Mezo signature, change the amount, reuse a signature (Mezo nonce), touch collateral or the borrower's own MUSD |
| Deployer | nothing after deployment (no owner/admin/upgrade) | — |
| Backend/server | none (no keys; invoices are signed by the controller's wallet) | — |

## Attacker entry points & mitigations
- **Payer-supplied calldata**: destinations are read from account state; amounts come from the signed invoice; hints only affect gas (SortedTroves validates/falls back).
- **Invoice forgery/replay**: EIP-712 (domain = chainId + router) signed by the *current* controller (EOA or ERC-1271); `invoicePaid[tokenId][invoiceId]` is set before transfers; expiry is enforced. Signatures from a previous NFT holder are invalid.
- **Reentrancy**: `nonReentrant` on all mutating account/router functions; CEI in router.
- **Repayment exceeding Mezo floor**: precise `maxRepayable()` check → `RepayExceedsHeadroom`; whole payment reverts (atomic).
- **Reserve drained by Mezo burn**: post-condition `balance ≥ hedgeReserve` on `applyPayment` and `closeTrove`.
- **NFT transfer**: locked while the trove is active; transfers only to code-less addresses; no burn path.
- **Wallet-loan invoices (adapter)**: the invoice's EIP-712 signature (domain = chainId + adapter) binds merchant, amount, repayAmount and expiry; Mezo's own EIP-712 `RepayMUSD` binds amount, borrower, nonce and deadline. `invoicePaid` is set before transfers; post-checks: debt decreased and exactly `repayAmount` MUSD left the adapter. Griefing: anyone holding the link could submit the Mezo signature directly and repay the borrower's loan with their own MUSD. That uses up the nonce and makes the invoice unpayable, but moves no one else's funds; the merchant re-issues the link. Signing any other Mezo signed operation also invalidates outstanding links. EOA signers only (Mezo uses ECDSA).
- **Oracle**: Ballast does not consume the price in a state-changing way; Mezo's own PriceFeed (60 s staleness) governs.
- **Token behavior**: MUSD is a standard non-fee-on-transfer ERC-20 (verified source); SafeERC20 is used. Other tokens are not supported by the router.

## Residual risks
Redemptions can hit healthy troves (lowest NICR first); queue position is not a guarantee. Liquidation is possible below 110% ICR. Interest accrues at 1% APR (live). Controller-key compromise = full account control. A trove closed by redemption/liquidation stops repayments (payments with a repay leg revert until the policy is changed). Testnet only.

## v2 changes to the threat model (2026-11-14)
- **Keeper (`processIncome`, callable by anyone):** applies the owner's stored policy to MUSD that arrived directly. The caller supplies only sorted-list hints. Income = balance − `ownerMUSD` − `hedgeReserve`, so the owner's borrowed or deposited MUSD can never be swept into a repayment by a third party. Sending dust and triggering it costs the attacker gas and moves nothing of the owner's.
- **Router `pay`:** open to any payer; the split and every destination come from the account (`quoteSplit`, `payoutAddress`). A payer can only give money.
- **Repayment cap:** the repay share is limited to what Mezo accepts above its minimum debt; the excess goes to the owner, so a large payment can no longer be blocked by the floor.
- **Cash buffer:** reads the payout address's MUSD balance. The payout address's owner can raise that balance to make repayments resume sooner, which only affects their own split.
- **Transferable NFT (owner's product decision):** control of the loan, collateral, MUSD, reserve and hedge module moves with the token at any time. Mitigations: recipients must be code-less addresses; the account clears its custom payout on transfer (`controllerChanged`, NFT-only) so income cannot keep flowing to the previous holder; invoices signed by the previous holder stop verifying. Residual risk: a holder who is tricked into transferring the NFT loses the whole account, and a buyer inherits the debt.
- **Hedge module:** only the NFT holder can open, close, withdraw or send to the account. Morpho Blue's owner is the Ballast deployer wallet (it can enable IRMs/LLTVs and set a market fee, as in upstream Morpho; it cannot touch positions). The market's liquidity is Ballast's own. Oracle = Mezo PriceFeed; pool price and oracle price differ on testnet (≈78k vs ≈64k MUSD/BTC), so a short sells above the price used for its collateral check.
- **Bridge receiver:** anyone may submit a VAA; only the receiver can redeem transfers addressed to it; failed swaps or payments refund to the payer-chosen Mezo address. The swap pool is small and Ballast-seeded, so large payments would fail the slippage bound and refund.

## v3 additions (2026-11-15)
- **NFT held by contracts.** The account NFT can now be held by any contract that implements `IERC721Receiver`. Whoever controls that contract controls the account, its loan and funds; an escrow or marketplace bug becomes an account risk. Plain `transferFrom` to a contract is rejected to avoid accidental stranding.
- **Hedge driven by the account.** `openHedge` / `closeHedge` are controller-only and move MUSD between the hedge reserve and the hedge module chosen by the controller (`setHedgeModule` checks only that the module reports this account's tokenId). A malicious module could take the collateral it is given; the controller chooses it and already controls those funds. `closeHedge` asserts the account still holds at least `ownerMUSD + hedgeReserve`.
- **BallastBaseGateway.** No owner, holds nothing between transactions, forwards only to the canonical MUSD NTT manager. The recipient account address is supplied by the payer; a wrong address sends the MUSD to that address on Mezo. The NTT manager implementations are not source-verified on the explorers.
