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
    /// The real GOOGLc and PAXG (gold) markets on Morpho (Base mainnet) liquidate at 77%; AAPLc, NVDAc,
    /// METAc and SPCXc at 62.5%; cbBTC and WETH at 86%.
    uint256 internal constant LLTV_77 = 0.77e18;
    uint16 internal constant SIP_FEE_BPS = 15; // 0.15% on recurring buys
    uint16 internal constant BORROW_FEE_BPS = 10; // 0.1% of borrowed USDC, once
    uint16 internal constant EARN_FEE_BPS = 10; // 0.1% a year, only out of interest
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
        require(
            MORPHO.isLltvEnabled(STOCK_LLTV) && MORPHO.isLltvEnabled(CRYPTO_LLTV) && MORPHO.isLltvEnabled(LLTV_77),
            "LLTV not enabled on Morpho"
        );

        vm.startBroadcast(pk);

        _asset(deployer, "Mock Apple (Stackday test)", "mAAPL", 8, 357e8, STOCK_LLTV);
        _asset(deployer, "Mock NVIDIA (Stackday test)", "mNVDA", 8, 190e8, STOCK_LLTV);
        _asset(deployer, "Mock Coinbase BTC (Stackday test)", "mcbBTC", 8, 100_000e8, CRYPTO_LLTV);
        _asset(deployer, "Mock Wrapped Ether (Stackday test)", "mWETH", 18, 3500e8, CRYPTO_LLTV);
        // Added November 16, 2026. Real Coinbase tokenized stocks on Base: TSLAc, MSFTc, AMZNc, GOOGLc, METAc.
        // Only assets with a real Morpho market on Base mainnet (checked November 17, 2026). Tesla,
        // Microsoft and Amazon have Coinbase tokens but no Morpho market, so they are not listed.
        _asset(deployer, "Mock Alphabet (Stackday test)", "mGOOGL", 8, 280e8, LLTV_77);
        _asset(deployer, "Mock Meta (Stackday test)", "mMETA", 8, 640e8, STOCK_LLTV);
        // SpaceX is not publicly traded: the mock price is a placeholder, not a market price.
        _asset(deployer, "Mock SpaceX (Stackday test)", "mSPCX", 8, 200e8, STOCK_LLTV);
        // PAX Gold: one token is one troy ounce of gold, 18 decimals like the real PAXG.
        _asset(deployer, "Mock PAX Gold (Stackday test)", "mPAXG", 18, 4060e8, LLTV_77);
        // Invest only (issue #60): real tokens on Base with good buy routes (LI.FI quotes under 1% at
        // $10,000, November 18, 2026) but no Morpho market, so no lending market here either (lltv 0).
        _asset(deployer, "Mock Tesla (Stackday test)", "mTSLA", 8, 381e8, 0);
        _asset(deployer, "Mock Amazon (Stackday test)", "mAMZN", 8, 257e8, 0);
        _asset(deployer, "Mock Microsoft (Stackday test)", "mMSFT", 8, 502e8, 0);
        _asset(deployer, "Mock Strategy (Stackday test)", "mMSTR", 8, 98e8, 0);
        _asset(deployer, "Mock AMD (Stackday test)", "mAMD", 8, 489e8, 0);
        // Funds, 18 decimals. S&P 500 fund token (deSPXA) is borrowable at 77% (issue #65): it has a real
        // Morpho market on Base (test/fork/SpxMorphoFork.t.sol). 0-3 month US Treasuries (wtSGOV) stay invest only.
        _asset(deployer, "Mock S&P 500 fund (Stackday test)", "mSPX", 18, 742e8, LLTV_77);
        _asset(deployer, "Mock 0-3 Month Treasuries (Stackday test)", "mSGOV", 18, 102e8, 0);
        uint256 markets;
        for (uint256 i; i < assets.length; ++i) {
            if (lltvs[i] != 0) markets++;
        }
        require(USDC.balanceOf(deployer) >= markets * liquidity, "Need more test USDC (faucet.circle.com)");
        ChainlinkPriceAdapter priceAdapter = new ChainlinkPriceAdapter(assets, feeds);

        USDC.approve(address(MORPHO), markets * liquidity);
        for (uint256 i; i < assets.length; ++i) {
            if (lltvs[i] == 0) {
                oracles.push(address(0));
                lendingAdapters.push(address(0));
                marketIds.push(bytes32(0));
                continue;
            }
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
        VaultFactory factory = new VaultFactory(assets, lendingAdapters, address(yieldAdapter), feeRecipient, BORROW_FEE_BPS, EARN_FEE_BPS);
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
        vm.serializeUint(k, "borrowFeeBps", BORROW_FEE_BPS);
        vm.serializeUint(k, "earnFeeBps", EARN_FEE_BPS);
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
