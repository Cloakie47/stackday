// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Where Stackday buys a stock token with USDC.
/// Testnet: MockSwapAdapter. Mainnet: a DEX adapter (Aerodrome).
interface ISwapAdapter {
    /// @notice Pulls `usdcIn` USDC from the caller, sends at least `minStockOut` of `stock` to `to`.
    function swapExactUsdcForStock(address stock, uint256 usdcIn, uint256 minStockOut, address to)
        external
        returns (uint256 stockOut);
}

/// @notice Sell direction (issues #35 and #77): asset in, USDC out. Testnet: MockSellDesk. Mainnet: a real DEX
/// route, still to be built.
interface ISellAdapter {
    /// @notice Pulls `stockIn` of `stock` from the caller, sends at least `minUsdcOut` USDC to `to`.
    function swapExactStockForUsdc(address stock, uint256 stockIn, uint256 minUsdcOut, address to)
        external
        returns (uint256 usdcOut);
}

/// @notice Where Stackday reads a stock token's USD price.
interface IPriceAdapter {
    /// @return price USD price of one whole token
    /// @return decimals number of decimals in `price`
    /// @return updatedAt time of the last price update (stale when markets are closed)
    function getPrice(address token) external view returns (uint256 price, uint8 decimals, uint256 updatedAt);
}

/// @notice One lending market (one stock as collateral, USDC as the loan).
/// Every function acts ONLY on the caller's own position. The adapter never
/// holds funds between calls and has no owner.
interface ILendingAdapter {
    function collateralToken() external view returns (address);
    function loanToken() external view returns (address);

    /// @notice One call the vault makes once so the adapter may act for it at the lending market.
    function setupCall() external view returns (address target, bytes memory data);

    function supplyCollateral(uint256 amount) external;
    function withdrawCollateral(uint256 amount, address receiver) external;
    function borrow(uint256 amount, address receiver) external;
    function repay(uint256 amount) external;
    /// @notice Repays the caller's whole debt. Caller must have approved `debtOf(caller)` after `accrue()`.
    function repayAll() external returns (uint256 repaid);
    /// @notice Brings the market's interest up to date.
    function accrue() external;

    function collateralOf(address account) external view returns (uint256);
    /// @notice Debt in USDC including interest up to now.
    function debtOf(address account) external view returns (uint256);
    /// @notice Debt at which the account becomes liquidatable, at the current price.
    function maxDebt(address account) external view returns (uint256);
    /// @notice 1e18 = exactly at the liquidation line. Higher is safer. type(uint256).max when there is no debt.
    function healthFactor(address account) external view returns (uint256);
    /// @notice Loan-to-value at which liquidation is allowed, 1e18 = 100 percent.
    function liquidationLtv() external view returns (uint256);
    /// @notice Current borrow interest rate per second, 1e18 = 100 percent.
    function borrowRatePerSecond() external view returns (uint256);
    /// @notice Identifier of the exact market used.
    function marketId() external view returns (bytes32);
}

/// @notice Where an employee's idle USDC earns interest (a Morpho vault, or Aave later).
/// The position always belongs to the caller. The adapter holds nothing between calls and has no owner.
interface IYieldAdapter {
    function asset() external view returns (address);
    /// @notice Token that represents the position. The caller approves it before withdrawing.
    function positionToken() external view returns (address);
    /// @notice Pulls `amount` of the asset from the caller and puts it to work for the caller.
    function deposit(uint256 amount) external;
    function withdraw(uint256 amount, address receiver) external;
    function withdrawAll(address receiver) external returns (uint256 amount);
    /// @notice Current value of `account`'s position in the asset, including interest.
    function balanceOf(address account) external view returns (uint256);
}
