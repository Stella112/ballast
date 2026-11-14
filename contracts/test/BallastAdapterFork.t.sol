// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BallastRepaymentAdapter} from "../src/BallastRepaymentAdapter.sol";
import {ITroveManager, IBorrowerOperations, IBorrowerOperationsSignatures} from "../interfaces/IMezo.sol";

/// @notice Signed repayment of ordinary WALLET troves, against a fork of LIVE Mezo testnet (no Mezo mocks
///         except the price precompile, see BallastFork.t.sol). Skipped unless MEZO_TESTNET_RPC_URL is set.
contract BallastAdapterForkTest is Test {
    address constant BO = 0xCdF7028ceAB81fA0C6971208e83fa7872994beE5;
    address constant BOS = 0xD757e3646AF370b15f32EB557F0F8380Df7D639e;
    address constant TM = 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0;
    address constant MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;
    address constant ORACLE_PRECOMPILE = 0x7b7c000000000000000000000000000000000015;

    bytes32 constant REPAY_MUSD_TYPEHASH =
        keccak256("RepayMUSD(uint256 amount,address borrower,uint256 nonce,uint256 deadline)");

    BallastRepaymentAdapter adapter;
    uint256 borrowerPk = 0xB0B;
    address borrower; // an ordinary Mezo borrower: trove held by their wallet, not a Ballast account
    address payer = makeAddr("payer");
    bool forked;

    function setUp() public {
        string memory rpc = vm.envOr("MEZO_TESTNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;
        _mockOraclePrecompileWithLivePrice();
        adapter = new BallastRepaymentAdapter(BOS, TM, MUSD);
        borrower = vm.addr(borrowerPk);

        vm.deal(borrower, 1 ether);
        vm.prank(borrower);
        IBorrowerOperations(BO).openTrove{value: 0.09 ether}(2100e18, address(0), address(0));

        // payer gets genuine MUSD by opening their own trove
        vm.deal(payer, 1 ether);
        vm.prank(payer);
        IBorrowerOperations(BO).openTrove{value: 0.1 ether}(2000e18, address(0), address(0));
    }

    modifier onlyFork() {
        if (!forked) vm.skip(true);
        _;
    }

    function _mockOraclePrecompileWithLivePrice() internal {
        bytes memory ret = vm.rpc(
            "eth_call", '[{"to":"0x7b7c000000000000000000000000000000000015","data":"0xfeaf968c"},"latest"]'
        );
        (uint80 roundId, int256 answer,,, uint80 answeredInRound) =
            abi.decode(ret, (uint80, int256, uint256, uint256, uint80));
        require(answer > 0, "live oracle answer");
        vm.mockCall(
            ORACLE_PRECOMPILE,
            abi.encodeWithSignature("latestRoundData()"),
            abi.encode(roundId, answer, block.timestamp, block.timestamp, answeredInRound)
        );
        vm.mockCall(ORACLE_PRECOMPILE, abi.encodeWithSignature("decimals()"), abi.encode(uint8(18)));
        if (ORACLE_PRECOMPILE.code.length == 0) vm.etch(ORACLE_PRECOMPILE, hex"00");
    }

    /// Mezo's EIP-712 domain, read from the live contract (not assumed).
    function _mezoDomainSeparator() internal view returns (bytes32) {
        (, string memory name, string memory version, uint256 chainId, address verifying,,) =
            IEIP5267(BOS).eip712Domain();
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                chainId,
                verifying
            )
        );
    }

    function _mezoRepaySig(uint256 pk, address who, uint256 amount, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(abi.encode(REPAY_MUSD_TYPEHASH, amount, who, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _mezoDomainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _repaySig(uint256 amount) internal view returns (BallastRepaymentAdapter.MezoRepaySig memory) {
        uint256 deadline = block.timestamp + 1 hours;
        return BallastRepaymentAdapter.MezoRepaySig({
            deadline: deadline,
            signature: _mezoRepaySig(borrowerPk, borrower, amount, adapter.mezoNonce(borrower), deadline),
            upperHint: address(0),
            lowerHint: address(0)
        });
    }

    function _invoice(bytes32 id, uint256 amount, uint256 repayAmount)
        internal
        view
        returns (BallastRepaymentAdapter.DirectInvoice memory inv, bytes memory sig)
    {
        inv = BallastRepaymentAdapter.DirectInvoice({
            merchant: borrower, invoiceId: id, amount: amount, repayAmount: repayAmount, expiry: block.timestamp + 1 days
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerPk, adapter.invoiceDigest(inv));
        sig = abi.encodePacked(r, s, v);
    }

    // ------------------------------------------------------------------

    function test_fork_wiring() public onlyFork {
        assertEq(address(adapter.borrowerOperations()), BO, "BO read from Mezo signatures contract");
        assertEq(adapter.maxRepayable(makeAddr("nobody")), 0);
        // 2100 + 0.1% fee + 200 gas comp - 200 - 1800
        assertEq(adapter.maxRepayable(borrower), 302.1e18);
    }

    function test_fork_repayWithSignature_fundedByAnotherWallet() public onlyFork {
        uint256 debt0 = ITroveManager(TM).getTroveDebt(borrower);
        uint256 n0 = adapter.mezoNonce(borrower);
        uint256 payer0 = IERC20(MUSD).balanceOf(payer);
        BallastRepaymentAdapter.MezoRepaySig memory s = _repaySig(25e18);

        vm.startPrank(payer);
        IERC20(MUSD).approve(address(adapter), 25e18);
        adapter.repayWithSignature(borrower, 25e18, s);
        vm.stopPrank();

        assertEq(ITroveManager(TM).getTroveDebt(borrower), debt0 - 25e18, "debt -25");
        assertEq(IERC20(MUSD).balanceOf(payer), payer0 - 25e18, "payer -25");
        assertEq(IERC20(MUSD).balanceOf(address(adapter)), 0, "adapter holds nothing");
        assertEq(adapter.mezoNonce(borrower), n0 + 1, "one-off: nonce consumed");

        // the same signature cannot be used again
        vm.startPrank(payer);
        IERC20(MUSD).approve(address(adapter), 25e18);
        vm.expectRevert(bytes("BorrowerOperationsSignatures: Invalid signature"));
        adapter.repayWithSignature(borrower, 25e18, s);
        vm.stopPrank();
    }

    function test_fork_signatureFromWrongKeyRejected() public onlyFork {
        uint256 deadline = block.timestamp + 1 hours;
        BallastRepaymentAdapter.MezoRepaySig memory s = BallastRepaymentAdapter.MezoRepaySig({
            deadline: deadline,
            signature: _mezoRepaySig(0xBAD, borrower, 10e18, adapter.mezoNonce(borrower), deadline),
            upperHint: address(0),
            lowerHint: address(0)
        });
        vm.startPrank(payer);
        IERC20(MUSD).approve(address(adapter), 10e18);
        vm.expectRevert(bytes("BorrowerOperationsSignatures: Invalid signature"));
        adapter.repayWithSignature(borrower, 10e18, s);
        vm.stopPrank();
    }

    function test_fork_directInvoice_splitAndRepay_inOneTx() public onlyFork {
        (BallastRepaymentAdapter.DirectInvoice memory inv, bytes memory isig) = _invoice(keccak256("d-1"), 100e18, 20e18);
        BallastRepaymentAdapter.MezoRepaySig memory rs = _repaySig(20e18);
        uint256 debt0 = ITroveManager(TM).getTroveDebt(borrower);
        uint256 m0 = IERC20(MUSD).balanceOf(borrower);
        uint256 p0 = IERC20(MUSD).balanceOf(payer);

        vm.startPrank(payer);
        IERC20(MUSD).approve(address(adapter), 100e18);
        adapter.payDirectInvoice(inv, isig, rs);
        vm.stopPrank();

        assertEq(IERC20(MUSD).balanceOf(payer), p0 - 100e18, "payer -100");
        assertEq(IERC20(MUSD).balanceOf(borrower), m0 + 80e18, "merchant +80");
        assertEq(ITroveManager(TM).getTroveDebt(borrower), debt0 - 20e18, "debt -20");
        assertEq(IERC20(MUSD).balanceOf(address(adapter)), 0);
        assertTrue(adapter.invoicePaid(adapter.invoiceKey(borrower, inv.invoiceId)));

        vm.startPrank(payer);
        IERC20(MUSD).approve(address(adapter), 100e18);
        vm.expectRevert(BallastRepaymentAdapter.InvoiceAlreadyPaid.selector);
        adapter.payDirectInvoice(inv, isig, rs);
        vm.stopPrank();
    }

    function test_fork_directInvoice_tamperedAmountRejected() public onlyFork {
        (BallastRepaymentAdapter.DirectInvoice memory inv, bytes memory isig) = _invoice(keccak256("d-2"), 100e18, 20e18);
        inv.repayAmount = 0; // payer tries to skip the repayment
        BallastRepaymentAdapter.MezoRepaySig memory rs = _repaySig(20e18); // build before expectRevert (it makes calls)
        vm.startPrank(payer);
        IERC20(MUSD).approve(address(adapter), 100e18);
        vm.expectRevert(BallastRepaymentAdapter.InvalidInvoiceSignature.selector);
        adapter.payDirectInvoice(inv, isig, rs);
        vm.stopPrank();
    }

    function test_fork_directInvoice_failedRepayRevertsEverything() public onlyFork {
        (BallastRepaymentAdapter.DirectInvoice memory inv, bytes memory isig) = _invoice(keccak256("d-3"), 100e18, 20e18);
        BallastRepaymentAdapter.MezoRepaySig memory wrong = _repaySig(19e18); // Mezo signature for another amount
        uint256 p0 = IERC20(MUSD).balanceOf(payer);
        uint256 debt0 = ITroveManager(TM).getTroveDebt(borrower);
        vm.startPrank(payer);
        IERC20(MUSD).approve(address(adapter), 100e18);
        vm.expectRevert(bytes("BorrowerOperationsSignatures: Invalid signature"));
        adapter.payDirectInvoice(inv, isig, wrong);
        vm.stopPrank();
        assertEq(IERC20(MUSD).balanceOf(payer), p0, "no partial state");
        assertEq(ITroveManager(TM).getTroveDebt(borrower), debt0);
        assertFalse(adapter.invoicePaid(adapter.invoiceKey(borrower, inv.invoiceId)));
    }

    function test_fork_directInvoice_beyondFloorReverts() public onlyFork {
        uint256 head = adapter.maxRepayable(borrower);
        (BallastRepaymentAdapter.DirectInvoice memory inv, bytes memory isig) =
            _invoice(keccak256("d-4"), 400e18, head + 1);
        BallastRepaymentAdapter.MezoRepaySig memory rs = _repaySig(head + 1);
        vm.startPrank(payer);
        IERC20(MUSD).approve(address(adapter), 400e18);
        vm.expectRevert(abi.encodeWithSelector(BallastRepaymentAdapter.RepayExceedsHeadroom.selector, head + 1, head));
        adapter.payDirectInvoice(inv, isig, rs);
        vm.stopPrank();
    }

    function test_fork_directInvoice_expiredAndNoRepay() public onlyFork {
        (BallastRepaymentAdapter.DirectInvoice memory inv, bytes memory isig) = _invoice(keccak256("d-5"), 10e18, 0);
        uint256 m0 = IERC20(MUSD).balanceOf(borrower);
        uint256 debt0 = ITroveManager(TM).getTroveDebt(borrower);
        BallastRepaymentAdapter.MezoRepaySig memory none;
        vm.startPrank(payer);
        IERC20(MUSD).approve(address(adapter), 10e18);
        adapter.payDirectInvoice(inv, isig, none); // repayAmount 0: plain payment, no signature needed
        vm.stopPrank();
        assertEq(IERC20(MUSD).balanceOf(borrower), m0 + 10e18);
        assertEq(ITroveManager(TM).getTroveDebt(borrower), debt0);

        (inv, isig) = _invoice(keccak256("d-6"), 10e18, 0);
        vm.warp(inv.expiry + 1);
        _mockOraclePrecompileWithLivePrice();
        vm.startPrank(payer);
        IERC20(MUSD).approve(address(adapter), 10e18);
        vm.expectRevert(BallastRepaymentAdapter.InvoiceExpired.selector);
        adapter.payDirectInvoice(inv, isig, none);
        vm.stopPrank();
    }
}

interface IEIP5267 {
    function eip712Domain()
        external
        view
        returns (bytes1, string memory, string memory, uint256, address, bytes32, uint256[] memory);
}
