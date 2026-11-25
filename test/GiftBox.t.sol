// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {BaseTest} from "./Base.t.sol";
import {GiftBox} from "../src/GiftBox.sol";
import {EmployeeVault} from "../src/EmployeeVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {ISwapAdapter, IPriceAdapter} from "../src/interfaces/IAdapters.sol";
import {MockSellDesk, MockStockToken} from "../src/mocks/Mocks.sol";

/// @dev An exchange that ignores the slippage floor and pays 10% too little, to prove GiftBox checks
/// what it actually received.
contract ShortSwap is ISwapAdapter {
    IERC20 internal immutable usdc;
    IPriceAdapter internal immutable prices;

    constructor(IERC20 usdc_, IPriceAdapter prices_) {
        usdc = usdc_;
        prices = prices_;
    }

    function swapExactUsdcForStock(address stock, uint256 usdcIn, uint256, address to) external returns (uint256 out) {
        (uint256 price,,) = prices.getPrice(stock);
        out = (usdcIn * 1e8 * 1e8) / (price * 1e6) * 9 / 10; // 8-decimal stock, 8-decimal price
        usdc.transferFrom(msg.sender, address(this), usdcIn);
        MockStockToken(stock).mint(to, out);
    }
}

/// @dev A USDC that burns 1% on every transfer, to prove the box checks the exact amount it received.
contract FeeUsdc is ERC20 {
    constructor() ERC20("Fee USDC", "fUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0), fee);
            value -= fee;
        }
        super._update(from, to, value);
    }
}

contract GiftBoxTest is BaseTest {
    GiftBox internal box;
    address internal maya = makeAddr("maya"); // the sender
    address internal ravi = makeAddr("ravi"); // the recipient, no vault yet
    uint40 internal in30Days;

    address[] internal noAssets;
    uint16[] internal noWeights;

    function setUp() public override {
        super.setUp();
        box = new GiftBox(IERC20(address(usdc)), factory, swapAdapter, IPriceAdapter(address(priceAdapter)), 0);
        usdc.mint(maya, 10_000 * U);
        vm.prank(maya);
        usdc.approve(address(box), type(uint256).max);
        in30Days = uint40(block.timestamp + 30 days);
    }

    // ------------------------------------------------------------------ helpers

    function _one(address a) internal pure returns (address[] memory assets, uint16[] memory weights) {
        assets = new address[](1);
        weights = new uint16[](1);
        assets[0] = a;
        weights[0] = 10_000;
    }

    function _two(address a, uint16 wa, address b, uint16 wb)
        internal
        pure
        returns (address[] memory assets, uint16[] memory weights)
    {
        assets = new address[](2);
        weights = new uint16[](2);
        (assets[0], assets[1]) = (a, b);
        (weights[0], weights[1]) = (wa, wb);
    }

    function _send(uint96 amount, address[] memory assets, uint16[] memory weights) internal returns (uint256 id) {
        vm.prank(maya);
        id = box.create(ravi, amount, in30Days, GiftBox.Kind.Fixed, assets, weights);
    }

    function _open(uint256 id) internal returns (address vault) {
        vm.prank(ravi);
        vault = box.open(id, 100, noAssets, noWeights);
    }

    // ------------------------------------------------------------------ happy paths

    function test_oneStock_opensIntoNewVault() public {
        (address[] memory a, uint16[] memory w) = _one(address(stock));
        uint256 id = _send(5 * uint96(U), a, w);
        assertEq(usdc.balanceOf(address(box)), 5 * U, "the box holds the USDC");
        assertEq(factory.vaultOf(ravi), address(0), "no vault yet");

        address vault = _open(id);
        assertEq(vault, factory.vaultOf(ravi), "vault created for the recipient");
        assertEq(EmployeeVault(vault).owner(), ravi);
        uint256 expected = box.quoteAtOracle(address(stock), 5 * U);
        assertEq(EmployeeVault(vault).idleOf(address(stock)), expected, "free stock worth exactly 5 USDC");
        assertEq(EmployeeVault(vault).collateralOf(address(stock)), 0, "never locked");
        assertEq(usdc.balanceOf(address(box)), 0, "every unit of USDC used");
        assertEq(stock.balanceOf(address(box)), 0, "the box keeps nothing");
        assertEq(uint8(box.giftOf(id).status), uint8(GiftBox.Status.Opened));
    }

    function test_mix_splitsByWeight_acrossDecimals() public {
        // 30% Apple (8 decimals), 70% Ether (18 decimals), 7 USDC and 1 unit so rounding matters.
        (address[] memory a, uint16[] memory w) = _two(address(stock), 3000, address(eth), 7000);
        uint96 amount = uint96(7 * U + 1);
        uint256 id = _send(amount, a, w);
        address vault = _open(id);

        uint256 applePart = (uint256(amount) * 3000) / 10_000;
        uint256 ethPart = amount - applePart; // the last part takes the remainder
        assertEq(EmployeeVault(vault).idleOf(address(stock)), box.quoteAtOracle(address(stock), applePart));
        assertEq(EmployeeVault(vault).idleOf(address(eth)), box.quoteAtOracle(address(eth), ethPart));
        assertEq(usdc.balanceOf(address(box)), 0);
        assertEq(box.legsOf(id).length, 2);
    }

    function test_researchBox_mixChosenAtOpening() public {
        vm.prank(maya);
        uint256 id = box.create(ravi, 10 * uint96(U), in30Days, GiftBox.Kind.Research, noAssets, noWeights);
        assertEq(box.legsOf(id).length, 0, "no mix until opened");

        (address[] memory a, uint16[] memory w) = _two(address(eth), 5000, address(stock), 5000);
        vm.prank(ravi);
        address vault = box.open(id, 100, a, w);
        assertGt(EmployeeVault(vault).idleOf(address(eth)), 0);
        assertGt(EmployeeVault(vault).idleOf(address(stock)), 0);
        assertEq(box.legsOf(id).length, 2, "the mix used is recorded");
    }

    function test_researchBox_singlePick() public {
        vm.prank(maya);
        uint256 id = box.create(ravi, 3 * uint96(U), in30Days, GiftBox.Kind.Research, noAssets, noWeights);
        (address[] memory a, uint16[] memory w) = _one(address(eth));
        vm.prank(ravi);
        address vault = box.open(id, 0, a, w);
        assertEq(EmployeeVault(vault).idleOf(address(eth)), box.quoteAtOracle(address(eth), 3 * U));
    }

    /// A gift to someone with a loan arrives as free stock and does not touch the loan.
    function test_recipientWithLoan_giftStaysFree() public {
        EmployeeVault vault = _aliceWithLoan(100 * U);
        uint256 collateralBefore = vault.collateralOf(address(stock));
        uint256 debtBefore = vault.debtOf(address(stock));
        uint256 idleBefore = vault.idleOf(address(stock));

        (address[] memory a, uint16[] memory w) = _one(address(stock));
        vm.prank(maya);
        uint256 id = box.create(alice, 20 * uint96(U), in30Days, GiftBox.Kind.Fixed, a, w);
        vm.prank(alice);
        address opened = box.open(id, 100, noAssets, noWeights);

        assertEq(opened, address(vault), "same vault, not a new one");
        assertEq(vault.collateralOf(address(stock)), collateralBefore, "collateral unchanged");
        assertEq(vault.debtOf(address(stock)), debtBefore, "loan unchanged");
        assertEq(vault.idleOf(address(stock)), idleBefore + box.quoteAtOracle(address(stock), 20 * U));
    }

    // ------------------------------------------------------------------ refunds

    function test_revoke_refundsSender() public {
        (address[] memory a, uint16[] memory w) = _one(address(stock));
        uint256 id = _send(50 * uint96(U), a, w);
        vm.prank(maya);
        box.revoke(id);
        assertEq(usdc.balanceOf(maya), 10_000 * U, "exact refund");
        vm.prank(ravi);
        vm.expectRevert(GiftBox.NotPending.selector);
        box.open(id, 100, noAssets, noWeights);
    }

    function test_decline_refundsSender() public {
        (address[] memory a, uint16[] memory w) = _one(address(stock));
        uint256 id = _send(50 * uint96(U), a, w);
        vm.prank(ravi);
        box.decline(id);
        assertEq(usdc.balanceOf(maya), 10_000 * U);
        assertEq(usdc.balanceOf(ravi), 0);
        assertEq(uint8(box.giftOf(id).status), uint8(GiftBox.Status.Declined));
    }

    function test_expiry_anyoneRefundsToSenderOnly() public {
        (address[] memory a, uint16[] memory w) = _one(address(stock));
        uint256 id = _send(50 * uint96(U), a, w);

        vm.expectRevert(GiftBox.NotExpired.selector);
        box.refundExpired(id);

        vm.warp(in30Days);
        vm.prank(ravi);
        vm.expectRevert(GiftBox.Expired.selector);
        box.open(id, 100, noAssets, noWeights);

        vm.prank(attacker);
        box.refundExpired(id);
        assertEq(usdc.balanceOf(maya), 10_000 * U, "back to the sender");
        assertEq(usdc.balanceOf(attacker), 0, "the caller gets nothing");

        vm.expectRevert(GiftBox.NotPending.selector);
        box.refundExpired(id);
    }

    // ------------------------------------------------------------------ wrong callers and races

    function test_onlyRecipientOpensOrDeclines_onlySenderRevokes() public {
        (address[] memory a, uint16[] memory w) = _one(address(stock));
        uint256 id = _send(50 * uint96(U), a, w);

        vm.startPrank(attacker);
        vm.expectRevert(GiftBox.NotRecipient.selector);
        box.open(id, 100, noAssets, noWeights);
        vm.expectRevert(GiftBox.NotRecipient.selector);
        box.decline(id);
        vm.expectRevert(GiftBox.NotSender.selector);
        box.revoke(id);
        vm.stopPrank();

        vm.prank(maya);
        vm.expectRevert(GiftBox.NotRecipient.selector);
        box.open(id, 100, noAssets, noWeights);
        vm.prank(ravi);
        vm.expectRevert(GiftBox.NotSender.selector);
        box.revoke(id);
    }

    function test_openTwice_andRevokeAfterOpen_fail() public {
        (address[] memory a, uint16[] memory w) = _one(address(stock));
        uint256 id = _send(50 * uint96(U), a, w);
        _open(id);

        vm.prank(ravi);
        vm.expectRevert(GiftBox.NotPending.selector);
        box.open(id, 100, noAssets, noWeights);
        vm.prank(maya);
        vm.expectRevert(GiftBox.NotPending.selector);
        box.revoke(id);
        vm.prank(ravi);
        vm.expectRevert(GiftBox.NotPending.selector);
        box.decline(id);
    }

    function test_unknownBox_cannotBeTouched() public {
        vm.expectRevert(GiftBox.NotPending.selector);
        box.refundExpired(99);
        vm.prank(ravi);
        vm.expectRevert(GiftBox.NotPending.selector);
        box.open(99, 100, noAssets, noWeights);
    }

    // ------------------------------------------------------------------ create checks

    function test_create_refusesBadRecipientsAmountsAndExpiry() public {
        (address[] memory a, uint16[] memory w) = _one(address(stock));
        vm.startPrank(maya);
        vm.expectRevert(GiftBox.SelfGift.selector);
        box.create(maya, 5 * uint96(U), in30Days, GiftBox.Kind.Fixed, a, w);
        vm.expectRevert(GiftBox.ZeroAddress.selector);
        box.create(address(0), 5 * uint96(U), in30Days, GiftBox.Kind.Fixed, a, w);
        vm.expectRevert(GiftBox.ZeroAddress.selector);
        box.create(address(box), 5 * uint96(U), in30Days, GiftBox.Kind.Fixed, a, w);
        vm.expectRevert(GiftBox.TooSmall.selector);
        box.create(ravi, uint96(U) - 1, in30Days, GiftBox.Kind.Fixed, a, w);
        vm.expectRevert(GiftBox.BadExpiry.selector);
        box.create(ravi, 5 * uint96(U), uint40(block.timestamp + 1 days - 1), GiftBox.Kind.Fixed, a, w);
        vm.expectRevert(GiftBox.BadExpiry.selector);
        box.create(ravi, 5 * uint96(U), uint40(block.timestamp + 365 days + 1), GiftBox.Kind.Fixed, a, w);
        vm.stopPrank();
    }

    function test_create_refusesBadMixes() public {
        vm.startPrank(maya);
        // weights do not add up
        (address[] memory a, uint16[] memory w) = _two(address(stock), 3000, address(eth), 6000);
        vm.expectRevert(GiftBox.BadMix.selector);
        box.create(ravi, 5 * uint96(U), in30Days, GiftBox.Kind.Fixed, a, w);
        // a zero weight
        (a, w) = _two(address(stock), 10_000, address(eth), 0);
        vm.expectRevert(GiftBox.BadMix.selector);
        box.create(ravi, 5 * uint96(U), in30Days, GiftBox.Kind.Fixed, a, w);
        // the same asset twice
        (a, w) = _two(address(stock), 5000, address(stock), 5000);
        vm.expectRevert(GiftBox.BadMix.selector);
        box.create(ravi, 5 * uint96(U), in30Days, GiftBox.Kind.Fixed, a, w);
        // an asset Stackday does not support
        (a, w) = _one(address(usdc));
        vm.expectRevert(abi.encodeWithSelector(GiftBox.UnsupportedAsset.selector, address(usdc)));
        box.create(ravi, 5 * uint96(U), in30Days, GiftBox.Kind.Fixed, a, w);
        // empty, and lengths that do not match
        vm.expectRevert(GiftBox.BadMix.selector);
        box.create(ravi, 5 * uint96(U), in30Days, GiftBox.Kind.Fixed, noAssets, noWeights);
        (a,) = _one(address(stock));
        vm.expectRevert(GiftBox.BadMix.selector);
        box.create(ravi, 5 * uint96(U), in30Days, GiftBox.Kind.Fixed, a, noWeights);
        // a Research box must not carry a mix
        (a, w) = _one(address(stock));
        vm.expectRevert(GiftBox.BadMix.selector);
        box.create(ravi, 5 * uint96(U), in30Days, GiftBox.Kind.Research, a, w);
        vm.stopPrank();
    }

    function test_create_refusesMoreThanSixParts() public {
        address[] memory a = new address[](7);
        uint16[] memory w = new uint16[](7);
        for (uint256 i; i < 7; ++i) {
            a[i] = address(uint160(0x1000 + i));
            w[i] = i == 6 ? 4000 : 1000;
        }
        vm.prank(maya);
        vm.expectRevert(GiftBox.BadMix.selector);
        box.create(ravi, 5 * uint96(U), in30Days, GiftBox.Kind.Fixed, a, w);
    }

    function test_create_checksExactAmountReceived() public {
        FeeUsdc fee = new FeeUsdc();
        GiftBox feeBox =
            new GiftBox(IERC20(address(fee)), factory, swapAdapter, IPriceAdapter(address(priceAdapter)), 0);
        fee.mint(maya, 100 * U);
        vm.startPrank(maya);
        fee.approve(address(feeBox), type(uint256).max);
        vm.expectRevert(GiftBox.AmountMismatch.selector);
        feeBox.create(ravi, 10 * uint96(U), in30Days, GiftBox.Kind.Research, noAssets, noWeights);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ open checks

    function test_open_refusesBadMixesAndSlippage() public {
        vm.prank(maya);
        uint256 rid = box.create(ravi, 5 * uint96(U), in30Days, GiftBox.Kind.Research, noAssets, noWeights);
        (address[] memory a, uint16[] memory w) = _two(address(stock), 5000, address(eth), 4000);
        vm.startPrank(ravi);
        vm.expectRevert(GiftBox.BadMix.selector);
        box.open(rid, 100, a, w);
        vm.expectRevert(GiftBox.BadMix.selector);
        box.open(rid, 100, noAssets, noWeights); // a Research box needs a mix
        vm.expectRevert(GiftBox.BadSlippage.selector);
        box.open(rid, 301, a, w);
        vm.stopPrank();
        assertEq(uint8(box.giftOf(rid).status), uint8(GiftBox.Status.Pending), "still closed after failures");

        (a, w) = _one(address(stock));
        uint256 fid = _send(5 * uint96(U), a, w);
        vm.prank(ravi);
        vm.expectRevert(GiftBox.BadMix.selector);
        box.open(fid, 100, a, w); // a Fixed box cannot be given another mix
    }

    function test_open_refusesShortFill_andBoxStaysRefundable() public {
        ShortSwap shortSwap = new ShortSwap(IERC20(address(usdc)), IPriceAdapter(address(priceAdapter)));
        vm.prank(demoAdmin);
        stock.setMinter(address(shortSwap), true);
        GiftBox badBox = new GiftBox(IERC20(address(usdc)), factory, shortSwap, IPriceAdapter(address(priceAdapter)), 0);
        vm.prank(maya);
        usdc.approve(address(badBox), type(uint256).max);
        (address[] memory a, uint16[] memory w) = _one(address(stock));
        vm.prank(maya);
        uint256 id = badBox.create(ravi, 10 * uint96(U), in30Days, GiftBox.Kind.Fixed, a, w);

        vm.prank(ravi);
        vm.expectRevert(abi.encodeWithSelector(GiftBox.BuyFailed.selector, address(stock)));
        badBox.open(id, 300, noAssets, noWeights);

        vm.prank(maya);
        badBox.revoke(id);
        assertEq(usdc.balanceOf(maya), 10_000 * U, "the sender gets it all back");
    }

    function test_open_refusesStalePrice_whenAgeLimitSet() public {
        GiftBox mainnetLike =
            new GiftBox(IERC20(address(usdc)), factory, swapAdapter, IPriceAdapter(address(priceAdapter)), 26 hours);
        vm.prank(maya);
        usdc.approve(address(mainnetLike), type(uint256).max);
        (address[] memory a, uint16[] memory w) = _one(address(stock));
        vm.prank(maya);
        uint256 id = mainnetLike.create(ravi, 10 * uint96(U), in30Days, GiftBox.Kind.Fixed, a, w);

        uint256 setAt = block.timestamp;
        vm.warp(block.timestamp + 27 hours);
        vm.prank(ravi);
        vm.expectRevert(abi.encodeWithSelector(GiftBox.StalePrice.selector, address(stock), setAt));
        mainnetLike.open(id, 100, noAssets, noWeights);

        _setPrice(PRICE); // fresh price
        vm.prank(ravi);
        mainnetLike.open(id, 100, noAssets, noWeights);
    }

    // ------------------------------------------------------------------ MockSellDesk (chat "sell" on testnet)

    function test_sellDesk_giftThenWithdrawThenSell() public {
        MockSellDesk desk = new MockSellDesk(IERC20(address(usdc)), IPriceAdapter(address(priceAdapter)), 50, demoAdmin);
        usdc.mint(address(desk), 1000 * U);

        (address[] memory a, uint16[] memory w) = _one(address(stock));
        address vault = _open(_send(100 * uint96(U), a, w));
        uint256 amount = EmployeeVault(vault).idleOf(address(stock));

        // The chat's sell card: take it out to my own wallet, then sell to my own wallet.
        vm.startPrank(ravi);
        EmployeeVault(vault).withdraw(address(stock), amount, ravi);
        stock.approve(address(desk), amount);
        uint256 quoted = desk.quote(address(stock), amount);
        uint256 out = desk.swapExactStockForUsdc(address(stock), amount, quoted, ravi);
        vm.stopPrank();

        assertEq(out, quoted);
        assertApproxEqAbs(out, 100 * U * 9950 / 10_000, 2, "price minus the 0.5% spread");
        assertEq(usdc.balanceOf(ravi), out);
        assertEq(stock.balanceOf(ravi), 0);
    }

    function test_sellDesk_eighteenDecimals_slippageAndReserve() public {
        MockSellDesk desk = new MockSellDesk(IERC20(address(usdc)), IPriceAdapter(address(priceAdapter)), 0, demoAdmin);
        vm.prank(address(swapAdapter));
        eth.mint(ravi, 1e18); // 1 ETH at 3,500 USD
        assertEq(desk.quote(address(eth), 1e18), 3500 * U);

        vm.startPrank(ravi);
        eth.approve(address(desk), 1e18);
        vm.expectRevert(abi.encodeWithSelector(MockSellDesk.ReserveTooLow.selector, 3500 * U, 0));
        desk.swapExactStockForUsdc(address(eth), 1e18, 0, ravi);
        vm.stopPrank();

        usdc.mint(address(desk), 5000 * U);
        vm.prank(ravi);
        vm.expectRevert(abi.encodeWithSelector(MockSellDesk.SlippageExceeded.selector, 3500 * U, 3600 * U));
        desk.swapExactStockForUsdc(address(eth), 1e18, 3600 * U, ravi);

        vm.prank(ravi);
        desk.swapExactStockForUsdc(address(eth), 1e18, 3500 * U, ravi);
        assertEq(usdc.balanceOf(ravi), 3500 * U);

        vm.prank(attacker);
        vm.expectRevert();
        desk.withdraw(IERC20(address(usdc)), attacker, 1);

        vm.expectRevert(MockSellDesk.BadSpread.selector);
        new MockSellDesk(IERC20(address(usdc)), IPriceAdapter(address(priceAdapter)), 501, demoAdmin);
    }
}
