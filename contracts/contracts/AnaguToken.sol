// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract AnaguToken is ERC20 {
    uint256 public constant MAX_SUPPLY = 100_000_000 * 10 ** 18;

    error ZeroTreasuryAddress();

    constructor(address treasury) ERC20("ANAGU Token", "ANAGU") {
        if (treasury == address(0)) revert ZeroTreasuryAddress();
        _mint(treasury, MAX_SUPPLY);
    }
}
