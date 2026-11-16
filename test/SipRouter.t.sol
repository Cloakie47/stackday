// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BaseTest} from "./Base.t.sol";
import {EmployeeVault} from "../src/EmployeeVault.sol";
import {SipRouter} from "../src/SipRouter.sol";
import {IPriceAdapter} from "../src/interfaces/IAdapters.sol";

/// Normal users (no employer, no payroll) use the same vault, SIP and borrowing.
contract SipRouterTest is BaseTest {
    SipRouter internal router;
    address internal carol = makeAddr("carol"); // not on any payroll
    address internal keeper = makeAddr("keeper");

    function setUp() public override {
        super.setUp();
        router = new SipRouter(
            IERC20(address(usdc)), factory, swapAdapter, IPriceAdapter(address(priceAdapter)), address(0), 0, 0
        );
        usdc.mint(carol, 10_000 * U);
        vm.prank(carol);
        usdc.approve(address(router), type(uint256).max);
    }

    function test_oneTimeInvest_thenBorrowRepayWithdraw() public {
        vm.prank(carol);
        uint256 out = router.invest(address(stock), 1000 * U, 0);
        EmployeeVault vault = _vault(carol);
        assertEq(vault.owner(), carol);
        assertEq(vault.idleOf(address(stock)), out);
        assertEq(out, router.quoteAtOracle(address(stock), 1000 * U));

        vm.startPrank(carol);
        vault.borrow(address(stock), out, 300 * U, carol);
        assertEq(usdc.balanceOf(carol), 9300 * U);
        usdc.approve(address(vault), type(uint256).max);
        vault.repay(address(stock), type(uint256).max);
        vault.withdraw(address(stock), out, carol);
        vm.stopPrank();
        assertEq(stock.balanceOf(carol), out);
    }

    function test_recurringPlan_runsOncePerInterval_byAnyone() public {
        vm.prank(carol);
        router.setPlan(address(stock), uint96(100 * U), 7 days, 100);

        vm.prank(keeper);
        uint256 out1 = router.executePlan(carol, address(stock));
        assertEq(usdc.balanceOf(carol), 9900 * U);
        assertEq(_vault(carol).idleOf(address(stock)), out1);
        assertEq(stock.balanceOf(keeper), 0, "the keeper gets nothing");

        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(SipRouter.NotDueYet.selector, block.timestamp + 7 days));
        router.executePlan(carol, address(stock));

        vm.warp(block.timestamp + 7 days);
        vm.prank(attacker); // even a stranger can only do what the plan says
        router.executePlan(carol, address(stock));
        assertEq(usdc.balanceOf(carol), 9800 * U);
        assertEq(_vault(carol).idleOf(address(stock)), out1 * 2);
        assertEq(usdc.balanceOf(attacker), 0);
    }

    /// Founder decision (issue #29): a recurring buy stays free even with a loan open.
    function test_recurringPlan_staysFreeWhenLoanOpen() public {
        vm.startPrank(carol);
        uint256 out = router.invest(address(stock), 1000 * U, 0);
        EmployeeVault vault = _vault(carol);
        vault.borrow(address(stock), out, 300 * U, carol);
        router.setPlan(address(stock), uint96(500 * U), 30 days, 100);
        vm.stopPrank();
        uint256 healthBefore = vault.healthFactor(address(stock));
        uint256 collateralBefore = vault.collateralOf(address(stock));
        vm.prank(keeper);
        router.executePlan(carol, address(stock));
        assertGt(vault.idleOf(address(stock)), 0, "the new buy is free in the vault");
        assertEq(vault.collateralOf(address(stock)), collateralBefore, "nothing locked automatically");
        assertEq(vault.healthFactor(address(stock)), healthBefore);
    }

    function test_cancelledOrMissingPlan_cannotRun() public {
        vm.prank(keeper);
        vm.expectRevert(SipRouter.NoPlan.selector);
        router.executePlan(carol, address(stock));

        vm.startPrank(carol);
        router.setPlan(address(stock), uint96(100 * U), 7 days, 100);
        router.cancelPlan(address(stock));
        vm.stopPrank();
        vm.prank(keeper);
        vm.expectRevert(SipRouter.NoPlan.selector);
        router.executePlan(carol, address(stock));
        assertEq(usdc.balanceOf(carol), 10_000 * U);
    }

    function test_planStopsWhenUserRevokesAllowance_orTokenPaused() public {
        vm.startPrank(carol);
        router.setPlan(address(stock), uint96(100 * U), 7 days, 100);
        usdc.approve(address(router), 0);
        vm.stopPrank();
        vm.prank(keeper);
        vm.expectRevert();
        router.executePlan(carol, address(stock));

        vm.prank(carol);
        usdc.approve(address(router), type(uint256).max);
        vm.prank(demoAdmin);
        stock.setTransfersPaused(true);
        vm.prank(keeper);
        vm.expectRevert();
        router.executePlan(carol, address(stock));
        assertEq(usdc.balanceOf(carol), 10_000 * U, "nothing was taken");
        (,,, uint40 nextBuyAt,) = router.planOf(carol, address(stock));
        assertEq(nextBuyAt, block.timestamp, "the buy is still due and can be retried");
    }

    function test_planValidation() public {
        vm.startPrank(carol);
        vm.expectRevert(SipRouter.BadInterval.selector);
        router.setPlan(address(stock), uint96(100 * U), 1 hours, 100);
        vm.expectRevert(SipRouter.BadSlippage.selector);
        router.setPlan(address(stock), uint96(100 * U), 7 days, 1001);
        vm.expectRevert(SipRouter.ZeroAmount.selector);
        router.setPlan(address(stock), 0, 7 days, 100);
        vm.expectRevert(abi.encodeWithSelector(SipRouter.UnsupportedStock.selector, address(usdc)));
        router.setPlan(address(usdc), uint96(100 * U), 7 days, 100);
        vm.expectRevert(abi.encodeWithSelector(SipRouter.UnsupportedStock.selector, address(usdc)));
        router.invest(address(usdc), 100 * U, 0);
        vm.stopPrank();
    }

    function test_routerHoldsNothing() public {
        vm.prank(carol);
        router.invest(address(stock), 1000 * U, 0);
        assertEq(usdc.balanceOf(address(router)), 0);
        assertEq(stock.balanceOf(address(router)), 0);
        assertEq(usdc.allowance(address(router), address(swapAdapter)), 0);
    }

    /// Security: a recurring buy triggered by a stranger must not rely on a frozen (stale) price.
    function test_recurringBuy_refusesStalePrice_whenGuardIsOn() public {
        SipRouter guarded = new SipRouter(
            IERC20(address(usdc)), factory, swapAdapter, IPriceAdapter(address(priceAdapter)), address(0), 0, 26 hours
        );
        vm.startPrank(carol);
        usdc.approve(address(guarded), type(uint256).max);
        guarded.setPlan(address(stock), uint96(100 * U), 7 days, 100);
        vm.stopPrank();

        // Fresh price: the buy runs.
        vm.prank(keeper);
        guarded.executePlan(carol, address(stock));

        // A week later the feed has not moved (long market closure): the buy is refused, nothing is taken.
        (,,, uint256 updatedAt,) = feed.latestRoundData();
        vm.warp(block.timestamp + 7 days);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(SipRouter.StalePrice.selector, updatedAt));
        guarded.executePlan(carol, address(stock));
        assertEq(usdc.balanceOf(carol), 9900 * U);

        // The price updates again: the buy goes through.
        _setPrice(PRICE);
        vm.prank(keeper);
        guarded.executePlan(carol, address(stock));
        assertEq(usdc.balanceOf(carol), 9800 * U);

        // One-time buys are made by the user with their own minimum, so they are not blocked.
        vm.warp(block.timestamp + 3 days);
        vm.prank(carol);
        guarded.invest(address(stock), 100 * U, 0);
    }
}
