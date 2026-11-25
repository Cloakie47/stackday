// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SlipstreamSwapAdapter} from "../../src/adapters/SlipstreamSwapAdapter.sol";
import {ChainlinkPriceAdapter} from "../../src/adapters/ChainlinkPriceAdapter.sol";
import {IPriceAdapter} from "../../src/interfaces/IAdapters.sol";
import {VaultFactory} from "../../src/VaultFactory.sol";
import {EmployeeVault} from "../../src/EmployeeVault.sol";
import {GiftBox} from "../../src/GiftBox.sol";

/// @notice A $5 stock gift box on a local copy (fork) of Base mainnet (issue #77):
/// - real USDC;
/// - real AAPLc, NVDAc and deSPXA (S&P 500) tokens;
/// - real Chainlink feeds (Coinbase AAPL and NVDA, and the feed behind the deSPXA Morpho oracle);
/// - real Aerodrome and Uniswap pools.
/// The box buys the mix when it is opened and puts it into the recipient's own vault. Nothing is mocked.
///
/// Finding (November 25, 2026): the deSPXA price feed only answers readers on its allowlist (it reverts
/// with NotTolled for anyone else), so Stackday's Chainlink price adapter cannot read it. On mainnet the
/// S&P 500 needs a price adapter that reads the Morpho market oracle instead. The last test shows a box
/// with deSPXA then refuses to open and stays fully refundable.
///
/// Run with:  $env:FOUNDRY_PROFILE="fork"; forge test
contract GiftBoxForkTest is Test {
    IERC20 internal constant USDC = IERC20(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);
    address internal constant AAPLC = 0xb200000000000000000000C2e324d24d7eEcd1fb;
    address internal constant NVDAC = 0xb20000000000000000000078ee7ce2fE4908108C;
    address internal constant DESPXA = 0x9c5C365e764829876243d0b289733B9D2b729685;
    address internal constant AAPL_FEED = 0x787f13dEa48Db0897CbCDD985de77809D837F988;
    address internal constant NVDA_FEED = 0x04689a41629776563E6822F76f2e57D148d28513;
    /// BASE_FEED_1 of the deSPXA/USDC Morpho market oracle (0x98c27f1C...), 18 decimals.
    address internal constant SPX_FEED = 0x97165Ad36D96567a521958cc46914160B968752b;
    address internal constant AAPLC_POOL = 0xF5FCB9CDAFcE67d50AfEf298F88E709d2B946BA6; // Aerodrome
    address internal constant NVDAC_POOL = 0xF668e21993f0ACd7ab00BB1cFbAeD0df28A3C8EC; // Aerodrome
    address internal constant DESPXA_POOL = 0xD08f1fb797BfaCdeD23323178672557034c64CfA; // Uniswap v3
    uint256 internal constant U = 1e6;

    GiftBox internal box;
    VaultFactory internal factory;
    address internal maya = makeAddr("maya");
    address internal ravi = makeAddr("ravi");

    function setUp() public {
        vm.createSelectFork(vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org")));

        address[] memory assets = new address[](3);
        (assets[0], assets[1], assets[2]) = (AAPLC, NVDAC, DESPXA);
        address[] memory noLending = new address[](3); // invest only here: the box never borrows
        address[] memory pools = new address[](3);
        (pools[0], pools[1], pools[2]) = (AAPLC_POOL, NVDAC_POOL, DESPXA_POOL);
        address[] memory feeds = new address[](3);
        (feeds[0], feeds[1], feeds[2]) = (AAPL_FEED, NVDA_FEED, SPX_FEED);

        factory = new VaultFactory(assets, noLending, address(0), address(0), 0, 0);
        SlipstreamSwapAdapter swap = new SlipstreamSwapAdapter(USDC, assets, pools);
        ChainlinkPriceAdapter prices = new ChainlinkPriceAdapter(assets, feeds);
        // The mainnet setting: refuse to open on an oracle price older than 26 hours.
        box = new GiftBox(USDC, factory, swap, IPriceAdapter(address(prices)), 26 hours);

        deal(address(USDC), maya, 100 * U);
        vm.prank(maya);
        USDC.approve(address(box), type(uint256).max);
    }

    function test_fork_fiveDollarMix_opensIntoVault() public {
        address[] memory a = new address[](2);
        uint16[] memory w = new uint16[](2);
        (a[0], a[1]) = (AAPLC, NVDAC);
        (w[0], w[1]) = (6000, 4000);

        vm.prank(maya);
        uint256 id = box.create(ravi, uint96(5 * U), uint40(block.timestamp + 30 days), GiftBox.Kind.Fixed, a, w);

        address[] memory none;
        uint16[] memory noW;
        vm.prank(ravi);
        EmployeeVault vault = EmployeeVault(box.open(id, 300, none, noW));

        assertEq(vault.owner(), ravi);
        for (uint256 i; i < 2; ++i) {
            uint256 got = vault.idleOf(a[i]);
            uint256 fair = box.quoteAtOracle(a[i], (5 * U * w[i]) / 10_000);
            assertGe(got, (fair * 9700) / 10_000, "within 3% of the oracle price");
            emit log_named_uint("received (smallest units)", got);
            emit log_named_uint("at oracle (smallest units)", fair);
        }
        assertEq(USDC.balanceOf(address(box)), 0, "every unit of USDC used");
        assertEq(IERC20(AAPLC).balanceOf(address(box)), 0);
        assertEq(IERC20(NVDAC).balanceOf(address(box)), 0);
    }

    /// The deSPXA feed is reader-restricted, so the box cannot price it: opening reverts and the
    /// sender still gets every unit back. (Mainnet needs a Morpho-oracle price adapter for deSPXA.)
    function test_fork_spxBox_cannotBePricedYet_staysRefundable() public {
        address[] memory a = new address[](1);
        uint16[] memory w = new uint16[](1);
        (a[0], w[0]) = (DESPXA, 10_000);
        vm.prank(maya);
        uint256 id = box.create(ravi, uint96(5 * U), uint40(block.timestamp + 30 days), GiftBox.Kind.Fixed, a, w);

        address[] memory none;
        uint16[] memory noW;
        vm.prank(ravi);
        vm.expectRevert();
        box.open(id, 300, none, noW);

        vm.prank(maya);
        box.revoke(id);
        assertEq(USDC.balanceOf(maya), 100 * U);
        assertEq(IERC20(DESPXA).balanceOf(ravi), 0);
    }

    /// A research box takes the mix at opening, here a single pick.
    function test_fork_researchPick_singleAsset() public {
        address[] memory none;
        uint16[] memory noW;
        vm.prank(maya);
        uint256 id = box.create(ravi, uint96(5 * U), uint40(block.timestamp + 7 days), GiftBox.Kind.Research, none, noW);

        address[] memory a = new address[](1);
        uint16[] memory w = new uint16[](1);
        (a[0], w[0]) = (NVDAC, 10_000);
        vm.prank(ravi);
        EmployeeVault vault = EmployeeVault(box.open(id, 300, a, w));
        assertGe(vault.idleOf(NVDAC), (box.quoteAtOracle(NVDAC, 5 * U) * 9700) / 10_000);
    }

    /// Revoking returns exactly the USDC sent: the box never held stock.
    function test_fork_revoke_returnsExactUsdc() public {
        address[] memory a = new address[](1);
        uint16[] memory w = new uint16[](1);
        (a[0], w[0]) = (AAPLC, 10_000);
        vm.prank(maya);
        uint256 id = box.create(ravi, uint96(5 * U), uint40(block.timestamp + 30 days), GiftBox.Kind.Fixed, a, w);
        vm.prank(maya);
        box.revoke(id);
        assertEq(USDC.balanceOf(maya), 100 * U);
    }
}
