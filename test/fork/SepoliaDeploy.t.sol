// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Deploy} from "../../script/Deploy.s.sol";
import {E2E} from "../../script/E2E.s.sol";
import {Payroll} from "../../src/Payroll.sol";
import {VaultFactory} from "../../src/VaultFactory.sol";

/// @notice Rehearsal: runs the exact deploy script and the exact end to end script on a local
/// copy of Base Sepolia, with a throwaway key. Proves they work before any real transaction.
contract SepoliaDeployRehearsalTest is Test {
    // Publicly known throwaway key (Foundry's default test account). Never used for real funds.
    uint256 internal constant KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    IERC20 internal constant USDC = IERC20(0x036CbD53842c5426634e7929541eC2318f3dCF7e);

    function test_fork_deployAndEndToEnd_onBaseSepolia() public {
        vm.createSelectFork(vm.envOr("BASE_SEPOLIA_RPC_URL", string("https://sepolia.base.org")));
        address me = vm.addr(KEY);
        vm.deal(me, 1 ether);
        deal(address(USDC), me, 30e6);
        vm.setEnv("PRIVATE_KEY", vm.toString(bytes32(KEY)));
        vm.setEnv("DEPLOYMENTS_FILE", "deployments/rehearsal.json");

        new Deploy().run();
        string memory json = vm.readFile("deployments/rehearsal.json");
        Payroll payroll = Payroll(vm.parseJsonAddress(json, ".payroll"));
        VaultFactory factory = VaultFactory(vm.parseJsonAddress(json, ".vaultFactory"));
        assertEq(payroll.sipFeeBps(), 15);
        assertEq(factory.stockCount(), 15);
        assertEq(USDC.balanceOf(me), 12e6, "2 USDC lent into each of the nine markets");
        // S&P 500 fund token is borrowable at 77% (issue #65); Treasuries stay invest only.
        address spx = vm.parseJsonAddress(json, ".mSPX");
        assertTrue(factory.lendingAdapterOf(spx) != address(0), "mSPX has a lending market");
        assertEq(vm.parseJsonUint(json, ".mSPXLltv"), 0.77e18);
        address sgov = vm.parseJsonAddress(json, ".mSGOV");
        assertEq(factory.lendingAdapterOf(sgov), address(0), "mSGOV stays invest only");
        assertTrue(factory.isSupported(sgov));

        new E2E().run();
        assertTrue(factory.vaultOf(me) != address(0));
        assertEq(USDC.balanceOf(address(payroll)), 0);
        // 30 - 18 lent, minus the SIP share (1 USDC went into stock), minus under 0.01 of interest
        assertApproxEqAbs(USDC.balanceOf(me), 11e6, 0.01e6);
    }
}
