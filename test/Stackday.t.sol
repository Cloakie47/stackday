// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "./Base.t.sol";
import {EmployeeVault} from "../src/EmployeeVault.sol";
import {Payroll} from "../src/Payroll.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {MockStockToken, MockPriceFeed} from "../src/mocks/Mocks.sol";

contract HappyPathTest is BaseTest {
    /// Fund payroll, claim with SIP, buy stock, borrow, repay, withdraw.
    function test_fullHappyPath() public {
        uint256 runId = _payday(5000 * U, 3000 * U);
        assertEq(payroll.claimable(runId, alice), 5000 * U);
        assertEq(payroll.totalClaimable(alice), 5000 * U);

        // Claim to a different wallet with a one-time 10% SIP share.
        vm.prank(alice);
        payroll.claimWithSip(runId, aliceBank, address(stock), 1000, 0);
        assertEq(usdc.balanceOf(aliceBank), 4500 * U, "90% paid in USDC to the chosen wallet");

        EmployeeVault vault = _vault(alice);
        assertEq(vault.owner(), alice);
        uint256 bought = vault.idleOf(address(stock));
        assertEq(bought, (500 * U * S * 1e8) / (uint256(PRICE) * U), "500 USDC of stock at 350 USD");
        assertEq(vault.debtOf(address(stock)), 0);

        // Borrow 150 USDC against the stock (limit is 500 * 62.5% * 50% = 156.25).
        assertApproxEqAbs(vault.borrowLimit(address(stock)), 0, 0, "no collateral posted yet");
        vm.prank(alice);
        vault.borrow(address(stock), bought, 150 * U, aliceBank);
        assertEq(usdc.balanceOf(aliceBank), 4650 * U);
        assertEq(vault.collateralOf(address(stock)), bought);
        assertEq(vault.idleOf(address(stock)), 0);
        assertEq(vault.debtOf(address(stock)), 150 * U);
        assertApproxEqRel(vault.borrowLimit(address(stock)), 156.25e6, 1e12);

        // A month passes, interest accrues.
        vm.warp(block.timestamp + 30 days);
        uint256 debt = vault.debtOf(address(stock));
        assertGt(debt, 150 * U, "interest accrued");
        assertLt(debt, 153 * U, "interest is sane");

        // Repay everything (from any wallet), then withdraw all stock.
        vm.startPrank(aliceBank);
        usdc.approve(address(vault), type(uint256).max);
        uint256 repaid = vault.repay(address(stock), type(uint256).max);
        vm.stopPrank();
        assertEq(repaid, debt);
        assertEq(vault.debtOf(address(stock)), 0);
        assertEq(usdc.allowance(address(vault), address(adapter)), 0);

        vm.prank(alice);
        vault.withdraw(address(stock), bought, alice);
        assertEq(stock.balanceOf(alice), bought);
        assertEq(vault.collateralOf(address(stock)), 0);
        assertEq(vault.idleOf(address(stock)), 0);
        assertEq(usdc.balanceOf(address(adapter)), 0, "adapter holds nothing");
        assertEq(stock.balanceOf(address(adapter)), 0, "adapter holds nothing");
    }

    function test_sipZeroPercent_paysEverythingInUsdc_noVault() public {
        uint256 runId = _payday(5000 * U, 3000 * U);
        vm.prank(alice);
        payroll.claimWithSip(runId, aliceBank, address(0), 0, 0);
        assertEq(usdc.balanceOf(aliceBank), 5000 * U);
        assertEq(factory.vaultOf(alice), address(0));
    }

    function test_sipMaximumPercent_putsWholeSalaryIntoStock() public {
        uint256 runId = _payday(5000 * U, 3000 * U);
        vm.prank(alice);
        payroll.claimWithSip(runId, aliceBank, address(stock), 10_000, 0);
        assertEq(usdc.balanceOf(aliceBank), 0);
        assertEq(_vault(alice).idleOf(address(stock)), swapAdapter.quote(address(stock), 5000 * U));
        assertEq(usdc.balanceOf(address(payroll)), 3000 * U, "only Bob's salary is left");
    }

    function test_sipAboveMaximum_reverts() public {
        uint256 runId = _payday(5000 * U, 3000 * U);
        vm.prank(alice);
        vm.expectRevert(Payroll.BpsTooHigh.selector);
        payroll.claimWithSip(runId, aliceBank, address(stock), 10_001, 0);
        vm.prank(alice);
        vm.expectRevert(Payroll.BpsTooHigh.selector);
        payroll.setSipPlan(address(stock), 10_001);
    }

    function test_standingInstruction_appliesEveryPayday() public {
        vm.prank(alice);
        payroll.setSipPlan(address(stock), 500); // 5% every payday

        uint256 run1 = _payday(4000 * U, 1000 * U);
        vm.prank(alice);
        payroll.claim(run1, aliceBank, 0);
        uint256 run2 = _payday(4000 * U, 1000 * U);
        vm.prank(alice);
        payroll.claim(run2, aliceBank, 0);

        assertEq(usdc.balanceOf(aliceBank), 2 * 3800 * U);
        assertEq(_vault(alice).idleOf(address(stock)), 2 * swapAdapter.quote(address(stock), 200 * U));

        // A one-time choice does not change the standing instruction.
        uint256 run3 = _payday(4000 * U, 1000 * U);
        vm.prank(alice);
        payroll.claimWithSip(run3, aliceBank, address(0), 0, 0);
        (, uint16[] memory planBps) = payroll.sipPlan(alice);
        assertEq(planBps.length, 1);
        assertEq(planBps[0], 500);
    }

    /// Founder decision (issue #29): a payday buy never locks itself. The owner locks it, then the
    /// loan gets safer.
    function test_secondPayday_staysFree_untilOwnerLocksIt() public {
        vm.prank(alice);
        payroll.setSipPlan(address(stock), 2000);
        uint256 run1 = _payday(5000 * U, 3000 * U);
        vm.prank(alice);
        payroll.claim(run1, aliceBank, 0);
        EmployeeVault vault = _vault(alice);
        uint256 idle = vault.idleOf(address(stock));
        vm.prank(alice);
        vault.borrow(address(stock), idle, 300 * U, aliceBank);

        uint256 healthBefore = vault.healthFactor(address(stock));
        uint256 collateralBefore = vault.collateralOf(address(stock));

        uint256 run2 = _payday(5000 * U, 3000 * U);
        vm.prank(alice);
        payroll.claim(run2, aliceBank, 0);

        uint256 newIdle = vault.idleOf(address(stock));
        assertEq(newIdle, collateralBefore, "new stock stays free in the vault");
        assertEq(vault.collateralOf(address(stock)), collateralBefore, "nothing locked automatically");
        assertEq(vault.healthFactor(address(stock)), healthBefore, "health unchanged until the owner locks");

        vm.prank(alice);
        vault.addCollateral(address(stock), newIdle);
        assertEq(vault.collateralOf(address(stock)), collateralBefore * 2);
        assertApproxEqRel(vault.healthFactor(address(stock)), healthBefore * 2, 1e14, "health doubled once locked");
    }

    function test_interestView_matchesMorphoAccrual() public {
        EmployeeVault vault = _aliceWithLoan(300 * U);
        vm.warp(block.timestamp + 45 days);
        uint256 viewDebt = vault.debtOf(address(stock));
        adapter.accrue();
        assertEq(vault.debtOf(address(stock)), viewDebt, "view predicts exactly what Morpho charges");
        assertGt(adapter.borrowRatePerSecond(), 0);
    }

    function test_partialRepay_byAnyone() public {
        EmployeeVault vault = _aliceWithLoan(300 * U);
        usdc.mint(bob, 100 * U);
        vm.startPrank(bob);
        usdc.approve(address(vault), 100 * U);
        vault.repay(address(stock), 100 * U);
        vm.stopPrank();
        assertApproxEqAbs(vault.debtOf(address(stock)), 200 * U, 1);
    }

    function testFuzz_claimConservesUsdc(uint16 sipBps, uint96 salary) public {
        sipBps = uint16(bound(sipBps, 0, 10_000));
        uint256 amount = bound(salary, 1 * U, 500_000 * U);
        uint256 runId = _payday(amount, 1 * U);
        vm.prank(alice);
        payroll.claimWithSip(runId, aliceBank, address(stock), sipBps, 0);
        uint256 sip = (amount * sipBps) / 10_000;
        // tiny SIP amounts that buy zero stock are skipped and paid in USDC instead
        uint256 paid = usdc.balanceOf(aliceBank);
        assertEq(paid + usdc.balanceOf(address(swapAdapter)), amount, "every USDC is accounted for");
        assertTrue(paid == amount - sip || paid == amount);
        assertEq(usdc.balanceOf(address(payroll)), 1 * U);
    }
}

contract RiskTest is BaseTest {
    function test_borrowCap_isConservativeAndOwnerAdjustable() public {
        uint256 runId = _payday(5000 * U, 3000 * U);
        vm.prank(alice);
        payroll.claimWithSip(runId, aliceBank, address(stock), 2000, 0); // 1,000 USDC of stock
        EmployeeVault vault = _vault(alice);
        uint256 idle = vault.idleOf(address(stock));

        // Liquidation limit is 625 USDC. Default cap is half of that: 312.5 USDC.
        vm.startPrank(alice);
        vm.expectRevert();
        vault.borrow(address(stock), idle, 320 * U, aliceBank);
        vault.borrow(address(stock), idle, 312 * U, aliceBank);

        vm.expectRevert(EmployeeVault.CapOutOfRange.selector);
        vault.setBorrowCapBps(8501);
        vault.setBorrowCapBps(8000);
        vault.borrow(address(stock), 0, 180 * U, aliceBank); // 492 <= 500
        vm.expectRevert();
        vault.borrow(address(stock), 0, 20 * U, aliceBank); // 512 > 500
        vm.stopPrank();
    }

    function test_emergencyRule_triggersAfterPriceDrop() public {
        vm.startPrank(alice);
        payroll.setSipPlan(address(stock), 500); // normally 5%
        payroll.setEmergencyRule(address(stock), 5000, 1.5e18); // if health <= 1.5, put 50% in
        vm.stopPrank();

        EmployeeVault vault = _aliceWithLoan(312 * U); // health about 2.0
        assertApproxEqRel(vault.healthFactor(address(stock)), 2.003e18, 1e15);
        assertFalse(payroll.emergencyActive(alice));

        // Healthy: the next payday uses the normal 5%.
        uint256 run2 = _payday(5000 * U, 3000 * U);
        uint256 bankBefore = usdc.balanceOf(aliceBank);
        vm.prank(alice);
        payroll.claim(run2, aliceBank, 0);
        assertEq(usdc.balanceOf(aliceBank) - bankBefore, 4750 * U);

        // Price falls 43%: health drops under the 1.5 threshold.
        _setPrice(200e8);
        uint256 healthLow = vault.healthFactor(address(stock));
        assertLt(healthLow, 1.5e18);
        assertGt(healthLow, 1e18);
        assertTrue(payroll.emergencyActive(alice));

        // Emergency: 50% of the next salary buys stock and all of it becomes collateral.
        uint256 run3 = _payday(5000 * U, 3000 * U);
        bankBefore = usdc.balanceOf(aliceBank);
        uint256 collateralBefore = vault.collateralOf(address(stock));
        uint256 idleBefore = vault.idleOf(address(stock)); // the healthy payday's 5% stayed free
        assertGt(idleBefore, 0, "the ordinary payday buy was not locked");
        vm.prank(alice);
        payroll.claim(run3, aliceBank, 0);
        assertEq(usdc.balanceOf(aliceBank) - bankBefore, 2500 * U, "half the salary was redirected");
        assertEq(
            vault.collateralOf(address(stock)) - collateralBefore, swapAdapter.quote(address(stock), 2500 * U)
        );
        assertEq(vault.idleOf(address(stock)), idleBefore, "only the emergency share was locked");
        assertGt(vault.healthFactor(address(stock)), 1.5e18, "loan is safe again");
        assertFalse(payroll.emergencyActive(alice));
    }

    function test_emergencyRule_overridesOneTimeZeroChoice_andCanBeSwitchedOff() public {
        vm.prank(alice);
        payroll.setEmergencyRule(address(stock), 3000, 1.5e18);
        EmployeeVault vault = _aliceWithLoan(312 * U);
        _setPrice(210e8);

        uint256 run2 = _payday(1000 * U, 1000 * U);
        uint256 bankBefore = usdc.balanceOf(aliceBank);
        vm.prank(alice);
        payroll.claimWithSip(run2, aliceBank, address(0), 0, 0);
        assertEq(usdc.balanceOf(aliceBank) - bankBefore, 700 * U);

        // The rule is the employee's own. They can switch it off.
        vm.prank(alice);
        payroll.setEmergencyRule(address(0), 0, 0);
        _setPrice(150e8);
        assertLt(vault.healthFactor(address(stock)), 1.5e18);
        uint256 run3 = _payday(1000 * U, 1000 * U);
        bankBefore = usdc.balanceOf(aliceBank);
        vm.prank(alice);
        payroll.claimWithSip(run3, aliceBank, address(0), 0, 0);
        assertEq(usdc.balanceOf(aliceBank) - bankBefore, 1000 * U);
    }

    function test_emergencyRule_validation() public {
        vm.startPrank(alice);
        vm.expectRevert(Payroll.BadThreshold.selector);
        payroll.setEmergencyRule(address(stock), 5000, 1e18);
        vm.expectRevert(abi.encodeWithSelector(Payroll.UnsupportedStock.selector, address(usdc)));
        payroll.setEmergencyRule(address(usdc), 5000, 1.5e18);
        vm.stopPrank();
    }

    function test_priceDrop_makesPositionLiquidatable() public {
        EmployeeVault vault = _aliceWithLoan(312 * U);
        uint256 collateral = vault.collateralOf(address(stock));

        usdc.mint(liquidator, 1000 * U);
        vm.startPrank(liquidator);
        usdc.approve(MORPHO, type(uint256).max);
        vm.expectRevert(); // healthy positions cannot be liquidated
        morpho.liquidate(params, address(vault), collateral / 2, 0, "");
        vm.stopPrank();

        // Overnight gap of 55%.
        _setPrice(157.5e8);
        assertLt(vault.healthFactor(address(stock)), 1e18, "below the liquidation line");

        vm.prank(liquidator);
        (uint256 seized, uint256 repaid) = morpho.liquidate(params, address(vault), collateral / 2, 0, "");
        assertEq(seized, collateral / 2);
        assertGt(repaid, 0);
        assertEq(stock.balanceOf(liquidator), collateral / 2, "liquidator took half the collateral");
        assertEq(vault.collateralOf(address(stock)), collateral - collateral / 2);
        assertLt(vault.debtOf(address(stock)), 312 * U);

        // The owner cannot pull collateral out of an unhealthy loan.
        vm.prank(alice);
        vm.expectRevert();
        vault.withdraw(address(stock), 1, alice);
    }

    function test_weekendGap_frozenFeedThenReopenLower() public {
        EmployeeVault vault = _aliceWithLoan(312 * U);
        (,,, uint256 updatedAtBefore,) = feed.latestRoundData();

        // Friday close: the feed freezes. Nothing moves for 2.5 days except interest.
        vm.prank(demoAdmin);
        feed.setFrozen(true);
        uint256 healthFriday = vault.healthFactor(address(stock));
        vm.warp(block.timestamp + 60 hours);
        (,,, uint256 updatedAt,) = feed.latestRoundData();
        assertEq(updatedAt, updatedAtBefore, "price timestamp stopped: the price is stale");
        (,, uint256 adapterUpdatedAt) = priceAdapter.getPrice(address(stock));
        assertEq(block.timestamp - adapterUpdatedAt, 60 hours, "price adapter reports the staleness");
        assertApproxEqRel(vault.healthFactor(address(stock)), healthFriday, 1e15, "health looks unchanged");
        vm.prank(demoAdmin);
        vm.expectRevert(MockPriceFeed.FeedFrozen.selector);
        feed.setPrice(1e8);

        // Monday open 20% lower: health drops in one step.
        vm.prank(demoAdmin);
        feed.reopenAt(280e8);
        assertApproxEqRel(vault.healthFactor(address(stock)), (healthFriday * 80) / 100, 2e15);
    }

    function test_pausedTransfers_salaryStillPaid_repayWorks_withdrawAndLiquidationBlocked() public {
        vm.prank(alice);
        payroll.setSipPlan(address(stock), 2000);
        EmployeeVault vault = _aliceWithLoan(312 * U);
        uint256 collateral = vault.collateralOf(address(stock));

        vm.prank(demoAdmin);
        stock.setTransfersPaused(true);

        // 1. Payday during the pause: the SIP leg cannot run, so the full salary is paid in USDC.
        uint256 run2 = _payday(5000 * U, 3000 * U);
        uint256 bankBefore = usdc.balanceOf(aliceBank);
        vm.prank(alice);
        payroll.claim(run2, aliceBank, 0);
        assertEq(usdc.balanceOf(aliceBank) - bankBefore, 5000 * U, "salary is never stuck");
        assertEq(vault.collateralOf(address(stock)), collateral, "no collateral could be added");

        // 2. Repaying only moves USDC, so it still works.
        vm.startPrank(aliceBank);
        usdc.approve(address(vault), type(uint256).max);
        vault.repay(address(stock), 100 * U);
        vm.stopPrank();
        assertApproxEqAbs(vault.debtOf(address(stock)), 212 * U, 1);

        // 3. Collateral cannot leave while transfers are paused.
        vm.prank(alice);
        vm.expectRevert();
        vault.removeCollateral(address(stock), 1);

        // 4. Even an underwater loan cannot be liquidated during the pause (collateral cannot move)...
        _setPrice(100e8);
        assertLt(vault.healthFactor(address(stock)), 1e18);
        usdc.mint(liquidator, 1000 * U);
        vm.startPrank(liquidator);
        usdc.approve(MORPHO, type(uint256).max);
        vm.expectRevert();
        morpho.liquidate(params, address(vault), collateral / 4, 0, "");
        vm.stopPrank();

        // ...but the moment transfers resume, it can.
        vm.prank(demoAdmin);
        stock.setTransfersPaused(false);
        vm.prank(liquidator);
        morpho.liquidate(params, address(vault), collateral / 4, 0, "");
        assertEq(stock.balanceOf(liquidator), collateral / 4);
    }

    function test_badSwapPrice_skipsSip_paysFullSalary() public {
        uint256 runId = _payday(5000 * U, 3000 * U);
        uint256 fair = swapAdapter.quote(address(stock), 500 * U);
        vm.prank(alice);
        payroll.claimWithSip(runId, aliceBank, address(stock), 1000, fair + 1); // asks for more than the market gives
        assertEq(usdc.balanceOf(aliceBank), 5000 * U);
        assertEq(usdc.allowance(address(payroll), address(swapAdapter)), 0);
    }
}

contract NoAdminTest is BaseTest {
    EmployeeVault internal vault;
    uint256 internal collateral;

    function setUp() public override {
        super.setUp();
        vault = _aliceWithLoan(100 * U);
        collateral = vault.collateralOf(address(stock));
        // leave some idle stock in the vault too
        vm.prank(demoAdmin);
        stock.mint(address(vault), 1 * S);
    }

    /// Nobody except the employee can move value out: not the deployer, the employer,
    /// the demo operator who owns the mocks, another employee or a stranger.
    function test_noOneButOwner_canMoveVaultFunds() public {
        address[5] memory others = [deployer, employer, demoAdmin, bob, attacker];
        for (uint256 i; i < others.length; ++i) {
            vm.startPrank(others[i]);
            vm.expectRevert(EmployeeVault.NotOwner.selector);
            vault.withdraw(address(stock), 1, others[i]);
            vm.expectRevert(EmployeeVault.NotOwner.selector);
            vault.withdraw(address(usdc), 1, others[i]);
            vm.expectRevert(EmployeeVault.NotOwner.selector);
            vault.removeCollateral(address(stock), 1);
            vm.expectRevert(EmployeeVault.NotOwner.selector);
            vault.borrow(address(stock), 0, 1 * U, others[i]);
            vm.expectRevert(EmployeeVault.NotOwner.selector);
            vault.addCollateral(address(stock), 1);
            vm.expectRevert(EmployeeVault.NotOwner.selector);
            vault.setBorrowCapBps(8500);
            vm.stopPrank();
        }
        assertEq(vault.collateralOf(address(stock)), collateral);
        assertEq(vault.idleOf(address(stock)), 1 * S);
    }

    function test_vaultCannotBeReinitialisedOrHijacked() public {
        vm.prank(attacker);
        vm.expectRevert(EmployeeVault.NotFactory.selector);
        vault.initialize(attacker);

        EmployeeVault implementation = EmployeeVault(factory.implementation());
        vm.prank(attacker);
        vm.expectRevert(EmployeeVault.NotFactory.selector);
        implementation.initialize(attacker);

        // Creating a vault "for" alice again returns the same vault and changes nothing.
        vm.prank(attacker);
        address again = factory.createVault(alice);
        assertEq(again, address(vault));
        assertEq(vault.owner(), alice);
        assertEq(factory.predictVault(alice), address(vault));
    }

    /// The lending adapter is authorised at Morpho by the vault, but it only ever acts on the
    /// caller's own position, so an attacker gains nothing by calling it.
    function test_adapterAndMorphoCannotBeUsedAgainstVault() public {
        assertTrue(morpho.isAuthorized(address(vault), address(adapter)));
        vm.startPrank(attacker);
        vm.expectRevert();
        adapter.withdrawCollateral(collateral, attacker);
        vm.expectRevert();
        adapter.borrow(1 * U, attacker);
        vm.expectRevert();
        morpho.withdrawCollateral(params, collateral, address(vault), attacker);
        vm.expectRevert();
        morpho.borrow(params, 1 * U, 0, address(vault), attacker);
        vm.stopPrank();
        assertEq(vault.collateralOf(address(stock)), collateral);
    }

    function test_payrollInternalsAreClosed() public {
        vm.prank(attacker);
        vm.expectRevert(Payroll.OnlySelf.selector);
        payroll.executeSip(attacker, address(stock), 1, 0, false);
    }

    /// Anyone may add value (deposit stock, repay), which can only help the owner. A plain deposit
    /// stays free even with a loan open; depositStockAsCollateral locks the caller's own tokens.
    function test_anyoneCanAddValue_depositStaysFree_explicitLockAddsCollateral() public {
        vm.prank(demoAdmin);
        stock.mint(bob, 4 * S);
        uint256 idleBefore = vault.idleOf(address(stock));
        vm.startPrank(bob);
        stock.approve(address(vault), 4 * S);
        vault.depositStock(address(stock), 2 * S);
        assertEq(vault.collateralOf(address(stock)), collateral, "plain deposit is not locked");
        assertEq(vault.idleOf(address(stock)), idleBefore + 2 * S);
        vault.depositStockAsCollateral(address(stock), 2 * S);
        vm.stopPrank();
        assertEq(vault.collateralOf(address(stock)), collateral + 2 * S, "explicit lock adds collateral");
        assertEq(vault.idleOf(address(stock)), idleBefore + 2 * S, "the free part is untouched");
    }

    function test_unsupportedStock_rejected() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(EmployeeVault.UnsupportedStock.selector, address(usdc)));
        vault.borrow(address(usdc), 0, 1, alice);
    }

    function test_ownerCanRescueAnyToken() public {
        usdc.mint(address(vault), 50 * U);
        vm.prank(alice);
        vault.withdraw(address(usdc), 50 * U, alice);
        assertEq(usdc.balanceOf(alice), 50 * U);
    }
}

contract PayrollTest is BaseTest {
    function test_onlyTheEmployeeCanClaim_andOnlyOnce() public {
        uint256 runId = _payday(5000 * U, 3000 * U);
        vm.prank(attacker);
        vm.expectRevert(Payroll.NothingToClaim.selector);
        payroll.claimWithSip(runId, attacker, address(0), 0, 0);

        vm.startPrank(alice);
        payroll.claimWithSip(runId, aliceBank, address(0), 0, 0);
        vm.expectRevert(Payroll.NothingToClaim.selector);
        payroll.claimWithSip(runId, aliceBank, address(0), 0, 0);
        vm.stopPrank();

        (address runEmployer,, uint256 total, uint256 claimed) = payroll.runs(runId);
        assertEq(runEmployer, employer);
        assertEq(total, 8000 * U);
        assertEq(claimed, 5000 * U);
    }

    function test_employerBalance_runNeedsFunds_unallocatedCanBeWithdrawn() public {
        address[] memory employees = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        employees[0] = alice;
        amounts[0] = 1000 * U;

        vm.startPrank(employer);
        vm.expectRevert(Payroll.InsufficientBalance.selector);
        payroll.createRun(employees, amounts);

        payroll.deposit(1500 * U);
        payroll.createRun(employees, amounts);
        assertEq(payroll.employerBalance(employer), 500 * U);

        vm.expectRevert(Payroll.InsufficientBalance.selector);
        payroll.withdrawUnallocated(501 * U);
        uint256 before = usdc.balanceOf(employer);
        payroll.withdrawUnallocated(500 * U);
        assertEq(usdc.balanceOf(employer) - before, 500 * U);
        vm.stopPrank();
    }

    function test_employerCannotTouchAssignedSalary_until180Days() public {
        uint256 runId = _payday(5000 * U, 3000 * U);
        vm.startPrank(employer);
        vm.expectRevert(Payroll.InsufficientBalance.selector);
        payroll.withdrawUnallocated(1);
        vm.expectRevert(Payroll.TooEarly.selector);
        payroll.reclaim(runId, alice);
        vm.stopPrank();

        vm.warp(block.timestamp + 180 days);
        vm.prank(attacker);
        vm.expectRevert(Payroll.NotEmployer.selector);
        payroll.reclaim(runId, alice);

        vm.prank(employer);
        payroll.reclaim(runId, alice);
        assertEq(payroll.employerBalance(employer), 5000 * U);
        vm.prank(alice);
        vm.expectRevert(Payroll.NothingToClaim.selector);
        payroll.claimWithSip(runId, aliceBank, address(0), 0, 0);
        // Bob's salary is untouched.
        vm.prank(bob);
        payroll.claimWithSip(runId, bob, address(0), 0, 0);
        assertEq(usdc.balanceOf(bob), 3000 * U);
    }

    function test_runValidation() public {
        address[] memory employees = new address[](2);
        uint256[] memory amounts = new uint256[](1);
        vm.startPrank(employer);
        vm.expectRevert(Payroll.LengthMismatch.selector);
        payroll.createRun(employees, amounts);

        amounts = new uint256[](2);
        employees[0] = alice;
        amounts[0] = 1;
        amounts[1] = 1;
        vm.expectRevert(Payroll.ZeroAddress.selector);
        payroll.depositAndCreateRun(2, employees, amounts);
        vm.stopPrank();
    }

    function test_sameEmployeeTwiceInOneRun_addsUp() public {
        address[] memory employees = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        employees[0] = alice;
        employees[1] = alice;
        amounts[0] = 100 * U;
        amounts[1] = 50 * U;
        vm.prank(employer);
        uint256 runId = payroll.depositAndCreateRun(150 * U, employees, amounts);
        assertEq(payroll.claimable(runId, alice), 150 * U);
        assertEq(payroll.runIdsOf(alice).length, 1);
    }

    function test_factoryConfigIsFixed() public view {
        assertEq(factory.stockCount(), 2);
        assertEq(factory.lendingAdapterOf(address(stock)), address(adapter));
        assertEq(adapter.marketId(), keccak256(abi.encode(params)));
        assertEq(adapter.liquidationLtv(), LLTV);
    }
}

/// Extra checks added during the security review.
contract SecurityReviewTest is BaseTest {
    /// A stranger cannot make themselves the owner of someone's future vault by creating it first.
    function test_frontRunVaultCreation_isHarmless() public {
        address predicted = factory.predictVault(alice);
        vm.prank(attacker);
        address created = factory.createVault(alice);
        assertEq(created, predicted);
        assertEq(EmployeeVault(created).owner(), alice);
    }

    /// Dust paydays sent by a stranger cannot block or reduce a real salary.
    function test_dustRunsFromStranger_doNotAffectRealSalary() public {
        uint256 real = _payday(5000 * U, 3000 * U);
        usdc.mint(attacker, 100);
        address[] memory employees = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        employees[0] = alice;
        amounts[0] = 1;
        vm.startPrank(attacker);
        usdc.approve(address(payroll), 100);
        for (uint256 i; i < 50; ++i) {
            payroll.depositAndCreateRun(1, employees, amounts);
        }
        vm.stopPrank();
        assertEq(payroll.claimable(real, alice), 5000 * U);
        vm.prank(alice);
        payroll.claimWithSip(real, aliceBank, address(stock), 1000, 0);
        assertEq(usdc.balanceOf(aliceBank), 4500 * U);
    }

    /// One employer cannot spend another employer's deposited balance.
    function test_employerBalancesAreSeparate() public {
        vm.prank(employer);
        payroll.deposit(1000 * U);
        address[] memory employees = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        employees[0] = attacker;
        amounts[0] = 1000 * U;
        vm.startPrank(attacker);
        vm.expectRevert(Payroll.InsufficientBalance.selector);
        payroll.createRun(employees, amounts);
        vm.expectRevert(Payroll.InsufficientBalance.selector);
        payroll.withdrawUnallocated(1);
        vm.stopPrank();
    }

    /// USDC sent to the lending adapter by mistake cannot be used to take anything from a vault.
    function test_adapterHoldsNoValueBetweenCalls() public {
        EmployeeVault vault = _aliceWithLoan(300 * U);
        assertEq(usdc.balanceOf(address(adapter)), 0);
        assertEq(stock.balanceOf(address(adapter)), 0);
        assertEq(stock.allowance(address(vault), address(adapter)), 0);
        assertEq(usdc.allowance(address(vault), address(adapter)), 0);
        assertEq(stock.allowance(address(adapter), MORPHO), 0);
    }

    /// Repaying more than is owed only takes what is owed.
    function test_overRepay_takesOnlyTheDebt() public {
        EmployeeVault vault = _aliceWithLoan(300 * U);
        usdc.mint(bob, 1000 * U);
        vm.startPrank(bob);
        usdc.approve(address(vault), type(uint256).max);
        uint256 repaid = vault.repay(address(stock), 900 * U);
        vm.stopPrank();
        assertEq(repaid, 300 * U);
        assertEq(usdc.balanceOf(bob), 700 * U);
        assertEq(vault.debtOf(address(stock)), 0);
    }
}

