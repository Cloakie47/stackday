// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IMorpho, MarketParams} from "../src/interfaces/IMorpho.sol";
import {IPriceAdapter} from "../src/interfaces/IAdapters.sol";
import {MorphoLendingAdapter} from "../src/adapters/MorphoLendingAdapter.sol";
import {ChainlinkPriceAdapter, FeedOracle, IAggregatorV3} from "../src/adapters/ChainlinkPriceAdapter.sol";
import {ERC4626YieldAdapter} from "../src/adapters/ERC4626YieldAdapter.sol";
import {MockStockToken, MockPriceFeed, MockSwapAdapter, MockYieldVault} from "../src/mocks/Mocks.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {Payroll} from "../src/Payroll.sol";
import {SipRouter} from "../src/SipRouter.sol";

/// @notice Deploys Stackday to Base Sepolia (testnet only, refuses any other network).
/// REAL on testnet: Morpho, its interest rate model, Circle test USDC, all Stackday contracts.
/// MOCK on testnet: the asset tokens (stocks, BTC, ETH), their price feeds, the exchange, the interest vault.
contract Deploy is Script {
    IMorpho internal constant MORPHO = IMorpho(0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb);
    address internal constant IRM = 0x46415998764C29aB2a25CbeA6254146D50D22687;
    IERC20 internal constant USDC = IERC20(0x036CbD53842c5426634e7929541eC2318f3dCF7e);
    /// Liquidation limits, matching the main real Morpho markets on Base for each kind of asset.
    uint256 internal constant STOCK_LLTV = 0.625e18;
    uint256 internal constant CRYPTO_LLTV = 0.86e18;
    uint16 internal constant SIP_FEE_BPS = 25;
    /// Off on testnet: the mock price feed is only updated when the demo operator changes it.
    /// On mainnet this must be about 26 hours (the real feeds update at least every 24 hours while markets are open).
    uint32 internal constant MAX_PRICE_AGE = 0;
    /// One minute on testnet so a recurring payroll can be shown in a demo. One day on mainnet.
    uint32 internal constant MIN_SCHEDULE_INTERVAL = 60;

    string[] internal symbols;
    address[] internal assets;
    address[] internal feeds;
    uint256[] internal lltvs;
    address[] internal lendingAdapters;
    bytes32[] internal marketIds;
    address[] internal oracles;

    function run() external {
        require(block.chainid == 84532, "Stackday deploy: Base Sepolia only");
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address feeRecipient = vm.envOr("FEE_RECIPIENT", deployer);
        uint256 liquidity = vm.envOr("MARKET_LIQUIDITY_USDC", uint256(2e6));
        require(MORPHO.isLltvEnabled(STOCK_LLTV) && MORPHO.isLltvEnabled(CRYPTO_LLTV), "LLTV not enabled on Morpho");

        vm.startBroadcast(pk);

        _asset(deployer, "Mock Apple (Stackday test)", "mAAPL", 8, 357e8, STOCK_LLTV);
        _asset(deployer, "Mock NVIDIA (Stackday test)", "mNVDA", 8, 190e8, STOCK_LLTV);
        _asset(deployer, "Mock Coinbase BTC (Stackday test)", "mcbBTC", 8, 100_000e8, CRYPTO_LLTV);
        _asset(deployer, "Mock Wrapped Ether (Stackday test)", "mWETH", 18, 3500e8, CRYPTO_LLTV);
        // Added November 16, 2026. Real Coinbase tokenized stocks on Base: TSLAc, MSFTc, AMZNc, GOOGLc, METAc.
        _asset(deployer, "Mock Tesla (Stackday test)", "mTSLA", 8, 430e8, STOCK_LLTV);
        _asset(deployer, "Mock Microsoft (Stackday test)", "mMSFT", 8, 510e8, STOCK_LLTV);
        _asset(deployer, "Mock Amazon (Stackday test)", "mAMZN", 8, 235e8, STOCK_LLTV);
        _asset(deployer, "Mock Alphabet (Stackday test)", "mGOOGL", 8, 280e8, STOCK_LLTV);
        _asset(deployer, "Mock Meta (Stackday test)", "mMETA", 8, 640e8, STOCK_LLTV);
        require(USDC.balanceOf(deployer) >= assets.length * liquidity, "Need more test USDC (faucet.circle.com)");
        ChainlinkPriceAdapter priceAdapter = new ChainlinkPriceAdapter(assets, feeds);

        USDC.approve(address(MORPHO), assets.length * liquidity);
        for (uint256 i; i < assets.length; ++i) {
            FeedOracle oracle = new FeedOracle(IAggregatorV3(feeds[i]), assets[i], address(USDC));
            MarketParams memory params = MarketParams(address(USDC), assets[i], address(oracle), IRM, lltvs[i]);
            MORPHO.createMarket(params);
            MorphoLendingAdapter adapter = new MorphoLendingAdapter(MORPHO, params);
            MORPHO.supply(params, liquidity, 0, deployer, "");
            oracles.push(address(oracle));
            lendingAdapters.push(address(adapter));
            marketIds.push(adapter.marketId());
        }

        MockYieldVault yieldVault = new MockYieldVault(USDC);
        ERC4626YieldAdapter yieldAdapter = new ERC4626YieldAdapter(yieldVault);
        VaultFactory factory = new VaultFactory(assets, lendingAdapters, address(yieldAdapter));
        MockSwapAdapter swapAdapter = new MockSwapAdapter(USDC, IPriceAdapter(address(priceAdapter)), deployer);
        for (uint256 i; i < assets.length; ++i) {
            MockStockToken(assets[i]).setMinter(address(swapAdapter), true);
        }
        Payroll payroll = new Payroll(USDC, factory, swapAdapter, feeRecipient, SIP_FEE_BPS, MIN_SCHEDULE_INTERVAL);
        SipRouter router = new SipRouter(
            USDC, factory, swapAdapter, IPriceAdapter(address(priceAdapter)), feeRecipient, SIP_FEE_BPS, MAX_PRICE_AGE
        );

        vm.stopBroadcast();

        string memory k = "stackday";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeAddress(k, "deployer", deployer);
        vm.serializeAddress(k, "feeRecipient", feeRecipient);
        vm.serializeUint(k, "sipFeeBps", SIP_FEE_BPS);
        vm.serializeUint(k, "minScheduleInterval", MIN_SCHEDULE_INTERVAL);
        vm.serializeAddress(k, "usdc", address(USDC));
        vm.serializeAddress(k, "morpho", address(MORPHO));
        vm.serializeAddress(k, "morphoIrm", IRM);
        vm.serializeAddress(k, "payroll", address(payroll));
        vm.serializeAddress(k, "sipRouter", address(router));
        vm.serializeAddress(k, "vaultFactory", address(factory));
        vm.serializeAddress(k, "vaultImplementation", factory.implementation());
        vm.serializeAddress(k, "priceAdapter", address(priceAdapter));
        vm.serializeAddress(k, "mockSwapAdapter", address(swapAdapter));
        vm.serializeAddress(k, "mockYieldVault", address(yieldVault));
        vm.serializeString(k, "assetSymbols", symbols);
        for (uint256 i; i < assets.length; ++i) {
            string memory s = symbols[i];
            vm.serializeAddress(k, s, assets[i]);
            vm.serializeAddress(k, string.concat(s, "Feed"), feeds[i]);
            vm.serializeAddress(k, string.concat(s, "Oracle"), oracles[i]);
            vm.serializeAddress(k, string.concat(s, "LendingAdapter"), lendingAdapters[i]);
            vm.serializeBytes32(k, string.concat(s, "MarketId"), marketIds[i]);
            vm.serializeUint(k, string.concat(s, "Lltv"), lltvs[i]);
        }
        string memory json = vm.serializeAddress(k, "yieldAdapter", address(yieldAdapter));
        string memory path = vm.envOr("DEPLOYMENTS_FILE", string("deployments/base-sepolia.json"));
        vm.writeJson(json, path);

        console2.log("Stackday deployed. Addresses saved to", path);
        console2.log("Payroll      ", address(payroll));
        console2.log("SipRouter    ", address(router));
        console2.log("VaultFactory ", address(factory));
    }

    function _asset(address owner, string memory name, string memory symbol, uint8 decimals, int256 price, uint256 lltv)
        internal
    {
        symbols.push(symbol);
        assets.push(address(new MockStockToken(name, symbol, decimals, owner)));
        feeds.push(address(new MockPriceFeed(price, owner)));
        lltvs.push(lltv);
    }
}
