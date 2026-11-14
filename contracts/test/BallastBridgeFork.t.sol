// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {BallastFactory} from "../src/BallastFactory.sol";
import {BallastAccountNFT} from "../src/BallastAccountNFT.sol";
import {BallastAccount} from "../src/BallastAccount.sol";
import {BallastRouter} from "../src/BallastRouter.sol";
import {BallastBridgeReceiver} from "../src/BallastBridgeReceiver.sol";
import {IWormholeTokenBridge} from "../interfaces/IExternal.sol";
import {ITroveManager, IBorrowerOperations} from "../interfaces/IMezo.sol";

/// Stand-in for the bridged USDC (6 decimals, like Wormhole-wrapped USDC).
contract TestUSDC is ERC20 {
    constructor() ERC20("Wrapped USDC (test)", "wUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }
}

/// Stand-in for the Wormhole Token Bridge's completeTransferWithPayload: guardian-signed VAAs cannot be produced on
/// a fork, so this mimics the verified behaviour that matters to the receiver (only `to` may redeem, once; mints the
/// wrapped token to `to`; returns the transfer). Everything else in the test (pool, swap, Ballast, Mezo) is real.
contract FakeTokenBridge {
    TestUSDC public immutable wusdc;
    uint16 public constant SOURCE = 10004;
    bytes32 public immutable sourceToken;
    mapping(bytes32 => bool) public done;

    constructor(TestUSDC w, bytes32 src) {
        wusdc = w;
        sourceToken = src;
    }

    function chainId() external pure returns (uint16) {
        return 50;
    }

    function wrappedAsset(uint16 c, bytes32 a) external view returns (address) {
        return c == SOURCE && a == sourceToken ? address(wusdc) : address(0);
    }

    function completeTransferWithPayload(bytes memory vm) external returns (bytes memory) {
        IWormholeTokenBridge.TransferWithPayload memory t = abi.decode(vm, (IWormholeTokenBridge.TransferWithPayload));
        require(msg.sender == address(uint160(uint256(t.to))), "invalid sender");
        require(!done[keccak256(vm)], "transfer already completed");
        done[keccak256(vm)] = true;
        wusdc.mint(msg.sender, t.amount);
        return vm;
    }

    function parseTransferWithPayload(bytes memory e) external pure returns (IWormholeTokenBridge.TransferWithPayload memory) {
        return abi.decode(e, (IWormholeTokenBridge.TransferWithPayload));
    }
}

interface IPoolFactoryLite {
    function createPool(address a, address b, bool stable) external returns (address);
}

interface IPoolsRouterLiq {
    function addLiquidity(address a, address b, bool stable, uint256 ad, uint256 bd, uint256 am, uint256 bm, address to, uint256 dl)
        external
        returns (uint256, uint256, uint256);
}

contract BallastBridgeForkTest is Test {
    address constant BO = 0xCdF7028ceAB81fA0C6971208e83fa7872994beE5;
    address constant TM = 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0;
    address constant MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;
    address constant POOLS_ROUTER = 0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9;
    address constant POOL_FACTORY = 0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A;
    address constant ORACLE_PRECOMPILE = 0x7b7c000000000000000000000000000000000015;
    bytes32 constant BASE_USDC = bytes32(uint256(uint160(0x036CbD53842c5426634e7929541eC2318f3dCF7e)));

    BallastFactory factory;
    BallastRouter router;
    BallastAccount account;
    uint256 tokenId;
    TestUSDC wusdc;
    FakeTokenBridge bridge;
    BallastBridgeReceiver receiver;
    uint256 merchantPk = 0xA11CE;
    address merchant;
    address payout = makeAddr("payout");
    address customer = makeAddr("customerOnMezo");
    bool forked;
    uint256 seq;

    function setUp() public {
        string memory rpc = vm.envOr("MEZO_TESTNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;
        _mockOracle();
        merchant = vm.addr(merchantPk);

        address me = address(this);
        uint256 n = vm.getNonce(me);
        address predFactory = vm.computeCreateAddress(me, n + 2);
        router = new BallastRouter(predFactory, MUSD);
        BallastAccountNFT nft = new BallastAccountNFT(predFactory);
        factory = new BallastFactory(address(nft), address(router), BO, TM, MUSD);

        vm.deal(merchant, 1 ether);
        vm.startPrank(merchant);
        address a;
        (tokenId, a) = factory.createAccount();
        account = BallastAccount(payable(a));
        account.openTrove{value: 0.09 ether}(2100e18, address(0), address(0));
        account.setPolicy(2000, 500, false, payout);
        vm.stopPrank();

        wusdc = new TestUSDC();
        bridge = new FakeTokenBridge(wusdc, BASE_USDC);
        receiver = new BallastBridgeReceiver(address(bridge), 10004, BASE_USDC, POOLS_ROUTER, POOL_FACTORY, MUSD, address(router));

        // Create + seed a REAL Mezo Pools stable pool wUSDC/MUSD (as will be done on testnet).
        IPoolFactoryLite(POOL_FACTORY).createPool(address(wusdc), MUSD, true);
        address lp = makeAddr("lp");
        vm.deal(lp, 1 ether);
        vm.prank(lp);
        IBorrowerOperations(BO).openTrove{value: 0.1 ether}(2000e18, address(0), address(0));
        wusdc.mint(lp, 1000e6);
        vm.startPrank(lp);
        wusdc.approve(POOLS_ROUTER, type(uint256).max);
        IERC20(MUSD).approve(POOLS_ROUTER, type(uint256).max);
        IPoolsRouterLiq(POOLS_ROUTER).addLiquidity(address(wusdc), MUSD, true, 1000e6, 1000e18, 0, 0, lp, block.timestamp);
        vm.stopPrank();
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
        vm.mockCall(
            ORACLE_PRECOMPILE,
            abi.encodeWithSignature("latestRoundData()"),
            abi.encode(roundId, answer, block.timestamp, block.timestamp, answeredInRound)
        );
        vm.mockCall(ORACLE_PRECOMPILE, abi.encodeWithSignature("decimals()"), abi.encode(uint8(18)));
        if (ORACLE_PRECOMPILE.code.length == 0) vm.etch(ORACLE_PRECOMPILE, hex"00");
    }

    function _invoice(bytes32 id, uint256 amount, uint256 expiry) internal view returns (BallastRouter.Invoice memory inv, bytes memory sig) {
        inv = BallastRouter.Invoice({tokenId: tokenId, invoiceId: id, amount: amount, expiry: expiry});
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(merchantPk, router.invoiceDigest(inv));
        sig = abi.encodePacked(r, s, v);
    }

    function _vaa(uint256 usdc, bytes32 token, BallastBridgeReceiver.BridgePayload memory p) internal returns (bytes memory) {
        seq++;
        return abi.encode(
            IWormholeTokenBridge.TransferWithPayload({
                payloadID: 3,
                amount: usdc,
                tokenAddress: token,
                tokenChain: 10004,
                to: bytes32(uint256(uint160(address(receiver)))),
                toChain: 50,
                fromAddress: bytes32(uint256(uint160(customer)) + seq),
                payload: abi.encode(p)
            })
        );
    }

    function _payload(BallastRouter.Invoice memory inv, bytes memory sig, uint256 minOut)
        internal
        view
        returns (BallastBridgeReceiver.BridgePayload memory)
    {
        return BallastBridgeReceiver.BridgePayload({version: 1, invoice: inv, invoiceSig: sig, refundTo: customer, minMusdOut: minOut});
    }

    function test_fork_bridgedUsdc_swapped_split_repaid_inOneTx() public onlyFork {
        (BallastRouter.Invoice memory inv, bytes memory sig) = _invoice(keccak256("b-1"), 100e18, block.timestamp + 1 days);
        bytes memory vm_ = _vaa(101e6, BASE_USDC, _payload(inv, sig, 100e18));
        uint256 debt0 = ITroveManager(TM).getTroveDebt(address(account));

        receiver.settle(vm_, address(0), address(0));

        assertEq(IERC20(MUSD).balanceOf(payout), 75e18, "spendable 75");
        assertEq(account.hedgeReserve(), 5e18, "reserve 5");
        assertEq(ITroveManager(TM).getTroveDebt(address(account)), debt0 - 20e18, "Mezo debt -20");
        assertTrue(router.invoicePaid(tokenId, inv.invoiceId));
        uint256 change = IERC20(MUSD).balanceOf(customer);
        assertGt(change, 0, "change above 100 MUSD returned");
        assertLt(change, 1e18);
        assertEq(IERC20(MUSD).balanceOf(address(receiver)), 0);
        assertEq(wusdc.balanceOf(address(receiver)), 0);

        vm.expectRevert(bytes("transfer already completed"));
        receiver.settle(vm_, address(0), address(0));
    }

    function test_fork_expiredInvoice_refundsMUSD_noPartialState() public onlyFork {
        (BallastRouter.Invoice memory inv, bytes memory sig) = _invoice(keccak256("b-2"), 50e18, block.timestamp - 1);
        uint256 debt0 = ITroveManager(TM).getTroveDebt(address(account));
        receiver.settle(_vaa(51e6, BASE_USDC, _payload(inv, sig, 50e18)), address(0), address(0));
        assertFalse(router.invoicePaid(tokenId, inv.invoiceId));
        assertEq(ITroveManager(TM).getTroveDebt(address(account)), debt0, "no repayment");
        assertGt(IERC20(MUSD).balanceOf(customer), 50e18, "customer refunded all MUSD");
        assertEq(IERC20(MUSD).balanceOf(payout), 0);
    }

    function test_fork_slippage_refundsUSDC() public onlyFork {
        (BallastRouter.Invoice memory inv, bytes memory sig) = _invoice(keccak256("b-3"), 100e18, block.timestamp + 1 days);
        receiver.settle(_vaa(100e6, BASE_USDC, _payload(inv, sig, 200e18)), address(0), address(0));
        assertEq(wusdc.balanceOf(customer), 100e6, "USDC refunded when swap min not met");
        assertFalse(router.invoicePaid(tokenId, inv.invoiceId));
    }

    function test_fork_underpaid_refundsMUSD() public onlyFork {
        (BallastRouter.Invoice memory inv, bytes memory sig) = _invoice(keccak256("b-4"), 100e18, block.timestamp + 1 days);
        receiver.settle(_vaa(90e6, BASE_USDC, _payload(inv, sig, 0)), address(0), address(0));
        assertFalse(router.invoicePaid(tokenId, inv.invoiceId));
        assertGt(IERC20(MUSD).balanceOf(customer), 89e18);
    }

    function test_fork_tamperedInvoice_refunds() public onlyFork {
        (BallastRouter.Invoice memory inv, bytes memory sig) = _invoice(keccak256("b-5"), 100e18, block.timestamp + 1 days);
        inv.amount = 1e18; // customer tries to pay less than the merchant signed
        receiver.settle(_vaa(2e6, BASE_USDC, _payload(inv, sig, 0)), address(0), address(0));
        assertFalse(router.invoicePaid(tokenId, inv.invoiceId));
        assertGt(IERC20(MUSD).balanceOf(customer), 1e18);
    }

    function test_fork_onlyReceiverCanRedeem() public onlyFork {
        (BallastRouter.Invoice memory inv, bytes memory sig) = _invoice(keccak256("b-6"), 10e18, block.timestamp + 1 days);
        bytes memory vm_ = _vaa(11e6, BASE_USDC, _payload(inv, sig, 0));
        vm.expectRevert(bytes("invalid sender"));
        bridge.completeTransferWithPayload(vm_);
    }

    function test_fork_starvedGas_reverts_notRefunds() public onlyFork {
        (BallastRouter.Invoice memory inv, bytes memory sig) = _invoice(keccak256("b-7"), 10e18, block.timestamp + 1 days);
        bytes memory vm_ = _vaa(11e6, BASE_USDC, _payload(inv, sig, 0));
        vm.expectRevert();
        receiver.settle{gas: 1_500_000}(vm_, address(0), address(0));
        assertFalse(router.invoicePaid(tokenId, inv.invoiceId));
    }
}
