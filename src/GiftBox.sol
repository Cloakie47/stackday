// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {ISwapAdapter, IPriceAdapter} from "./interfaces/IAdapters.sol";
import {VaultFactory} from "./VaultFactory.sol";
import {EmployeeVault} from "./EmployeeVault.sol";

/// @title GiftBox
/// @notice Stock gift boxes (issue #77). A sender puts USDC in a box for one recipient wallet. When the
/// recipient opens it, the box buys the chosen mix of assets with that USDC and puts them straight into
/// the recipient's own vault as free stock (never locked as collateral).
///
/// The box holds only USDC until it is opened, so it is always worth exactly what was sent, a refund is
/// always the exact USDC, and stock transfer rules can never trap a box.
///
/// Two kinds of box:
/// - Fixed: the mix (up to 6 assets and their weights) is set by the sender at creation. This covers
///   "one stock", "my mix" and "surprise" (a random mix picked by the app when sending).
/// - Research: the mix is chosen when the box is opened, from the latest approved Stackday research.
///   The recipient's opening transaction carries that mix. The contract checks it is a valid mix of
///   supported assets; it cannot check the research itself. The app shows the mix before signing.
///
/// No owner, no admin, no pause, no upgrade, no fee and no rescue. Refunds only ever go to the sender.
contract GiftBox is ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    enum Kind {
        Fixed,
        Research
    }

    enum Status {
        None,
        Pending,
        Opened,
        Revoked,
        Declined,
        Refunded
    }

    struct Gift {
        address sender;
        uint96 usdc; // exact USDC held for this box
        address recipient; // fixed at creation; the only wallet that can open or decline
        uint40 expiresAt; // the box can be opened while block.timestamp < expiresAt
        Kind kind;
        Status status;
    }

    struct Leg {
        address asset;
        uint16 weightBps; // share of the box, all legs add up to 10_000
    }

    uint256 public constant MAX_LEGS = 6;
    uint16 public constant MAX_SLIPPAGE_BPS = 300;
    uint40 public constant MIN_DURATION = 1 days;
    uint40 public constant MAX_DURATION = 365 days;

    IERC20 public immutable usdc;
    VaultFactory public immutable factory;
    ISwapAdapter public immutable swapAdapter;
    IPriceAdapter public immutable priceAdapter;
    /// @notice Oldest oracle price (seconds) an opening may rely on. 0 switches the check off (testnet mocks).
    /// On mainnet it must be set (for example 26 hours), because the slippage floor comes from the oracle.
    uint32 public immutable maxPriceAge;
    /// @notice Smallest box: 1 USDC, so every part of a mix can buy something.
    uint256 public immutable minGift;

    uint256 public nextId = 1;
    mapping(uint256 id => Gift) internal gifts;
    mapping(uint256 id => Leg[]) internal legs;

    error ZeroAddress();
    error SelfGift();
    error TooSmall();
    error BadExpiry();
    error BadMix();
    error UnsupportedAsset(address asset);
    error NotPending();
    error NotRecipient();
    error NotSender();
    error Expired();
    error NotExpired();
    error BadSlippage();
    error AmountMismatch();
    error StalePrice(address asset, uint256 updatedAt);
    error BuyFailed(address asset);

    event GiftCreated(
        uint256 indexed id,
        address indexed sender,
        address indexed recipient,
        uint256 usdc,
        Kind kind,
        uint256 expiresAt
    );
    event GiftPartBought(uint256 indexed id, address indexed asset, uint256 usdcIn, uint256 assetOut);
    event GiftOpened(uint256 indexed id, address indexed recipient, address vault);
    event GiftRevoked(uint256 indexed id);
    event GiftDeclined(uint256 indexed id);
    event GiftRefunded(uint256 indexed id);

    constructor(
        IERC20 usdc_,
        VaultFactory factory_,
        ISwapAdapter swapAdapter_,
        IPriceAdapter priceAdapter_,
        uint32 maxPriceAge_
    ) {
        if (
            address(usdc_) == address(0) || address(factory_) == address(0) || address(swapAdapter_) == address(0)
                || address(priceAdapter_) == address(0)
        ) revert ZeroAddress();
        usdc = usdc_;
        factory = factory_;
        swapAdapter = swapAdapter_;
        priceAdapter = priceAdapter_;
        maxPriceAge = maxPriceAge_;
        minGift = 10 ** IERC20Metadata(address(usdc_)).decimals();
    }

    // ------------------------------------------------------------------ send

    /// @notice Lock `amount` USDC from the caller's wallet in a box for `recipient`.
    /// @param assets,weightsBps the mix for a Fixed box (both empty for a Research box)
    function create(
        address recipient,
        uint96 amount,
        uint40 expiresAt,
        Kind kind,
        address[] calldata assets,
        uint16[] calldata weightsBps
    ) external nonReentrant returns (uint256 id) {
        if (recipient == address(0) || recipient == address(this)) revert ZeroAddress();
        if (recipient == msg.sender) revert SelfGift();
        if (amount < minGift) revert TooSmall();
        if (expiresAt < block.timestamp + MIN_DURATION || expiresAt > block.timestamp + MAX_DURATION) {
            revert BadExpiry();
        }

        id = nextId++;
        if (kind == Kind.Fixed) {
            _checkMix(assets, weightsBps);
            for (uint256 i; i < assets.length; ++i) {
                legs[id].push(Leg(assets[i], weightsBps[i]));
            }
        } else if (assets.length != 0 || weightsBps.length != 0) {
            revert BadMix();
        }

        gifts[id] = Gift(msg.sender, amount, recipient, expiresAt, kind, Status.Pending);

        uint256 beforeBal = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        if (usdc.balanceOf(address(this)) - beforeBal != amount) revert AmountMismatch();

        emit GiftCreated(id, msg.sender, recipient, amount, kind, expiresAt);
    }

    // ------------------------------------------------------------------ open

    /// @notice Open the box: buy the mix with its USDC, straight into the recipient's own vault.
    /// @param maxSlippageBps how far below the oracle price each buy may fill (at most 3%)
    /// @param researchAssets,researchWeightsBps the mix for a Research box (both empty for a Fixed box)
    function open(
        uint256 id,
        uint16 maxSlippageBps,
        address[] calldata researchAssets,
        uint16[] calldata researchWeightsBps
    ) external nonReentrant returns (address vault) {
        Gift storage g = gifts[id];
        if (g.status != Status.Pending) revert NotPending();
        if (msg.sender != g.recipient) revert NotRecipient();
        if (block.timestamp >= g.expiresAt) revert Expired();
        if (maxSlippageBps > MAX_SLIPPAGE_BPS) revert BadSlippage();

        if (g.kind == Kind.Research) {
            _checkMix(researchAssets, researchWeightsBps);
            for (uint256 i; i < researchAssets.length; ++i) {
                legs[id].push(Leg(researchAssets[i], researchWeightsBps[i]));
            }
        } else if (researchAssets.length != 0 || researchWeightsBps.length != 0) {
            revert BadMix();
        }

        g.status = Status.Opened; // effects before any external call
        vault = factory.createVault(g.recipient);
        _buyMix(id, vault, g.usdc, maxSlippageBps);
        emit GiftOpened(id, g.recipient, vault);
    }

    // ------------------------------------------------------------------ refunds

    /// @notice The sender takes the box back while it is still unopened.
    function revoke(uint256 id) external nonReentrant {
        Gift storage g = gifts[id];
        if (g.status != Status.Pending) revert NotPending();
        if (msg.sender != g.sender) revert NotSender();
        g.status = Status.Revoked;
        usdc.safeTransfer(g.sender, g.usdc);
        emit GiftRevoked(id);
    }

    /// @notice The recipient refuses the box. The USDC goes back to the sender.
    function decline(uint256 id) external nonReentrant {
        Gift storage g = gifts[id];
        if (g.status != Status.Pending) revert NotPending();
        if (msg.sender != g.recipient) revert NotRecipient();
        g.status = Status.Declined;
        usdc.safeTransfer(g.sender, g.usdc);
        emit GiftDeclined(id);
    }

    /// @notice After expiry anyone may send the USDC back to the sender (the keeper does it daily).
    /// The money can only go to the sender, so letting anyone trigger it is safe.
    function refundExpired(uint256 id) external nonReentrant {
        Gift storage g = gifts[id];
        if (g.status != Status.Pending) revert NotPending();
        if (block.timestamp < g.expiresAt) revert NotExpired();
        g.status = Status.Refunded;
        usdc.safeTransfer(g.sender, g.usdc);
        emit GiftRefunded(id);
    }

    // ------------------------------------------------------------------ views

    function giftOf(uint256 id) external view returns (Gift memory) {
        return gifts[id];
    }

    /// @notice The mix of a box. Empty for an unopened Research box.
    function legsOf(uint256 id) external view returns (Leg[] memory) {
        return legs[id];
    }

    /// @notice Amount of `asset` that `usdcAmount` buys at exactly the oracle price.
    function quoteAtOracle(address asset, uint256 usdcAmount) public view returns (uint256) {
        (uint256 price, uint8 priceDecimals,) = priceAdapter.getPrice(asset);
        uint256 usdcUnit = 10 ** IERC20Metadata(address(usdc)).decimals();
        uint256 assetUnit = 10 ** IERC20Metadata(asset).decimals();
        return Math.mulDiv(usdcAmount, assetUnit * 10 ** priceDecimals, price * usdcUnit);
    }

    // ------------------------------------------------------------------ internal

    function _checkMix(address[] calldata assets, uint16[] calldata weightsBps) internal view {
        uint256 n = assets.length;
        if (n == 0 || n > MAX_LEGS || n != weightsBps.length) revert BadMix();
        uint256 sum;
        for (uint256 i; i < n; ++i) {
            if (weightsBps[i] == 0) revert BadMix();
            if (!factory.isSupported(assets[i])) revert UnsupportedAsset(assets[i]);
            for (uint256 j; j < i; ++j) {
                if (assets[j] == assets[i]) revert BadMix();
            }
            sum += weightsBps[i];
        }
        if (sum != 10_000) revert BadMix();
    }

    function _buyMix(uint256 id, address vault, uint256 total, uint16 maxSlippageBps) internal {
        Leg[] storage mix = legs[id];
        uint256 n = mix.length;
        uint256 spent;
        for (uint256 i; i < n; ++i) {
            // The last part takes the rounding remainder, so every unit of USDC is used.
            uint256 part = i + 1 == n ? total - spent : (total * mix[i].weightBps) / 10_000;
            spent += part;
            _buyInto(id, vault, mix[i].asset, part, maxSlippageBps);
        }
    }

    function _buyInto(uint256 id, address vault, address asset, uint256 usdcIn, uint16 maxSlippageBps) internal {
        if (maxPriceAge != 0) {
            (,, uint256 updatedAt) = priceAdapter.getPrice(asset);
            if (block.timestamp - updatedAt > maxPriceAge) revert StalePrice(asset, updatedAt);
        }
        uint256 minOut = (quoteAtOracle(asset, usdcIn) * (10_000 - maxSlippageBps)) / 10_000;
        uint256 beforeBal = IERC20(asset).balanceOf(address(this));
        usdc.forceApprove(address(swapAdapter), usdcIn);
        swapAdapter.swapExactUsdcForStock(asset, usdcIn, minOut, address(this));
        usdc.forceApprove(address(swapAdapter), 0);
        uint256 out = IERC20(asset).balanceOf(address(this)) - beforeBal;
        if (out == 0 || out < minOut) revert BuyFailed(asset);
        IERC20(asset).forceApprove(vault, out);
        EmployeeVault(vault).depositStock(asset, out);
        emit GiftPartBought(id, asset, usdcIn, out);
    }
}
