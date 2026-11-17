// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Multicall} from "@openzeppelin/contracts/utils/Multicall.sol";
import {ILendingAdapter, IYieldAdapter} from "./interfaces/IAdapters.sol";

interface IVaultFactory {
    function lendingAdapterOf(address stock) external view returns (address);
    function yieldAdapter() external view returns (address);
    function borrowFeeBps() external view returns (uint16);
    function earnFeeBps() external view returns (uint16);
    function feeRecipient() external view returns (address);
}

/// @title EmployeeVault
/// @notice One vault per employee. It holds that employee's stock tokens and is the borrower
/// at the lending market. Only the employee (owner) can borrow, withdraw collateral or
/// take anything out. There is no admin, no upgrade path and no pooled money.
/// Anyone may put value IN (deposit stock, repay debt), nobody but the owner can take value OUT.
/// @dev Multicall (OpenZeppelin) lets the owner do several actions in one transaction, for example
/// lock four assets and borrow against them with one signature. Every inner call keeps its own checks
/// (owner only, borrow cap, reentrancy guard) and the whole batch is undone if any part fails.
contract EmployeeVault is ReentrancyGuardTransient, Multicall {
    using SafeERC20 for IERC20;

    uint16 public constant DEFAULT_BORROW_CAP_BPS = 5000; // borrow up to 50% of the liquidation limit
    uint16 public constant MAX_BORROW_CAP_BPS = 8500; // never closer than 85% of the liquidation limit

    IVaultFactory public immutable factory;

    address public owner;
    /// @notice Share of the liquidation limit the owner allows themself to borrow, in basis points.
    uint16 public borrowCapBps;
    mapping(address adapter => bool) public adapterReady;
    /// @notice USDC put to work and not yet taken back (the part the earn fee is measured on).
    uint256 public earnPrincipal;
    /// @notice Earn fee built up so far and not yet taken. It is only ever taken out of interest.
    uint256 public earnFeeOwed;
    /// @notice When `earnFeeOwed` was last brought up to date.
    uint40 public earnFeeUpdatedAt;
    /// @notice Borrow fee built up on the loan against each asset and not yet paid (issue #56): a yearly
    /// rate on the outstanding loan, paid on repayment. Never taken from the vault or collateral.
    mapping(address stock => uint256) public borrowFeeOwed;
    /// @notice When `borrowFeeOwed[stock]` was last brought up to date.
    mapping(address stock => uint40) public borrowFeeUpdatedAt;

    error NotOwner();
    error NotFactory();
    error AlreadyInitialized();
    error UnsupportedStock(address stock);
    error ZeroAmount();
    error ZeroAddress();
    error BorrowCapExceeded(uint256 debt, uint256 allowed);
    error CapOutOfRange();
    error SetupFailed();
    error YieldNotAvailable();

    event StockDeposited(address indexed stock, address indexed from, uint256 amount, bool addedAsCollateral);
    event CollateralAdded(address indexed stock, uint256 amount);
    event CollateralRemoved(address indexed stock, uint256 amount);
    event Borrowed(address indexed stock, uint256 usdcAmount, address indexed receiver);
    event Repaid(address indexed stock, address indexed payer, uint256 usdcAmount);
    event Withdrawn(address indexed token, uint256 amount, address indexed to);
    event BorrowCapSet(uint16 bps);
    event EarningStarted(uint256 usdcAmount);
    event EarningStopped(uint256 usdcAmount, address indexed to);
    event FeePaid(string kind, uint256 usdcAmount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        factory = IVaultFactory(msg.sender);
    }

    function initialize(address owner_) external {
        if (msg.sender != address(factory)) revert NotFactory();
        if (owner != address(0)) revert AlreadyInitialized();
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        borrowCapBps = DEFAULT_BORROW_CAP_BPS;
    }

    // ------------------------------------------------------- value in (anyone)

    /// @notice Put stock into the vault. It stays free: nothing is locked as loan collateral unless
    /// the owner locks it (founder decision, issue #29).
    function depositStock(address stock, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _adapter(stock);
        IERC20(stock).safeTransferFrom(msg.sender, address(this), amount);
        emit StockDeposited(stock, msg.sender, amount, false);
    }

    /// @notice Put stock into the vault and lock it as collateral for the loan against it. Anyone may
    /// call it, because it can only add the caller's own tokens as collateral, which makes the
    /// owner's loan safer. Payroll uses it only when the owner's opt-in emergency rule fires.
    function depositStockAsCollateral(address stock, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        ILendingAdapter adapter = _adapter(stock);
        IERC20(stock).safeTransferFrom(msg.sender, address(this), amount);
        _supply(adapter, stock, amount);
        emit StockDeposited(stock, msg.sender, amount, true);
    }

    /// @notice Repay the loan against `stock`. Anyone may repay. Pass type(uint256).max to repay everything.
    /// The Stackday borrow fee built up so far is paid first, then the loan; both come out of `amount`
    /// (pulled from the caller), never out of the vault.
    function repay(address stock, uint256 amount) external nonReentrant returns (uint256 repaid) {
        if (amount == 0) revert ZeroAmount();
        ILendingAdapter adapter = _adapter(stock);
        IERC20 usdc = IERC20(adapter.loanToken());
        adapter.accrue();
        uint256 debt = adapter.debtOf(address(this));
        if (debt == 0) return 0;
        _accrueBorrowFee(stock, adapter);
        uint256 fee = borrowFeeOwed[stock];
        if (amount >= debt + fee) {
            usdc.safeTransferFrom(msg.sender, address(this), debt + fee);
            _payBorrowFee(stock, usdc, fee);
            usdc.forceApprove(address(adapter), debt);
            repaid = adapter.repayAll();
        } else {
            usdc.safeTransferFrom(msg.sender, address(this), amount);
            uint256 feePart = amount < fee ? amount : fee;
            _payBorrowFee(stock, usdc, feePart);
            uint256 rest = amount - feePart;
            if (rest > 0) {
                usdc.forceApprove(address(adapter), rest);
                adapter.repay(rest);
            }
            repaid = rest;
        }
        usdc.forceApprove(address(adapter), 0);
        emit Repaid(stock, msg.sender, repaid);
    }

    // ---------------------------------------------------- owner only (value out)

    /// @notice Move idle stock into loan collateral.
    function addCollateral(address stock, uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _supply(_adapter(stock), stock, amount);
    }

    /// @notice Borrow USDC against `stock`. Optionally add idle stock as collateral first.
    /// The loan must stay inside the owner's conservative borrow cap.
    function borrow(address stock, uint256 collateralToAdd, uint256 usdcAmount, address receiver)
        external
        onlyOwner
        nonReentrant
    {
        if (usdcAmount == 0) revert ZeroAmount();
        if (receiver == address(0)) revert ZeroAddress();
        ILendingAdapter adapter = _adapter(stock);
        if (collateralToAdd > 0) _supply(adapter, stock, collateralToAdd);
        _ready(adapter);
        // The yearly borrow fee is brought up to date on the loan as it was, then the person receives
        // the full amount they borrow. The fee is paid later, on repayment (issue #56).
        _accrueBorrowFee(stock, adapter);
        adapter.borrow(usdcAmount, receiver);
        _checkCap(adapter);
        emit Borrowed(stock, usdcAmount, receiver);
    }

    /// @notice Move collateral back to idle. With a loan open, the rest must still respect the borrow cap.
    function removeCollateral(address stock, uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _removeCollateral(_adapter(stock), stock, amount);
    }

    /// @notice Send tokens out of the vault to any address. For a supported stock, collateral is
    /// released automatically if idle stock is not enough (the loan must allow it).
    function withdraw(address token, uint256 amount, address to) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        uint256 idle = IERC20(token).balanceOf(address(this));
        if (amount > idle) {
            address adapter = factory.lendingAdapterOf(token);
            if (adapter != address(0)) _removeCollateral(ILendingAdapter(adapter), token, amount - idle);
        }
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(token, amount, to);
    }

    /// @notice Put idle USDC to work earning interest (for example in a Morpho vault). Uses USDC already
    /// in this vault first and pulls any shortfall from the owner's wallet. The position stays in this
    /// vault, in the owner's name only. Interest is not guaranteed and the lending venue carries its own risk.
    function earn(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        IYieldAdapter y = _yield();
        IERC20 usdc = IERC20(y.asset());
        uint256 idle = usdc.balanceOf(address(this));
        if (amount > idle) usdc.safeTransferFrom(msg.sender, address(this), amount - idle);
        _accrueEarnFee();
        usdc.forceApprove(address(y), amount);
        y.deposit(amount);
        usdc.forceApprove(address(y), 0);
        earnPrincipal += amount;
        emit EarningStarted(amount);
    }

    /// @notice Take USDC (with its interest) back out to any address. Pass type(uint256).max for everything.
    function stopEarning(uint256 amount, address to) external onlyOwner nonReentrant returns (uint256 out) {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        IYieldAdapter y = _yield();
        IERC20 position = IERC20(y.positionToken());
        position.forceApprove(address(y), type(uint256).max);
        // The fee comes only out of interest: never more than the balance above what was put in.
        _accrueEarnFee();
        uint256 bal = y.balanceOf(address(this));
        uint256 interest = bal > earnPrincipal ? bal - earnPrincipal : 0;
        uint256 fee = earnFeeOwed < interest ? earnFeeOwed : interest;
        if (fee > 0) {
            y.withdraw(fee, factory.feeRecipient());
            emit FeePaid("earn", fee);
        }
        if (amount == type(uint256).max) {
            out = y.withdrawAll(to);
            earnPrincipal = 0;
            earnFeeOwed = 0; // anything the interest could not cover is forgiven
        } else {
            earnFeeOwed -= fee;
            y.withdraw(amount, to);
            out = amount;
            earnPrincipal = amount >= earnPrincipal ? 0 : earnPrincipal - amount;
            if (earnPrincipal == 0) earnFeeOwed = 0;
        }
        position.forceApprove(address(y), 0);
        emit EarningStopped(out, to);
    }

    /// @notice Choose how much of the liquidation limit you allow yourself to borrow (default 50%).
    function setBorrowCapBps(uint16 bps) external onlyOwner {
        if (bps == 0 || bps > MAX_BORROW_CAP_BPS) revert CapOutOfRange();
        borrowCapBps = bps;
        emit BorrowCapSet(bps);
    }

    // -------------------------------------------------------------------- views

    function idleOf(address stock) public view returns (uint256) {
        return IERC20(stock).balanceOf(address(this));
    }

    function collateralOf(address stock) public view returns (uint256) {
        return _adapter(stock).collateralOf(address(this));
    }

    function debtOf(address stock) public view returns (uint256) {
        return _adapter(stock).debtOf(address(this));
    }

    /// @notice 1e18 = at the liquidation line. Higher is safer. Max value when there is no loan.
    function healthFactor(address stock) external view returns (uint256) {
        return _adapter(stock).healthFactor(address(this));
    }

    /// @notice Most USDC the vault may owe under the owner's borrow cap, at the current price.
    function borrowLimit(address stock) public view returns (uint256) {
        return (_adapter(stock).maxDebt(address(this)) * borrowCapBps) / 10_000;
    }

    /// @notice Stackday borrow fee owed on the loan against `stock` right now, including the part built
    /// up since the last update. Paid on repayment, before the loan.
    function borrowFeeOf(address stock) public view returns (uint256 owed) {
        owed = borrowFeeOwed[stock];
        uint256 bps = factory.borrowFeeBps();
        uint40 at = borrowFeeUpdatedAt[stock];
        if (bps == 0 || at == 0) return owed;
        uint256 debt = _adapter(stock).debtOf(address(this));
        if (debt == 0) return 0;
        owed += (debt * bps * (block.timestamp - at)) / (10_000 * 365 days);
    }

    /// @notice Everything needed to close the loan against `stock` now: the loan plus the fee.
    function totalOwed(address stock) external view returns (uint256) {
        return _adapter(stock).debtOf(address(this)) + borrowFeeOf(stock);
    }

    /// @notice USDC currently earning interest for this vault, including the interest.
    function earningBalance() external view returns (uint256) {
        address y = factory.yieldAdapter();
        return y == address(0) ? 0 : IYieldAdapter(y).balanceOf(address(this));
    }

    // ----------------------------------------------------------------- internal

    /// @dev Builds up the yearly earn fee on the principal since the last update.
    function _accrueEarnFee() internal {
        uint16 bps = factory.earnFeeBps();
        if (bps != 0 && earnPrincipal != 0 && earnFeeUpdatedAt != 0) {
            earnFeeOwed += (earnPrincipal * bps * (block.timestamp - earnFeeUpdatedAt)) / (10_000 * 365 days);
        }
        earnFeeUpdatedAt = uint40(block.timestamp);
    }

    function _yield() internal view returns (IYieldAdapter) {
        address y = factory.yieldAdapter();
        if (y == address(0)) revert YieldNotAvailable();
        return IYieldAdapter(y);
    }

    function _adapter(address stock) internal view returns (ILendingAdapter) {
        address adapter = factory.lendingAdapterOf(stock);
        if (adapter == address(0)) revert UnsupportedStock(stock);
        return ILendingAdapter(adapter);
    }

    /// @dev One-time: allow the (fixed, ownerless) adapter to act for this vault at the lending market.
    function _ready(ILendingAdapter adapter) internal {
        if (adapterReady[address(adapter)]) return;
        adapterReady[address(adapter)] = true;
        (address target, bytes memory data) = adapter.setupCall();
        if (target != address(0)) {
            (bool ok,) = target.call(data);
            if (!ok) revert SetupFailed();
        }
    }

    function _supply(ILendingAdapter adapter, address stock, uint256 amount) internal {
        IERC20(stock).forceApprove(address(adapter), amount);
        adapter.supplyCollateral(amount);
        IERC20(stock).forceApprove(address(adapter), 0);
        emit CollateralAdded(stock, amount);
    }

    /// @dev Builds up the yearly borrow fee on the loan since the last update. A loan that ended without
    /// repayment (for example a liquidation) leaves nothing owed.
    function _accrueBorrowFee(address stock, ILendingAdapter adapter) internal {
        uint256 debt = adapter.debtOf(address(this));
        uint40 at = borrowFeeUpdatedAt[stock];
        if (debt == 0) {
            borrowFeeOwed[stock] = 0;
        } else {
            uint256 bps = factory.borrowFeeBps();
            if (bps != 0 && at != 0) borrowFeeOwed[stock] += (debt * bps * (block.timestamp - at)) / (10_000 * 365 days);
        }
        borrowFeeUpdatedAt[stock] = uint40(block.timestamp);
    }

    function _payBorrowFee(address stock, IERC20 usdc, uint256 fee) internal {
        if (fee == 0) return;
        borrowFeeOwed[stock] -= fee;
        usdc.safeTransfer(factory.feeRecipient(), fee);
        emit FeePaid("borrow", fee);
    }

    function _removeCollateral(ILendingAdapter adapter, address stock, uint256 amount) internal {
        _ready(adapter);
        adapter.withdrawCollateral(amount, address(this));
        _checkCap(adapter);
        emit CollateralRemoved(stock, amount);
    }

    function _checkCap(ILendingAdapter adapter) internal view {
        uint256 debt = adapter.debtOf(address(this));
        if (debt == 0) return;
        uint256 allowed = (adapter.maxDebt(address(this)) * borrowCapBps) / 10_000;
        if (debt > allowed) revert BorrowCapExceeded(debt, allowed);
    }
}
