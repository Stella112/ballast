// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
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
    // stand-in ratio: fixed 3,300 MUSD of collateral value over the debt
    function getCurrentICR(address b, uint256) external view returns (uint256) { return debt[b] == 0 ? type(uint256).max : 3300e18 * 1e18 / debt[b]; }
}

contract StandInPF {
    function fetchPrice() external pure returns (uint256) { return 68_000e18; }
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

/// @dev Minimal marketplace escrow: holds the NFT (implements IERC721Receiver) and releases it to a buyer.
contract EscrowStandIn is IERC721Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function release(address nft, address buyer, uint256 tokenId) external {
        BallastAccountNFT(nft).transferFrom(address(this), buyer, tokenId);
    }
}

contract BallastUnitTest is Test {
    StandInMUSD musd;
    StandInTM tm;
    StandInBO bo;
    StandInPF pf;
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
        pf = new StandInPF();
        musd.setBO(address(bo));
        uint256 n = vm.getNonce(address(this));
        address predFactory = vm.computeCreateAddress(address(this), n + 2);
        router = new BallastRouter(predFactory, address(musd));
        nft = new BallastAccountNFT(predFactory);
        factory = new BallastFactory(address(nft), address(router), address(bo), address(tm), address(musd), address(pf));
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
        account.setPolicy(r, v, false, address(0), 0);
        _fundPayer(amount);
        (BallastRouter.Invoice memory inv, bytes memory sig) = _inv(keccak256(abi.encode(amount, r, v)), amount, block.timestamp + 1);
        (uint256 s, uint256 res, uint256 rep) = router.computeSplit(amount, r, v, false);
        uint256 debt0 = tm.getTroveDebt(address(account));
        uint256 m0 = musd.balanceOf(merchant);
        uint256 a0 = musd.balanceOf(address(account));
        uint256 headroom = account.maxRepayable();
        if (rep > headroom) {
            // v2: repayment is capped at Mezo's minimum debt; the excess goes to the owner
            s += rep - headroom;
            rep = headroom;
        }
        vm.prank(payer);
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
        account.setPolicy(2000, 500, false, address(0), 0);
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
        account.setPolicy(2000, 500, false, address(0), 0);
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
        account.setPolicy(5000, 1000, true, address(0), 0);
        _fundPayer(100e18);
        (BallastRouter.Invoice memory inv, bytes memory sig) = _inv("p", 100e18, block.timestamp + 10);
        vm.prank(payer);
        router.payInvoice(inv, sig, address(0), address(0));
        assertEq(musd.balanceOf(merchant), 90e18);
        assertEq(account.hedgeReserve(), 10e18);
    }

    function test_noActiveTrove_repayShareGoesToOwner() public {
        vm.prank(merchant);
        account.setPolicy(2000, 0, false, address(0), 0);
        _fundPayer(100e18);
        (BallastRouter.Invoice memory inv, bytes memory sig) = _inv("n", 100e18, block.timestamp + 10);
        vm.prank(payer);
        router.payInvoice(inv, sig, address(0), address(0));
        assertEq(musd.balanceOf(merchant), 100e18, "nothing to repay: all to owner");
    }

    // ---------------- v2: pay(), cap, cash buffer, keeper ----------------
    event Payment(uint256 indexed accountId, bytes32 indexed reference_, address indexed payer, uint256 amount, uint256 toOwner, uint256 toReserve, uint256 repaid, uint256 icrBefore, uint256 icrAfter);

    function test_pay_splits_emitsRatioBeforeAfter() public {
        _open(); // debt 2300 -> headroom 300
        vm.prank(merchant);
        account.setPolicy(2000, 500, false, address(0), 0);
        _fundPayer(100e18);
        uint256 icr0 = account.currentICR();
        uint256 icr1 = uint256(3300e18) * 1e18 / uint256(2280e18);
        vm.expectEmit(true, true, true, true, address(router));
        emit Payment(tokenId, "order-1", payer, 100e18, 75e18, 5e18, 20e18, icr0, icr1);
        vm.prank(payer);
        router.pay(tokenId, 100e18, "order-1");
        assertEq(musd.balanceOf(merchant), 75e18);
        assertEq(account.hedgeReserve(), 5e18);
        assertEq(tm.getTroveDebt(address(account)), 2280e18);
        assertGt(icr1, icr0);
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(BallastRouter.UnknownAccount.selector, 77));
        router.pay(77, 1e18, "x");
        vm.prank(payer);
        vm.expectRevert(BallastRouter.ZeroAmount.selector);
        router.pay(tokenId, 0, "x");
    }

    function test_cap_repayStopsAtMinimumDebt_excessToOwner() public {
        _open(); // headroom 300
        vm.prank(merchant);
        account.setPolicy(10_000, 0, false, address(0), 0);
        _fundPayer(1000e18);
        vm.prank(payer);
        router.pay(tokenId, 1000e18, "big");
        assertEq(tm.getTroveDebt(address(account)), 2000e18, "debt stops at Mezo minimum");
        assertEq(musd.balanceOf(merchant), 700e18, "excess to owner");
        assertEq(account.maxRepayable(), 0);
    }

    function test_cashBuffer_topsUpOwnerBeforeRepaying() public {
        _open();
        vm.prank(merchant);
        account.setPolicy(1000, 0, false, address(0), 95e18); // 10% repay, keep 95 MUSD cash
        _fundPayer(300e18);
        vm.startPrank(payer);
        router.pay(tokenId, 100e18, "1"); // owner would get 90 < 95 -> 5 shifts from repay
        assertEq(musd.balanceOf(merchant), 95e18);
        assertEq(tm.getTroveDebt(address(account)), 2300e18 - 5e18);
        router.pay(tokenId, 100e18, "2"); // buffer already met -> normal 90/10
        assertEq(musd.balanceOf(merchant), 185e18);
        assertEq(tm.getTroveDebt(address(account)), 2300e18 - 15e18);
        vm.stopPrank();
    }

    function test_keeper_processIncome_anyoneCanTrigger_cannotRedirect() public {
        _open();
        address payoutAddr = makeAddr("payout");
        vm.prank(merchant);
        account.setPolicy(2000, 500, false, payoutAddr, 0);
        uint256 owner0 = account.ownerMUSD();
        assertEq(owner0, 2100e18, "borrowed MUSD is the owner's, not income");
        vm.prank(stranger);
        vm.expectRevert(BallastAccount.NothingToProcess.selector);
        account.processIncome(address(0), address(0));

        musd.mint(address(account), 200e18); // MUSD lands directly (e.g. from a bridge)
        assertEq(account.pendingIncome(), 200e18);
        vm.prank(stranger); // keeper
        account.processIncome(address(0), address(0));
        assertEq(musd.balanceOf(payoutAddr), 150e18, "owner share to the owner's payout");
        assertEq(musd.balanceOf(stranger), 0, "keeper gets nothing");
        assertEq(account.hedgeReserve(), 10e18);
        assertEq(tm.getTroveDebt(address(account)), 2300e18 - 40e18);
        assertEq(account.ownerMUSD(), owner0, "owner funds untouched");
        assertEq(account.pendingIncome(), 0);
    }

    function test_depositMUSD_creditsOwner_notIncome() public {
        musd.mint(stranger, 50e18);
        vm.startPrank(stranger);
        musd.approve(address(account), 50e18);
        account.depositMUSD(50e18);
        vm.stopPrank();
        assertEq(account.ownerMUSD(), 50e18);
        assertEq(account.pendingIncome(), 0);
        vm.prank(merchant);
        account.withdrawMUSD(merchant, 50e18);
        assertEq(musd.balanceOf(merchant), 50e18);
    }

    // ---------------- access control ----------------
    function test_onlyController_everywhere() public {
        _open();
        vm.deal(stranger, 1 ether);
        vm.startPrank(stranger);
        vm.expectRevert(BallastAccount.NotController.selector);
        account.openTrove{value: 1}(1, address(0), address(0));
        vm.expectRevert(BallastAccount.NotController.selector);
        account.setPolicy(0, 0, false, stranger, 0);
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
        account.applyPayment(bytes32(0), 2, 0, 1, 1, address(0), address(0));
        vm.expectRevert(BallastAccount.NotNFT.selector);
        account.controllerChanged(stranger);
        vm.stopPrank();
    }

    function test_setPolicy_rejectsBpsOver10000() public {
        vm.prank(merchant);
        vm.expectRevert(BallastAccount.InvalidBps.selector);
        account.setPolicy(9000, 1001, false, address(0), 0);
    }

    function test_reserveNotWithdrawableAsFree_andCannotRescueMUSD() public {
        _open();
        vm.prank(merchant);
        account.setPolicy(0, 1000, false, address(0), 0);
        _fundPayer(100e18);
        (BallastRouter.Invoice memory inv, bytes memory sig) = _inv("r", 100e18, block.timestamp + 10);
        vm.prank(payer);
        router.payInvoice(inv, sig, address(0), address(0));
        uint256 free = account.freeMUSD();
        assertEq(musd.balanceOf(address(account)), free + 10e18);
        assertEq(account.pendingIncome(), 0);
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

    function test_nft_transferableWithOpenLoan_EOAonly_controlAndIncomeFollowHolder() public {
        _open();
        address oldPayout = makeAddr("oldPayout");
        vm.prank(merchant);
        account.setPolicy(2000, 0, false, oldPayout, 0);

        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(BallastAccountNFT.UseSafeTransferForContracts.selector, address(router)));
        nft.transferFrom(merchant, address(router), tokenId);
        // safeTransferFrom to a contract that cannot receive NFTs is rejected too
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InvalidReceiver.selector, address(router)));
        nft.safeTransferFrom(merchant, address(router), tokenId);

        // invoice signed by the old holder becomes invalid after transfer
        (BallastRouter.Invoice memory inv, bytes memory sig) = _inv("old", 1e18, block.timestamp + 10);
        vm.prank(merchant);
        nft.transferFrom(merchant, stranger, tokenId); // loan is OPEN: the whole account moves
        assertEq(account.controller(), stranger);
        assertTrue(account.hasActiveTrove());
        assertEq(account.payoutAddress(), stranger, "custom payout cleared: income follows the new holder");
        vm.prank(merchant);
        vm.expectRevert(BallastAccount.NotController.selector);
        account.withdrawMUSD(merchant, 1);
        _fundPayer(101e18);
        vm.prank(payer);
        vm.expectRevert(BallastRouter.BadSignature.selector);
        router.payInvoice(inv, sig, address(0), address(0));
        vm.prank(payer);
        router.pay(tokenId, 100e18, "after-transfer");
        assertEq(musd.balanceOf(stranger), 80e18);
        assertEq(musd.balanceOf(oldPayout), 0);
        // new holder controls the owner's MUSD and the loan
        vm.prank(stranger);
        account.withdrawMUSD(stranger, 2100e18);
        assertEq(musd.balanceOf(stranger), 2180e18);
    }

    function test_factory_rejectsBadWiring() public {
        BallastAccountNFT otherNft = new BallastAccountNFT(address(0xdead));
        vm.expectRevert(BallastFactory.BadWiring.selector);
        new BallastFactory(address(otherNft), address(router), address(bo), address(tm), address(musd), address(pf));
    }

    function test_account_receivesBTC_andControllerWithdraws() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(account).call{value: 0.5 ether}("");
        assertTrue(ok);
        vm.prank(merchant);
        account.withdrawBTC(merchant, 0.5 ether);
        assertEq(merchant.balance, 0.5 ether);
    }

    function test_nft_soldWholeThroughEscrowContract_withOpenLoan() public {
        _open();
        EscrowStandIn escrow = new EscrowStandIn();
        address buyer = makeAddr("buyer");
        uint256 debt = tm.getTroveDebt(address(account));

        vm.prank(merchant);
        nft.safeTransferFrom(merchant, address(escrow), tokenId); // listed: escrow holds the account
        assertEq(account.controller(), address(escrow));
        vm.prank(merchant);
        vm.expectRevert(BallastAccount.NotController.selector);
        account.withdrawMUSD(merchant, 1);

        escrow.release(address(nft), buyer, tokenId); // sold: buyer takes the whole account, loan included
        assertEq(account.controller(), buyer);
        assertTrue(account.hasActiveTrove());
        assertEq(tm.getTroveDebt(address(account)), debt, "the loan moved with the account");
        uint256 free = account.freeMUSD();
        vm.prank(buyer);
        account.withdrawMUSD(buyer, free);
        assertEq(musd.balanceOf(buyer), free);
    }
}
