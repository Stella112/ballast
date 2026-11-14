// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {BallastFactory} from "../src/BallastFactory.sol";
import {BallastAccountNFT} from "../src/BallastAccountNFT.sol";
import {BallastAccount} from "../src/BallastAccount.sol";
import {BallastRouter} from "../src/BallastRouter.sol";
import {BallastMezoOracle} from "../src/BallastMezoOracle.sol";
import {BallastHedge, BallastHedgeFactory} from "../src/BallastHedge.sol";
import {IMorpho, MorphoMarketParams, IPoolsRouter} from "../interfaces/IExternal.sol";
import {IPriceFeed} from "../interfaces/IMezo.sol";

/// Mezo's BTC ERC-20 (0x7b7C…0000) is a wrapper over a chain-native precompile that Foundry's EVM cannot execute
/// (NotActivated). For this fork test only, a plain ERC-20 is placed at that address and the real MUSD/BTC pool is
/// given token balances equal to its live reserves. Morpho Blue v1.0.0, AdaptiveCurveIrm, Mezo Pools, MUSD, Mezo
/// PriceFeed math and Ballast are the real code. The live testnet run uses the real BTC token.
contract ForkBTC is ERC20 {
    constructor() ERC20("Bitcoin (fork stand-in)", "BTC") {}

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }
}

interface IPoolReserves {
    function getReserves() external view returns (uint256, uint256, uint256);
}

contract BallastHedgeForkTest is Test {
    address constant BO = 0xCdF7028ceAB81fA0C6971208e83fa7872994beE5;
    address constant TM = 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0;
    address constant PF = 0x86bCF0841622a5dAC14A313a15f96A95421b9366;
    address constant MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;
    address constant BTC = 0x7b7C000000000000000000000000000000000000;
    address constant POOL = 0xd16A5Df82120ED8D626a1a15232bFcE2366d6AA9; // MUSD/BTC volatile
    address constant POOLS_ROUTER = 0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9;
    address constant POOL_FACTORY = 0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A;
    address constant ORACLE_PRECOMPILE = 0x7b7c000000000000000000000000000000000015;

    IMorpho morpho;
    MorphoMarketParams mp;
    BallastFactory factory;
    BallastAccount account;
    BallastHedgeFactory hedgeFactory;
    BallastHedge hedge;
    uint256 tokenId;
    address merchant = makeAddr("merchant");
    address lender = makeAddr("lender");
    bool forked;

    function setUp() public {
        string memory rpc = vm.envOr("MEZO_TESTNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;
        _mockOracle();

        // BTC stand-in + real pool balances matching live reserves
        (uint256 r0, uint256 r1,) = IPoolReserves(POOL).getReserves(); // token0 = MUSD, token1 = BTC
        r0; // MUSD balance of the pool is real
        deployCodeTo("BallastHedgeFork.t.sol:ForkBTC", BTC);
        ForkBTC(BTC).mint(POOL, r1);

        // Ballast core + an account with MUSD for the controller
        address me = address(this);
        uint256 n = vm.getNonce(me);
        address predFactory = vm.computeCreateAddress(me, n + 2);
        BallastRouter router = new BallastRouter(predFactory, MUSD);
        BallastAccountNFT nft = new BallastAccountNFT(predFactory);
        factory = new BallastFactory(address(nft), address(router), BO, TM, MUSD);
        vm.deal(merchant, 1 ether);
        vm.startPrank(merchant);
        address a;
        (tokenId, a) = factory.createAccount();
        account = BallastAccount(payable(a));
        account.openTrove{value: 0.09 ether}(2100e18, address(0), address(0));
        account.withdrawMUSD(merchant, 1500e18);
        vm.stopPrank();

        // Morpho Blue v1.0.0 + AdaptiveCurveIrm (exact upstream bytecode, london) + Ballast oracle on Mezo PriceFeed
        morpho = IMorpho(deployCode(".upstream/morpho-blue/out/Morpho.sol/Morpho.json", abi.encode(address(this))));
        address irm = deployCode(".upstream/morpho-blue-irm/out/AdaptiveCurveIrm.sol/AdaptiveCurveIrm.json", abi.encode(address(morpho)));
        BallastMezoOracle oracle = new BallastMezoOracle(PF);
        mp = MorphoMarketParams({loanToken: BTC, collateralToken: MUSD, oracle: address(oracle), irm: irm, lltv: 0.86e18});
        morpho.enableIrm(irm);
        morpho.enableLltv(0.86e18);
        morpho.createMarket(mp);

        // lender supplies BTC liquidity
        ForkBTC(BTC).mint(lender, 1e18);
        vm.startPrank(lender);
        IERC20(BTC).approve(address(morpho), type(uint256).max);
        morpho.supply(mp, 0.5e18, 0, lender, "");
        vm.stopPrank();

        hedgeFactory = new BallastHedgeFactory(address(factory), address(morpho), mp, POOLS_ROUTER, POOL_FACTORY);
        vm.prank(merchant);
        hedge = BallastHedge(hedgeFactory.create(tokenId));
    }

    modifier onlyFork() {
        if (!forked) vm.skip(true);
        _;
    }

    function _mockOracle() internal {
        bytes memory ret = vm.rpc(
            "eth_call", '[{"to":"0x7b7c000000000000000000000000000000000015","data":"0xfeaf968c"},"latest"]'
        );
        (uint80 roundId, int256 answer,,, uint80 answeredInRound) =
            abi.decode(ret, (uint80, int256, uint256, uint256, uint80));
        _setOracle(roundId, answer, answeredInRound);
    }

    function _setOracle(uint80 roundId, int256 answer, uint80 answeredInRound) internal {
        vm.mockCall(
            ORACLE_PRECOMPILE,
            abi.encodeWithSignature("latestRoundData()"),
            abi.encode(roundId, answer, block.timestamp, block.timestamp, answeredInRound)
        );
        vm.mockCall(ORACLE_PRECOMPILE, abi.encodeWithSignature("decimals()"), abi.encode(uint8(18)));
        if (ORACLE_PRECOMPILE.code.length == 0) vm.etch(ORACLE_PRECOMPILE, hex"00");
    }

    function test_fork_oracleScale() public onlyFork {
        uint256 p = IPriceFeed(PF).fetchPrice();
        uint256 o = BallastMezoOracle(mp.oracle).price();
        // 1 MUSD of collateral is worth 1e18 * o / 1e36 BTC wei == 1e36 / p
        assertEq(o, 1e54 / p);
        assertApproxEqRel(1e18 * o / 1e36, 1e36 / p, 1e9);
    }

    function test_fork_openAndClose_realMorpho_realPool() public onlyFork {
        vm.startPrank(merchant);
        IERC20(MUSD).approve(address(hedge), 1000e18);
        hedge.open(1000e18, 0.004e18, 0);
        vm.stopPrank();

        (uint256 coll, uint256 shares, uint256 owed) = hedge.positionInfo();
        assertEq(coll, 1000e18, "MUSD collateral on Morpho");
        assertGt(shares, 0);
        assertEq(owed, 0.004e18, "owes what it borrowed (no time passed)");
        uint256 proceeds = IERC20(MUSD).balanceOf(address(hedge));
        assertGt(proceeds, 200e18, "sold 0.004 BTC for MUSD in the real pool");

        vm.warp(block.timestamp + 7 days); // interest accrues in BTC
        _mockOracle();
        // proceeds alone do not cover the buy-back after fees + 7 days of interest -> clear revert
        vm.prank(merchant);
        vm.expectRevert();
        hedge.close(proceeds, 0, 0);
        // top up 5 MUSD from the controller and spend it with the proceeds
        vm.startPrank(merchant);
        IERC20(MUSD).approve(address(hedge), 5e18);
        hedge.close(proceeds + 5e18, 0, 5e18);
        vm.stopPrank();

        (coll, shares,) = hedge.positionInfo();
        assertEq(shares, 0, "debt fully repaid");
        assertEq(coll, 0, "collateral withdrawn");
        assertEq(IERC20(MUSD).balanceOf(address(hedge)), 1000e18, "collateral back; proceeds + top-up spent on buy-back");
        assertGt(IERC20(BTC).balanceOf(address(hedge)), 0, "leftover BTC from the buy-back stays here");

        uint256 acct0 = IERC20(MUSD).balanceOf(address(account));
        uint256 held = IERC20(MUSD).balanceOf(address(hedge));
        vm.prank(merchant);
        hedge.sendToAccount();
        assertEq(IERC20(MUSD).balanceOf(address(account)), acct0 + held, "funds go to the Ballast account");
    }

    function test_fork_onlyController() public onlyFork {
        address stranger = makeAddr("stranger");
        vm.startPrank(stranger);
        vm.expectRevert(BallastHedge.NotController.selector);
        hedge.open(1, 1, 0);
        vm.expectRevert(BallastHedge.NotController.selector);
        hedge.close(0, 0, 0);
        vm.expectRevert(BallastHedge.NotController.selector);
        hedge.sendToAccount();
        vm.expectRevert(BallastHedge.NotController.selector);
        hedge.withdraw(MUSD, stranger, 1);
        vm.stopPrank();
        vm.expectRevert(BallastHedgeFactory.NotController.selector);
        vm.prank(stranger);
        hedgeFactory.create(tokenId);
        vm.expectRevert(BallastHedgeFactory.AlreadyExists.selector);
        vm.prank(merchant);
        hedgeFactory.create(tokenId);
    }

    function test_fork_cannotOpenTwice_orSendWhileOpen() public onlyFork {
        vm.startPrank(merchant);
        IERC20(MUSD).approve(address(hedge), 2000e18);
        hedge.open(500e18, 0.001e18, 0);
        vm.expectRevert(BallastHedge.PositionOpen.selector);
        hedge.open(500e18, 0.001e18, 0);
        vm.expectRevert(BallastHedge.PositionOpen.selector);
        hedge.sendToAccount();
        vm.stopPrank();
    }

    function test_fork_borrowAboveLltvRejectedByMorpho() public onlyFork {
        // 100 MUSD collateral at 86% LLTV supports ~86 MUSD of BTC; borrowing ~0.01 BTC (~680 MUSD) must fail
        vm.startPrank(merchant);
        IERC20(MUSD).approve(address(hedge), 100e18);
        vm.expectRevert(bytes("insufficient collateral"));
        hedge.open(100e18, 0.01e18, 0);
        vm.stopPrank();
    }

    function test_fork_btcRally_makesPositionLiquidatable() public onlyFork {
        vm.startPrank(merchant);
        IERC20(MUSD).approve(address(hedge), 400e18);
        hedge.open(400e18, 0.004e18, 0); // ~272 MUSD of BTC vs 344 MUSD max at 86%
        vm.stopPrank();
        // BTC +40% on Mezo's feed: borrowed value ~381 MUSD > 344 -> Morpho allows liquidation
        (uint80 r, int256 a,,, uint80 ar) = abi.decode(
            vm.rpc("eth_call", '[{"to":"0x7b7c000000000000000000000000000000000015","data":"0xfeaf968c"},"latest"]'),
            (uint80, int256, uint256, uint256, uint80)
        );
        _setOracle(r, a * 14 / 10, ar);
        address liq = makeAddr("liquidator");
        ForkBTC(BTC).mint(liq, 1e18);
        vm.startPrank(liq);
        IERC20(BTC).approve(address(morpho), type(uint256).max);
        (bool ok,) = address(morpho).call(
            abi.encodeWithSignature(
                "liquidate((address,address,address,address,uint256),address,uint256,uint256,bytes)",
                mp, address(hedge), 100e18, 0, ""
            )
        );
        vm.stopPrank();
        assertTrue(ok, "third party liquidated the hedge after a BTC rally");
        (uint256 coll,,) = hedge.positionInfo();
        assertLt(coll, 400e18, "collateral seized");
    }
}
