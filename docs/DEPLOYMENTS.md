# Deployments — Mezo testnet (chain 31611)

Source commit for the deployed bytecode: `d4facb3`. Compiler solc 0.8.24, EVM london, optimizer 200 runs.
Machine-readable copy: `config/deployments.mezo-testnet.json`. Explorer: https://explorer.test.mezo.org

| Contract | Address | Deploy tx | Block |
|---|---|---|---|
| BallastRouter | [`0x2a3Ce214189F62A2f15b58ecFD7c4CfCDa97dF1d`](https://explorer.test.mezo.org/address/0x2a3Ce214189F62A2f15b58ecFD7c4CfCDa97dF1d) | [`0x90c2b1a1…0a57`](https://explorer.test.mezo.org/tx/0x90c2b1a1b20854b1fa9c9cfc7b61ac1d27b31459ab0bd750a5dfe7d196a30a57) | 16762083 |
| BallastAccountNFT | [`0xAa0034E681d208579cFF63A8E2CD298Fc51F3Afa`](https://explorer.test.mezo.org/address/0xAa0034E681d208579cFF63A8E2CD298Fc51F3Afa) | [`0xd8ddb4ee…e35b`](https://explorer.test.mezo.org/tx/0xd8ddb4eed3fe1059e468a77db3ec2c7d414fdc5c4b09a6866d11c3f3a65ee35b) | 16762085 |
| BallastFactory | [`0x74f918a5C1c8BDDc40CD0Ba8F9935790Fbc5dCCd`](https://explorer.test.mezo.org/address/0x74f918a5C1c8BDDc40CD0Ba8F9935790Fbc5dCCd) | [`0x4d4853e5…ac1f`](https://explorer.test.mezo.org/tx/0x4d4853e529b977d486836c29505f6c3aee2b65fe781ffb2565ed78e84226ac1f) | 16762087 |
| BallastAccount #1 (demo) | [`0xDE61A300ca381463FD6FeCc6b2602980a2Db6323`](https://explorer.test.mezo.org/address/0xDE61A300ca381463FD6FeCc6b2602980a2Db6323) | createAccount [`0xc8c82af3…7815`](https://explorer.test.mezo.org/tx/0xc8c82af3b6baf50c7d516e124e2d7ae91dee2c680274caf1bf2f492cac3c7815) | 16762107 |

Demo wallets (disposable, testnet-only): merchant/controller `0x4ff0D7c712B109dE476f21Ed443Ef0928d52a5fA`, payer `0xCBCd26d717CEe0305b92FDC1E50A398608A4d857`.
No admin, owner, or upgrade keys exist on any Ballast contract.
Explorer source verification of Ballast contracts: **VERIFIED** on Blockscout (Router, NFT, Factory, Account) 2026-11-13; view the "Contract" tab of each address on https://explorer.test.mezo.org.
