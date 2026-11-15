// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapAdapter} from "../interfaces/IAdapters.sol";

interface ICLPool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1);
}

/// @title SlipstreamSwapAdapter
/// @notice REAL exchange adapter for Base mainnet. Buys a stock token with USDC directly from its
/// Aerodrome Slipstream (concentrated liquidity) pool. The pool list is fixed at deployment. No owner.
/// It holds no funds between calls.
contract SlipstreamSwapAdapter is ISwapAdapter {
    using SafeERC20 for IERC20;

    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    IERC20 public immutable usdc;
    mapping(address stock => address pool) public poolOf;
    address private transient _activePool;

    error LengthMismatch();
    error BadPool(address stock);
    error NoPool(address stock);
    error NotActivePool();
    error SlippageExceeded(uint256 out, uint256 minOut);
    error PartialFill();

    constructor(IERC20 usdc_, address[] memory stocks, address[] memory pools) {
        if (stocks.length != pools.length) revert LengthMismatch();
        usdc = usdc_;
        for (uint256 i; i < stocks.length; ++i) {
            address t0 = ICLPool(pools[i]).token0();
            address t1 = ICLPool(pools[i]).token1();
            bool ok = (t0 == address(usdc_) && t1 == stocks[i]) || (t1 == address(usdc_) && t0 == stocks[i]);
            if (!ok) revert BadPool(stocks[i]);
            poolOf[stocks[i]] = pools[i];
        }
    }

    function swapExactUsdcForStock(address stock, uint256 usdcIn, uint256 minStockOut, address to)
        external
        returns (uint256 stockOut)
    {
        address pool = poolOf[stock];
        if (pool == address(0)) revert NoPool(stock);
        usdc.safeTransferFrom(msg.sender, address(this), usdcIn);

        bool zeroForOne = ICLPool(pool).token0() == address(usdc);
        _activePool = pool;
        (int256 amount0, int256 amount1) = ICLPool(pool).swap(
            to, zeroForOne, int256(usdcIn), zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1, ""
        );
        _activePool = address(0);

        (int256 paid, int256 received) = zeroForOne ? (amount0, amount1) : (amount1, amount0);
        if (paid != int256(usdcIn)) revert PartialFill();
        stockOut = uint256(-received);
        if (stockOut < minStockOut) revert SlippageExceeded(stockOut, minStockOut);
    }

    /// @dev Called by the pool during `swap` to collect the USDC. Only the pool being swapped with may call.
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        if (msg.sender != _activePool) revert NotActivePool();
        int256 owed = amount0Delta > 0 ? amount0Delta : amount1Delta;
        usdc.safeTransfer(msg.sender, uint256(owed));
    }
}
