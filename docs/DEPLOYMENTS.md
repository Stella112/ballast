# Deployments — Mezo testnet (chain 31611)

Source commit for the deployed bytecode: `d4facb3`. Compiler solc 0.8.24, EVM london, optimizer 200 runs.
Machine-readable copy: `config/deployments.mezo-testnet.json`. Explorer: https://explorer.test.mezo.org

| Contract | Address | Deploy tx | Block |
|---|---|---|---|
| BallastRouter | [`0x2a3Ce214189F62A2f15b58ecFD7c4CfCDa97dF1d`](https://explorer.test.mezo.org/address/0x2a3Ce214189F62A2f15b58ecFD7c4CfCDa97dF1d) | [`0x90c2b1a1…0a57`](https://explorer.test.mezo.org/tx/0x90c2b1a1b20854b1fa9c9cfc7b61ac1d27b31459ab0bd750a5dfe7d196a30a57) | 16762083 |
| BallastAccountNFT | [`0xAa0034E681d208579cFF63A8E2CD298Fc51F3Afa`](https://explorer.test.mezo.org/address/0xAa0034E681d208579cFF63A8E2CD298Fc51F3Afa) | [`0xd8ddb4ee…e35b`](https://explorer.test.mezo.org/tx/0xd8ddb4eed3fe1059e468a77db3ec2c7d414fdc5c4b09a6866d11c3f3a65ee35b) | 16762085 |
| BallastFactory | [`0x74f918a5C1c8BDDc40CD0Ba8F9935790Fbc5dCCd`](https://explorer.test.mezo.org/address/0x74f918a5C1c8BDDc40CD0Ba8F9935790Fbc5dCCd) | [`0x4d4853e5…ac1f`](https://explorer.test.mezo.org/tx/0x4d4853e529b977d486836c29505f6c3aee2b65fe781ffb2565ed78e84226ac1f) | 16762087 |
| BallastRepaymentAdapter | [`0x096f8C705fce216bdBAEc7f86022117682A9f7DC`](https://explorer.test.mezo.org/address/0x096f8C705fce216bdBAEc7f86022117682A9f7DC) | [`0x8fefd7dd…afd5`](https://explorer.test.mezo.org/tx/0x8fefd7dd8602116059eabbac2c575f16fdcbc21856b8cd0b8cb203a2b578afd5) | 16764880 |
| BallastAccount #1 (demo) | [`0xDE61A300ca381463FD6FeCc6b2602980a2Db6323`](https://explorer.test.mezo.org/address/0xDE61A300ca381463FD6FeCc6b2602980a2Db6323) | createAccount [`0xc8c82af3…7815`](https://explorer.test.mezo.org/tx/0xc8c82af3b6baf50c7d516e124e2d7ae91dee2c680274caf1bf2f492cac3c7815) | 16762107 |

Demo wallets (disposable, testnet-only): merchant/controller `0x4ff0D7c712B109dE476f21Ed443Ef0928d52a5fA`, payer `0xCBCd26d717CEe0305b92FDC1E50A398608A4d857`.
Frontend: https://ballast-tawny.vercel.app (Vercel production, deployment `dpl_5pi9ErA2NVGuorZqvyiUpxF3Q4Ur`, source commit `26bca95`, 2026-11-14). Public; all routes returned HTTP 200 and `/api/radar` matched direct RPC reads of SortedTroves/TroveManager.
No admin, owner, or upgrade keys exist on any Ballast contract.
Explorer source verification of Ballast contracts: **VERIFIED** on Blockscout (Router, NFT, Factory, Account on 2026-11-13; RepaymentAdapter on 2026-11-14). The adapter is wired to Mezo `BorrowerOperationsSignatures` `0xD757e3646AF370b15f32EB557F0F8380Df7D639e` (read from `BorrowerOperations.borrowerOperationsSignaturesAddress()`), TroveManager and MUSD; source commit `0b5ee7b`. Existing-loan demo borrower: the payer wallet `0xCBCd…d857` opened its own trove ([tx](https://explorer.test.mezo.org/tx/0x765193b68c9e46886144494a0028269afee879d2039776f7586a5c4a48d8536d)) and borrowed 100 MUSD more to leave room above the minimum debt ([tx](https://explorer.test.mezo.org/tx/0xe0f556bae91f1836e62adf38b2b0afc58d5c19274a4ade367131f1026cf66a0a)); view the "Contract" tab of each address on https://explorer.test.mezo.org.


## Hedge stack (Mezo testnet, 2026-11-14) — deployed and funded by Ballast
Morpho has no deployment on Mezo testnet. With the owner's approval Ballast deployed the **unmodified** official Morpho Blue v1.0.0 and AdaptiveCurveIrm v1.0.0 (pinned commits in `scripts/fetch-morpho.sh`, compiled for london) and supplied the market's BTC lending liquidity itself. This is disclosed in the app.

| Contract | Address | Tx | Block |
|---|---|---|---|
| Morpho Blue v1.0.0 (owner = deployer `0x4ff0…a5fA`) | [`0x3f2Be2a4a16e3fbc55e168B6cC56AA46Ff9cdC93`](https://explorer.test.mezo.org/address/0x3f2Be2a4a16e3fbc55e168B6cC56AA46Ff9cdC93) | [`0x6ca88599…`](https://explorer.test.mezo.org/tx/0x6ca88599a87af54cb4b44fb659ed46d03bdb8bae88088cfc8167a28ad9fb5266) | 16772885 |
| AdaptiveCurveIrm v1.0.0 | [`0xf3e3baD2f52662FDdef1f1C53Ce733E6703cB484`](https://explorer.test.mezo.org/address/0xf3e3baD2f52662FDdef1f1C53Ce733E6703cB484) | [`0x5c81aaae…`](https://explorer.test.mezo.org/tx/0x5c81aaae38748126e948eef36cde8987372fb5d9e3ee39b4e6af173ab84a3ee5) | 16772890 |
| BallastMezoOracle (Mezo PriceFeed → Morpho 1e36 scale) | [`0x301FEEf08C25D2F8AE5EfF95E8f32253006108d9`](https://explorer.test.mezo.org/address/0x301FEEf08C25D2F8AE5EfF95E8f32253006108d9) | [`0xfcb28974…`](https://explorer.test.mezo.org/tx/0xfcb28974c94d6583f20cf250db33dce9a3c5ce827b4d0a56de105e10aba6530e) | 16772895 |
| BallastHedgeFactory | [`0xE6bf4f9C911a5A4dD17062d25A1eCd0DdaA5C39E`](https://explorer.test.mezo.org/address/0xE6bf4f9C911a5A4dD17062d25A1eCd0DdaA5C39E) | [`0xb721b79c…`](https://explorer.test.mezo.org/tx/0xb721b79c2001b937914860963f823cb3fab5b8c83f8cff089d4b993ed3980846) | 16772917 |
| BallastHedge for account #1 | [`0x26df16A52A19C49d7b546c7E2B51b84A12d3aE07`](https://explorer.test.mezo.org/address/0x26df16A52A19C49d7b546c7E2B51b84A12d3aE07) | [`0x61aee737…`](https://explorer.test.mezo.org/tx/0x61aee737c35f3f4ce1def0b57bd1a0a9b8096697e32d4a22d929b88adf7984fd) | 16772946 |
| BallastBridgeReceiver | [`0xA28f9D5b2461623492d88a29400A62af627F18D9`](https://explorer.test.mezo.org/address/0xA28f9D5b2461623492d88a29400A62af627F18D9) | [`0x58e80513…`](https://explorer.test.mezo.org/tx/0x58e8051305c99293101bd499f39193786c55d7616101a314620e15eac3fbda80) | 16774152 |

Market: loan = Mezo BTC ERC-20 `0x7b7C000000000000000000000000000000000000`, collateral = MUSD, oracle = BallastMezoOracle, irm = AdaptiveCurveIrm, LLTV 0.86. Market id `0xffa1cd17869e9f195a2c9f6b218a5f8c3d90251640616b6da62604db0c482573`. Setup txs: enableIrm [`0x6766d84c…`](https://explorer.test.mezo.org/tx/0x6766d84c1008b1d6ec8a863394a573e35b8f5a9d2bc507e43c71ab5f8e4f61ab), enableLltv [`0x2d1c0074…`](https://explorer.test.mezo.org/tx/0x2d1c00743e4444b5565072f8276ced3cf5daa7d82aa0f7a6f9e7cfe2f1fbfd35), createMarket [`0x41162dee…`](https://explorer.test.mezo.org/tx/0x41162dee34e7a7b9f71664134451cef53bc56c8d6ee60c9dcf110eb3cf869f68); liquidity: deployer supplied 0.0012 BTC [`0x423f7c30…`](https://explorer.test.mezo.org/tx/0x423f7c30c2d5874046032116f27612f99908f6d560e0abb72d8d5c632ae4bcc3).
All of the above are source-verified on Blockscout (Morpho from the upstream source).
