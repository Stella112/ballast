// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {BallastFactory} from "../src/BallastFactory.sol";
import {BallastAccountNFT} from "../src/BallastAccountNFT.sol";
import {BallastAccount} from "../src/BallastAccount.sol";
import {BallastRouter} from "../src/BallastRouter.sol";

// ---------------------------------------------------------------------------
// UNIT-LEVEL STAND-INS (not Mezo). They model only the rules Ballast depends on,
// copied from mezo-org/musd@da7888a: repay burns from caller, (debt - 200) - repay >= minNetDebt,
// open adds fee 0 + 200 gas comp. Real Mezo behaviour is covered by BallastFork.t.sol and live evidence.
// ---------------------------------------------------------------------------
contract StandInMUSD is ERC20 {
    address public bo;
    constructor() ERC20("Stand-in MUSD", "sMUSD") {}
    function setBO(address b) external { bo = b; }
    function mint(address to, uint256 a) external { _mint(to, a); }
    function burn(address from, uint256 a) external { require(msg.sender == bo, "only BO"); _burn(from, a); }
}

contract StandInTM {
    mapping(address => uint8) public status;
    mapping(address => uint256) public debt;
    function set(address b, uint8 s, uint256 d) external { status[b] = s; debt[b] = d; }
    function getTroveStatus(address b) external view returns (uint8) { return status[b]; }
    function getTroveDebt(address b) external view returns (uint256) { return debt[b]; }
}

contract StandInBO {
    StandInMUSD public musd;
    StandInTM public tm;
    uint256 public constant MUSD_GAS_COMPENSATION = 200e18;
    uint256 public minNetDebt = 1800e18;
    constructor(StandInMUSD m, StandInTM t) { musd = m; tm = t; }
    function openTrove(uint256 amt, address, address) external payable {
        require(tm.getTroveStatus(msg.sender) != 1, "active");
        require(amt >= minNetDebt, "min");
        tm.set(msg.sender, 1, amt + MUSD_GAS_COMPENSATION);
        musd.mint(msg.sender, amt);
    }
    function repayMUSD(uint256 amt, address, address) external {
        uint256 d = tm.getTroveDebt(msg.sender);
        require(tm.getTroveStatus(msg.sender) == 1, "inactive");
        require(d - MUSD_GAS_COMPENSATION - amt >= minNetDebt, "BorrowerOps: Trove's net debt must be greater than minimum");
        musd.burn(msg.sender, amt);
        tm.set(msg.sender, 1, d - amt);
    }
    function closeTrove() external { tm.set(msg.sender, 2, 0); }
}

contract BallastUnitTest is Test {
    StandInMUSD musd;
    StandInTM tm;
    StandInBO bo;
    BallastRouter router;
    BallastAccountNFT nft;
    BallastFactory factory;
    BallastAccount account;
    uint256 tokenId;

    uint256 merchantPk = 0xA11CE;
    address merchant;
    address payer = makeAddr("payer");
    address stranger = makeAddr("stranger");

    function setUp() public {
        merchant = vm.addr(merchantPk);
        musd = new StandInMUSD();
        tm = new StandInTM();
        bo = new StandInBO(musd, tm);
        musd.setBO(address(bo));
        uint256 n = vm.getNonce(address(this));
        address predFactory = vm.computeCreateAddress(address(this), n + 2);
        router = new BallastRouter(predFactory, address(musd));
        nft = new BallastAccountNFT(predFactory);
        factory = new BallastFactory(address(nft), address(router), address(bo), address(tm), address(musd));
        vm.prank(merchant);
        address a;
        (tokenId, a) = factory.createAccount();
        account = BallastAccount(payable(a));
    }

    function _open() internal {
        vm.deal(merchant, 1 ether);
        vm.prank(merchant);
        account.openTrove{value: 0.1 ether}(2100e18, address(0), address(0));
    }

    function _inv(bytes32 id, uint256 amount, uint256 expiry) internal view returns (BallastRouter.Invoice memory inv, bytes memory sig) {
        inv = BallastRouter.Invoice({tokenId: tokenId, invoiceId: id, amount: amount, expiry: expiry});
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(merchantPk, router.invoiceDigest(inv));
        sig = abi.encodePacked(r, s, v);
    }

    function _fundPayer(uint256 amt) internal {
        musd.mint(payer, amt);
        vm.prank(payer);
        musd.approve(address(router), type(uint256).max);
    }

    // ---------------- split math ----------------
    function testFuzz_splitConservesExactly(uint256 amount, uint16 r, uint16 v, bool paused) public view {
        amount = bound(amount, 0, type(uint128).max);
        r = uint16(bound(r, 0, 10_000));
        v = uint16(bound(v, 0, 10_000 - r));
        (uint256 s, uint256 res, uint256 rep) = router.computeSplit(amount, r, v, paused);
        assertEq(s + res + rep, amount, "legs sum to amount");
        assertEq(rep, paused ? 0 : amount * r / 10_000);
        assertEq(res, amount * v / 10_000);
    }

    function test_split_example_20_5_75() public view {
        (uint256 s, uint256 res, uint256 rep) = router.computeSplit(100e18, 2000, 500, false);
        assertEq(s, 75e18);
        assertEq(res, 5e18);
        assertEq(rep, 20e18);
    }

    function test_split_dust_goesToSpendable() public view {
        (uint256 s, uint256 res, uint256 rep) = router.computeSplit(3, 3333, 3333, false);
        assertEq(rep, 0);
        assertEq(res, 0);
        assertEq(s, 3);
    }

    // ---------------- payInvoice ----------------
    function testFuzz_payInvoice_balancesConserve(uint96 amt, uint16 r, uint16 v) public {
        uint256 amount = bound(uint256(amt), 1, 300e18);
        r = uint16(bound(r, 0, 10_000));
        v = uint16(bound(v, 0, 10_000 - r));
        _open();
        vm.prank(merchant);
        account.setPolicy(r, v, false, address(0));
        _fundPayer(amount);
        (BallastRouter.Invoice memory inv, bytes memory sig) = _inv(keccak256(abi.encode(amount, r, v)), amount, block.timestamp + 1);
        (uint256 s, uint256 res, uint256 rep) = router.computeSplit(amount, r, v, false);
        uint256 debt0 = tm.getTroveDebt(address(account));
        uint256 m0 = musd.balanceOf(merchant);
        uint256 a0 = musd.balanceOf(address(account));
        uint256 headroom = account.maxRepayable();
        vm.prank(payer);
        if (rep > headroom) {
            vm.expectRevert(abi.encodeWithSelector(BallastAccount.RepayExceedsHeadroom.selector, rep, headroom));
            router.payInvoice(inv, sig, address(0), address(0));
            assertEq(musd.balanceOf(payer), amount, "no partial state");
            assertFalse(router.invoicePaid(tokenId, inv.invoiceId));
            return;
        }
        router.payInvoice(inv, sig, address(0), address(0));
        assertEq(musd.balanceOf(payer), 0);
        assertEq(musd.balanceOf(merchant) - m0, s);
        assertEq(musd.balanceOf(address(account)) - a0, res);
        assertEq(account.hedgeReserve(), res);
        assertEq(debt0 - tm.getTroveDebt(address(account)), rep);
    }

    function test_payInvoice_replay_expiry_badSig_zero_unknown() public {
        _open();
        vm.prank(merchant);
        account.setPolicy(2000, 500, false, address(0));
        _fundPayer(1000e18);
        (BallastRouter.Invoice memory inv, bytes memory sig) = _inv("a", 100e18, block.timestamp + 10);
        vm.startPrank(payer);
        router.payInvoice(inv, sig, address(0), address(0));
        vm.expectRevert(abi.encodeWithSelector(BallastRouter.AlreadyPaid.selector, bytes32("a")));
        router.payInvoice(inv, sig, address(0), address(0));
        vm.stopPrank();

        (inv, sig) = _inv("b", 100e18, block.timestamp + 10);
        vm.warp(block.timestamp + 11);
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(BallastRouter.Expired.selector, inv.expiry));
        router.payInvoice(inv, sig, address(0), address(0));

        (inv, sig) = _inv("c", 100e18, block.timestamp + 10);
        inv.amount = 1e18; // payer edits amount
        vm.prank(payer);
        vm.expectRevert(BallastRouter.BadSignature.selector);
        router.payInvoice(inv, sig, address(0), address(0));

        // signature by someone other than the controller
        BallastRouter.Invoice memory inv2 = BallastRouter.Invoice({tokenId: tokenId, invoiceId: "d", amount: 1e18, expiry: block.timestamp + 10});
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBEEF, router.invoiceDigest(inv2));
        vm.prank(payer);
        vm.expectRevert(BallastRouter.BadSignature.selector);
        router.payInvoice(inv2, abi.encodePacked(r, s, v), address(0), address(0));

        (inv, sig) = _inv("e", 0, block.timestamp + 10);
        vm.prank(payer);
        vm.expectRevert(BallastRouter.ZeroAmount.selector);
        router.payInvoice(inv, sig, address(0), address(0));

        inv2.tokenId = 999;
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(BallastRouter.UnknownAccount.selector, 999));
        router.payInvoice(inv2, "", address(0), address(0));
    }

    function test_payInvoice_insufficientAllowance_revertsWithoutState() public {
        _open();
        vm.prank(merchant);
        account.setPolicy(2000, 500, false, address(0));
        musd.mint(payer, 100e18);
        vm.prank(payer);
        musd.approve(address(router), 50e18);
        (BallastRouter.Invoice memory inv, bytes memory sig) = _inv("x", 100e18, block.timestamp + 10);
        uint256 debt0 = tm.getTroveDebt(address(account));
        vm.prank(payer);
        vm.expectRevert();
        router.payInvoice(inv, sig, address(0), address(0));
        assertEq(musd.balanceOf(payer), 100e18);
        assertEq(tm.getTroveDebt(address(account)), debt0);
        assertFalse(router.invoicePaid(tokenId, "x"));
    }

    function test_paused_routesRepayShareToSpendable_andNoTroveNeeded() public {
        vm.prank(merchant);
        account.setPolicy(5000, 1000, true, address(0));
        _fundPayer(100e18);
        (BallastRouter.Invoice memory inv, bytes memory sig) = _inv("p", 100e18, block.timestamp + 10);
        vm.prank(payer);
        router.payInvoice(inv, sig, address(0), address(0));
        assertEq(musd.balanceOf(merchant), 90e18);
        assertEq(account.hedgeReserve(), 10e18);
    }

    function test_repayLegWithoutActiveTrove_revertsWhole() public {
        vm.prank(merchant);
        account.setPolicy(2000, 0, false, address(0));
        _fundPayer(100e18);
        (BallastRouter.Invoice memory inv, bytes memory sig) = _inv("n", 100e18, block.timestamp + 10);
        vm.prank(payer);
        vm.expectRevert(BallastAccount.NoActiveTrove.selector);
        router.payInvoice(inv, sig, address(0), address(0));
        assertEq(musd.balanceOf(payer), 100e18);
    }

    // ---------------- access control ----------------
    function test_onlyController_everywhere() public {
        _open();
        vm.deal(stranger, 1 ether);
        vm.startPrank(stranger);
        vm.expectRevert(BallastAccount.NotController.selector);
        account.openTrove{value: 1}(1, address(0), address(0));
        vm.expectRevert(BallastAccount.NotController.selector);
        account.setPolicy(0, 0, false, stranger);
        vm.expectRevert(BallastAccount.NotController.selector);
        account.withdrawMUSD(stranger, 1);
        vm.expectRevert(BallastAccount.NotController.selector);
        account.withdrawReserve(stranger, 0);
        vm.expectRevert(BallastAccount.NotController.selector);
        account.withdrawBTC(stranger, 0);
        vm.expectRevert(BallastAccount.NotController.selector);
        account.repay(1, address(0), address(0));
        vm.expectRevert(BallastAccount.NotController.selector);
        account.borrow(1, address(0), address(0));
        vm.expectRevert(BallastAccount.NotController.selector);
        account.closeTrove();
        vm.expectRevert(BallastAccount.NotController.selector);
        account.rescueToken(address(musd), stranger, 1);
        vm.expectRevert(BallastAccount.NotRouter.selector);
        account.applyPayment(bytes32(0), 1, 1, address(0), address(0));
        vm.stopPrank();
    }

    function test_setPolicy_rejectsBpsOver10000() public {
        vm.prank(merchant);
        vm.expectRevert(BallastAccount.InvalidBps.selector);
        account.setPolicy(9000, 1001, false, address(0));
    }

    function test_reserveNotWithdrawableAsFree_andCannotRescueMUSD() public {
        _open();
        vm.prank(merchant);
        account.setPolicy(0, 1000, false, address(0));
        _fundPayer(100e18);
        (BallastRouter.Invoice memory inv, bytes memory sig) = _inv("r", 100e18, block.timestamp + 10);
        vm.prank(payer);
        router.payInvoice(inv, sig, address(0), address(0));
        uint256 free = account.freeMUSD();
        assertEq(musd.balanceOf(address(account)), free + 10e18);
        vm.startPrank(merchant);
        vm.expectRevert(abi.encodeWithSelector(BallastAccount.InsufficientFreeMUSD.selector, free + 1, free));
        account.withdrawMUSD(merchant, free + 1);
        vm.expectRevert(BallastAccount.CannotRescueMUSD.selector);
        account.rescueToken(address(musd), merchant, 1);
        account.withdrawReserve(merchant, 10e18);
        vm.stopPrank();
        assertEq(account.hedgeReserve(), 0);
    }

    // ---------------- NFT & factory ----------------
    function test_nft_onlyFactoryMints_uniqueAccounts() public {
        vm.expectRevert(BallastAccountNFT.OnlyFactory.selector);
        nft.mint(stranger, 99);
        vm.prank(stranger);
        (uint256 id2, address a2) = factory.createAccount();
        assertEq(id2, tokenId + 1);
        assertTrue(a2 != address(account));
        assertEq(factory.accountOf(id2), a2);
        assertEq(factory.tokenIdOf(a2), id2);
        assertEq(BallastAccount(payable(a2)).controller(), stranger);
    }

    function test_nft_lockedWhileActive_EOAonly_controlFollowsHolder() public {
        _open();
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(BallastAccountNFT.TransferLockedActiveTrove.selector, tokenId));
        nft.transferFrom(merchant, stranger, tokenId);

        tm.set(address(account), 2, 0); // closed
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(BallastAccountNFT.RecipientMustBeEOA.selector, address(router)));
        nft.transferFrom(merchant, address(router), tokenId);

        // invoice signed by the old holder becomes invalid after transfer
        (BallastRouter.Invoice memory inv, bytes memory sig) = _inv("old", 1e18, block.timestamp + 10);
        vm.prank(merchant);
        nft.transferFrom(merchant, stranger, tokenId);
        assertEq(account.controller(), stranger);
        vm.prank(merchant);
        vm.expectRevert(BallastAccount.NotController.selector);
        account.setPolicy(0, 0, false, address(0));
        _fundPayer(1e18);
        vm.prank(payer);
        vm.expectRevert(BallastRouter.BadSignature.selector);
        router.payInvoice(inv, sig, address(0), address(0));
    }

    function test_factory_rejectsBadWiring() public {
        BallastAccountNFT otherNft = new BallastAccountNFT(address(0xdead));
        vm.expectRevert(BallastFactory.BadWiring.selector);
        new BallastFactory(address(otherNft), address(router), address(bo), address(tm), address(musd));
    }

    function test_account_receivesBTC_andControllerWithdraws() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(account).call{value: 0.5 ether}("");
        assertTrue(ok);
        vm.prank(merchant);
        account.withdrawBTC(merchant, 0.5 ether);
        assertEq(merchant.balance, 0.5 ether);
    }
}
