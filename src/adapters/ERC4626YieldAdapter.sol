// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IYieldAdapter} from "../interfaces/IAdapters.sol";

/// @title ERC4626YieldAdapter
/// @notice Puts idle USDC into one ERC-4626 lending vault (Morpho vaults follow this standard).
/// The shares are held by the caller (the user's own vault), never by this adapter. No owner.
contract ERC4626YieldAdapter is IYieldAdapter {
    using SafeERC20 for IERC20;

    IERC4626 public immutable yieldVault;
    address public immutable asset;

    error ZeroAmount();

    constructor(IERC4626 yieldVault_) {
        yieldVault = yieldVault_;
        asset = yieldVault_.asset();
    }

    function positionToken() external view returns (address) {
        return address(yieldVault);
    }

    function deposit(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        IERC20(asset).forceApprove(address(yieldVault), amount);
        yieldVault.deposit(amount, msg.sender);
    }

    function withdraw(uint256 amount, address receiver) external {
        if (amount == 0) revert ZeroAmount();
        yieldVault.withdraw(amount, receiver, msg.sender);
    }

    function withdrawAll(address receiver) external returns (uint256 amount) {
        uint256 shares = yieldVault.balanceOf(msg.sender);
        if (shares == 0) return 0;
        amount = yieldVault.redeem(shares, receiver, msg.sender);
    }

    function balanceOf(address account) external view returns (uint256) {
        return yieldVault.previewRedeem(yieldVault.balanceOf(account));
    }
}
