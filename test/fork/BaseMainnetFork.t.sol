// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IMorpho, MarketParams} from "../../src/interfaces/IMorpho.sol";
import {MorphoLendingAdapter} from "../../src/adapters/MorphoLendingAdapter.sol";
import {SlipstreamSwapAdapter} from "../../src/adapters/SlipstreamSwapAdapter.sol";
import {ChainlinkPriceAdapter} from "../../src/adapters/ChainlinkPriceAdapter.sol";
import {ERC4626YieldAdapter} from "../../src/adapters/ERC4626YieldAdapter.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {VaultFactory} from "../../src/VaultFactory.sol";
import {EmployeeVault} from "../../src/EmployeeVault.sol";
import {Payroll} from "../../src/Payroll.sol";

/// @notice Runs Stackday against the REAL things on a local copy (fork) of Base mainnet:
/// real AAPLc stock token, real USDC, real Chainlink feed, real Aerodrome pool and the real
/// Morpho AAPLc/USDC market. Nothing here is mocked. It costs nothing and sends no transaction.
///
/// Run with:  $env:FOUNDRY_PROFILE="fork"; forge test
contract BaseMainnetForkTest is Test {
    IMorpho internal constant MORPHO = IMorpho(0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb);
    IERC20 internal constant USDC = IERC20(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);
    IERC20 internal constant AAPLC = IERC20(0xb200000000000000000000C2e324d24d7eEcd1fb);
    address internal constant AAPL_FEED = 0x787f13dEa48Db0897CbCDD985de77809D837F988;
    /// Aerodrome Slipstream AAPLc/USDC pool (largest AAPLc pool at time of writing).
    address internal constant AAPLC_POOL = 0xF5FCB9CDAFcE67d50AfEf298F88E709d2B946BA6;
    /// The exact market: Morpho AAPLc/USDC, 62.5% liquidation limit.
    bytes32 internal constant MARKET_ID = 0xae1a30486234bf7e7ac166c7c03d9bc5f2cd8a39be2c48e73c665ac7148c3c28;

    /// Real Morpho vault: Steakhouse High Yield USDC on Base.
    IERC4626 internal constant YIELD_VAULT = IERC4626(0xbeeff7aE5E00Aae3Db302e4B0d8C883810a58100);

    uint256 internal constant U = 1e6;

    MorphoLendingAdapter internal adapter;
    SlipstreamSwapAdapter internal swapAdapter;
    ChainlinkPriceAdapter internal priceAdapter;
    ERC4626YieldAdapter internal yieldAdapter;
    VaultFactory internal factory;
    Payroll internal payroll;
    MarketParams internal params;

    address internal employer = makeAddr("employer");
    address internal alice = makeAddr("alice");
    address internal aliceBank = makeAddr("aliceBank");
    address internal lender = makeAddr("lender");
    address internal attacker = makeAddr("attacker");
    address internal treasury = makeAddr("treasury");

    function setUp() public {
        vm.createSelectFork(vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org")));

        (params.loanToken, params.collateralToken, params.oracle, params.irm, params.lltv) =
            MORPHO.idToMarketParams(MARKET_ID);
        assertEq(params.loanToken, address(USDC), "market lends USDC");
        assertEq(params.collateralToken, address(AAPLC), "market takes AAPLc");
        assertEq(params.lltv, 0.625e18);

        address[] memory stocks = new address[](1);
        address[] memory one = new address[](1);
        stocks[0] = address(AAPLC);

        adapter = new MorphoLendingAdapter(MORPHO, params);
        one[0] = address(adapter);
        yieldAdapter = new ERC4626YieldAdapter(YIELD_VAULT);
        assertEq(yieldAdapter.asset(), address(USDC));
        factory = new VaultFactory(stocks, one, address(yieldAdapter), address(0), 0, 0);
        one[0] = AAPLC_POOL;
        swapAdapter = new SlipstreamSwapAdapter(USDC, stocks, one);
        one[0] = AAPL_FEED;
        priceAdapter = new ChainlinkPriceAdapter(stocks, one);
        payroll = new Payroll(USDC, factory, swapAdapter, treasury, 25, 1 days);

        deal(address(USDC), employer, 100_000 * U);
        vm.prank(employer);
        USDC.approve(address(payroll), type(uint256).max);

        // Make sure the small real market has USDC to lend, whatever its state on the day.
        deal(address(USDC), lender, 50_000 * U);
        vm.startPrank(lender);
        USDC.approve(address(MORPHO), type(uint256).max);
        MORPHO.supply(params, 50_000 * U, 0, lender, "");
        vm.stopPrank();
    }

    function _payday(uint256 amount) internal returns (uint256 runId) {
        address[] memory employees = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        employees[0] = alice;
        amounts[0] = amount;
        vm.prank(employer);
        runId = payroll.depositAndCreateRun(amount, employees, amounts);
    }

    /// Payday, buy real AAPLc on Aerodrome, hold it in a contract vault, borrow from the real
    /// Morpho market, second payday improves health, repay, withdraw.
    function test_fork_fullFlow_realStock_realMorpho_realDex() public {
        (uint256 feedPrice, uint8 feedDecimals, uint256 updatedAt) = priceAdapter.getPrice(address(AAPLC));
        assertEq(feedDecimals, 8);
        assertGt(feedPrice, 50e8);
        assertLt(feedPrice, 2000e8);
        emit log_named_decimal_uint("AAPL Chainlink price (USD)", feedPrice, 8);
        emit log_named_uint("price age (seconds)", block.timestamp - updatedAt);

        // Payday 1: 20% of 5,000 USDC into AAPLc. Require the DEX to deliver within 2% of the oracle price.
        uint256 runId = _payday(5000 * U);
        uint256 fairOut = (1000 * U * 1e8 * 1e8) / (feedPrice * U);
        vm.prank(alice);
        payroll.claimWithSip(runId, aliceBank, address(AAPLC), 2000, (fairOut * 98) / 100);
        assertEq(USDC.balanceOf(aliceBank), 4000 * U, "SIP leg must have executed on the real pool");
        assertEq(USDC.balanceOf(treasury), 2.5e6, "0.25% SIP fee on 1,000 USDC");

        EmployeeVault vault = EmployeeVault(factory.vaultOf(alice));
        uint256 bought = AAPLC.balanceOf(address(vault));
        assertGe(bought, (fairOut * 98) / 100, "a contract holds the real stock token");
        emit log_named_decimal_uint("AAPLc bought for 1,000 USDC", bought, 8);

        // Borrow 250 USDC against it on the real market (cap is about 312).
        vm.prank(alice);
        vault.borrow(address(AAPLC), bought, 250 * U, aliceBank);
        assertEq(USDC.balanceOf(aliceBank), 4250 * U);
        assertEq(vault.collateralOf(address(AAPLC)), bought);
        uint256 health1 = vault.healthFactor(address(AAPLC));
        assertGt(health1, 2e18);
        emit log_named_decimal_uint("health after borrowing 250 USDC", health1, 18);
        emit log_named_decimal_uint("borrow rate per year (percent)", adapter.borrowRatePerSecond() * 365 days * 100, 18);

        // Over-borrowing is refused by the vault's conservative cap.
        vm.prank(alice);
        vm.expectRevert();
        vault.borrow(address(AAPLC), 0, 100 * U, aliceBank);

        // Nobody else can touch the vault.
        vm.prank(attacker);
        vm.expectRevert(EmployeeVault.NotOwner.selector);
        vault.withdraw(address(AAPLC), 1, attacker);
        vm.prank(attacker);
        vm.expectRevert();
        MORPHO.withdrawCollateral(params, bought, address(vault), attacker);

        // Payday 2 adds collateral automatically and health improves.
        vm.warp(block.timestamp + 14 days);
        runId = _payday(5000 * U);
        vm.prank(alice);
        payroll.claimWithSip(runId, aliceBank, address(AAPLC), 2000, 0);
        assertGt(vault.collateralOf(address(AAPLC)), bought);
        assertEq(AAPLC.balanceOf(address(vault)), 0);
        assertGt(vault.healthFactor(address(AAPLC)), health1);

        // Repay everything, withdraw the real stock to Alice's own wallet.
        uint256 debt = vault.debtOf(address(AAPLC));
        assertGt(debt, 250 * U);
        vm.startPrank(aliceBank);
        USDC.approve(address(vault), type(uint256).max);
        vault.repay(address(AAPLC), type(uint256).max);
        vm.stopPrank();
        assertEq(vault.debtOf(address(AAPLC)), 0);

        uint256 all = vault.collateralOf(address(AAPLC));
        vm.prank(alice);
        vault.withdraw(address(AAPLC), all, alice);
        assertEq(AAPLC.balanceOf(alice), all);
        assertEq(vault.collateralOf(address(AAPLC)), 0);
        assertEq(USDC.balanceOf(address(swapAdapter)), 0);
        assertEq(AAPLC.balanceOf(address(adapter)), 0);
    }

    /// The swap adapter's pool callback cannot be abused to pull its (zero) funds.
    function test_fork_swapCallbackIsClosed() public {
        vm.prank(attacker);
        vm.expectRevert(SlipstreamSwapAdapter.NotActivePool.selector);
        swapAdapter.uniswapV3SwapCallback(1, 0, "");
    }

    /// Idle USDC in the employee's own vault earns interest in a real Morpho vault.
    function test_fork_idleUsdc_earnsInRealMorphoVault() public {
        uint256 runId = _payday(5000 * U);
        EmployeeVault vault = EmployeeVault(factory.createVault(alice));
        vm.prank(alice);
        payroll.claimWithSip(runId, address(vault), address(0), 0, 0);

        vm.prank(alice);
        vault.earn(5000 * U);
        uint256 start = vault.earningBalance();
        assertApproxEqAbs(start, 5000 * U, 5);
        assertGt(YIELD_VAULT.balanceOf(address(vault)), 0, "the employee vault holds the Morpho vault shares");

        vm.warp(block.timestamp + 30 days);
        uint256 later = vault.earningBalance();
        emit log_named_decimal_uint("5,000 USDC after 30 days", later, 6);
        assertGe(later, start);

        vm.prank(attacker);
        vm.expectRevert(EmployeeVault.NotOwner.selector);
        vault.stopEarning(1, attacker);

        vm.prank(alice);
        uint256 out = vault.stopEarning(type(uint256).max, aliceBank);
        assertEq(USDC.balanceOf(aliceBank), out);
        assertGe(out, 5000 * U - 5);
        assertEq(vault.earningBalance(), 0);
    }
}
