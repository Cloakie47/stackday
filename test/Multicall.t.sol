// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "./Base.t.sol";
import {EmployeeVault} from "../src/EmployeeVault.sol";

/// One signature for several vault actions (lock many assets, borrow against many, repay many).
/// The vault inherits OpenZeppelin Multicall: each inner call runs with the same caller and all of
/// its own checks, and the whole batch is undone if any part fails.
contract MulticallTest is BaseTest {
    EmployeeVault internal vault;

    function setUp() public override {
        super.setUp();
        vault = EmployeeVault(factory.createVault(alice));
        vm.startPrank(demoAdmin);
        stock.mint(alice, 2 * S);
        eth.mint(alice, 1e18);
        vm.stopPrank();
        vm.startPrank(alice);
        stock.approve(address(vault), 2 * S);
        eth.approve(address(vault), 1e18);
        vault.depositStock(address(stock), 1 * S); // 1 share free in the vault
        vm.stopPrank();
    }

    function _lockAndBorrowCalls(uint256 stockBorrow, uint256 ethBorrow) internal view returns (bytes[] memory calls) {
        calls = new bytes[](5);
        calls[0] = abi.encodeCall(EmployeeVault.depositStock, (address(eth), 1e18)); // from the wallet
        calls[1] = abi.encodeCall(EmployeeVault.addCollateral, (address(stock), 1 * S));
        calls[2] = abi.encodeCall(EmployeeVault.addCollateral, (address(eth), 1e18));
        calls[3] = abi.encodeCall(EmployeeVault.borrow, (address(stock), 0, stockBorrow, alice));
        calls[4] = abi.encodeCall(EmployeeVault.borrow, (address(eth), 0, ethBorrow, alice));
    }

    function test_lockTwoAssetsAndBorrowAgainstBoth_inOneTransaction() public {
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        vault.multicall(_lockAndBorrowCalls(100 * U, 1000 * U));

        assertEq(vault.collateralOf(address(stock)), 1 * S);
        assertEq(vault.collateralOf(address(eth)), 1e18);
        assertEq(vault.debtOf(address(stock)), 100 * U);
        assertEq(vault.debtOf(address(eth)), 1000 * U);
        assertEq(usdc.balanceOf(alice) - before, 1100 * U, "both loans paid to the owner");
        assertEq(eth.balanceOf(alice), 0, "the wallet's ether was pulled from the caller");
    }

    function test_onlyTheOwnerCanBatch() public {
        bytes[] memory calls = new bytes[](1);
        calls[0] = abi.encodeCall(EmployeeVault.borrow, (address(stock), 0, 1 * U, attacker));
        vm.prank(attacker);
        vm.expectRevert(EmployeeVault.NotOwner.selector);
        vault.multicall(calls);
    }

    function test_batchIsAllOrNothing() public {
        // The stock loan is above the borrow cap (1 share at 350 USD x 62.5% x 50% = 109 USDC), so
        // nothing in the batch happens: no lock, no ether loan.
        vm.prank(alice);
        vm.expectRevert();
        vault.multicall(_lockAndBorrowCalls(150 * U, 1000 * U));
        assertEq(vault.collateralOf(address(stock)), 0);
        assertEq(vault.collateralOf(address(eth)), 0);
        assertEq(vault.debtOf(address(eth)), 0);
        assertEq(eth.balanceOf(alice), 1e18, "the wallet kept its ether");
    }

    function test_repayEveryLoanInOneTransaction() public {
        vm.startPrank(alice);
        vault.multicall(_lockAndBorrowCalls(100 * U, 1000 * U));
        vm.warp(block.timestamp + 7 days);
        usdc.approve(address(vault), type(uint256).max);
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(EmployeeVault.repay, (address(stock), type(uint256).max));
        calls[1] = abi.encodeCall(EmployeeVault.repay, (address(eth), type(uint256).max));
        usdc.mint(alice, 10 * U); // a week of interest
        vault.multicall(calls);
        vm.stopPrank();
        assertEq(vault.debtOf(address(stock)), 0);
        assertEq(vault.debtOf(address(eth)), 0);
    }

    function test_batchCannotSkipTheBorrowCapOrReenter() public {
        // A batch cannot nest another multicall to sidestep checks: each inner call still checks the cap.
        bytes[] memory inner = new bytes[](1);
        inner[0] = abi.encodeCall(EmployeeVault.borrow, (address(stock), 0, 500 * U, alice));
        bytes[] memory outer = new bytes[](2);
        outer[0] = abi.encodeCall(EmployeeVault.addCollateral, (address(stock), 1 * S));
        outer[1] = abi.encodeWithSignature("multicall(bytes[])", inner);
        vm.prank(alice);
        vm.expectRevert();
        vault.multicall(outer);
        assertEq(vault.debtOf(address(stock)), 0);
    }
}
