// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISwapAdapter, IPriceAdapter} from "../src/interfaces/IAdapters.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {GiftBox} from "../src/GiftBox.sol";
import {MockSellDesk} from "../src/mocks/Mocks.sol";

/// @notice Adds the gift box and the mock sell desk (issue #77) to the EXISTING testnet deployment.
/// Nothing else is redeployed: both contracts read the current USDC, vault factory, mock exchange and
/// price adapter from the deployment file, and their addresses are added to it.
///
/// Founder only (it changes the official deployment file):
///   forge script script/DeployGifts.s.sol --rpc-url base_sepolia --broadcast --slow
/// Optional: SELL_DESK_RESERVE (test USDC, 6 decimals, default 5 USDC) funds the sell desk.
contract DeployGifts is Script {
    /// Testnet mock prices do not move on their own, so the age check is off, like SipRouter on testnet.
    uint32 internal constant MAX_PRICE_AGE = 0;
    /// The mock desk pays the feed price minus 0.5%.
    uint16 internal constant SELL_SPREAD_BPS = 50;

    function run() external {
        string memory path = vm.envOr("DEPLOYMENTS_FILE", string("deployments/base-sepolia.json"));
        string memory json = vm.readFile(path);
        IERC20 usdc = IERC20(vm.parseJsonAddress(json, ".usdc"));
        VaultFactory factory = VaultFactory(vm.parseJsonAddress(json, ".vaultFactory"));
        ISwapAdapter swap = ISwapAdapter(vm.parseJsonAddress(json, ".mockSwapAdapter"));
        IPriceAdapter prices = IPriceAdapter(vm.parseJsonAddress(json, ".priceAdapter"));
        uint256 reserve = vm.envOr("SELL_DESK_RESERVE", uint256(5e6));

        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        vm.startBroadcast(pk);
        GiftBox box = new GiftBox(usdc, factory, swap, prices, MAX_PRICE_AGE);
        MockSellDesk desk = new MockSellDesk(usdc, prices, SELL_SPREAD_BPS, deployer);
        if (reserve > 0) usdc.transfer(address(desk), reserve);
        vm.stopBroadcast();

        vm.writeJson(vm.toString(address(box)), path, ".giftBox");
        vm.writeJson(vm.toString(address(desk)), path, ".mockSellDesk");
        console2.log("GiftBox", address(box));
        console2.log("MockSellDesk", address(desk));
        console2.log("sell desk reserve (test USDC, 6 decimals)", reserve);
    }
}
