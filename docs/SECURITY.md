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
| Deployer | nothing after deployment (no owner/admin/upgrade) | — |
| Backend/server | none (no keys; invoices are signed by the controller's wallet) | — |

## Attacker entry points & mitigations
- **Payer-supplied calldata**: destinations are read from account state; amounts come from the signed invoice; hints only affect gas (SortedTroves validates/falls back).
- **Invoice forgery/replay**: EIP-712 (domain = chainId + router) signed by the *current* controller (EOA or ERC-1271); `invoicePaid[tokenId][invoiceId]` is set before transfers; expiry is enforced. Signatures from a previous NFT holder are invalid.
- **Reentrancy**: `nonReentrant` on all mutating account/router functions; CEI in router.
- **Repayment exceeding Mezo floor**: precise `maxRepayable()` check → `RepayExceedsHeadroom`; whole payment reverts (atomic).
- **Reserve drained by Mezo burn**: post-condition `balance ≥ hedgeReserve` on `applyPayment` and `closeTrove`.
- **NFT transfer**: locked while the trove is active; transfers only to code-less addresses; no burn path.
- **Oracle**: Ballast does not consume the price in a state-changing way; Mezo's own PriceFeed (60 s staleness) governs.
- **Token behavior**: MUSD is a standard non-fee-on-transfer ERC-20 (verified source); SafeERC20 is used. Other tokens are not supported by the router.

## Residual risks
Redemptions can hit healthy troves (lowest NICR first); queue position is not a guarantee. Liquidation is possible below 110% ICR. Interest accrues at 1% APR (live). Controller-key compromise = full account control. A trove closed by redemption/liquidation stops repayments (payments with a repay leg revert until the policy is changed). Testnet only.
