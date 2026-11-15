// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BaseTest} from "./Base.t.sol";
import {EmployeeVault} from "../src/EmployeeVault.sol";
import {Payroll} from "../src/Payroll.sol";
import {SipRouter} from "../src/SipRouter.sol";
import {IPriceAdapter} from "../src/interfaces/IAdapters.sol";

/// Recurring payroll: fund the treasury once, set a timeframe, and paydays keep coming.
contract RecurringPayrollTest is BaseTest {
    address internal keeper = makeAddr("keeper");

    function _team() internal view returns (address[] memory employees, uint256[] memory amounts) {
        employees = new address[](2);
        amounts = new uint256[](2);
        employees[0] = alice;
        employees[1] = bob;
        amounts[0] = 1000 * U;
        amounts[1] = 500 * U;
    }

    function _schedule(uint32 interval) internal returns (uint256 id) {
        (address[] memory employees, uint256[] memory amounts) = _team();
        vm.prank(employer);
        id = payroll.createSchedule(employees, amounts, interval, 0);
    }

    function test_weeklySchedule_paysEveryWeek_whileTreasuryIsFunded() public {
        vm.prank(employer);
        payroll.deposit(10_000 * U);
        uint256 id = _schedule(7 days);

        // First payday is due immediately. Anyone can release it.
        assertTrue(payroll.scheduleDue(id));
        vm.prank(keeper);
        uint256 run1 = payroll.runSchedule(id);
        assertEq(payroll.claimable(run1, alice), 1000 * U);
        assertEq(payroll.claimable(run1, bob), 500 * U);
        assertEq(payroll.employerBalance(employer), 8500 * U);

        // Not due again until a week has passed.
        assertFalse(payroll.scheduleDue(id));
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(Payroll.NotDueYet.selector, block.timestamp + 7 days));
        payroll.runSchedule(id);

        // Weeks 2, 3 and 4.
        for (uint256 week = 1; week <= 3; ++week) {
            vm.warp(block.timestamp + 7 days);
            vm.prank(alice); // an employee can release their own payday
            payroll.runSchedule(id);
        }
        assertEq(payroll.totalClaimable(alice), 4000 * U);
        assertEq(payroll.employerBalance(employer), 4000 * U);

        // The employee claims a scheduled payday exactly like any other, SIP share included.
        vm.prank(alice);
        payroll.claimWithSip(run1, aliceBank, address(stock), 1000, 0);
        assertEq(usdc.balanceOf(aliceBank), 900 * U);
        assertEq(payroll.schedulesOfEmployee(alice)[0], id);
        assertEq(payroll.schedulesOfEmployer(employer)[0], id);
    }

    function test_dailyAndMonthlySchedules() public {
        vm.prank(employer);
        payroll.deposit(100_000 * U);
        uint256 daily = _schedule(1 days);
        uint256 monthly = _schedule(30 days);
        payroll.runSchedule(daily);
        payroll.runSchedule(monthly);
        vm.warp(block.timestamp + 1 days);
        payroll.runSchedule(daily);
        vm.expectRevert();
        payroll.runSchedule(monthly);
        vm.warp(block.timestamp + 29 days);
        payroll.runSchedule(monthly);
        (, uint32 interval, uint40 nextPayAt, bool active, uint256 total,,) = payroll.getSchedule(monthly);
        assertEq(interval, 30 days);
        assertTrue(active);
        assertEq(total, 1500 * U);
        assertEq(nextPayAt, block.timestamp + 30 days);
    }

    function test_emptyTreasury_paydayWaits_thenCatchesUp() public {
        vm.prank(employer);
        payroll.deposit(1500 * U); // enough for exactly one payday
        uint256 id = _schedule(7 days);
        payroll.runSchedule(id);

        vm.warp(block.timestamp + 15 days); // two paydays are now overdue
        assertFalse(payroll.scheduleDue(id), "not payable: treasury is empty");
        vm.expectRevert(Payroll.InsufficientBalance.selector);
        payroll.runSchedule(id);

        // The employer tops up. The missed paydays are paid one call at a time.
        vm.prank(employer);
        payroll.deposit(3000 * U);
        payroll.runSchedule(id);
        payroll.runSchedule(id);
        vm.expectRevert();
        payroll.runSchedule(id);
        assertEq(payroll.totalClaimable(alice), 3000 * U);
        assertEq(payroll.employerBalance(employer), 0);
    }

    function test_pauseAndResume_onlyEmployer_noBackPayForPausedTime() public {
        vm.prank(employer);
        payroll.deposit(10_000 * U);
        uint256 id = _schedule(7 days);
        payroll.runSchedule(id);

        vm.prank(attacker);
        vm.expectRevert(Payroll.NotEmployer.selector);
        payroll.setScheduleActive(id, false);

        vm.prank(employer);
        payroll.setScheduleActive(id, false);
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert(Payroll.ScheduleNotActive.selector);
        payroll.runSchedule(id);

        vm.prank(employer);
        payroll.setScheduleActive(id, true);
        payroll.runSchedule(id); // one payday on resume
        vm.expectRevert();
        payroll.runSchedule(id); // but not four weeks of back pay
        assertEq(payroll.totalClaimable(alice), 2000 * U);
    }

    function test_scheduleCannotSpendAnotherEmployersTreasury() public {
        vm.prank(employer);
        payroll.deposit(10_000 * U);
        (address[] memory employees, uint256[] memory amounts) = _team();
        employees[0] = attacker;
        vm.prank(attacker);
        uint256 id = payroll.createSchedule(employees, amounts, 1 days, 0);
        vm.prank(attacker);
        vm.expectRevert(Payroll.InsufficientBalance.selector);
        payroll.runSchedule(id);
        assertEq(payroll.employerBalance(employer), 10_000 * U);
    }

    function test_scheduleValidation() public {
        (address[] memory employees, uint256[] memory amounts) = _team();
        vm.startPrank(employer);
        vm.expectRevert(Payroll.BadInterval.selector);
        payroll.createSchedule(employees, amounts, 1 hours, 0);
        amounts[1] = 0;
        vm.expectRevert(Payroll.ZeroAmount.selector);
        payroll.createSchedule(employees, amounts, 1 days, 0);
        amounts[1] = 1;
        employees[1] = address(0);
        vm.expectRevert(Payroll.ZeroAddress.selector);
        payroll.createSchedule(employees, amounts, 1 days, 0);
        vm.stopPrank();
    }

    function test_firstPaydayCanBeInTheFuture() public {
        vm.prank(employer);
        payroll.deposit(10_000 * U);
        (address[] memory employees, uint256[] memory amounts) = _team();
        vm.prank(employer);
        uint256 id = payroll.createSchedule(employees, amounts, 7 days, uint40(block.timestamp + 3 days));
        vm.expectRevert();
        payroll.runSchedule(id);
        vm.warp(block.timestamp + 3 days);
        payroll.runSchedule(id);
    }
}

/// SIP shares across several assets: stocks and also BTC or ETH tokens.
contract MultiAssetSipTest is BaseTest {
    function _two(uint16 a, uint16 b) internal view returns (address[] memory assets, uint16[] memory bps) {
        assets = new address[](2);
        bps = new uint16[](2);
        assets[0] = address(stock);
        assets[1] = address(eth);
        bps[0] = a;
        bps[1] = b;
    }

    function test_oneTimeClaim_splitAcrossStockAndEth() public {
        uint256 runId = _payday(5000 * U, 3000 * U);
        (address[] memory assets, uint16[] memory bps) = _two(1000, 2000);
        uint256[] memory minOuts = new uint256[](2);
        vm.prank(alice);
        payroll.claimWithSipMany(runId, aliceBank, assets, bps, minOuts);

        assertEq(usdc.balanceOf(aliceBank), 3500 * U, "70% in cash");
        EmployeeVault vault = _vault(alice);
        assertEq(vault.idleOf(address(stock)), swapAdapter.quote(address(stock), 500 * U));
        // 1,000 USDC of an 18-decimal token priced at 3,500 USD
        assertEq(vault.idleOf(address(eth)), (1000 * 1e18) / uint256(3500));
        assertEq(eth.decimals(), 18);
    }

    function test_standingPlan_acrossAssets_everyPayday_andVisible() public {
        (address[] memory assets, uint16[] memory bps) = _two(1000, 500);
        vm.prank(alice);
        payroll.setSipPlanMany(assets, bps);
        (address[] memory planAssets, uint16[] memory planBps) = payroll.sipPlan(alice);
        assertEq(planAssets.length, 2);
        assertEq(planAssets[1], address(eth));
        assertEq(planBps[0], 1000);
        assertEq(planBps[1], 500);

        uint256[] memory minOuts = new uint256[](2);
        for (uint256 i; i < 2; ++i) {
            uint256 runId = _payday(4000 * U, 1000 * U);
            vm.prank(alice);
            payroll.claimMany(runId, aliceBank, minOuts);
        }
        assertEq(usdc.balanceOf(aliceBank), 2 * 3400 * U);
        assertEq(_vault(alice).idleOf(address(stock)), 2 * swapAdapter.quote(address(stock), 400 * U));
        assertEq(_vault(alice).idleOf(address(eth)), 2 * swapAdapter.quote(address(eth), 200 * U));

        // Switching the plan off.
        vm.prank(alice);
        payroll.setSipPlan(address(0), 0);
        (planAssets,) = payroll.sipPlan(alice);
        assertEq(planAssets.length, 0);
    }

    function test_oneAssetFails_theOtherStillBuys_restPaidInCash() public {
        vm.prank(demoAdmin);
        stock.setTransfersPaused(true); // the stock leg cannot run
        uint256 runId = _payday(5000 * U, 3000 * U);
        (address[] memory assets, uint16[] memory bps) = _two(1000, 2000);
        uint256[] memory minOuts = new uint256[](2);
        vm.prank(alice);
        payroll.claimWithSipMany(runId, aliceBank, assets, bps, minOuts);
        assertEq(usdc.balanceOf(aliceBank), 4000 * U, "the failed 10% came back as cash");
        assertEq(_vault(alice).idleOf(address(eth)), swapAdapter.quote(address(eth), 1000 * U));
        assertEq(stock.balanceOf(address(_vault(alice))), 0);
    }

    function test_planValidation() public {
        vm.startPrank(alice);
        (address[] memory assets, uint16[] memory bps) = _two(6000, 5000);
        vm.expectRevert(Payroll.BpsTooHigh.selector);
        payroll.setSipPlanMany(assets, bps);
        (assets, bps) = _two(1000, 0);
        vm.expectRevert(Payroll.ZeroAmount.selector);
        payroll.setSipPlanMany(assets, bps);
        (assets, bps) = _two(1000, 1000);
        assets[1] = address(usdc);
        vm.expectRevert(abi.encodeWithSelector(Payroll.UnsupportedStock.selector, address(usdc)));
        payroll.setSipPlanMany(assets, bps);
        address[] memory many = new address[](7);
        uint16[] memory manyBps = new uint16[](7);
        vm.expectRevert(Payroll.TooManyAllocations.selector);
        payroll.setSipPlanMany(many, manyBps);
        vm.stopPrank();
    }

    /// Borrowing works the same against an 18-decimal asset in its own (86%) market.
    function test_borrowAgainstEth_ownMarket_ownLimit() public {
        uint256 runId = _payday(5000 * U, 3000 * U);
        vm.prank(alice);
        payroll.claimWithSip(runId, aliceBank, address(eth), 2000, 0); // 1,000 USDC of ETH
        EmployeeVault vault = _vault(alice);
        uint256 idle = vault.idleOf(address(eth));

        vm.startPrank(alice);
        // limit = 1,000 * 86% * 50% = 430
        vm.expectRevert();
        vault.borrow(address(eth), idle, 440 * U, aliceBank);
        vault.borrow(address(eth), idle, 420 * U, aliceBank);
        vm.stopPrank();
        assertApproxEqRel(vault.healthFactor(address(eth)), 2.047e18, 2e15);
        assertEq(vault.debtOf(address(stock)), 0, "the stock market is untouched");
        assertEq(ethAdapter.liquidationLtv(), ETH_LLTV);

        vm.startPrank(aliceBank);
        usdc.approve(address(vault), type(uint256).max);
        vault.repay(address(eth), type(uint256).max);
        vm.stopPrank();
        vm.prank(alice);
        vault.withdraw(address(eth), idle, alice);
        assertEq(eth.balanceOf(alice), idle);
    }

    /// With the emergency rule active, the whole SIP share of that payday goes to the risky loan's asset.
    function test_emergencyRule_redirectsMultiAssetPlan() public {
        (address[] memory assets, uint16[] memory bps) = _two(500, 500);
        vm.startPrank(alice);
        payroll.setSipPlanMany(assets, bps);
        payroll.setEmergencyRule(address(stock), 4000, 1.5e18);
        vm.stopPrank();

        EmployeeVault vault = _aliceWithLoan(312 * U);
        _setPrice(200e8);
        assertTrue(payroll.emergencyActive(alice));
        uint256 ethBefore = vault.idleOf(address(eth));
        uint256 collateralBefore = vault.collateralOf(address(stock));

        uint256 runId = _payday(1000 * U, 1000 * U);
        uint256 bankBefore = usdc.balanceOf(aliceBank);
        uint256[] memory minOuts = new uint256[](2);
        vm.prank(alice);
        payroll.claimMany(runId, aliceBank, minOuts);
        assertEq(usdc.balanceOf(aliceBank) - bankBefore, 600 * U, "40% redirected");
        assertEq(vault.idleOf(address(eth)), ethBefore, "no ETH bought this payday");
        assertEq(vault.collateralOf(address(stock)) - collateralBefore, swapAdapter.quote(address(stock), 400 * U));
    }
}

/// Non-payroll users: one recurring plan per asset, side by side.
contract MultiAssetRouterTest is BaseTest {
    SipRouter internal router;
    address internal carol = makeAddr("carol");

    function setUp() public override {
        super.setUp();
        router = new SipRouter(
            IERC20(address(usdc)), factory, swapAdapter, IPriceAdapter(address(priceAdapter)), address(0), 0, 0
        );
        usdc.mint(carol, 10_000 * U);
        vm.prank(carol);
        usdc.approve(address(router), type(uint256).max);
    }

    function test_twoPlans_twoAssets_independent() public {
        vm.startPrank(carol);
        router.setPlan(address(stock), uint96(100 * U), 7 days, 100);
        router.setPlan(address(eth), uint96(50 * U), 1 days, 100);
        vm.stopPrank();

        router.executePlan(carol, address(stock));
        router.executePlan(carol, address(eth));
        vm.warp(block.timestamp + 1 days);
        router.executePlan(carol, address(eth));
        vm.expectRevert();
        router.executePlan(carol, address(stock));

        assertEq(usdc.balanceOf(carol), 9800 * U);
        assertEq(_vault(carol).idleOf(address(eth)), 2 * swapAdapter.quote(address(eth), 50 * U));

        vm.prank(carol);
        router.cancelPlan(address(eth));
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(SipRouter.NoPlan.selector);
        router.executePlan(carol, address(eth));
        (, uint96 perBuy,,,) = router.planOf(carol, address(stock));
        assertEq(perBuy, 100 * U, "the stock plan is untouched");
    }
}
