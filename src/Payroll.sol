// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {ISwapAdapter} from "./interfaces/IAdapters.sol";
import {VaultFactory} from "./VaultFactory.sol";
import {EmployeeVault} from "./EmployeeVault.sol";

/// @title Payroll
/// @notice Employers fund a USDC treasury and pay salaries from it, either as one-off payroll runs
/// or as a recurring schedule (for example daily, weekly or monthly) that keeps running for as long
/// as the treasury is funded. Employees claim to any wallet and may send shares of each salary
/// (the SIP shares) into assets held in their own vault: tokenized stocks, and also BTC or ETH tokens.
///
/// No owner and no admin. The only fee is a SIP fee fixed forever at deployment (at most 1%),
/// charged on the USDC that goes into assets, never on salary paid out and never on vault funds.
/// Salary assigned to an employee can only be claimed by that employee (an employer can take back
/// a salary that stayed unclaimed for 180 days).
contract Payroll is ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_BPS = 10_000;
    uint256 public constant RECLAIM_DELAY = 180 days;
    uint16 public constant MAX_SIP_FEE_BPS = 100; // the fee can never be deployed above 1%
    uint256 public constant MAX_ALLOCATIONS = 6;
    uint256 public constant MAX_SCHEDULE_EMPLOYEES = 200;

    IERC20 public immutable usdc;
    VaultFactory public immutable factory;
    ISwapAdapter public immutable swapAdapter;
    /// @notice Platform fee on USDC going into assets, in basis points (25 = 0.25%). Cannot be changed.
    uint16 public immutable sipFeeBps;
    address public immutable feeRecipient;
    /// @notice Shortest allowed time between two paydays of a schedule (1 day on mainnet, shorter on testnet for demos).
    uint32 public immutable minScheduleInterval;

    struct Run {
        address employer;
        uint64 createdAt;
        uint256 total;
        uint256 claimed;
    }

    /// @notice One line of an employee's standing instruction: `bps` of every salary buys `asset`.
    struct Allocation {
        address asset;
        uint16 bps;
    }

    /// @notice Emergency rule set in advance by the employee. When the loan against `stock` is
    /// at or below `healthThreshold` at claim time, at least `sipBps` of that salary buys `stock`,
    /// and all of it is added to the loan's collateral.
    struct EmergencyRule {
        address stock;
        uint16 sipBps;
        uint256 healthThreshold; // 1e18 = liquidation line. Example: 1.3e18
    }

    /// @notice A recurring payroll: the same people and amounts, paid every `interval` seconds.
    struct Schedule {
        address employer;
        uint32 interval;
        uint40 nextPayAt;
        bool active;
        uint256 total;
        address[] employees;
        uint256[] amounts;
    }

    uint256 public runCount;
    mapping(uint256 runId => Run) public runs;
    mapping(uint256 runId => mapping(address employee => uint256)) public claimable;
    mapping(address employee => uint256[]) internal _runIdsOf;
    mapping(address employer => uint256) public employerBalance;
    mapping(address employee => Allocation[]) internal _planOf;
    mapping(address employee => EmergencyRule) public emergencyRuleOf;

    uint256 public scheduleCount;
    mapping(uint256 scheduleId => Schedule) internal _schedules;
    mapping(address employer => uint256[]) internal _schedulesOfEmployer;
    mapping(address employee => uint256[]) internal _schedulesOfEmployee;

    error ZeroAmount();
    error ZeroAddress();
    error LengthMismatch();
    error InsufficientBalance();
    error NothingToClaim();
    error BpsTooHigh();
    error TooManyAllocations();
    error UnsupportedStock(address stock);
    error OnlySelf();
    error NotEmployer();
    error TooEarly();
    error BadThreshold();
    error BadFee();
    error BadInterval();
    error ScheduleNotActive();
    error NotDueYet(uint256 nextPayAt);
    error TooManyEmployees();

    event Deposited(address indexed employer, uint256 amount);
    event UnallocatedWithdrawn(address indexed employer, uint256 amount);
    event RunCreated(uint256 indexed runId, address indexed employer, uint256 total, uint256 employeeCount);
    event SalaryAssigned(uint256 indexed runId, address indexed employee, uint256 amount);
    event SipPlanSet(address indexed employee, address[] assets, uint16[] bps);
    event EmergencyRuleSet(address indexed employee, address stock, uint16 sipBps, uint256 healthThreshold);
    event Claimed(
        uint256 indexed runId,
        address indexed employee,
        address indexed recipient,
        uint256 usdcPaid,
        uint256 sipUsdc,
        bool emergencyTriggered
    );
    event SipBought(uint256 indexed runId, address indexed employee, address indexed asset, uint256 usdcIn, uint256 assetOut);
    event SipSkipped(uint256 indexed runId, address indexed employee, address indexed asset, uint256 sipUsdc, bytes reason);
    event SipFeePaid(address indexed employee, uint256 feeUsdc);
    event Reclaimed(uint256 indexed runId, address indexed employee, uint256 amount);
    event ScheduleCreated(
        uint256 indexed scheduleId, address indexed employer, uint32 interval, uint40 firstPayAt, uint256 total, uint256 employeeCount
    );
    event ScheduleActiveSet(uint256 indexed scheduleId, bool active);
    event ScheduleRun(uint256 indexed scheduleId, uint256 indexed runId, uint40 nextPayAt);

    constructor(
        IERC20 usdc_,
        VaultFactory factory_,
        ISwapAdapter swapAdapter_,
        address feeRecipient_,
        uint16 sipFeeBps_,
        uint32 minScheduleInterval_
    ) {
        if (sipFeeBps_ > MAX_SIP_FEE_BPS) revert BadFee();
        if (sipFeeBps_ > 0 && feeRecipient_ == address(0)) revert BadFee();
        if (minScheduleInterval_ == 0) revert BadInterval();
        sipFeeBps = sipFeeBps_;
        feeRecipient = feeRecipient_;
        minScheduleInterval = minScheduleInterval_;
        usdc = usdc_;
        factory = factory_;
        swapAdapter = swapAdapter_;
    }

    // ------------------------------------------------------- employer: treasury

    /// @notice Fund the employer's treasury. Paydays are paid out of it.
    function deposit(uint256 amount) external nonReentrant {
        _deposit(amount);
    }

    /// @notice Take back USDC that has not been paid into a payday yet.
    function withdrawUnallocated(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (employerBalance[msg.sender] < amount) revert InsufficientBalance();
        employerBalance[msg.sender] -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit UnallocatedWithdrawn(msg.sender, amount);
    }

    // ---------------------------------------------------- employer: one-off run

    /// @notice Create a one-off payroll run from the employer's treasury.
    function createRun(address[] calldata employees, uint256[] calldata amounts)
        external
        nonReentrant
        returns (uint256 runId)
    {
        return _createRun(msg.sender, employees, amounts);
    }

    /// @notice Deposit and create a one-off payroll run in one transaction.
    function depositAndCreateRun(uint256 depositAmount, address[] calldata employees, uint256[] calldata amounts)
        external
        nonReentrant
        returns (uint256 runId)
    {
        _deposit(depositAmount);
        return _createRun(msg.sender, employees, amounts);
    }

    /// @notice Employer takes back a salary that stayed unclaimed for 180 days (for example a mistyped address).
    function reclaim(uint256 runId, address employee) external nonReentrant {
        Run storage run = runs[runId];
        if (run.employer != msg.sender) revert NotEmployer();
        if (block.timestamp < run.createdAt + RECLAIM_DELAY) revert TooEarly();
        uint256 amount = claimable[runId][employee];
        if (amount == 0) revert NothingToClaim();
        claimable[runId][employee] = 0;
        run.claimed += amount;
        employerBalance[msg.sender] += amount;
        emit Reclaimed(runId, employee, amount);
    }

    // ------------------------------------------------ employer: recurring payroll

    /// @notice Set up a recurring payroll. Every `interval` seconds one payday becomes due and is paid
    /// from the employer's treasury. Nothing is locked in advance: keep the treasury funded.
    /// @param firstPayAt time of the first payday (0 or a past time means now)
    function createSchedule(address[] calldata employees, uint256[] calldata amounts, uint32 interval, uint40 firstPayAt)
        external
        returns (uint256 scheduleId)
    {
        uint256 n = employees.length;
        if (n == 0 || n != amounts.length) revert LengthMismatch();
        if (n > MAX_SCHEDULE_EMPLOYEES) revert TooManyEmployees();
        if (interval < minScheduleInterval) revert BadInterval();
        uint256 total;
        scheduleId = ++scheduleCount;
        for (uint256 i; i < n; ++i) {
            if (employees[i] == address(0)) revert ZeroAddress();
            if (amounts[i] == 0) revert ZeroAmount();
            total += amounts[i];
            _schedulesOfEmployee[employees[i]].push(scheduleId);
        }
        uint40 first = firstPayAt < block.timestamp ? uint40(block.timestamp) : firstPayAt;
        _schedules[scheduleId] = Schedule(msg.sender, interval, first, true, total, employees, amounts);
        _schedulesOfEmployer[msg.sender].push(scheduleId);
        emit ScheduleCreated(scheduleId, msg.sender, interval, first, total, n);
    }

    /// @notice Pause or resume a schedule. Only its employer. Salaries already paid out are not affected.
    function setScheduleActive(uint256 scheduleId, bool active) external {
        Schedule storage s = _schedules[scheduleId];
        if (s.employer != msg.sender) revert NotEmployer();
        s.active = active;
        // Resuming never pays for the time the schedule was paused.
        if (active && s.nextPayAt < block.timestamp) s.nextPayAt = uint40(block.timestamp);
        emit ScheduleActiveSet(scheduleId, active);
    }

    /// @notice Pay one due payday of a schedule out of the employer's treasury. Anyone may call this
    /// (the employer, an employee, or an automation service): it can only do what the employer set up.
    /// If several paydays were missed, call it once per payday.
    function runSchedule(uint256 scheduleId) external nonReentrant returns (uint256 runId) {
        Schedule storage s = _schedules[scheduleId];
        if (!s.active) revert ScheduleNotActive();
        if (block.timestamp < s.nextPayAt) revert NotDueYet(s.nextPayAt);
        s.nextPayAt += s.interval;
        runId = _createRun(s.employer, s.employees, s.amounts);
        emit ScheduleRun(scheduleId, runId, s.nextPayAt);
    }

    // ------------------------------------------------------------------ employee

    /// @notice Standing instruction for every payday: one asset. Set sipBps to 0 to switch it off.
    function setSipPlan(address asset, uint16 sipBps) external {
        address[] memory assets = new address[](sipBps == 0 ? 0 : 1);
        uint16[] memory bps = new uint16[](assets.length);
        if (sipBps != 0) {
            assets[0] = asset;
            bps[0] = sipBps;
        }
        _setPlan(assets, bps);
    }

    /// @notice Standing instruction for every payday across several assets, for example
    /// 10% into a stock and 5% into BTC. Pass empty lists to switch it off.
    function setSipPlanMany(address[] calldata assets, uint16[] calldata bps) external {
        _setPlan(assets, bps);
    }

    /// @notice Emergency rule. Set sipBps to 0 to switch it off.
    function setEmergencyRule(address stock, uint16 sipBps, uint256 healthThreshold) external {
        if (sipBps > MAX_BPS) revert BpsTooHigh();
        if (sipBps > 0) {
            _requireSupported(stock);
            if (healthThreshold <= 1e18 || healthThreshold > 10e18) revert BadThreshold();
        }
        emergencyRuleOf[msg.sender] = EmergencyRule(stock, sipBps, healthThreshold);
        emit EmergencyRuleSet(msg.sender, stock, sipBps, healthThreshold);
    }

    /// @notice Claim a salary using the standing instruction.
    /// @param recipient any wallet that should receive the USDC
    /// @param minOut least amount the first SIP line must buy after the fee (protects against a bad price)
    function claim(uint256 runId, address recipient, uint256 minOut) external nonReentrant {
        uint256[] memory minOuts = new uint256[](1);
        minOuts[0] = minOut;
        _claim(runId, recipient, _planOf[msg.sender], minOuts);
    }

    /// @notice Claim a salary using the standing instruction, with a minimum per SIP line.
    function claimMany(uint256 runId, address recipient, uint256[] calldata minOuts) external nonReentrant {
        _claim(runId, recipient, _planOf[msg.sender], minOuts);
    }

    /// @notice Claim a salary with a one-time SIP choice in one asset (0 for none).
    /// Does not change the standing instruction.
    function claimWithSip(uint256 runId, address recipient, address asset, uint16 sipBps, uint256 minOut)
        external
        nonReentrant
    {
        Allocation[] memory legs = new Allocation[](sipBps == 0 ? 0 : 1);
        uint256[] memory minOuts = new uint256[](1);
        minOuts[0] = minOut;
        if (sipBps != 0) {
            if (sipBps > MAX_BPS) revert BpsTooHigh();
            _requireSupported(asset);
            legs[0] = Allocation(asset, sipBps);
        }
        _claim(runId, recipient, legs, minOuts);
    }

    /// @notice Claim a salary with a one-time SIP choice across several assets.
    function claimWithSipMany(
        uint256 runId,
        address recipient,
        address[] calldata assets,
        uint16[] calldata bps,
        uint256[] calldata minOuts
    ) external nonReentrant {
        _claim(runId, recipient, _validated(assets, bps), minOuts);
    }

    // --------------------------------------------------------------------- views

    function runIdsOf(address employee) external view returns (uint256[] memory) {
        return _runIdsOf[employee];
    }

    /// @notice Total USDC the employee can claim across all runs.
    function totalClaimable(address employee) external view returns (uint256 total) {
        uint256[] storage ids = _runIdsOf[employee];
        for (uint256 i; i < ids.length; ++i) {
            total += claimable[ids[i]][employee];
        }
    }

    /// @notice The employee's standing instruction.
    function sipPlan(address employee) external view returns (address[] memory assets, uint16[] memory bps) {
        Allocation[] storage plan = _planOf[employee];
        assets = new address[](plan.length);
        bps = new uint16[](plan.length);
        for (uint256 i; i < plan.length; ++i) {
            assets[i] = plan[i].asset;
            bps[i] = plan[i].bps;
        }
    }

    /// @notice True when the employee's emergency rule would apply to a claim made now.
    function emergencyActive(address employee) public view returns (bool) {
        EmergencyRule memory rule = emergencyRuleOf[employee];
        if (rule.sipBps == 0) return false;
        address vault = factory.vaultOf(employee);
        if (vault == address(0)) return false;
        try EmployeeVault(vault).healthFactor(rule.stock) returns (uint256 health) {
            return health <= rule.healthThreshold;
        } catch {
            return false;
        }
    }

    function getSchedule(uint256 scheduleId)
        external
        view
        returns (
            address employer,
            uint32 interval,
            uint40 nextPayAt,
            bool active,
            uint256 total,
            address[] memory employees,
            uint256[] memory amounts
        )
    {
        Schedule storage s = _schedules[scheduleId];
        return (s.employer, s.interval, s.nextPayAt, s.active, s.total, s.employees, s.amounts);
    }

    /// @notice True when a payday of this schedule can be paid right now.
    function scheduleDue(uint256 scheduleId) external view returns (bool) {
        Schedule storage s = _schedules[scheduleId];
        return s.active && block.timestamp >= s.nextPayAt && employerBalance[s.employer] >= s.total;
    }

    function schedulesOfEmployer(address employer) external view returns (uint256[] memory) {
        return _schedulesOfEmployer[employer];
    }

    function schedulesOfEmployee(address employee) external view returns (uint256[] memory) {
        return _schedulesOfEmployee[employee];
    }

    // ------------------------------------------------------------------ internal

    function _deposit(uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        employerBalance[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    function _createRun(address employer, address[] memory employees, uint256[] memory amounts)
        internal
        returns (uint256 runId)
    {
        uint256 n = employees.length;
        if (n == 0 || n != amounts.length) revert LengthMismatch();
        runId = ++runCount;
        uint256 total;
        for (uint256 i; i < n; ++i) {
            address employee = employees[i];
            uint256 amount = amounts[i];
            if (employee == address(0)) revert ZeroAddress();
            if (amount == 0) revert ZeroAmount();
            if (claimable[runId][employee] == 0) _runIdsOf[employee].push(runId);
            claimable[runId][employee] += amount;
            total += amount;
            emit SalaryAssigned(runId, employee, amount);
        }
        if (employerBalance[employer] < total) revert InsufficientBalance();
        employerBalance[employer] -= total;
        runs[runId] = Run(employer, uint64(block.timestamp), total, 0);
        emit RunCreated(runId, employer, total, n);
    }

    function _validated(address[] memory assets, uint16[] memory bps) internal view returns (Allocation[] memory legs) {
        uint256 n = assets.length;
        if (n != bps.length) revert LengthMismatch();
        if (n > MAX_ALLOCATIONS) revert TooManyAllocations();
        legs = new Allocation[](n);
        uint256 total;
        for (uint256 i; i < n; ++i) {
            if (bps[i] == 0) revert ZeroAmount();
            _requireSupported(assets[i]);
            total += bps[i];
            legs[i] = Allocation(assets[i], bps[i]);
        }
        if (total > MAX_BPS) revert BpsTooHigh();
    }

    function _setPlan(address[] memory assets, uint16[] memory bps) internal {
        Allocation[] memory legs = _validated(assets, bps);
        delete _planOf[msg.sender];
        for (uint256 i; i < legs.length; ++i) {
            _planOf[msg.sender].push(legs[i]);
        }
        emit SipPlanSet(msg.sender, assets, bps);
    }

    function _claim(uint256 runId, address recipient, Allocation[] memory legs, uint256[] memory minOuts) internal {
        if (recipient == address(0)) revert ZeroAddress();
        uint256 amount = claimable[runId][msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[runId][msg.sender] = 0;
        runs[runId].claimed += amount;

        // Emergency: the whole SIP share of this payday (at least the rule's share) goes into the
        // asset backing the risky loan, where the vault adds it to collateral.
        bool emergency = emergencyActive(msg.sender);
        if (emergency) {
            EmergencyRule memory rule = emergencyRuleOf[msg.sender];
            uint256 chosen;
            for (uint256 i; i < legs.length; ++i) {
                chosen += legs[i].bps;
            }
            legs = new Allocation[](1);
            legs[0] = Allocation(rule.stock, chosen > rule.sipBps ? uint16(chosen) : rule.sipBps);
        }

        uint256 sipTotal;
        for (uint256 i; i < legs.length; ++i) {
            uint256 sipUsdc = (amount * legs[i].bps) / MAX_BPS;
            if (sipUsdc == 0) continue;
            uint256 minOut = i < minOuts.length ? minOuts[i] : 0;
            // The salary must never get stuck because the asset side failed (paused token, bad price,
            // exchange down). A failed SIP line is undone and that part is paid in USDC instead.
            try this.executeSip(msg.sender, legs[i].asset, sipUsdc, minOut) returns (uint256 out) {
                sipTotal += sipUsdc;
                emit SipBought(runId, msg.sender, legs[i].asset, sipUsdc, out);
            } catch (bytes memory reason) {
                emit SipSkipped(runId, msg.sender, legs[i].asset, sipUsdc, reason);
            }
        }

        uint256 usdcPaid = amount - sipTotal;
        if (usdcPaid > 0) usdc.safeTransfer(recipient, usdcPaid);
        emit Claimed(runId, msg.sender, recipient, usdcPaid, sipTotal, emergency);
    }

    /// @dev Called only by this contract (inside try/catch) so a failed SIP line is fully undone.
    function executeSip(address employee, address stock, uint256 usdcIn, uint256 minStockOut)
        external
        returns (uint256 stockOut)
    {
        if (msg.sender != address(this)) revert OnlySelf();
        address vault = factory.createVault(employee);
        uint256 fee = (usdcIn * sipFeeBps) / MAX_BPS;
        if (fee > 0) {
            usdc.safeTransfer(feeRecipient, fee);
            usdcIn -= fee;
            emit SipFeePaid(employee, fee);
        }
        uint256 beforeBal = IERC20(stock).balanceOf(address(this));
        usdc.forceApprove(address(swapAdapter), usdcIn);
        swapAdapter.swapExactUsdcForStock(stock, usdcIn, minStockOut, address(this));
        usdc.forceApprove(address(swapAdapter), 0);
        stockOut = IERC20(stock).balanceOf(address(this)) - beforeBal;
        if (stockOut == 0 || stockOut < minStockOut) revert ZeroAmount();
        IERC20(stock).forceApprove(vault, stockOut);
        EmployeeVault(vault).depositStock(stock, stockOut);
    }

    function _requireSupported(address stock) internal view {
        if (factory.lendingAdapterOf(stock) == address(0)) revert UnsupportedStock(stock);
    }
}
