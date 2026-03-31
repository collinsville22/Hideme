// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ConfidentialWrapper} from "./ConfidentialWrapper.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @title WrapperFactory - Deploy confidential wrappers for any ERC-20
/// @notice One wrapper per ERC-20 token. Anyone can create a wrapper.
contract WrapperFactory is ZamaEthereumConfig {
    event WrapperCreated(
        address indexed erc20Token,
        address indexed wrapper,
        string name,
        string symbol,
        address creator
    );

    mapping(address => address) public wrappers;
    address[] public allWrappers;

    struct WrapperInfo {
        address erc20Token;
        address wrapper;
        string tokenName;
        string tokenSymbol;
        uint8 tokenDecimals;
        string wrapperName;
        string wrapperSymbol;
    }

    /// @notice Create a confidential wrapper for an ERC-20 token
    /// @param erc20Token The underlying ERC-20 token address
    /// @return wrapper The deployed wrapper address
    function createWrapper(address erc20Token) external returns (address wrapper) {
        require(erc20Token != address(0), "Zero address");
        require(wrappers[erc20Token] == address(0), "Wrapper already exists");

        IERC20Metadata token = IERC20Metadata(erc20Token);
        require(token.decimals() >= 6, "Token must have >= 6 decimals");

        ConfidentialWrapper w = new ConfidentialWrapper(erc20Token);
        wrapper = address(w);

        wrappers[erc20Token] = wrapper;
        allWrappers.push(wrapper);

        emit WrapperCreated(erc20Token, wrapper, token.name(), token.symbol(), msg.sender);
    }

    /// @notice Get wrapper address for an ERC-20 token
    function getWrapper(address erc20Token) external view returns (address) {
        return wrappers[erc20Token];
    }

    /// @notice Total wrappers created
    function totalWrappers() external view returns (uint256) {
        return allWrappers.length;
    }

    /// @notice Get all wrapper info (paginated)
    function getWrappersPaginated(uint256 offset, uint256 limit)
        external view returns (WrapperInfo[] memory)
    {
        uint256 total = allWrappers.length;
        if (offset >= total) return new WrapperInfo[](0);

        uint256 end = offset + limit;
        if (end > total) end = total;

        WrapperInfo[] memory result = new WrapperInfo[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            address wrapper = allWrappers[i];
            ConfidentialWrapper w = ConfidentialWrapper(wrapper);
            IERC20Metadata token = IERC20Metadata(address(w.underlyingToken()));

            result[i - offset] = WrapperInfo({
                erc20Token: address(token),
                wrapper: wrapper,
                tokenName: token.name(),
                tokenSymbol: token.symbol(),
                tokenDecimals: token.decimals(),
                wrapperName: w.name(),
                wrapperSymbol: w.symbol()
            });
        }
        return result;
    }
}
