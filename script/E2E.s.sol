// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {EmployeeVault} from "../src/EmployeeVault.sol";
import {Payroll} from "../src/Payroll.sol";

/// @notice One real end to end run on Base Sepolia from a single test wallet that plays
/// both employer and employee: payday, claim with a 20% SIP into mAAPL (mock stock),
/// borrow USDC from the real Morpho market, repay, withdraw the stock.
contract E2E is Script {
    IERC20 internal usdc;
    Payroll internal payroll;
    VaultFactory internal factory;
    EmployeeVault internal vault;
    address internal stock;
    address internal me;
    uint256 internal salary;
    uint256 internal borrowAmount;
    uint256 internal runId;
    uint256 internal health;
    uint256 internal collateral;

    function run() external {
        require(block.chainid == 84532, "Stackday E2E: Base Sepolia only");
        uint256 pk = vm.envUint("PRIVATE_KEY");
        me = vm.addr(pk);
        string memory json = vm.readFile(vm.envOr("DEPLOYMENTS_FILE", string("deployments/base-sepolia.json")));
        usdc = IERC20(vm.parseJsonAddress(json, ".usdc"));
        payroll = Payroll(vm.parseJsonAddress(json, ".payroll"));
        factory = VaultFactory(vm.parseJsonAddress(json, ".vaultFactory"));
        // Any borrowable asset, mAAPL by default (for example E2E_ASSET=mSPX for the S&P 500 fund token).
        string memory asset = vm.envOr("E2E_ASSET", string("mAAPL"));
        stock = vm.parseJsonAddress(json, string.concat(".", asset));

        salary = vm.envOr("E2E_SALARY_USDC", uint256(5e6));
        borrowAmount = salary / 20; // SIP share is 20% of salary; borrow a quarter of that
        require(usdc.balanceOf(me) >= salary + 1e6, "Need more test USDC (faucet.circle.com)");

        // If an earlier run stopped half way (loan still open), just finish it: repay and withdraw.
        vault = EmployeeVault(factory.vaultOf(me));
        bool resume = address(vault) != address(0) && vault.debtOf(stock) > 0;

        vm.startBroadcast(pk);
        if (!resume) {
            _paydayAndClaim();
            vault.borrow(stock, vault.idleOf(stock), borrowAmount, me);
        }
        health = vault.healthFactor(stock);
        _repayWithdraw();
        vm.stopBroadcast();

        console2.log("Vault", address(vault));
        console2.log("Run id", runId);
        console2.log("Asset bought and withdrawn (smallest units)", collateral);
        console2.log("USDC borrowed then repaid (6 decimals)", borrowAmount);
        console2.log("Loan health while borrowed (1e18 = liquidation line)", health);
        require(vault.debtOf(stock) == 0, "debt not cleared");
        require(IERC20(stock).balanceOf(me) >= collateral, "stock not withdrawn");
    }

    function _paydayAndClaim() internal {
        address[] memory employees = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        employees[0] = me;
        amounts[0] = salary;
        // 1. Employer funds payroll and creates a run.
        usdc.approve(address(payroll), salary);
        runId = payroll.depositAndCreateRun(salary, employees, amounts);
        // 2. Employee claims with a one-time 20% SIP share into mAAPL.
        payroll.claimWithSip(runId, me, stock, 2000, 0);
        vault = EmployeeVault(factory.vaultOf(me));
    }

    function _repayWithdraw() internal {
        // 3 (above). Deposit the stock as collateral and borrow USDC from the Morpho market.
        // 4. Repay the whole loan.
        usdc.approve(address(vault), borrowAmount + 1e6);
        vault.repay(stock, type(uint256).max);
        usdc.approve(address(vault), 0);
        // 5. Withdraw all the stock to the wallet.
        collateral = vault.collateralOf(stock);
        vault.withdraw(stock, collateral, me);
    }
}
