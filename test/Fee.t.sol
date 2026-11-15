// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BaseTest} from "./Base.t.sol";
import {Payroll} from "../src/Payroll.sol";
import {SipRouter} from "../src/SipRouter.sol";
import {EmployeeVault} from "../src/EmployeeVault.sol";
import {IPriceAdapter} from "../src/interfaces/IAdapters.sol";

/// Platform revenue: a 0.25% SIP fee, fixed at deployment, only on USDC going into stock.
contract SipFeeTest is BaseTest {
    uint16 internal constant FEE_BPS = 25;
    address internal treasury = makeAddr("treasury");
    Payroll internal feePayroll;
    SipRouter internal feeRouter;
    address internal carol = makeAddr("carol");

    function setUp() public override {
        super.setUp();
        feePayroll = new Payroll(IERC20(address(usdc)), factory, swapAdapter, treasury, FEE_BPS, 1 days);
        feeRouter = new SipRouter(
            IERC20(address(usdc)), factory, swapAdapter, IPriceAdapter(address(priceAdapter)), treasury, FEE_BPS, 0
        );
        vm.prank(employer);
        usdc.approve(address(feePayroll), type(uint256).max);
        usdc.mint(carol, 10_000 * U);
        vm.prank(carol);
        usdc.approve(address(feeRouter), type(uint256).max);
    }

    function _feePayday(uint256 amount) internal returns (uint256 runId) {
        address[] memory employees = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        employees[0] = alice;
        amounts[0] = amount;
        vm.prank(employer);
        runId = feePayroll.depositAndCreateRun(amount, employees, amounts);
    }

    function test_payroll_feeOnlyOnSipShare() public {
        uint256 runId = _feePayday(5000 * U);
        vm.prank(alice);
        feePayroll.claimWithSip(runId, aliceBank, address(stock), 2000, 0); // 1,000 USDC SIP
        assertEq(usdc.balanceOf(aliceBank), 4000 * U, "salary paid out is never charged");
        assertEq(usdc.balanceOf(treasury), 2.5e6, "0.25% of 1,000 USDC");
        assertEq(_vault(alice).idleOf(address(stock)), swapAdapter.quote(address(stock), 997.5e6));
        assertEq(usdc.balanceOf(address(feePayroll)), 0);
    }

    function test_payroll_noSip_noFee() public {
        uint256 runId = _feePayday(5000 * U);
        vm.prank(alice);
        feePayroll.claimWithSip(runId, aliceBank, address(0), 0, 0);
        assertEq(usdc.balanceOf(aliceBank), 5000 * U);
        assertEq(usdc.balanceOf(treasury), 0);
    }

    function test_payroll_failedSip_noFee_fullSalaryPaid() public {
        uint256 runId = _feePayday(5000 * U);
        vm.prank(demoAdmin);
        stock.setTransfersPaused(true);
        vm.prank(alice);
        feePayroll.claimWithSip(runId, aliceBank, address(stock), 2000, 0);
        assertEq(usdc.balanceOf(aliceBank), 5000 * U);
        assertEq(usdc.balanceOf(treasury), 0, "no fee when no stock was bought");
    }

    function test_router_feeOnOneTimeAndRecurring() public {
        vm.prank(carol);
        uint256 out = feeRouter.invest(address(stock), 1000 * U, 0);
        assertEq(out, swapAdapter.quote(address(stock), 997.5e6));
        assertEq(usdc.balanceOf(treasury), 2.5e6);

        vm.prank(carol);
        feeRouter.setPlan(address(stock), uint96(400 * U), 7 days, 0); // zero tolerance still fills at oracle price
        feeRouter.executePlan(carol, address(stock));
        assertEq(usdc.balanceOf(treasury), 3.5e6);
        assertEq(usdc.balanceOf(carol), 8600 * U);
        assertEq(usdc.balanceOf(address(feeRouter)), 0);
    }

    function test_feeIsFixedAndCapped() public {
        assertEq(feePayroll.sipFeeBps(), FEE_BPS);
        assertEq(feePayroll.feeRecipient(), treasury);
        vm.expectRevert(Payroll.BadFee.selector);
        new Payroll(IERC20(address(usdc)), factory, swapAdapter, treasury, 101, 1 days);
        vm.expectRevert(Payroll.BadFee.selector);
        new Payroll(IERC20(address(usdc)), factory, swapAdapter, address(0), 25, 1 days);
        vm.expectRevert(SipRouter.BadFee.selector);
        new SipRouter(IERC20(address(usdc)), factory, swapAdapter, IPriceAdapter(address(priceAdapter)), treasury, 101, 0);
    }

    /// The fee recipient is just a wallet that receives fees. It has no power over vaults or salaries.
    function test_feeRecipientHasNoPowers() public {
        uint256 runId = _feePayday(5000 * U);
        vm.prank(alice);
        feePayroll.claimWithSip(runId, aliceBank, address(stock), 2000, 0);
        EmployeeVault vault = _vault(alice);
        vm.startPrank(treasury);
        vm.expectRevert(EmployeeVault.NotOwner.selector);
        vault.withdraw(address(stock), 1, treasury);
        vm.expectRevert(Payroll.NothingToClaim.selector);
        feePayroll.claimWithSip(runId, treasury, address(0), 0, 0);
        vm.stopPrank();
    }

    function testFuzz_feeMath(uint16 sipBps, uint96 salary) public {
        sipBps = uint16(bound(sipBps, 1, 10_000));
        uint256 amount = bound(salary, 100 * U, 500_000 * U);
        uint256 runId = _feePayday(amount);
        vm.prank(alice);
        feePayroll.claimWithSip(runId, aliceBank, address(stock), sipBps, 0);
        uint256 sip = (amount * sipBps) / 10_000;
        uint256 fee = (sip * FEE_BPS) / 10_000;
        if (usdc.balanceOf(aliceBank) == amount - sip) {
            assertEq(usdc.balanceOf(treasury), fee);
            assertEq(usdc.balanceOf(address(swapAdapter)), sip - fee);
        } else {
            assertEq(usdc.balanceOf(aliceBank), amount, "SIP skipped: full salary, no fee");
            assertEq(usdc.balanceOf(treasury), 0);
        }
        assertEq(usdc.balanceOf(address(feePayroll)), 0);
    }
}
