// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BaseTest} from "./Base.t.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {EmployeeVault} from "../src/EmployeeVault.sol";
import {Payroll} from "../src/Payroll.sol";
import {SipRouter} from "../src/SipRouter.sol";
import {ChainlinkPriceAdapter} from "../src/adapters/ChainlinkPriceAdapter.sol";
import {IPriceAdapter} from "../src/interfaces/IAdapters.sol";
import {MockStockToken, MockPriceFeed, MockSwapAdapter} from "../src/mocks/Mocks.sol";

/// Invest-only assets (issue #60): listed with no lending market. They can be bought (one-time,
/// recurring and from pay), held and withdrawn, but never locked or borrowed against.
contract InvestOnlyTest is BaseTest {
    MockStockToken internal fund; // an S&P 500 fund token, 18 decimals
    VaultFactory internal f2;
    Payroll internal p2;
    SipRouter internal r2;
    MockSwapAdapter internal swap2;

    function setUp() public override {
        super.setUp();
        vm.startPrank(deployer);
        fund = new MockStockToken("Mock S&P 500 fund", "mSPX", 18, demoAdmin);
        MockPriceFeed fundFeed = new MockPriceFeed(742e8, demoAdmin);
        address[] memory tokens = new address[](3);
        address[] memory feeds = new address[](3);
        address[] memory adapters = new address[](3);
        (tokens[0], feeds[0], adapters[0]) = (address(stock), address(feed), address(adapter));
        (tokens[1], feeds[1], adapters[1]) = (address(eth), address(ethFeed), address(ethAdapter));
        (tokens[2], feeds[2], adapters[2]) = (address(fund), address(fundFeed), address(0)); // invest only
        ChainlinkPriceAdapter prices = new ChainlinkPriceAdapter(tokens, feeds);
        f2 = new VaultFactory(tokens, adapters, address(yieldAdapter), address(0), 0, 0);
        swap2 = new MockSwapAdapter(IERC20(address(usdc)), IPriceAdapter(address(prices)), demoAdmin);
        p2 = new Payroll(IERC20(address(usdc)), f2, swap2, address(0), 0, 1 days);
        r2 = new SipRouter(IERC20(address(usdc)), f2, swap2, IPriceAdapter(address(prices)), address(0), 0, 0);
        vm.stopPrank();
        vm.startPrank(demoAdmin);
        fund.setMinter(address(swap2), true);
        stock.setMinter(address(swap2), true);
        vm.stopPrank();
        usdc.mint(alice, 10_000 * U);
        vm.prank(alice);
        usdc.approve(address(r2), type(uint256).max);
        vm.prank(employer);
        usdc.approve(address(p2), type(uint256).max);
    }

    function test_listedWithoutALendingMarket() public view {
        assertTrue(f2.isSupported(address(fund)));
        assertEq(f2.lendingAdapterOf(address(fund)), address(0));
        assertTrue(f2.isSupported(address(stock)));
        assertEq(f2.stockCount(), 3);
    }

    function test_oneTimeBuy_holdAndWithdraw() public {
        vm.prank(alice);
        uint256 out = r2.invest(address(fund), 742 * U, 0);
        assertApproxEqRel(out, 1e18, 0.01e18, "about one fund token for its price");
        EmployeeVault v = EmployeeVault(f2.vaultOf(alice));
        assertEq(v.idleOf(address(fund)), out);
        vm.prank(alice);
        v.withdraw(address(fund), out, aliceBank);
        assertEq(fund.balanceOf(aliceBank), out);
    }

    function test_recurringBuy_works() public {
        vm.prank(alice);
        r2.setPlan(address(fund), uint96(100 * U), 7 days, 100, 0);
        r2.executePlan(alice, address(fund));
        assertGt(EmployeeVault(f2.vaultOf(alice)).idleOf(address(fund)), 0);
    }

    function test_payday_splitAcrossBorrowableAndInvestOnly() public {
        address[] memory employees = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        employees[0] = alice;
        amounts[0] = 5000 * U;
        vm.prank(employer);
        uint256 runId = p2.depositAndCreateRun(5000 * U, employees, amounts);
        address[] memory assets = new address[](2);
        uint16[] memory bps = new uint16[](2);
        uint256[] memory mins = new uint256[](2);
        (assets[0], bps[0]) = (address(stock), 1000);
        (assets[1], bps[1]) = (address(fund), 1000);
        vm.prank(alice);
        p2.claimWithSipMany(runId, aliceBank, assets, bps, mins);
        EmployeeVault v = EmployeeVault(f2.vaultOf(alice));
        assertGt(v.idleOf(address(stock)), 0);
        assertGt(v.idleOf(address(fund)), 0);
        assertEq(usdc.balanceOf(aliceBank), 4000 * U, "80% paid out");
    }

    function test_cannotBeLockedOrBorrowedAgainst() public {
        vm.prank(alice);
        r2.invest(address(fund), 742 * U, 0);
        EmployeeVault v = EmployeeVault(f2.vaultOf(alice));
        uint256 bal = v.idleOf(address(fund));
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(EmployeeVault.UnsupportedStock.selector, address(fund)));
        v.addCollateral(address(fund), bal);
        vm.expectRevert(abi.encodeWithSelector(EmployeeVault.UnsupportedStock.selector, address(fund)));
        v.borrow(address(fund), 0, 1 * U, alice);
        vm.stopPrank();
    }

    function test_emergencyRule_needsABorrowableAsset() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Payroll.UnsupportedStock.selector, address(fund)));
        p2.setEmergencyRule(address(fund), 2000, 1.2e18);
    }

    function test_unlistedTokenIsStillRejected() public {
        MockStockToken other = new MockStockToken("Other", "OTH", 18, demoAdmin);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SipRouter.UnsupportedStock.selector, address(other)));
        r2.invest(address(other), 10 * U, 0);
        EmployeeVault bobVault = EmployeeVault(f2.createVault(bob));
        vm.expectRevert(abi.encodeWithSelector(EmployeeVault.UnsupportedStock.selector, address(other)));
        bobVault.depositStock(address(other), 1);
    }

    function test_factoryRejectsDuplicatesAndZero() public {
        address[] memory tokens = new address[](2);
        address[] memory adapters = new address[](2);
        tokens[0] = address(fund);
        tokens[1] = address(fund);
        vm.expectRevert(abi.encodeWithSelector(VaultFactory.DuplicateStock.selector, address(fund)));
        new VaultFactory(tokens, adapters, address(0), address(0), 0, 0);
        tokens[1] = address(0);
        vm.expectRevert(VaultFactory.ZeroAddress.selector);
        new VaultFactory(tokens, adapters, address(0), address(0), 0, 0);
    }
}
