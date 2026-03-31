// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title HideMeToken - Confidential ERC20-like token with encrypted balances
/// @notice Balances and transfer amounts are fully encrypted using FHE.
///         Only the account owner (and designated observers) can decrypt their balance.
contract HideMeToken is ZamaEthereumConfig {
    error ZeroAddress();
    error SenderNotAllowed();
    error OnlyOwner();
    error MintingDisabled();
    error BurningDisabled();
    error ExceedsMaxSupply();

    /// @dev Amount is always 0 in events to prevent leaking encrypted data
    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event ObserverAdded(address indexed observer, address indexed addedBy);
    event ObserverRemoved(address indexed observer, address indexed removedBy);
    event OwnershipRenounced(address indexed previousOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    string public name;
    string public symbol;
    uint8 public constant decimals = 6;
    uint64 public totalSupply;
    address public owner;

    bool public mintable;
    bool public burnable;
    uint64 public maxSupply;

    mapping(address => euint64) internal _balances;
    mapping(address => mapping(address => euint64)) internal _allowances;

    /// @notice Compliance observers that can decrypt any balance (auditors, regulators)
    mapping(address => bool) public isObserver;
    address[] public observers;

    constructor(
        string memory name_,
        string memory symbol_,
        uint64 initialSupply_,
        address owner_,
        address[] memory observers_,
        bool mintable_,
        bool burnable_,
        uint64 maxSupply_
    ) {
        if (owner_ == address(0)) revert ZeroAddress();
        if (maxSupply_ > 0 && initialSupply_ > maxSupply_) revert ExceedsMaxSupply();

        name = name_;
        symbol = symbol_;
        owner = owner_;
        mintable = mintable_;
        burnable = burnable_;
        maxSupply = maxSupply_;

        for (uint256 i = 0; i < observers_.length; i++) {
            if (observers_[i] != address(0)) {
                isObserver[observers_[i]] = true;
                observers.push(observers_[i]);
            }
        }

        if (initialSupply_ > 0) {
            _mint(owner_, initialSupply_);
        }
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    /// @notice Get encrypted balance of an account
    function balanceOf(address account) external view returns (euint64) {
        return _balances[account];
    }

    /// @notice Get encrypted allowance
    function allowance(address account, address spender) external view returns (euint64) {
        return _allowances[account][spender];
    }

    /// @notice Transfer encrypted amount to recipient
    function transfer(
        address to,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external returns (bool) {
        if (to == address(0)) revert ZeroAddress();
        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
        _transfer(msg.sender, to, amount);
        return true;
    }

    /// @notice Transfer using an already-encrypted euint64 (for contract-to-contract calls)
    function transfer(address to, euint64 amount) external returns (bool) {
        if (to == address(0)) revert ZeroAddress();
        if (!FHE.isSenderAllowed(amount)) revert SenderNotAllowed();
        _transfer(msg.sender, to, amount);
        return true;
    }

    /// @notice Transfer a plaintext amount (encrypts on-chain via FHE.asEuint64)
    function transferPlaintext(address to, uint64 amount) external returns (bool) {
        if (to == address(0)) revert ZeroAddress();
        euint64 encAmount = FHE.asEuint64(amount);
        FHE.allowThis(encAmount);
        FHE.allow(encAmount, msg.sender);
        _transfer(msg.sender, to, encAmount);
        return true;
    }

    /// @notice Approve spender for encrypted amount
    function approve(
        address spender,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external returns (bool) {
        if (spender == address(0)) revert ZeroAddress();
        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
        _approve(msg.sender, spender, amount);
        return true;
    }

    /// @notice Transfer from an approved account
    function transferFrom(
        address from,
        address to,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external returns (bool) {
        if (to == address(0)) revert ZeroAddress();
        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
        if (!FHE.isSenderAllowed(amount)) revert SenderNotAllowed();
        _transferFrom(from, to, amount);
        return true;
    }

    /// @notice Burn tokens from caller's balance (reduces total supply)
    function burn(uint64 amount) external {
        if (!burnable) revert BurningDisabled();
        euint64 encAmount = FHE.asEuint64(amount);
        FHE.allowThis(encAmount);
        FHE.allow(encAmount, msg.sender);

        ebool canBurn = FHE.le(encAmount, _balances[msg.sender]);
        euint64 burnValue = FHE.select(canBurn, encAmount, FHE.asEuint64(0));

        euint64 newBalance = FHE.sub(_balances[msg.sender], burnValue);
        _balances[msg.sender] = newBalance;
        FHE.allowThis(newBalance);
        FHE.allow(newBalance, msg.sender);
        _allowObservers(newBalance);

        totalSupply -= amount;
        emit Transfer(msg.sender, address(0), 0);
    }

    /// @notice Mint new tokens (only owner, only if mintable)
    function mint(address to, uint64 amount) external onlyOwner {
        if (!mintable) revert MintingDisabled();
        if (to == address(0)) revert ZeroAddress();
        if (maxSupply > 0 && totalSupply + amount > maxSupply) revert ExceedsMaxSupply();
        _mint(to, amount);
    }

    /// @notice Add a compliance observer who can view all balances
    function addObserver(address observer) external onlyOwner {
        if (observer == address(0)) revert ZeroAddress();
        if (!isObserver[observer]) {
            isObserver[observer] = true;
            observers.push(observer);
            emit ObserverAdded(observer, msg.sender);
        }
    }

    /// @notice Remove a compliance observer
    function removeObserver(address observer) external onlyOwner {
        if (isObserver[observer]) {
            isObserver[observer] = false;
            for (uint256 i = 0; i < observers.length; i++) {
                if (observers[i] == observer) {
                    observers[i] = observers[observers.length - 1];
                    observers.pop();
                    break;
                }
            }
            emit ObserverRemoved(observer, msg.sender);
        }
    }

    /// @notice Transfer ownership
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address prev = owner;
        owner = newOwner;
        emit OwnershipTransferred(prev, newOwner);
    }

    /// @notice Permanently renounce ownership (disables mint and observer changes)
    function renounceOwnership() external onlyOwner {
        address prev = owner;
        owner = address(0);
        emit OwnershipRenounced(prev);
    }

    /// @notice Get all observers
    function getObservers() external view returns (address[] memory) {
        return observers;
    }

    function _mint(address to, uint64 amount) internal {
        euint64 encAmount = FHE.asEuint64(amount);
        euint64 newBalance = FHE.add(_balances[to], encAmount);
        _balances[to] = newBalance;

        FHE.allowThis(newBalance);
        FHE.allow(newBalance, to);
        _allowObservers(newBalance);

        totalSupply += amount;
        emit Transfer(address(0), to, 0);
    }

    function _transfer(address from, address to, euint64 amount) internal {
        ebool canTransfer = FHE.le(amount, _balances[from]);
        euint64 transferValue = FHE.select(canTransfer, amount, FHE.asEuint64(0));

        euint64 newBalanceFrom = FHE.sub(_balances[from], transferValue);
        _balances[from] = newBalanceFrom;
        FHE.allowThis(newBalanceFrom);
        FHE.allow(newBalanceFrom, from);
        _allowObservers(newBalanceFrom);

        euint64 newBalanceTo = FHE.add(_balances[to], transferValue);
        _balances[to] = newBalanceTo;
        FHE.allowThis(newBalanceTo);
        FHE.allow(newBalanceTo, to);
        _allowObservers(newBalanceTo);

        emit Transfer(from, to, 0);
    }

    function _approve(address account, address spender, euint64 amount) internal {
        _allowances[account][spender] = amount;
        FHE.allowThis(amount);
        FHE.allow(amount, account);
        FHE.allow(amount, spender);
        emit Approval(account, spender, 0);
    }

    function _transferFrom(address from, address to, euint64 amount) internal {
        euint64 currentAllowance = _allowances[from][msg.sender];

        ebool allowedTransfer = FHE.le(amount, currentAllowance);
        ebool hasBalance = FHE.le(amount, _balances[from]);
        ebool canTransfer = FHE.and(hasBalance, allowedTransfer);

        euint64 transferValue = FHE.select(canTransfer, amount, FHE.asEuint64(0));

        euint64 newAllowance = FHE.select(canTransfer, FHE.sub(currentAllowance, transferValue), currentAllowance);
        _approve(from, msg.sender, newAllowance);

        euint64 newBalanceFrom = FHE.sub(_balances[from], transferValue);
        _balances[from] = newBalanceFrom;
        FHE.allowThis(newBalanceFrom);
        FHE.allow(newBalanceFrom, from);
        _allowObservers(newBalanceFrom);

        euint64 newBalanceTo = FHE.add(_balances[to], transferValue);
        _balances[to] = newBalanceTo;
        FHE.allowThis(newBalanceTo);
        FHE.allow(newBalanceTo, to);
        _allowObservers(newBalanceTo);

        emit Transfer(from, to, 0);
    }

    /// @dev Grant all registered observers access to a ciphertext
    function _allowObservers(euint64 ct) internal {
        for (uint256 i = 0; i < observers.length; i++) {
            FHE.allow(ct, observers[i]);
        }
    }
}
