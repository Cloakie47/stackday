// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {EmployeeVault} from "./EmployeeVault.sol";
import {ILendingAdapter} from "./interfaces/IAdapters.sol";

/// @title VaultFactory
/// @notice Creates exactly one vault per employee at a predictable address.
/// The list of supported stocks and their lending markets is fixed at deployment.
/// There is no owner and nothing can be changed afterwards, so nobody can point
/// vaults at a different (malicious) market later.
contract VaultFactory {
    address public immutable implementation;
    /// @notice Where idle USDC can earn interest. Zero address means the feature is off.
    address public immutable yieldAdapter;
    address[] public stocks;
    mapping(address stock => address adapter) public lendingAdapterOf;
    mapping(address employee => address vault) public vaultOf;

    error LengthMismatch();
    error AdapterMismatch(address stock);
    error DuplicateStock(address stock);
    error ZeroAddress();

    event VaultCreated(address indexed employee, address vault);

    constructor(address[] memory stocks_, address[] memory adapters_, address yieldAdapter_) {
        yieldAdapter = yieldAdapter_;
        if (stocks_.length != adapters_.length) revert LengthMismatch();
        for (uint256 i; i < stocks_.length; ++i) {
            if (ILendingAdapter(adapters_[i]).collateralToken() != stocks_[i]) revert AdapterMismatch(stocks_[i]);
            if (lendingAdapterOf[stocks_[i]] != address(0)) revert DuplicateStock(stocks_[i]);
            lendingAdapterOf[stocks_[i]] = adapters_[i];
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
