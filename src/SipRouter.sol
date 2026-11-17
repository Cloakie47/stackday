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

/// @title SipRouter
/// @notice SIP for everyone, no employer needed. Any wallet can buy stock into its own vault,
/// once or on a schedule. The vault, the borrowing and the risk rules are exactly the same
/// ones payroll users get.
///
/// A recurring plan (one per asset) pulls a fixed USDC amount from the user's wallet at most once per interval.
/// Anyone may trigger a due plan (an automation service, or the user), but a trigger can only
/// ever do what the user's plan says: that amount, that stock, into that user's own vault,
/// at a price within the user's chosen distance from the oracle price. No owner.
/// The only fee is a SIP fee fixed forever at deployment (at most 1%) on the USDC a recurring plan puts
/// into stock. One-time buys are free.
contract SipRouter is ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    uint32 public constant MIN_INTERVAL = 1 days;
    /// The first buy can be scheduled at most this far ahead.
    uint32 public constant MAX_FIRST_BUY_DELAY = 31 days;
    uint16 public constant MAX_SLIPPAGE_BPS = 1000;
    uint16 public constant MAX_SIP_FEE_BPS = 100; // the fee can never be deployed above 1%

    IERC20 public immutable usdc;
    VaultFactory public immutable factory;
    ISwapAdapter public immutable swapAdapter;
    IPriceAdapter public immutable priceAdapter;
    /// @notice Platform fee on USDC a recurring plan puts into stock, in basis points (25 = 0.25%). Cannot be changed.
    uint16 public immutable sipFeeBps;
    address public immutable feeRecipient;
    /// @notice Oldest oracle price (in seconds) a recurring buy may rely on. 0 switches the check off.
    /// Recurring buys are triggered by third parties, and their price protection is the oracle price.
    /// When stock markets are closed that price is frozen, so on mainnet this must be set (for example
    /// 26 hours) or a stale price could be used to fill a buy at a bad market price.
    uint32 public immutable maxPriceAge;

    struct Plan {
        address stock;
        uint96 usdcPerBuy;
        uint32 interval; // seconds between buys
        uint40 nextBuyAt;
        uint16 maxSlippageBps; // how far below the oracle price a buy may fill
    }

    /// @notice One recurring plan per asset, so a user can run several side by side.
    mapping(address user => mapping(address asset => Plan)) public planOf;
    /// @notice Lifetime USDC this user put into `asset` through this router (before any fee). Only ever grows:
    /// a running total for the portfolio's "Total put in". It moves no funds.
    mapping(address user => mapping(address asset => uint256)) public investedOf;

    error ZeroAmount();
    error UnsupportedStock(address stock);
    error BadInterval();
    error BadFirstBuy();
    error BadSlippage();
    error NoPlan();
    error NotDueYet(uint256 nextBuyAt);
    error BadFee();
    error StalePrice(uint256 updatedAt);

    event Invested(address indexed user, address indexed stock, uint256 usdcIn, uint256 stockOut, bool recurring);
    event PlanSet(address indexed user, address stock, uint256 usdcPerBuy, uint32 interval, uint16 maxSlippageBps);
    event PlanCancelled(address indexed user);
    event SipFeePaid(address indexed user, uint256 feeUsdc);

    constructor(
        IERC20 usdc_,
        VaultFactory factory_,
        ISwapAdapter swapAdapter_,
        IPriceAdapter priceAdapter_,
        address feeRecipient_,
        uint16 sipFeeBps_,
        uint32 maxPriceAge_
    ) {
        maxPriceAge = maxPriceAge_;
        if (sipFeeBps_ > MAX_SIP_FEE_BPS) revert BadFee();
        if (sipFeeBps_ > 0 && feeRecipient_ == address(0)) revert BadFee();
        sipFeeBps = sipFeeBps_;
        feeRecipient = feeRecipient_;
        usdc = usdc_;
        factory = factory_;
        swapAdapter = swapAdapter_;
        priceAdapter = priceAdapter_;
    }

    /// @notice One-time buy: `usdcAmount` from the caller's wallet into `stock` in the caller's own vault.
    /// No SIP fee. `minStockOut` is the least stock to receive.
    function invest(address stock, uint256 usdcAmount, uint256 minStockOut)
        external
        nonReentrant
        returns (uint256 stockOut)
    {
        _requireSupported(stock);
        stockOut = _buy(msg.sender, stock, usdcAmount, minStockOut, false);
        emit Invested(msg.sender, stock, usdcAmount, stockOut, false);
    }

    /// @notice Start or change a recurring plan. The caller must also approve this contract to spend their USDC.
    /// @param firstBuyAt when the first buy is due, for example next Monday 11:00 New York time, so buys
    /// land while the stock market is open. 0 or a past time means now. Later buys keep the same slot:
    /// every `interval` after it.
    function setPlan(address stock, uint96 usdcPerBuy, uint32 interval, uint16 maxSlippageBps, uint40 firstBuyAt)
        external
    {
        _requireSupported(stock);
        if (usdcPerBuy == 0) revert ZeroAmount();
        if (interval < MIN_INTERVAL) revert BadInterval();
        if (maxSlippageBps > MAX_SLIPPAGE_BPS) revert BadSlippage();
        if (firstBuyAt > block.timestamp + MAX_FIRST_BUY_DELAY) revert BadFirstBuy();
        uint40 first = firstBuyAt < block.timestamp ? uint40(block.timestamp) : firstBuyAt;
        planOf[msg.sender][stock] = Plan(stock, usdcPerBuy, interval, first, maxSlippageBps);
        emit PlanSet(msg.sender, stock, usdcPerBuy, interval, maxSlippageBps);
    }

    function cancelPlan(address stock) external {
        delete planOf[msg.sender][stock];
        emit PlanCancelled(msg.sender);
    }

    /// @notice Run `user`'s plan for `stock` if it is due. Anyone may call. Reverts (and can be retried later)
    /// if the market price is further from the oracle price than the user allowed, or if the oracle
    /// price is too old to trust (market closed).
    function executePlan(address user, address stock) external nonReentrant returns (uint256 stockOut) {
        Plan memory plan = planOf[user][stock];
        if (plan.usdcPerBuy == 0) revert NoPlan();
        if (block.timestamp < plan.nextBuyAt) revert NotDueYet(plan.nextBuyAt);
        // Stay on the chosen slot (same weekday and time) even if this run is late: the next buy is
        // the first slot after now, never a slot shifted to whenever the trigger happened to arrive.
        uint256 missed = (block.timestamp - plan.nextBuyAt) / plan.interval;
        planOf[user][stock].nextBuyAt = uint40(plan.nextBuyAt + (missed + 1) * plan.interval);

        if (maxPriceAge != 0) {
            (,, uint256 updatedAt) = priceAdapter.getPrice(plan.stock);
            if (block.timestamp - updatedAt > maxPriceAge) revert StalePrice(updatedAt);
        }
        uint256 net = plan.usdcPerBuy - (uint256(plan.usdcPerBuy) * sipFeeBps) / 10_000;
        uint256 minOut = (quoteAtOracle(plan.stock, net) * (10_000 - plan.maxSlippageBps)) / 10_000;
        stockOut = _buy(user, plan.stock, plan.usdcPerBuy, minOut, true);
        emit Invested(user, plan.stock, plan.usdcPerBuy, stockOut, true);
    }

    /// @notice Stock that `usdcAmount` buys at exactly the oracle price.
    function quoteAtOracle(address stock, uint256 usdcAmount) public view returns (uint256) {
        (uint256 price, uint8 priceDecimals,) = priceAdapter.getPrice(stock);
        uint256 usdcUnit = 10 ** IERC20Metadata(address(usdc)).decimals();
        uint256 stockUnit = 10 ** IERC20Metadata(stock).decimals();
        return Math.mulDiv(usdcAmount, stockUnit * 10 ** priceDecimals, price * usdcUnit);
    }

    /// @dev Only recurring buys pay the SIP fee; a one-time buy is free (founder decision, November 16, 2026).
    function _buy(address user, address stock, uint256 usdcAmount, uint256 minStockOut, bool chargeFee)
        internal
        returns (uint256 stockOut)
    {
        if (usdcAmount == 0) revert ZeroAmount();
        address vault = factory.createVault(user);
        usdc.safeTransferFrom(user, address(this), usdcAmount);
        uint256 fee = chargeFee ? (usdcAmount * sipFeeBps) / 10_000 : 0;
        if (fee > 0) {
            usdc.safeTransfer(feeRecipient, fee);
            usdcAmount -= fee;
            emit SipFeePaid(user, fee);
        }
        uint256 beforeBal = IERC20(stock).balanceOf(address(this));
        usdc.forceApprove(address(swapAdapter), usdcAmount);
        swapAdapter.swapExactUsdcForStock(stock, usdcAmount, minStockOut, address(this));
        usdc.forceApprove(address(swapAdapter), 0);
        stockOut = IERC20(stock).balanceOf(address(this)) - beforeBal;
        if (stockOut == 0 || stockOut < minStockOut) revert ZeroAmount();
        investedOf[user][stock] += usdcAmount + fee;
        IERC20(stock).forceApprove(vault, stockOut);
        EmployeeVault(vault).depositStock(stock, stockOut);
    }

    function _requireSupported(address stock) internal view {
        if (factory.lendingAdapterOf(stock) == address(0)) revert UnsupportedStock(stock);
    }
}
