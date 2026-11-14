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
