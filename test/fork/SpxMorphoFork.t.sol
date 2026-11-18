// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IMorpho, MarketParams} from "../../src/interfaces/IMorpho.sol";
import {MorphoLendingAdapter} from "../../src/adapters/MorphoLendingAdapter.sol";
import {VaultFactory} from "../../src/VaultFactory.sol";
import {EmployeeVault} from "../../src/EmployeeVault.sol";

/// @notice Borrowing against the S&P 500 fund token on a local copy (fork) of Base mainnet:
/// the real deSPXA token (Centrifuge, 18 decimals), real USDC and the real Morpho deSPXA/USDC
/// market at 77 percent. This is why mSPX is borrowable on testnet (issue #65). Nothing is mocked.
///
/// Run with:  $env:FOUNDRY_PROFILE="fork"; forge test
contract SpxMorphoForkTest is Test {
    IMorpho internal constant MORPHO = IMorpho(0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb);
    IERC20 internal constant USDC = IERC20(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);
    IERC20 internal constant DESPXA = IERC20(0x9c5C365e764829876243d0b289733B9D2b729685);
    /// Morpho deSPXA/USDC, 77% liquidation limit (largest S&P 500 market on Base, November 19, 2026).
    bytes32 internal constant MARKET_ID = 0x4440abd9eff38ebf76b8f64c074682acef8c89e77555075478a7582883206604;
    uint256 internal constant U = 1e6;

    MorphoLendingAdapter internal adapter;
    VaultFactory internal factory;
    MarketParams internal params;

    address internal alice = makeAddr("alice");
    address internal aliceBank = makeAddr("aliceBank");
    address internal lender = makeAddr("lender");
    address internal attacker = makeAddr("attacker");

    function setUp() public {
        vm.createSelectFork(vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org")));

        (params.loanToken, params.collateralToken, params.oracle, params.irm, params.lltv) =
            MORPHO.idToMarketParams(MARKET_ID);
        assertEq(params.loanToken, address(USDC), "market lends USDC");
        assertEq(params.collateralToken, address(DESPXA), "market takes deSPXA");
        assertEq(params.lltv, 0.77e18);

        address[] memory stocks = new address[](1);
        address[] memory adapters = new address[](1);
        stocks[0] = address(DESPXA);
        adapter = new MorphoLendingAdapter(MORPHO, params);
        adapters[0] = address(adapter);
        factory = new VaultFactory(stocks, adapters, address(0), address(0), 0, 0);

        // Make sure the market has USDC to lend, whatever its state on the day.
        deal(address(USDC), lender, 50_000 * U);
        vm.startPrank(lender);
        USDC.approve(address(MORPHO), type(uint256).max);
        MORPHO.supply(params, 50_000 * U, 0, lender, "");
        vm.stopPrank();
    }

    function test_fork_spx_lock_borrow_repay_withdraw() public {
        // 10 deSPXA in Alice's wallet, put into her own vault (stays free until she locks it).
        uint256 amount = 10e18;
        deal(address(DESPXA), alice, amount);
        EmployeeVault vault = EmployeeVault(factory.createVault(alice));
        vm.startPrank(alice);
        DESPXA.approve(address(vault), amount);
        vault.depositStock(address(DESPXA), amount);
        vm.stopPrank();
        assertEq(vault.collateralOf(address(DESPXA)), 0, "never locked automatically");

        // Lock it and borrow half of the vault's limit from the real market.
        vm.prank(alice);
        vault.addCollateral(address(DESPXA), amount);
        uint256 limit = vault.borrowLimit(address(DESPXA));
        emit log_named_decimal_uint("borrow limit on 10 deSPXA (USDC)", limit, 6);
        assertGt(limit, 100 * U, "the real oracle values the collateral");
        uint256 loan = limit / 2;
        vm.prank(alice);
        vault.borrow(address(DESPXA), 0, loan, aliceBank);
        assertEq(USDC.balanceOf(aliceBank), loan, "the person receives the full amount borrowed");
        uint256 health = vault.healthFactor(address(DESPXA));
        assertGt(health, 1e18);
        emit log_named_decimal_uint("health after borrowing", health, 18);

        // Over the cap is refused, and nobody else can move the collateral.
        vm.prank(alice);
        vm.expectRevert();
        vault.borrow(address(DESPXA), 0, limit, aliceBank);
        vm.prank(attacker);
        vm.expectRevert(EmployeeVault.NotOwner.selector);
        vault.withdraw(address(DESPXA), 1, attacker);
        vm.prank(attacker);
        vm.expectRevert();
        MORPHO.withdrawCollateral(params, amount, address(vault), attacker);

        // A month later: repay everything (manual), then withdraw all of it.
        vm.warp(block.timestamp + 30 days);
        deal(address(USDC), aliceBank, loan * 2);
        vm.startPrank(aliceBank);
        USDC.approve(address(vault), type(uint256).max);
        vault.repay(address(DESPXA), type(uint256).max);
        vm.stopPrank();
        assertEq(vault.debtOf(address(DESPXA)), 0);

        vm.prank(alice);
        vault.withdraw(address(DESPXA), amount, alice);
        assertEq(DESPXA.balanceOf(alice), amount);
        assertEq(DESPXA.balanceOf(address(adapter)), 0);
    }
}
