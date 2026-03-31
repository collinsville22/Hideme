// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title ConfidentialWrapper - Wrap any ERC-20 into a confidential token
/// @notice Deposit standard ERC-20 to get encrypted balance. Transfer confidentially.
///         Unwrap via async public decryption (2-step: request then finalize with KMS proof).
contract ConfidentialWrapper is ZamaEthereumConfig {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error ZeroAmount();
    error AmountTooHigh();
    error AccountRestricted();
    error RequestNotFound();
    error RequestNotReady();
    error NotRequestOwner();
    error RequestExpired();

    event Wrapped(address indexed account, uint64 amount);
    event UnwrapRequested(uint256 indexed requestId, address indexed account, uint64 amount, bytes32 handle);
    event UnwrapFinalized(uint256 indexed requestId, address indexed account, uint64 amount, bool success);
    event UnwrapCancelled(uint256 indexed requestId, address indexed account);
    event Transfer(address indexed from, address indexed to, uint256 amount);

    IERC20 public immutable underlyingToken;
    uint8 public immutable underlyingDecimals;
    string public name;
    string public symbol;
    uint8 public constant decimals = 6;

    mapping(address => euint64) internal _balances;
    uint64 public totalSupply;

    struct UnwrapRequest {
        address account;
        uint64 amount;
        bytes32 handle;
        uint256 createdAt;
    }

    mapping(uint256 => UnwrapRequest) public unwrapRequests;
    mapping(address => bool) public isRestricted;
    uint256 public unwrapNonce;
    uint256 public constant UNWRAP_TIMEOUT = 1 days;

    constructor(address erc20Token) {
        if (erc20Token == address(0)) revert ZeroAddress();

        underlyingToken = IERC20(erc20Token);
        underlyingDecimals = IERC20Metadata(erc20Token).decimals();

        name = string(abi.encodePacked("Confidential ", IERC20Metadata(erc20Token).name()));
        symbol = string(abi.encodePacked("c", IERC20Metadata(erc20Token).symbol()));
    }

    /// @notice Deposit ERC-20 tokens and receive confidential wrapped tokens
    /// @param amount Amount in underlying token decimals
    function wrap(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (isRestricted[msg.sender]) revert AccountRestricted();

        underlyingToken.safeTransferFrom(msg.sender, address(this), amount);

        uint256 adjusted = amount;
        if (underlyingDecimals > decimals) {
            adjusted = amount / (10 ** (underlyingDecimals - decimals));
        } else if (underlyingDecimals < decimals) {
            adjusted = amount * (10 ** (decimals - underlyingDecimals));
        }

        if (adjusted > type(uint64).max) revert AmountTooHigh();
        uint64 amt = uint64(adjusted);

        euint64 encAmount = FHE.asEuint64(amt);
        euint64 newBalance = FHE.add(_balances[msg.sender], encAmount);
        _balances[msg.sender] = newBalance;
        FHE.allowThis(newBalance);
        FHE.allow(newBalance, msg.sender);

        totalSupply += amt;
        emit Wrapped(msg.sender, amt);
        emit Transfer(address(0), msg.sender, 0);
    }

    /// @notice Transfer confidential tokens (amount encrypts on-chain)
    function transferPlaintext(address to, uint64 amount) external returns (bool) {
        if (to == address(0)) revert ZeroAddress();
        if (isRestricted[msg.sender]) revert AccountRestricted();

        euint64 encAmount = FHE.asEuint64(amount);
        FHE.allowThis(encAmount);
        FHE.allow(encAmount, msg.sender);

        ebool canTransfer = FHE.le(encAmount, _balances[msg.sender]);
        euint64 transferValue = FHE.select(canTransfer, encAmount, FHE.asEuint64(0));

        euint64 newFrom = FHE.sub(_balances[msg.sender], transferValue);
        _balances[msg.sender] = newFrom;
        FHE.allowThis(newFrom);
        FHE.allow(newFrom, msg.sender);

        euint64 newTo = FHE.add(_balances[to], transferValue);
        _balances[to] = newTo;
        FHE.allowThis(newTo);
        FHE.allow(newTo, to);

        emit Transfer(msg.sender, to, 0);
        return true;
    }

    /// @notice Request unwrap (marks canUnwrap boolean for public decryption)
    /// @param amount Amount of confidential tokens to unwrap (6 decimals)
    /// @return requestId Unique request identifier
    function unwrap(uint64 amount) external returns (uint256 requestId) {
        if (amount == 0) revert ZeroAmount();
        if (isRestricted[msg.sender]) revert AccountRestricted();

        isRestricted[msg.sender] = true;

        euint64 encAmount = FHE.asEuint64(amount);
        ebool canUnwrap = FHE.le(encAmount, _balances[msg.sender]);

        FHE.allowThis(canUnwrap);
        FHE.makePubliclyDecryptable(canUnwrap);

        requestId = unwrapNonce++;
        bytes32 handle = ebool.unwrap(canUnwrap);

        unwrapRequests[requestId] = UnwrapRequest({
            account: msg.sender,
            amount: amount,
            handle: handle,
            createdAt: block.timestamp
        });

        emit UnwrapRequested(requestId, msg.sender, amount, handle);
    }

    /// @notice Finalize unwrap with KMS decryption proof
    /// @param requestId The unwrap request ID
    /// @param handlesList The handles that were decrypted
    /// @param cleartexts ABI-encoded decrypted values
    /// @param decryptionProof KMS signatures proving the decryption is valid
    function finalizeUnwrap(
        uint256 requestId,
        bytes32[] calldata handlesList,
        bytes calldata cleartexts,
        bytes calldata decryptionProof
    ) external {
        UnwrapRequest memory req = unwrapRequests[requestId];
        if (req.account == address(0)) revert RequestNotFound();

        FHE.checkSignatures(handlesList, cleartexts, decryptionProof);

        bool canUnwrap = abi.decode(cleartexts, (bool));

        if (canUnwrap) {
            euint64 encAmount = FHE.asEuint64(req.amount);
            euint64 newBalance = FHE.sub(_balances[req.account], encAmount);
            _balances[req.account] = newBalance;
            FHE.allowThis(newBalance);
            FHE.allow(newBalance, req.account);

            totalSupply -= req.amount;

            uint256 underlyingAmount = uint256(req.amount);
            if (underlyingDecimals > decimals) {
                underlyingAmount = underlyingAmount * (10 ** (underlyingDecimals - decimals));
            } else if (underlyingDecimals < decimals) {
                underlyingAmount = underlyingAmount / (10 ** (decimals - underlyingDecimals));
            }

            underlyingToken.safeTransfer(req.account, underlyingAmount);
            emit Transfer(req.account, address(0), 0);
        }

        emit UnwrapFinalized(requestId, req.account, req.amount, canUnwrap);

        delete unwrapRequests[requestId];
        delete isRestricted[req.account];
    }

    /// @notice Cancel a stuck unwrap request after timeout
    /// @param requestId The unwrap request ID
    function cancelUnwrap(uint256 requestId) external {
        UnwrapRequest memory req = unwrapRequests[requestId];
        if (req.account == address(0)) revert RequestNotFound();
        if (req.account != msg.sender) revert NotRequestOwner();
        if (block.timestamp < req.createdAt + UNWRAP_TIMEOUT) revert RequestNotReady();

        delete unwrapRequests[requestId];
        delete isRestricted[req.account];

        emit UnwrapCancelled(requestId, req.account);
    }

    /// @notice Get encrypted balance handle
    function balanceOf(address account) external view returns (euint64) {
        return _balances[account];
    }
}
