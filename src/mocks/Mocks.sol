// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ISwapAdapter, IPriceAdapter} from "../interfaces/IAdapters.sol";

// =============================================================================
//  MOCKS. TESTNET AND TESTS ONLY. These are NOT real stocks, prices or trades.
//  They have an owner (the demo operator) on purpose, so stress scenarios can be
//  triggered. The real Stackday contracts (Payroll, VaultFactory, EmployeeVault,
//  adapters) have no owner at all.
// =============================================================================

/// @notice MOCK stand-in for an asset token: a Coinbase tokenized stock (8 decimals like the real ones),
/// or a BTC or ETH token such as cbBTC (8 decimals) or WETH (18 decimals).
contract MockStockToken is ERC20, Ownable {
    /// @notice Shares per token, 1e18 = 1.0. Real tokens raise this when dividends are reinvested.
    uint256 public multiplier = 1e18;
    bool public transfersPaused;
    mapping(address => bool) public isMinter;

    error TransfersPaused();
    error NotMinter();

    event TransfersPausedSet(bool paused);
    event MultiplierSet(uint256 multiplier);

    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address owner_)
        ERC20(name_, symbol_)
        Ownable(owner_)
    {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function setMinter(address minter, bool allowed) external onlyOwner {
        isMinter[minter] = allowed;
    }

    function mint(address to, uint256 amount) external {
        if (!isMinter[msg.sender] && msg.sender != owner()) revert NotMinter();
        _mint(to, amount);
    }

    /// @notice Stress switch: simulates the issuer pausing all transfers.
    function setTransfersPaused(bool paused) external onlyOwner {
        transfersPaused = paused;
        emit TransfersPausedSet(paused);
    }

    /// @notice Simulates a reinvested dividend.
    function setMultiplier(uint256 multiplier_) external onlyOwner {
        multiplier = multiplier_;
        emit MultiplierSet(multiplier_);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (transfersPaused) revert TransfersPaused();
        super._update(from, to, value);
    }
}

/// @notice MOCK Chainlink-style price feed with a settable price. 8 decimals like the real stock feeds.
contract MockPriceFeed is Ownable {
    uint8 public constant decimals = 8;
    int256 public answer;
    uint256 public updatedAt;
    uint80 public roundId;
    /// @notice True simulates a closed market: the price holds and its timestamp stops moving.
    bool public frozen;

    error FeedFrozen();
    error BadPrice();

    event PriceSet(int256 price, uint256 updatedAt);
    event FrozenSet(bool frozen);

    constructor(int256 initialPrice, address owner_) Ownable(owner_) {
        _set(initialPrice);
    }

    function setPrice(int256 price) external onlyOwner {
        if (frozen) revert FeedFrozen();
        _set(price);
    }

    function setFrozen(bool frozen_) external onlyOwner {
        frozen = frozen_;
        emit FrozenSet(frozen_);
    }

    /// @notice Market reopens at a new price after a gap (overnight or weekend).
    function reopenAt(int256 price) external onlyOwner {
        frozen = false;
        emit FrozenSet(false);
        _set(price);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, updatedAt, updatedAt, roundId);
    }

    function _set(int256 price) internal {
        if (price <= 0) revert BadPrice();
        answer = price;
        updatedAt = block.timestamp;
        roundId++;
        emit PriceSet(price, block.timestamp);
    }
}

/// @notice MOCK exchange. Sells mock stock for USDC at exactly the feed price by minting it.
/// The USDC it collects stays here and the demo operator can take it back out to refill payroll.
contract MockSwapAdapter is ISwapAdapter, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    IPriceAdapter public immutable priceAdapter;

    error SlippageExceeded(uint256 out, uint256 minOut);

    constructor(IERC20 usdc_, IPriceAdapter priceAdapter_, address owner_) Ownable(owner_) {
        usdc = usdc_;
        priceAdapter = priceAdapter_;
    }

    function quote(address stock, uint256 usdcIn) public view returns (uint256 stockOut) {
        (uint256 price, uint8 priceDecimals,) = priceAdapter.getPrice(stock);
        uint256 usdcUnit = 10 ** IERC20Metadata(address(usdc)).decimals();
        uint256 stockUnit = 10 ** IERC20Metadata(stock).decimals();
        // usd value = usdcIn / usdcUnit ; tokens = usd * 10^priceDecimals / price
        stockOut = Math.mulDiv(usdcIn, stockUnit * 10 ** priceDecimals, price * usdcUnit);
    }

    function swapExactUsdcForStock(address stock, uint256 usdcIn, uint256 minStockOut, address to)
        external
        returns (uint256 stockOut)
    {
        stockOut = quote(stock, usdcIn);
        if (stockOut < minStockOut) revert SlippageExceeded(stockOut, minStockOut);
        usdc.safeTransferFrom(msg.sender, address(this), usdcIn);
        MockStockToken(stock).mint(to, stockOut);
    }

    /// @notice Demo operator recycles the test USDC collected by the mock exchange.
    function withdrawUsdc(address to, uint256 amount) external onlyOwner {
        usdc.safeTransfer(to, amount);
    }
}

/// @notice MOCK USDC for local tests only. On Base Sepolia the demo uses Circle's test USDC.
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin (mock)", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice MOCK interest-earning USDC vault (ERC-4626), standing in for a Morpho vault on testnet.
/// "Interest" appears when someone sends USDC straight to this contract. It has no owner.
contract MockYieldVault is ERC4626 {
    constructor(IERC20 usdc_) ERC20("Mock Yield USDC", "myUSDC") ERC4626(usdc_) {}
}
