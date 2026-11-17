// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "./Base.t.sol";
import {EmployeeVault} from "../src/EmployeeVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";

/// Small fees (issues #45, #56): 0.1% a year on the outstanding loan, paid on repayment, and 0.1% a year on USDC earning interest,
/// taken only out of the interest. Both fixed at deployment and capped at 0.2%.
contract SmallFeesTest is BaseTest {
    address internal treasury = makeAddr("treasury");
    VaultFactory internal feeFactory;
    EmployeeVault internal vault;

    function setUp() public override {
        super.setUp();
        address[] memory tokens = new address[](1);
        address[] memory adapters = new address[](1);
        tokens[0] = address(stock);
        adapters[0] = address(adapter);
        feeFactory = new VaultFactory(tokens, adapters, address(yieldAdapter), treasury, 10, 10);
        vault = EmployeeVault(feeFactory.createVault(alice));

        vm.prank(demoAdmin);
        stock.setMinter(address(this), true);
        stock.mint(alice, 100 * S); // 35,000 USD of stock
        vm.startPrank(alice);
        stock.approve(address(vault), type(uint256).max);
        vault.depositStock(address(stock), 100 * S);
        vault.addCollateral(address(stock), 100 * S);
        vm.stopPrank();
    }

    /// The person receives everything they borrow: the fee is a yearly rate paid on repayment (issue #56).
    function test_borrowFee_personReceivesTheFullAmount() public {
        vm.prank(alice);
        vault.borrow(address(stock), 0, 1000 * U, aliceBank);
        assertEq(usdc.balanceOf(aliceBank), 1000 * U, "nothing taken at the start");
        assertEq(usdc.balanceOf(treasury), 0);
        assertEq(vault.borrowFeeOf(address(stock)), 0, "no time passed, no fee");
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_borrowFee_isOneTenthPercentAYear_paidOnRepay() public {
        vm.prank(alice);
        vault.borrow(address(stock), 0, 1000 * U, aliceBank);
        vm.warp(block.timestamp + 365 days);
        uint256 owed = vault.borrowFeeOf(address(stock));
        // 0.1% of the loan for a year; the loan itself grew by Morpho's interest, so a little above 1 USDC.
        assertGe(owed, 1 * U);
        assertLe(owed, 1.2e6);
        uint256 total = vault.totalOwed(address(stock));
        // Anyone may repay; the fee is paid first, then the whole loan.
        usdc.mint(bob, total);
        vm.startPrank(bob);
        usdc.approve(address(vault), type(uint256).max);
        vault.repay(address(stock), type(uint256).max);
        vm.stopPrank();
        assertApproxEqAbs(usdc.balanceOf(treasury), owed, 1, "the fee went to the fee wallet");
        assertEq(vault.debtOf(address(stock)), 0, "loan closed");
        assertEq(vault.borrowFeeOwed(address(stock)), 0);
        assertLe(usdc.balanceOf(address(vault)), 1, "nothing stays in the vault");
    }

    function test_borrowFee_partialRepay_paysTheFeeFirst() public {
        vm.prank(alice);
        vault.borrow(address(stock), 0, 1000 * U, aliceBank);
        vm.warp(block.timestamp + 182 days);
        uint256 fee = vault.borrowFeeOf(address(stock));
        assertGt(fee, 0.45e6);
        uint256 debtBefore = vault.debtOf(address(stock));
        usdc.mint(alice, 10 * U);
        vm.startPrank(alice);
        usdc.approve(address(vault), 10 * U);
        uint256 toLoan = vault.repay(address(stock), 10 * U);
        vm.stopPrank();
        assertApproxEqAbs(usdc.balanceOf(treasury), fee, 1, "fee paid first");
        assertApproxEqAbs(toLoan, 10 * U - fee, 1, "the rest went to the loan");
        assertApproxEqAbs(vault.debtOf(address(stock)), debtBefore - toLoan, 2);
        assertEq(vault.borrowFeeOwed(address(stock)), 0);
    }

    function test_borrowFee_neverTouchesVaultMoney() public {
        usdc.mint(address(vault), 500 * U); // USDC already in the vault
        vm.prank(alice);
        vault.borrow(address(stock), 0, 1000 * U, aliceBank);
        vm.warp(block.timestamp + 365 days);
        uint256 total = vault.totalOwed(address(stock));
        usdc.mint(alice, total);
        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vault.repay(address(stock), type(uint256).max);
        vm.stopPrank();
        assertApproxEqAbs(usdc.balanceOf(address(vault)), 500 * U, 1, "vault USDC untouched");
        assertGt(usdc.balanceOf(treasury), 0);
    }

    /// A loan that ends without going through the vault (for example a liquidation) leaves no fee owed.
    function test_borrowFee_droppedWhenTheLoanEndsElsewhere() public {
        vm.prank(alice);
        vault.borrow(address(stock), 0, 1000 * U, aliceBank);
        vm.warp(block.timestamp + 365 days);
        assertGt(vault.borrowFeeOf(address(stock)), 0);
        (, uint128 shares,) = morpho.position(adapter.marketId(), address(vault));
        usdc.mint(bob, 2000 * U);
        vm.startPrank(bob);
        usdc.approve(address(morpho), type(uint256).max);
        morpho.repay(adapter.marketParams(), 0, shares, address(vault), "");
        vm.stopPrank();
        assertEq(vault.debtOf(address(stock)), 0);
        assertEq(vault.borrowFeeOf(address(stock)), 0, "nothing owed once the loan is gone");
    }

    function test_earnFee_isOneTenthPercentAYear_fromInterest() public {
        usdc.mint(address(vault), 10_000 * U);
        vm.prank(alice);
        vault.earn(10_000 * U);
        vm.warp(block.timestamp + 365 days);
        usdc.mint(address(yieldVault), 400 * U); // 4% interest
        vm.prank(alice);
        uint256 out = vault.stopEarning(type(uint256).max, aliceBank);
        assertApproxEqAbs(usdc.balanceOf(treasury), 10 * U, 2, "0.1% of 10,000 for one year");
        assertApproxEqAbs(out, 10_390 * U, 3, "the person keeps the deposit and the rest of the interest");
        assertEq(vault.earnPrincipal(), 0);
        assertEq(vault.earnFeeOwed(), 0);
    }

    function test_earnFee_neverMoreThanTheInterest() public {
        usdc.mint(address(vault), 10_000 * U);
        vm.prank(alice);
        vault.earn(10_000 * U);
        vm.warp(block.timestamp + 365 days);
        usdc.mint(address(yieldVault), 3 * U); // less interest than the 10 USDC fee
        vm.prank(alice);
        uint256 out = vault.stopEarning(type(uint256).max, aliceBank);
        assertApproxEqAbs(usdc.balanceOf(treasury), 3 * U, 2, "fee capped at the interest");
        assertGe(out + 2, 10_000 * U, "the deposit always comes back whole");
    }

    function test_earnFee_noInterest_noFee() public {
        usdc.mint(address(vault), 10_000 * U);
        vm.prank(alice);
        vault.earn(10_000 * U);
        vm.warp(block.timestamp + 365 days);
        vm.prank(alice);
        uint256 out = vault.stopEarning(type(uint256).max, aliceBank);
        assertEq(usdc.balanceOf(treasury), 0);
        assertApproxEqAbs(out, 10_000 * U, 1);
    }

    function test_earnFee_partialWithdrawals() public {
        usdc.mint(address(vault), 10_000 * U);
        vm.prank(alice);
        vault.earn(10_000 * U);
        vm.warp(block.timestamp + 182 days);
        usdc.mint(address(yieldVault), 200 * U);
        vm.prank(alice);
        vault.stopEarning(5000 * U, aliceBank); // half a year on 10,000: about 4.99 USDC fee
        assertApproxEqAbs(usdc.balanceOf(treasury), 4.986e6, 0.01e6);
        assertEq(usdc.balanceOf(aliceBank), 5000 * U);
        assertEq(vault.earnPrincipal(), 5000 * U);
        vm.warp(block.timestamp + 183 days);
        vm.prank(alice);
        vault.stopEarning(type(uint256).max, aliceBank); // second half on 5,000: about 2.5 USDC
        assertApproxEqAbs(usdc.balanceOf(treasury), 7.49e6, 0.02e6);
        assertEq(vault.earningBalance(), 0);
    }

    function test_feesAreCappedAndNeedARecipient() public {
        address[] memory none = new address[](0);
        vm.expectRevert(VaultFactory.BadFee.selector);
        new VaultFactory(none, none, address(0), treasury, 21, 0);
        vm.expectRevert(VaultFactory.BadFee.selector);
        new VaultFactory(none, none, address(0), treasury, 0, 21);
        vm.expectRevert(VaultFactory.BadFee.selector);
        new VaultFactory(none, none, address(0), address(0), 10, 0);
        assertEq(feeFactory.borrowFeeBps(), 10);
        assertEq(feeFactory.earnFeeBps(), 10);
        assertEq(feeFactory.MAX_FEE_BPS(), 20);
    }

    /// The fee wallet only receives. It cannot borrow, withdraw or stop earning for anyone.
    function test_feeRecipientHasNoPowers() public {
        vm.startPrank(treasury);
        vm.expectRevert(EmployeeVault.NotOwner.selector);
        vault.borrow(address(stock), 0, 1 * U, treasury);
        vm.expectRevert(EmployeeVault.NotOwner.selector);
        vault.withdraw(address(stock), 1, treasury);
        vm.expectRevert(EmployeeVault.NotOwner.selector);
        vault.stopEarning(1, treasury);
        vm.stopPrank();
    }
}
