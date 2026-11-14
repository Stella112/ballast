# Verification log

Status legend: **VERIFIED** (on-chain read / verified source / tx) · **ASSUMED** · **UNVERIFIED** · **BLOCKED**

All reads on 2026-11-13 (UTC) against `https://rpc.test.mezo.org` unless noted.

## Network
| Fact | Value | Status | Evidence |
|---|---|---|---|
| Chain ID | 31611 | VERIFIED | `eth_chainId` → `0x7b7b` |
| Block height at audit | 16,761,642 | VERIFIED | `eth_blockNumber` → `0xffc32a` |
| Gas price | ~146 wei (base fee 130) | VERIFIED | `cast gas-price`, `cast base-fee` |
| Explorer | https://explorer.test.mezo.org | VERIFIED | Blockscout API `api.explorer.test.mezo.org/api/v2/smart-contracts/<addr>` returned verified sources |
| Native gas asset | BTC, 18 decimals | VERIFIED (collateral sent as `msg.value`, returned via `call{value}` in `SendCollateral.sol`) | source |

## Mezo MUSD protocol contracts (testnet)
Upstream: `github.com/mezo-org/musd` @ `da7888a10949c8a5d3f884454cec8978cfa87e48` (2026-10-26).
Explorer-verified implementations: solc `v0.8.24+commit.e11b9ed9`, EVM `london`, optimizer 100 runs.

| Contract | Proxy | Implementation (EIP-1967 slot) | Verified source vs upstream HEAD | Status |
|---|---|---|---|---|
| MUSD (token, not proxied) | `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` | — | `contracts/token/MUSD.sol` | VERIFIED: name "Mezo USD", symbol "MUSD", decimals 18 |
| BorrowerOperations | `0xCdF7028ceAB81fA0C6971208e83fa7872994beE5` | `0xc05bf344bd5b58825784326dd3112fb6cc160dcc` | identical | VERIFIED |
| TroveManager | `0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0` | `0x9aab567966983e95536fc460c12266fb0cc10b07` | identical | VERIFIED |
| SortedTroves | `0x722E4D24FD6Ff8b0AC679450F3D91294607268fA` | `0x9177df58a9614b84c8c2f68df27506ab9a5d0323` | only `pragma ^0.8.24` vs `0.8.24` | VERIFIED |
| HintHelpers | `0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6` | `0x8adf3f35dbe4026112bcfc078872bcb967732ea8` | identical | VERIFIED |
| PriceFeed | `0x86bCF0841622a5dAC14A313a15f96A95421b9366` | `0xec42b37c12b8d73d320f4075a1bcd58b306629c1` | only pragma | VERIFIED |
| Oracle (precompile) | `0x7b7c000000000000000000000000000000000015` | chain-native | — | VERIFIED: `PriceFeed.oracle()` returns it; `decimals()`=18; `latestRoundData` price ≈ 68,8xx e18 |

Cross-wiring (all VERIFIED by `cast call`): `BO.troveManager/musd/sortedTroves/priceFeed` → addresses above; `TM.sortedTroves`, `TM.musdToken`; `ST.troveManager`, `ST.borrowerOperationsAddress`; `MUSD.mintList(BO)=true`, `MUSD.burnList(BO)=true`. `BO.borrowerOperationsSignaturesAddress = 0xD757e3646AF370b15f32EB557F0F8380Df7D639e`.

## Live protocol parameters @ block ~16,761,688
| Parameter | Value |
|---|---|
| `minNetDebt` | 1800e18 |
| `MUSD_GAS_COMPENSATION` | 200e18 |
| `borrowingRate` | 1e15 (0.1%) |
| `redemptionRate` | 7.5e15 (0.75%) |
| `MCR` / `CCR` | 1.1e18 / 1.5e18 |
| `interestRateManager.interestRate()` | 100 (bps → 1% APR) |
| TCR | ~2.474e18 · recovery mode **false** |
| Sorted troves size | 324 (`getMaxSize` = uint256 max) |

## Source-level semantics (VERIFIED by reading verified implementation)
- `openTrove/repayMUSD/withdrawMUSD/closeTrove/addColl/withdrawColl` all use **`msg.sender` as the borrower**. No `tx.origin`, `extcodesize` or `isContract` checks in BorrowerOperations or TroveManager (grep). ⇒ a contract can own a trove.
- Open: `netDebt = debtAmount + borrowingFee` must be ≥ `minNetDebt`; `compositeDebt = netDebt + 200 MUSD gas comp`. Borrower receives `debtAmount`.
- Repay: burns from the caller (no ERC-20 approval needed). Requires `(totalDebt − 200) − repay ≥ minNetDebt` and `repay ≤ totalDebt − 200`. Interest is paid first (`InterestRateMath.calculateDebtAdjustment`).
- `getTroveDebt` = principal + stored interest + interest accrued to `block.timestamp` (excludes pending redistribution).
- SortedTroves is keyed by **NICR computed on principal only** (`_computeNominalCR(newColl, newPrincipal)`), not total debt.
- Close: needs `debt − 200` MUSD in caller balance; collateral returned with `call{value}` (account needs `receive()`).
- `fetchPrice` requires oracle `updatedAt` within 60 s.

## Test-tooling finding
Foundry's EVM does not implement the oracle precompile (`EvmError: NotActivated` at `0x7b7c…15`). Fork tests fetch the **live** `latestRoundData` via `vm.rpc` and mock only that precompile (updatedAt = fork timestamp). All Mezo contracts execute real deployed bytecode on real fork state. Live transactions do not use this mock.

## Dependency table
| Requirement | Source | Verification | Result | Evidence | Fallback |
|---|---|---|---|---|---|
| Account-owned Mezo trove | BorrowerOperations | source + fork test | fork PASS; **live pending funding** | docs/TEST_EVIDENCE.md | — (P0) |
| Canonical MUSD | token + explorer | bytecode/metadata | VERIFIED | above | — |
| Redemption list | SortedTroves | contains/prev/next reads | partial | — | neighbor-only view |
| Base Sepolia → Mezo testnet MUSD | — | not started (P1) | UNVERIFIED | — | DEFERRED |
| Morpho BTC borrowing on Mezo testnet | — | not started (P1) | UNVERIFIED | — | Simulation, labeled |

## Signed repayment for wallet-held loans (2026-11-14)
| Fact | Value | Status | Evidence |
|---|---|---|---|
| BorrowerOperationsSignatures proxy | `0xD757e3646AF370b15f32EB557F0F8380Df7D639e` | VERIFIED | `BorrowerOperations.borrowerOperationsSignaturesAddress()`; explorer: TransparentUpgradeableProxy, verified |
| Implementation | `0xEec635aB00463A4a803DE38C9d858A0FE3bdc235` | VERIFIED | Blockscout `implementations`; source `BorrowerOperationsSignatures`, solc 0.8.24 |
| `repayMUSDWithSignature(uint256,address,address,address,bytes,uint256)` | selector `0x2cf63a40` | VERIFIED | verified ABI; selector present in deployed bytecode |
| EIP-712 domain | `("BorrowerOperationsSignatures","1",31611,0xD757…639e)` | VERIFIED | live `eip712Domain()` |
| Type | `RepayMUSD(uint256 amount,address borrower,uint256 nonce,uint256 deadline)`; per-borrower sequential nonce | VERIFIED | verified source; live use (nonce 0 → 1 → 2) |
| Whose MUSD is burned | the **caller's** (`_requireSufficientMUSDBalance(_caller, …)`) | VERIFIED | `BorrowerOperations.sol` (musd@da7888a) `_adjustTrove`; live tx burned the adapter's MUSD |

## P1 feasibility (2026-11-14)
| Requirement | Result | Evidence | Fallback |
|---|---|---|---|
| Base Sepolia USDC → Mezo testnet MUSD (Wormhole NTT) | **BLOCKED: no verified route** | Mezo contracts reference (https://mezo.org/docs/users/resources/contracts-reference) lists the MUSD NTT Manager/Transceiver for Mezo, Ethereum and Base **mainnet only**; for testnet it lists only the Mezo testnet MUSD token. No Base Sepolia or Mezo-testnet NTT contracts, no Wormhole chain id for Mezo testnet, no USDC→MUSD swap on Base documented. | Shown as planned in the app; no simulated bridge |
| Morpho market with BTC as the loan asset on Mezo testnet | **BLOCKED: not found** | docs.morpho.org addresses page: no Mezo entry in the portion read. Mezo docs: Morpho only on mainnet (Morpho Vault V2 `0x06291b67e3d7660240ab44Afc9a708d82b976a8B` supplying a Morpho Blue **BTC collateral / mUSDC loan** market, LLTV 86%), the opposite direction. | `/app/hedge` labelled simulator |


## Correction and update (2026-11-14, later)
- The earlier "Base → Mezo BLOCKED" finding only covered Mezo's **MUSD NTT** docs. Wormhole's own contract list (wormhole.com/docs/reference/contract-addresses) shows the **Wormhole Token Bridge ("Wrapped Token Transfers") on Mezo testnet**: core `0x268557122Ffd64c85750d630b716471118F323c8`, token bridge `0xA31aa3FDb7aF7Db93d18DDA4e19F811342EDF780`. VERIFIED on-chain: code present, `chainId()` = 50, `wormhole()` = the core, explorer-verified `BridgeImplementation` (solc 0.8.4); **`bridgeContracts(10004)` = `0x…86f55a04690fd7815a3d802bd587e83ea888b239`, the Base Sepolia token bridge** (chain 10004, verified, same implementation). Base Sepolia does not register Mezo (50), so only Base → Mezo works — which is the direction Ballast needs.
- Mezo Pools testnet (mezo.org/docs/developers/features/mezo-pools): Router `0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9` (verified, Aerodrome-style `Route{from,to,stable,factory}`), PoolFactory `0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A` (not paused), MUSD/BTC pool `0xd16A5Df82120ED8D626a1a15232bFcE2366d6AA9` (reserves ≈ 102.25M MUSD / 1,307 BTC at 2026-11-14). No pool for Wormhole-bridged USDC existed.
- Mezo BTC ERC-20 `0x7b7C000000000000000000000000000000000000` ("BTCCaller", verified): symbol BTC, 18 decimals, `balanceOf` = native balance; implemented over a chain-native precompile (Foundry fork: NotActivated). Live `approve`/`transferFrom` into Morpho worked (supply tx above).
- Morpho: no Mezo-testnet deployment (unchanged). Ballast deployed upstream Morpho Blue v1.0.0 (`55d2d99`) + AdaptiveCurveIrm v1.0.0 (`a7d9cce`) with owner approval; see DEPLOYMENTS.md.
