// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {BallastFactory} from "../src/BallastFactory.sol";
import {BallastAccountNFT} from "../src/BallastAccountNFT.sol";
import {BallastRouter} from "../src/BallastRouter.sol";

/// @notice Deploys Router -> NFT -> Factory with nonce-predicted wiring. No admin keys remain.
///         Preflight: refuses any chain other than Mezo testnet (31611) and checks Mezo bytecode exists.
/// Usage: forge script contracts/script/Deploy.s.sol --rpc-url $MEZO_TESTNET_RPC_URL --broadcast --slow
contract Deploy is Script {
    // Verified in docs/VERIFICATION.md (explorer-verified proxies; implementation == mezo-org/musd@da7888a)
    address constant BO = 0xCdF7028ceAB81fA0C6971208e83fa7872994beE5;
    address constant TM = 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0;
    address constant MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;

    function run() external {
        require(block.chainid == 31611, "preflight: not Mezo testnet");
        require(BO.code.length > 0 && TM.code.length > 0 && MUSD.code.length > 0, "preflight: Mezo bytecode missing");

        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        uint64 n = vm.getNonce(deployer);
        address predFactory = vm.computeCreateAddress(deployer, n + 2);
        console2.log("deployer", deployer, "nonce", n);
        console2.log("predicted factory", predFactory);

        vm.startBroadcast(pk);
        BallastRouter router = new BallastRouter(predFactory, MUSD);
        BallastAccountNFT nft = new BallastAccountNFT(predFactory);
        BallastFactory factory = new BallastFactory(address(nft), address(router), BO, TM, MUSD);
        vm.stopBroadcast();

        require(address(factory) == predFactory, "factory address mismatch");
        console2.log("router ", address(router));
        console2.log("nft    ", address(nft));
        console2.log("factory", address(factory));

        string memory o = "deploy";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeAddress(o, "deployer", deployer);
        vm.serializeAddress(o, "BallastRouter", address(router));
        vm.serializeAddress(o, "BallastAccountNFT", address(nft));
        string memory json = vm.serializeAddress(o, "BallastFactory", address(factory));
        vm.writeJson(json, "./config/ballast-deploy.out.json");
    }
}
