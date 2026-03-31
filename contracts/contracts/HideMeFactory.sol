// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {HideMeToken} from "./HideMeToken.sol";

/// @title HideMeFactory - Deploy confidential tokens in one click
/// @notice Anyone can create a new confidential ERC20 token through this factory.
///         All tokens deployed via this factory are tracked and discoverable.
contract HideMeFactory is ZamaEthereumConfig {
    event TokenCreated(
        address indexed creator,
        address indexed tokenAddress,
        string name,
        string symbol,
        uint64 initialSupply,
        bool mintable,
        bool burnable
    );

    address[] public allTokens;
    mapping(address => address[]) public tokensByCreator;

    struct TokenInfo {
        address tokenAddress;
        string name;
        string symbol;
        uint64 initialSupply;
        address creator;
        uint256 createdAt;
        bool mintable;
        bool burnable;
        uint64 maxSupply;
        string description;
        string logoUri;
        string website;
    }

    mapping(address => TokenInfo) public tokenInfo;

    struct CreateParams {
        string name;
        string symbol;
        uint64 initialSupply;
        address[] observers;
        bool mintable;
        bool burnable;
        uint64 maxSupply;
        string description;
        string logoUri;
        string website;
    }

    /// @notice Deploy a new confidential token
    /// @param p Token creation parameters
    /// @return tokenAddr Address of the deployed token
    function createToken(CreateParams calldata p) external returns (address) {
        HideMeToken token = new HideMeToken(
            p.name,
            p.symbol,
            p.initialSupply,
            msg.sender,
            p.observers,
            p.mintable,
            p.burnable,
            p.maxSupply
        );

        address tokenAddr = address(token);

        allTokens.push(tokenAddr);
        tokensByCreator[msg.sender].push(tokenAddr);

        tokenInfo[tokenAddr] = TokenInfo({
            tokenAddress: tokenAddr,
            name: p.name,
            symbol: p.symbol,
            initialSupply: p.initialSupply,
            creator: msg.sender,
            createdAt: block.timestamp,
            mintable: p.mintable,
            burnable: p.burnable,
            maxSupply: p.maxSupply,
            description: p.description,
            logoUri: p.logoUri,
            website: p.website
        });

        emit TokenCreated(msg.sender, tokenAddr, p.name, p.symbol, p.initialSupply, p.mintable, p.burnable);

        return tokenAddr;
    }

    /// @notice Get total number of tokens created
    function totalTokens() external view returns (uint256) {
        return allTokens.length;
    }

    /// @notice Get all token addresses
    function getAllTokens() external view returns (address[] memory) {
        return allTokens;
    }

    /// @notice Get tokens created by a specific address
    function getTokensByCreator(address creator) external view returns (address[] memory) {
        return tokensByCreator[creator];
    }

    /// @notice Get paginated tokens
    function getTokensPaginated(
        uint256 offset,
        uint256 limit
    ) external view returns (TokenInfo[] memory) {
        uint256 total = allTokens.length;
        if (offset >= total) {
            return new TokenInfo[](0);
        }

        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }

        TokenInfo[] memory result = new TokenInfo[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = tokenInfo[allTokens[i]];
        }
        return result;
    }
}
