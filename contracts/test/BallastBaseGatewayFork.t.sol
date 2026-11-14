// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BallastBaseGateway} from "../src/BallastBaseGateway.sol";

/// @notice Runs against a fork of LIVE Base Sepolia state: the real MUSD token and its real NTT manager.
///         Skipped unless BASE_SEPOLIA_RPC_URL is set. Never broadcasts.
contract BallastBaseGatewayForkTest is Test {
    // Verified on-chain 2026-11-14 (docs/VERIFICATION.md)
    address constant MUSD = 0x560985f804De8187E8FBA94F7127Bc4c0e54AEA5;
    address constant NTT = 0x6590DFF6abEd7C077839E8227A4f12Ec90E6D85F;
    uint16 constant MEZO = 50;
    address constant ACCOUNT_ON_MEZO = 0x1Ed5B7462545b4639d70fE18A300Bdbdb55910e0;

    BallastBaseGateway gw;
    address payer = makeAddr("payer");
    bool forked;

    event BasePayment(
        address indexed account, bytes32 indexed paymentReference, address indexed payer, uint256 amount, uint64 nttSequence
    );

    function setUp() public {
        string memory rpc = vm.envOr("BASE_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;
        gw = new BallastBaseGateway(MUSD, NTT, MEZO);
        deal(MUSD, payer, 100e18);
        vm.deal(payer, 1 ether);
    }

    modifier onlyFork() {
        if (!forked) vm.skip(true);
        _;
    }

    function test_fork_pay_burnsPayerMusdThroughRealNtt() public onlyFork {
        uint256 supply0 = IERC20(MUSD).totalSupply();
        vm.startPrank(payer);
        IERC20(MUSD).approve(address(gw), 5e18);
        vm.expectEmit(true, true, true, false);
        emit BasePayment(ACCOUNT_ON_MEZO, bytes32("inv-1"), payer, 5e18, 0);
        gw.pay(ACCOUNT_ON_MEZO, 5e18, bytes32("inv-1"));
        vm.stopPrank();
        assertEq(IERC20(MUSD).balanceOf(payer), 95e18, "payer -5");
        assertEq(IERC20(MUSD).balanceOf(address(gw)), 0, "gateway holds nothing");
        assertEq(IERC20(MUSD).allowance(address(gw), NTT), 0, "no standing approval");
        assertEq(supply0 - IERC20(MUSD).totalSupply(), 5e18, "burning-mode manager burned the MUSD on Base");
    }

    function test_fork_refundsUnusedNativeFee() public onlyFork {
        vm.startPrank(payer);
        IERC20(MUSD).approve(address(gw), 1e18);
        uint256 eth0 = payer.balance;
        gw.pay{value: 0.01 ether}(ACCOUNT_ON_MEZO, 1e18, bytes32(0));
        vm.stopPrank();
        assertEq(address(gw).balance, 0);
        assertEq(payer.balance, eth0, "Wormhole message fee is 0 on Base Sepolia: all native returned");
    }

    function test_fork_rejectsZeroDustAndZeroAccount() public onlyFork {
        vm.startPrank(payer);
        IERC20(MUSD).approve(address(gw), 10e18);
        vm.expectRevert(BallastBaseGateway.ZeroAmount.selector);
        gw.pay(ACCOUNT_ON_MEZO, 0, bytes32(0));
        vm.expectRevert(BallastBaseGateway.ZeroAccount.selector);
        gw.pay(address(0), 1e18, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(BallastBaseGateway.AmountHasDust.selector, 1e18 + 1));
        gw.pay(ACCOUNT_ON_MEZO, 1e18 + 1, bytes32(0));
        vm.stopPrank();
        assertEq(IERC20(MUSD).balanceOf(payer), 100e18);
    }

    function test_fork_withoutAllowanceReverts() public onlyFork {
        vm.prank(payer);
        vm.expectRevert();
        gw.pay(ACCOUNT_ON_MEZO, 1e18, bytes32(0));
    }
}
