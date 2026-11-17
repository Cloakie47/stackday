// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "./Base.t.sol";
import {EmployeeVault} from "../src/EmployeeVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";

contract IdleUsdcYieldTest is BaseTest {
    EmployeeVault internal vault;

    function setUp() public override {
        super.setUp();
        vault = EmployeeVault(factory.createVault(alice));
    }

    /// Salary claimed straight into the employee's own vault, put to work, interest earned, taken out.
    function test_idleUsdc_earnsInterest_inOwnVault() public {
        uint256 runId = _payday(5000 * U, 3000 * U);
        vm.prank(alice);
        payroll.claimWithSip(runId, address(vault), address(0), 0, 0);
        assertEq(usdc.balanceOf(address(vault)), 5000 * U);

        vm.prank(alice);
        vault.earn(4000 * U);
        assertEq(usdc.balanceOf(address(vault)), 1000 * U);
        assertApproxEqAbs(vault.earningBalance(), 4000 * U, 1);
        assertEq(yieldVault.balanceOf(address(vault)), yieldVault.totalSupply(), "shares sit in the employee vault");
        assertEq(yieldVault.balanceOf(address(yieldAdapter)), 0, "adapter holds nothing");
        assertEq(usdc.allowance(address(vault), address(yieldAdapter)), 0);

        // 2% interest arrives at the lending venue.
        usdc.mint(address(yieldVault), 80 * U);
        assertApproxEqAbs(vault.earningBalance(), 4080 * U, 2);

        vm.startPrank(alice);
        vault.stopEarning(1000 * U, aliceBank);
        assertEq(usdc.balanceOf(aliceBank), 1000 * U);
        uint256 out = vault.stopEarning(type(uint256).max, aliceBank);
        vm.stopPrank();
        assertApproxEqAbs(out, 3080 * U, 2);
        assertEq(vault.earningBalance(), 0);
        assertEq(yieldVault.allowance(address(vault), address(yieldAdapter)), 0);
    }

    function test_earn_pullsShortfallFromOwnerWallet() public {
        usdc.mint(alice, 300 * U);
        usdc.mint(address(vault), 200 * U);
        vm.startPrank(alice);
        usdc.approve(address(vault), 300 * U);
        vault.earn(500 * U);
        vm.stopPrank();
        assertApproxEqAbs(vault.earningBalance(), 500 * U, 1);
        assertEq(usdc.balanceOf(alice), 0);
    }

    function test_onlyOwner_canStartOrStopEarning() public {
        usdc.mint(address(vault), 500 * U);
        vm.prank(alice);
        vault.earn(500 * U);
        address[4] memory others = [deployer, employer, demoAdmin, attacker];
        for (uint256 i; i < others.length; ++i) {
            vm.startPrank(others[i]);
            vm.expectRevert(EmployeeVault.NotOwner.selector);
            vault.earn(1);
            vm.expectRevert(EmployeeVault.NotOwner.selector);
            vault.stopEarning(1, others[i]);
            vm.stopPrank();
        }
        // The adapter cannot be used by a stranger to pull the vault's position.
        vm.startPrank(attacker);
        vm.expectRevert();
        yieldAdapter.withdraw(1 * U, attacker);
        assertEq(yieldAdapter.withdrawAll(attacker), 0);
        vm.expectRevert();
        yieldVault.withdraw(1 * U, attacker, address(vault));
        vm.stopPrank();
        assertApproxEqAbs(vault.earningBalance(), 500 * U, 1);
    }

    function test_yieldSwitchedOff_whenFactoryHasNoAdapter() public {
        address[] memory tokens = new address[](1);
        address[] memory adapters = new address[](1);
        tokens[0] = address(stock);
        adapters[0] = address(adapter);
        VaultFactory plain = new VaultFactory(tokens, adapters, address(0), address(0), 0, 0);
        EmployeeVault v = EmployeeVault(plain.createVault(alice));
        assertEq(v.earningBalance(), 0);
        vm.prank(alice);
        vm.expectRevert(EmployeeVault.YieldNotAvailable.selector);
        v.earn(1);
    }

    /// Earning USDC and a stock-backed loan live side by side in the same vault.
    function test_earningAndBorrowingTogether() public {
        uint256 runId = _payday(5000 * U, 3000 * U);
        vm.prank(alice);
        payroll.claimWithSip(runId, address(vault), address(stock), 2000, 0);
        uint256 idle = vault.idleOf(address(stock));
        vm.startPrank(alice);
        vault.earn(4000 * U);
        vault.borrow(address(stock), idle, 300 * U, aliceBank);
        vm.stopPrank();
        assertEq(vault.debtOf(address(stock)), 300 * U);
        assertApproxEqAbs(vault.earningBalance(), 4000 * U, 1);
        assertEq(vault.collateralOf(address(stock)), idle);
    }
}
