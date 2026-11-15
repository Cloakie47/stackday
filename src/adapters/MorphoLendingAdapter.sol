// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ILendingAdapter} from "../interfaces/IAdapters.sol";
import {IMorpho, IMorphoIrm, IMorphoOracle, MarketParams, Market} from "../interfaces/IMorpho.sol";

/// @title MorphoLendingAdapter
/// @notice Connects employee vaults to ONE existing Morpho market (stock collateral, USDC loan).
/// It has no owner and no settings. Every function acts only on the caller's own position
/// (`msg.sender`), so authorising this adapter at Morpho cannot let anyone touch another vault.
contract MorphoLendingAdapter is ILendingAdapter {
    using SafeERC20 for IERC20;

    uint256 internal constant WAD = 1e18;
    uint256 internal constant ORACLE_PRICE_SCALE = 1e36;
    uint256 internal constant VIRTUAL_SHARES = 1e6;
    uint256 internal constant VIRTUAL_ASSETS = 1;

    IMorpho public immutable morpho;
    address public immutable loanToken;
    address public immutable collateralToken;
    address public immutable oracle;
    address public immutable irm;
    uint256 public immutable lltv;
    bytes32 public immutable marketId;

    error MarketNotCreated();
    error ZeroAmount();

    constructor(IMorpho morpho_, MarketParams memory params) {
        morpho = morpho_;
        loanToken = params.loanToken;
        collateralToken = params.collateralToken;
        oracle = params.oracle;
        irm = params.irm;
        lltv = params.lltv;
        marketId = keccak256(abi.encode(params));
        (,,,, uint128 lastUpdate,) = morpho_.market(marketId);
        if (lastUpdate == 0) revert MarketNotCreated();
    }

    function marketParams() public view returns (MarketParams memory) {
        return MarketParams(loanToken, collateralToken, oracle, irm, lltv);
    }

    // ------------------------------------------------------------------ actions

    function setupCall() external view returns (address target, bytes memory data) {
        return (address(morpho), abi.encodeCall(IMorpho.setAuthorization, (address(this), true)));
    }

    function supplyCollateral(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        IERC20(collateralToken).safeTransferFrom(msg.sender, address(this), amount);
        IERC20(collateralToken).forceApprove(address(morpho), amount);
        morpho.supplyCollateral(marketParams(), amount, msg.sender, "");
    }

    function withdrawCollateral(uint256 amount, address receiver) external {
        if (amount == 0) revert ZeroAmount();
        morpho.withdrawCollateral(marketParams(), amount, msg.sender, receiver);
    }

    function borrow(uint256 amount, address receiver) external {
        if (amount == 0) revert ZeroAmount();
        morpho.borrow(marketParams(), amount, 0, msg.sender, receiver);
    }

    function repay(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        IERC20(loanToken).safeTransferFrom(msg.sender, address(this), amount);
        IERC20(loanToken).forceApprove(address(morpho), amount);
        morpho.repay(marketParams(), amount, 0, msg.sender, "");
    }

    function repayAll() external returns (uint256 repaid) {
        MarketParams memory params = marketParams();
        morpho.accrueInterest(params);
        (, uint128 borrowShares,) = morpho.position(marketId, msg.sender);
        if (borrowShares == 0) return 0;
        (,, uint128 totalBorrowAssets, uint128 totalBorrowShares,,) = morpho.market(marketId);
        repaid = _toAssetsUp(borrowShares, totalBorrowAssets, totalBorrowShares);
        IERC20(loanToken).safeTransferFrom(msg.sender, address(this), repaid);
        IERC20(loanToken).forceApprove(address(morpho), repaid);
        morpho.repay(params, 0, borrowShares, msg.sender, "");
        IERC20(loanToken).forceApprove(address(morpho), 0);
        uint256 left = IERC20(loanToken).balanceOf(address(this));
        if (left > 0) IERC20(loanToken).safeTransfer(msg.sender, left);
    }

    function accrue() external {
        morpho.accrueInterest(marketParams());
    }

    // -------------------------------------------------------------------- views

    function collateralOf(address account) public view returns (uint256 collateral) {
        (,, collateral) = morpho.position(marketId, account);
    }

    function debtOf(address account) public view returns (uint256) {
        (, uint128 borrowShares,) = morpho.position(marketId, account);
        if (borrowShares == 0) return 0;
        (uint256 totalBorrowAssets, uint256 totalBorrowShares) = _expectedBorrowTotals();
        return _toAssetsUp(borrowShares, totalBorrowAssets, totalBorrowShares);
    }

    function maxDebt(address account) public view returns (uint256) {
        uint256 collateralValue = Math.mulDiv(collateralOf(account), IMorphoOracle(oracle).price(), ORACLE_PRICE_SCALE);
        return Math.mulDiv(collateralValue, lltv, WAD);
    }

    function healthFactor(address account) external view returns (uint256) {
        uint256 debt = debtOf(account);
        if (debt == 0) return type(uint256).max;
        return Math.mulDiv(maxDebt(account), WAD, debt);
    }

    function liquidationLtv() external view returns (uint256) {
        return lltv;
    }

    function borrowRatePerSecond() public view returns (uint256) {
        if (irm == address(0)) return 0;
        return IMorphoIrm(irm).borrowRateView(marketParams(), _market());
    }

    /// @notice Price of one smallest unit of collateral in smallest units of USDC, scaled by 1e36 (Morpho format).
    function oraclePrice() external view returns (uint256) {
        return IMorphoOracle(oracle).price();
    }

    /// @notice USDC currently available to borrow in this market.
    function availableLiquidity() external view returns (uint256) {
        Market memory m = _market();
        return m.totalSupplyAssets > m.totalBorrowAssets ? m.totalSupplyAssets - m.totalBorrowAssets : 0;
    }

    // ----------------------------------------------------------------- internal

    function _market() internal view returns (Market memory m) {
        (m.totalSupplyAssets, m.totalSupplyShares, m.totalBorrowAssets, m.totalBorrowShares, m.lastUpdate, m.fee) =
            morpho.market(marketId);
    }

    /// @dev Same interest formula Morpho applies when it accrues, so views match what a transaction would see.
    function _expectedBorrowTotals() internal view returns (uint256 totalBorrowAssets, uint256 totalBorrowShares) {
        Market memory m = _market();
        totalBorrowAssets = m.totalBorrowAssets;
        totalBorrowShares = m.totalBorrowShares;
        uint256 elapsed = block.timestamp - m.lastUpdate;
        if (elapsed != 0 && totalBorrowAssets != 0 && irm != address(0)) {
            uint256 rate = IMorphoIrm(irm).borrowRateView(marketParams(), m);
            uint256 first = rate * elapsed;
            uint256 second = Math.mulDiv(first, first, 2 * WAD);
            uint256 third = Math.mulDiv(second, first, 3 * WAD);
            totalBorrowAssets += Math.mulDiv(totalBorrowAssets, first + second + third, WAD);
        }
    }

    function _toAssetsUp(uint256 shares, uint256 totalAssets, uint256 totalShares) internal pure returns (uint256) {
        return Math.mulDiv(shares, totalAssets + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES, Math.Rounding.Ceil);
    }
}
