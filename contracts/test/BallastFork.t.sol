// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BallastFactory} from "../src/BallastFactory.sol";
import {BallastAccountNFT} from "../src/BallastAccountNFT.sol";
import {BallastAccount} from "../src/BallastAccount.sol";
import {BallastRouter} from "../src/BallastRouter.sol";
import {ITroveManager, IBorrowerOperations, IPriceFeed, ISortedTroves} from "../interfaces/IMezo.sol";

/// @notice Runs against a fork of LIVE Mezo testnet state (no mocks of Mezo).
///         Skipped unless MEZO_TESTNET_RPC_URL is set. Never broadcasts.
contract BallastForkTest is Test {
    // Verified addresses — see docs/VERIFICATION.md
    address constant BO = 0xCdF7028ceAB81fA0C6971208e83fa7872994beE5;
    address constant TM = 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0;
    address constant ST = 0x722E4D24FD6Ff8b0AC679450F3D91294607268fA;
    address constant PF = 0x86bCF0841622a5dAC14A313a15f96A95421b9366;
    address constant MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;

    BallastFactory factory;
    BallastAccountNFT nft;
    BallastRouter router;
    BallastAccount account;
    uint256 tokenId;

    uint256 merchantPk = 0xA11CE;
    address merchant;
    address payer = makeAddr("payer");
    address payout = makeAddr("payout");
    bool forked;

    function setUp() public {
        string memory rpc = vm.envOr("MEZO_TESTNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;
        merchant = vm.addr(merchantPk);
        _mockOraclePrecompileWithLivePrice();

        address me = address(this);
        uint256 n = vm.getNonce(me);
        address predRouter = vm.computeCreateAddress(me, n);
        address predFactory = vm.computeCreateAddress(me, n + 2);
        router = new BallastRouter(predFactory, MUSD);
        nft = new BallastAccountNFT(predFactory);
        factory = new BallastFactory(address(nft), address(router), BO, TM, MUSD);
        assertEq(address(router), predRouter);
        assertEq(address(factory), predFactory);

        vm.deal(merchant, 1 ether);
        vm.prank(merchant);
        address a;
        (tokenId, a) = factory.createAccount();
        account = BallastAccount(payable(a));
    }

    /// @dev Mezo's PriceFeed reads a chain-native precompile (0x7b7c..15) that Foundry's EVM does not
    ///      implement (EvmError: NotActivated). We fetch the REAL latestRoundData from the live RPC and
    ///      mock only that precompile, with updatedAt = fork timestamp so the 60s staleness check passes.
    ///      All Mezo protocol contracts execute their real deployed bytecode against real fork state.
    address constant ORACLE_PRECOMPILE = 0x7b7c000000000000000000000000000000000015;

    function _mockOraclePrecompileWithLivePrice() internal {
        bytes memory ret = vm.rpc(
            "eth_call", '[{"to":"0x7b7c000000000000000000000000000000000015","data":"0xfeaf968c"},"latest"]'
        );
        (uint80 roundId, int256 answer,,, uint80 answeredInRound) =
            abi.decode(ret, (uint80, int256, uint256, uint256, uint80));
        require(answer > 0, "live oracle answer");
        livePrice = uint256(answer);
        vm.mockCall(
            ORACLE_PRECOMPILE,
            abi.encodeWithSignature("latestRoundData()"),
            abi.encode(roundId, answer, block.timestamp, block.timestamp, answeredInRound)
        );
        vm.mockCall(ORACLE_PRECOMPILE, abi.encodeWithSignature("decimals()"), abi.encode(uint8(18)));
        // Foundry needs code at the address for high-level calls to reach the mock.
        if (ORACLE_PRECOMPILE.code.length == 0) vm.etch(ORACLE_PRECOMPILE, hex"00");
    }

    uint256 livePrice;

    modifier onlyFork() {
        if (!forked) {
            vm.skip(true);
        }
        _;
    }

    function _open(uint256 debt, uint256 coll) internal {
        vm.prank(merchant);
        account.openTrove{value: coll}(debt, address(0), address(0));
    }

    function _sign(BallastRouter.Invoice memory inv) internal view returns (bytes memory) {
        bytes32 d = router.invoiceDigest(inv);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(merchantPk, d);
        return abi.encodePacked(r, s, v);
    }

    function test_fork_contractOwnedTrove_openWithdrawRepay() public onlyFork {
        uint256 price = IPriceFeed(PF).fetchPrice();
        console2.log("price", price);
        _open(2100e18, 0.09 ether);

        ITroveManager tm = ITroveManager(TM);
        assertEq(tm.getTroveStatus(address(account)), 1, "trove active, keyed by account address");
        assertTrue(ISortedTroves(ST).contains(address(account)));
        uint256 debt0 = tm.getTroveDebt(address(account));
        // 2100 + 0.1% fee + 200 gas comp
        assertEq(debt0, 2100e18 + 2.1e18 + 200e18);
        assertEq(IERC20(MUSD).balanceOf(address(account)), 2100e18, "account received minted MUSD");
        assertEq(tm.getTroveColl(address(account)), 0.09 ether);

        // controller withdraws borrowed MUSD
        vm.prank(merchant);
        account.withdrawMUSD(merchant, 500e18);
        assertEq(IERC20(MUSD).balanceOf(merchant), 500e18);

        // controller partial repay from free MUSD
        vm.prank(merchant);
        account.repay(50e18, address(0), address(0));
        assertEq(tm.getTroveDebt(address(account)), debt0 - 50e18);

        // stranger cannot do anything
        vm.startPrank(payer);
        vm.expectRevert(BallastAccount.NotController.selector);
        account.withdrawMUSD(payer, 1);
        vm.expectRevert(BallastAccount.NotController.selector);
        account.repay(1, address(0), address(0));
        vm.expectRevert(BallastAccount.NotController.selector);
        account.setPolicy(0, 0, false, payer);
        vm.expectRevert(BallastAccount.NotController.selector);
        account.closeTrove();
        vm.stopPrank();
    }

    function test_fork_gateB_invoice_20_5_75() public onlyFork {
        _open(2100e18, 0.09 ether);
        vm.startPrank(merchant);
        account.setPolicy(2000, 500, false, payout);
        account.withdrawMUSD(payer, 300e18); // genuine MUSD to payer wallet
        vm.stopPrank();

        BallastRouter.Invoice memory inv =
            BallastRouter.Invoice({tokenId: tokenId, invoiceId: keccak256("inv-1"), amount: 100e18, expiry: block.timestamp + 1 days});
        bytes memory sig = _sign(inv);

        uint256 debt0 = ITroveManager(TM).getTroveDebt(address(account));
        uint256 accBal0 = IERC20(MUSD).balanceOf(address(account));

        vm.startPrank(payer);
        IERC20(MUSD).approve(address(router), 100e18);
        router.payInvoice(inv, sig, address(0), address(0));
        vm.stopPrank();

        assertEq(IERC20(MUSD).balanceOf(payer), 200e18, "payer -100");
        assertEq(IERC20(MUSD).balanceOf(payout), 75e18, "spendable 75");
        assertEq(account.hedgeReserve(), 5e18, "reserve 5");
        assertEq(IERC20(MUSD).balanceOf(address(account)), accBal0 + 5e18, "account +5 reserve (20 burnt)");
        assertEq(ITroveManager(TM).getTroveDebt(address(account)), debt0 - 20e18, "debt -20");
        assertTrue(router.invoicePaid(tokenId, inv.invoiceId));

        // replay rejected
        vm.startPrank(payer);
        IERC20(MUSD).approve(address(router), 100e18);
        vm.expectRevert(abi.encodeWithSelector(BallastRouter.AlreadyPaid.selector, inv.invoiceId));
        router.payInvoice(inv, sig, address(0), address(0));
        vm.stopPrank();

        // reserve cannot be withdrawn as free MUSD
        uint256 free = account.freeMUSD();
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(BallastAccount.InsufficientFreeMUSD.selector, free + 1, free));
        account.withdrawMUSD(merchant, free + 1);
    }

    function test_fork_repayBeyondFloorRevertsWholePayment() public onlyFork {
        _open(1900e18, 0.09 ether); // net = 1901.9, headroom = 101.9
        vm.startPrank(merchant);
        account.setPolicy(10_000, 0, false, address(0));
        account.withdrawMUSD(payer, 500e18);
        vm.stopPrank();
        uint256 head = account.maxRepayable();
        assertEq(head, 101.9e18);

        BallastRouter.Invoice memory inv =
            BallastRouter.Invoice({tokenId: tokenId, invoiceId: keccak256("big"), amount: 200e18, expiry: block.timestamp + 1});
        bytes memory sig = _sign(inv);
        vm.startPrank(payer);
        IERC20(MUSD).approve(address(router), 200e18);
        vm.expectRevert(abi.encodeWithSelector(BallastAccount.RepayExceedsHeadroom.selector, 200e18, head));
        router.payInvoice(inv, sig, address(0), address(0));
        vm.stopPrank();
        assertEq(IERC20(MUSD).balanceOf(payer), 500e18, "no partial state");
        assertFalse(router.invoicePaid(tokenId, inv.invoiceId));
    }

    function test_fork_nftLockedWhileTroveActive_thenCloseAndTransfer() public onlyFork {
        _open(2100e18, 0.09 ether);
        address newOwner = makeAddr("newOwner");
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(BallastAccountNFT.TransferLockedActiveTrove.selector, tokenId));
        nft.transferFrom(merchant, newOwner, tokenId);

        // close: needs debt-200 MUSD. Account holds 2100; debt-200 = 2102.1 (+tiny interest) -> top up from a funded holder
        uint256 need = ITroveManager(TM).getTroveDebt(address(account)) - 200e18;
        uint256 have = IERC20(MUSD).balanceOf(address(account));
        // obtain extra genuine MUSD by opening a second trove from another EOA
        address helper = makeAddr("helper");
        vm.deal(helper, 1 ether);
        vm.prank(helper);
        IBorrowerOperations(BO).openTrove{value: 0.1 ether}(2000e18, address(0), address(0));
        vm.prank(helper);
        IERC20(MUSD).transfer(address(account), need - have + 1e18);

        uint256 btc0 = address(account).balance;
        vm.prank(merchant);
        account.closeTrove();
        assertEq(ITroveManager(TM).getTroveStatus(address(account)), 2, "closedByOwner");
        assertEq(address(account).balance, btc0 + 0.09 ether, "collateral returned to account");

        vm.prank(merchant);
        account.withdrawBTC(merchant, 0.09 ether);

        vm.prank(merchant);
        nft.transferFrom(merchant, newOwner, tokenId);
        assertEq(account.controller(), newOwner);
        vm.prank(merchant);
        vm.expectRevert(BallastAccount.NotController.selector);
        account.withdrawMUSD(merchant, 1);
    }
}
