// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {EmployeeVault} from "./EmployeeVault.sol";
import {ILendingAdapter} from "./interfaces/IAdapters.sol";

/// @title VaultFactory
/// @notice Creates exactly one vault per employee at a predictable address.
/// The list of supported assets and their lending markets is fixed at deployment. An asset with no
/// lending market (adapter zero) is "invest only": it can be bought, held and withdrawn, but not
/// locked or borrowed against (issue #60).
/// There is no owner and nothing can be changed afterwards, so nobody can point
/// vaults at a different (malicious) market later.
contract VaultFactory {
    address public immutable implementation;
    /// @notice Where idle USDC can earn interest. Zero address means the feature is off.
    address public immutable yieldAdapter;
    /// @notice Most any Stackday fee can ever be: 0.2% (founder decision, November 17, 2026).
    uint16 public constant MAX_FEE_BPS = 20;
    /// @notice Yearly fee on the outstanding loan, in basis points (10 = 0.1% a year), built up in each
    /// vault and paid on repayment (issue #56). Fixed forever.
    uint16 public immutable borrowFeeBps;
    /// @notice Yearly fee on USDC earning interest, in basis points of the amount, taken only out of the
    /// interest (10 = 0.1% a year). Fixed forever.
    uint16 public immutable earnFeeBps;
    /// @notice Wallet that receives fees. It has no power over any vault.
    address public immutable feeRecipient;
    address[] public stocks;
    /// @notice Lending market adapter for an asset, or zero for an invest-only asset.
    mapping(address stock => address adapter) public lendingAdapterOf;
    /// @notice Every asset that can be bought and held in a vault, with or without a lending market.
    mapping(address stock => bool) public isSupported;
    mapping(address employee => address vault) public vaultOf;

    error LengthMismatch();
    error AdapterMismatch(address stock);
    error DuplicateStock(address stock);
    error ZeroAddress();
    error BadFee();

    event VaultCreated(address indexed employee, address vault);

    constructor(
        address[] memory stocks_,
        address[] memory adapters_,
        address yieldAdapter_,
        address feeRecipient_,
        uint16 borrowFeeBps_,
        uint16 earnFeeBps_
    ) {
        if (borrowFeeBps_ > MAX_FEE_BPS || earnFeeBps_ > MAX_FEE_BPS) revert BadFee();
        if ((borrowFeeBps_ > 0 || earnFeeBps_ > 0) && feeRecipient_ == address(0)) revert BadFee();
        borrowFeeBps = borrowFeeBps_;
        earnFeeBps = earnFeeBps_;
        feeRecipient = feeRecipient_;
        yieldAdapter = yieldAdapter_;
        if (stocks_.length != adapters_.length) revert LengthMismatch();
        for (uint256 i; i < stocks_.length; ++i) {
            if (stocks_[i] == address(0)) revert ZeroAddress();
            if (isSupported[stocks_[i]]) revert DuplicateStock(stocks_[i]);
            if (adapters_[i] != address(0)) {
                if (ILendingAdapter(adapters_[i]).collateralToken() != stocks_[i]) revert AdapterMismatch(stocks_[i]);
                lendingAdapterOf[stocks_[i]] = adapters_[i];
            }
            isSupported[stocks_[i]] = true;
            stocks.push(stocks_[i]);
        }
        implementation = address(new EmployeeVault());
    }

    /// @notice Returns the employee's vault, creating it if needed. Anyone may call; the vault
    /// always belongs to `employee`.
    function createVault(address employee) external returns (address vault) {
        if (employee == address(0)) revert ZeroAddress();
        vault = vaultOf[employee];
        if (vault != address(0)) return vault;
        vault = Clones.cloneDeterministic(implementation, bytes32(uint256(uint160(employee))));
        EmployeeVault(vault).initialize(employee);
        vaultOf[employee] = vault;
        emit VaultCreated(employee, vault);
    }

    /// @notice Address the employee's vault has or will have.
    function predictVault(address employee) external view returns (address) {
        return Clones.predictDeterministicAddress(implementation, bytes32(uint256(uint160(employee))));
    }

    function stockCount() external view returns (uint256) {
        return stocks.length;
    }

    function allStocks() external view returns (address[] memory) {
        return stocks;
    }
}
