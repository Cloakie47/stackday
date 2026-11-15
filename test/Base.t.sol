// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IMorpho, MarketParams} from "../src/interfaces/IMorpho.sol";
import {IPriceAdapter} from "../src/interfaces/IAdapters.sol";
import {MorphoLendingAdapter} from "../src/adapters/MorphoLendingAdapter.sol";
import {ChainlinkPriceAdapter, FeedOracle, IAggregatorV3} from "../src/adapters/ChainlinkPriceAdapter.sol";
import {MockStockToken, MockPriceFeed, MockSwapAdapter, MockUSDC, MockYieldVault} from "../src/mocks/Mocks.sol";
import {ERC4626YieldAdapter} from "../src/adapters/ERC4626YieldAdapter.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {EmployeeVault} from "../src/EmployeeVault.sol";
import {Payroll} from "../src/Payroll.sol";

/// @dev Shared setup. Lending runs on the REAL Morpho and REAL interest rate model bytecode,
/// copied from Base (test/fixtures) and placed at their real addresses. The stock token,
/// its price feed, the exchange and USDC are mocks.
abstract contract BaseTest is Test {
    address internal constant MORPHO = 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb;
    address internal constant IRM = 0x46415998764C29aB2a25CbeA6254146D50D22687;
    uint256 internal constant LLTV = 0.625e18;
    uint256 internal constant U = 1e6; // 1 USDC
    uint256 internal constant S = 1e8; // 1 stock token
    int256 internal constant PRICE = 350e8; // 350 USD

    IMorpho internal morpho = IMorpho(MORPHO);
    MockUSDC internal usdc;
    MockStockToken internal stock;
    MockStockToken internal eth; // 18 decimals, 86% liquidation limit
    MockPriceFeed internal ethFeed;
    MorphoLendingAdapter internal ethAdapter;
    MarketParams internal ethParams;
    uint256 internal constant ETH_LLTV = 0.86e18;
    int256 internal constant ETH_PRICE = 3500e8;
    MockPriceFeed internal feed;
    ChainlinkPriceAdapter internal priceAdapter;
    FeedOracle internal oracle;
    MorphoLendingAdapter internal adapter;
    MockSwapAdapter internal swapAdapter;
    MockYieldVault internal yieldVault;
    ERC4626YieldAdapter internal yieldAdapter;
    VaultFactory internal factory;
    Payroll internal payroll;
    MarketParams internal params;

    address internal deployer = makeAddr("deployer");
    address internal demoAdmin = makeAddr("demoAdmin");
    address internal morphoOwner = makeAddr("morphoOwner");
    address internal lender = makeAddr("lender");
    address internal employer = makeAddr("employer");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal aliceBank = makeAddr("aliceBank");
    address internal attacker = makeAddr("attacker");
    address internal liquidator = makeAddr("liquidator");

    function setUp() public virtual {
        vm.warp(1_794_000_000);

        // Real Morpho + real AdaptiveCurveIrm bytecode at their real addresses.
        vm.etch(MORPHO, vm.parseBytes(vm.trim(vm.readFile("test/fixtures/morpho.hex"))));
        vm.etch(IRM, vm.parseBytes(vm.trim(vm.readFile("test/fixtures/irm.hex"))));
        vm.store(MORPHO, bytes32(0), bytes32(uint256(uint160(morphoOwner))));
        vm.startPrank(morphoOwner);
        morpho.enableIrm(IRM);
        morpho.enableLltv(LLTV);
        morpho.enableLltv(ETH_LLTV);
        vm.stopPrank();

        vm.startPrank(deployer);
        usdc = new MockUSDC();
        stock = new MockStockToken("Mock Apple", "mAAPL", 8, demoAdmin);
        feed = new MockPriceFeed(PRICE, demoAdmin);

        eth = new MockStockToken("Mock Wrapped Ether", "mWETH", 18, demoAdmin);
        ethFeed = new MockPriceFeed(ETH_PRICE, demoAdmin);
        address[] memory tokens = new address[](2);
        address[] memory feeds = new address[](2);
        tokens[0] = address(stock);
        feeds[0] = address(feed);
        tokens[1] = address(eth);
        feeds[1] = address(ethFeed);
        priceAdapter = new ChainlinkPriceAdapter(tokens, feeds);
        oracle = new FeedOracle(IAggregatorV3(address(feed)), address(stock), address(usdc));

        params = MarketParams(address(usdc), address(stock), address(oracle), IRM, LLTV);
        morpho.createMarket(params);
        adapter = new MorphoLendingAdapter(morpho, params);

        ethParams = MarketParams(
            address(usdc),
            address(eth),
            address(new FeedOracle(IAggregatorV3(address(ethFeed)), address(eth), address(usdc))),
            IRM,
            ETH_LLTV
        );
        morpho.createMarket(ethParams);
        ethAdapter = new MorphoLendingAdapter(morpho, ethParams);

        address[] memory adapters = new address[](2);
        adapters[0] = address(adapter);
        adapters[1] = address(ethAdapter);
        yieldVault = new MockYieldVault(IERC20(address(usdc)));
        yieldAdapter = new ERC4626YieldAdapter(yieldVault);
        factory = new VaultFactory(tokens, adapters, address(yieldAdapter));
        swapAdapter = new MockSwapAdapter(IERC20(address(usdc)), IPriceAdapter(address(priceAdapter)), demoAdmin);
        payroll = new Payroll(IERC20(address(usdc)), factory, swapAdapter, address(0), 0, 1 days);
        vm.stopPrank();

        vm.startPrank(demoAdmin);
        stock.setMinter(address(swapAdapter), true);
        eth.setMinter(address(swapAdapter), true);
        vm.stopPrank();

        // A lender funds the market so there is USDC to borrow.
        usdc.mint(lender, 1_000_000 * U);
        vm.startPrank(lender);
        usdc.approve(MORPHO, type(uint256).max);
        morpho.supply(params, 1_000_000 * U, 0, lender, "");
        vm.stopPrank();
        usdc.mint(lender, 1_000_000 * U);
        vm.prank(lender);
        morpho.supply(ethParams, 1_000_000 * U, 0, lender, "");

        usdc.mint(employer, 1_000_000 * U);
        vm.prank(employer);
        usdc.approve(address(payroll), type(uint256).max);
    }

    // ------------------------------------------------------------------ helpers

    function _payday(uint256 aliceAmount, uint256 bobAmount) internal returns (uint256 runId) {
        address[] memory employees = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        employees[0] = alice;
        employees[1] = bob;
        amounts[0] = aliceAmount;
        amounts[1] = bobAmount;
        vm.prank(employer);
        runId = payroll.depositAndCreateRun(aliceAmount + bobAmount, employees, amounts);
    }

    function _vault(address employee) internal view returns (EmployeeVault) {
        return EmployeeVault(factory.vaultOf(employee));
    }

    function _setPrice(int256 price) internal {
        vm.prank(demoAdmin);
        feed.setPrice(price);
    }

    /// @dev Alice gets a 5,000 USDC salary, puts 20% (1,000 USDC) into stock and borrows `borrowUsdc`.
    function _aliceWithLoan(uint256 borrowUsdc) internal returns (EmployeeVault vault) {
        uint256 runId = _payday(5000 * U, 3000 * U);
        vm.prank(alice);
        payroll.claimWithSip(runId, aliceBank, address(stock), 2000, 0);
        vault = _vault(alice);
        uint256 idle = vault.idleOf(address(stock));
        vm.prank(alice);
        vault.borrow(address(stock), idle, borrowUsdc, aliceBank);
    }
}
