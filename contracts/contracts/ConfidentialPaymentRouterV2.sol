// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IConfidentialWrapper {
    function wrap(uint256 amount) external;
    function transferPlaintext(address to, uint64 amount) external returns (bool);
    function unwrap(uint64 amount) external returns (uint256 requestId);
    function finalizeUnwrap(
        uint256 requestId,
        bytes32[] calldata handlesList,
        bytes calldata cleartexts,
        bytes calldata decryptionProof
    ) external;
    function cancelUnwrap(uint256 requestId) external;
    function underlyingToken() external view returns (IERC20);
    function underlyingDecimals() external view returns (uint8);
    function balanceOf(address account) external view returns (euint64);
    function isRestricted(address account) external view returns (bool);
    function unwrapRequests(uint256 requestId) external view returns (
        address account, uint64 amount, bytes32 handle, uint256 createdAt
    );
}

interface IWrapperFactory {
    function getWrapper(address erc20Token) external view returns (address);
    function createWrapper(address erc20Token) external returns (address);
}

/// @title ConfidentialPaymentRouterV2 - Encrypted amount, receiver gets plain ERC-20
/// @notice Wraps ERC-20 into cToken, transfers with encrypted amount, unwraps for receiver.
///         On-chain transfer amount is encrypted. Receiver gets standard ERC-20 without
///         ever touching FHE or cTokens.
contract ConfidentialPaymentRouterV2 is ZamaEthereumConfig {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error ZeroAmount();
    error InsufficientRelayerFee();
    error PaymentNotFound();
    error PaymentAlreadyFinalized();
    error WrapperNotFound();
    error NotSender();
    error TooEarly();

    event PaymentCreated(
        uint256 indexed paymentId,
        address indexed sender,
        address indexed receiver,
        address wrapper,
        uint64 amount,
        string memo
    );
    event PaymentUnwrapRequested(uint256 indexed paymentId, uint256 unwrapRequestId, bytes32 handle);
    event PaymentFinalized(uint256 indexed paymentId, address indexed receiver, uint64 amount, bool success);
    event PaymentCancelled(uint256 indexed paymentId, address indexed sender);

    struct Payment {
        address sender;
        address receiver;
        address wrapper;
        uint64 amount;
        uint256 unwrapRequestId;
        bytes32 handle;
        uint256 relayerFee;
        string memo;
        uint256 createdAt;
        bool finalized;
        bool cancelled;
    }

    IWrapperFactory public immutable factory;
    mapping(uint256 => Payment) public payments;
    uint256 public paymentCount;
    uint256 public constant PAYMENT_TIMEOUT = 1 days;
    uint256 public constant MIN_RELAYER_FEE = 0.00005 ether;

    constructor(address _factory) {
        factory = IWrapperFactory(_factory);
    }

    /// @notice Send ERC-20 confidentially (amount is encrypted on-chain)
    /// @param token The ERC-20 token address
    /// @param receiver Who gets the plain tokens after finalization
    /// @param amount Amount in the token's native decimals
    /// @param memo Human-readable memo
    /// @return paymentId Unique payment ID
    function send(
        address token,
        address receiver,
        uint256 amount,
        string calldata memo
    ) external payable returns (uint256 paymentId) {
        if (receiver == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (msg.value < MIN_RELAYER_FEE) revert InsufficientRelayerFee();

        address wrapperAddr = factory.getWrapper(token);
        if (wrapperAddr == address(0)) revert WrapperNotFound();
        IConfidentialWrapper wrapper = IConfidentialWrapper(wrapperAddr);

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        IERC20(token).forceApprove(wrapperAddr, amount);
        wrapper.wrap(amount);

        uint8 tokenDecimals = wrapper.underlyingDecimals();
        uint64 adjustedAmount;
        if (tokenDecimals > 6) {
            adjustedAmount = uint64(amount / (10 ** (tokenDecimals - 6)));
        } else if (tokenDecimals < 6) {
            adjustedAmount = uint64(amount * (10 ** (6 - tokenDecimals)));
        } else {
            adjustedAmount = uint64(amount);
        }

        uint256 unwrapReqId = wrapper.unwrap(adjustedAmount);

        (, , bytes32 handle, ) = wrapper.unwrapRequests(unwrapReqId);

        paymentId = paymentCount++;
        payments[paymentId] = Payment({
            sender: msg.sender,
            receiver: receiver,
            wrapper: wrapperAddr,
            amount: adjustedAmount,
            unwrapRequestId: unwrapReqId,
            handle: handle,
            relayerFee: msg.value,
            memo: memo,
            createdAt: block.timestamp,
            finalized: false,
            cancelled: false
        });

        emit PaymentCreated(paymentId, msg.sender, receiver, wrapperAddr, adjustedAmount, memo);
        emit PaymentUnwrapRequested(paymentId, unwrapReqId, handle);
    }

    /// @notice Finalize payment: submit KMS proof, receiver gets plain ERC-20. Anyone can call.
    function finalize(
        uint256 paymentId,
        bytes32[] calldata handlesList,
        bytes calldata cleartexts,
        bytes calldata decryptionProof
    ) external {
        Payment storage p = payments[paymentId];
        if (p.sender == address(0)) revert PaymentNotFound();
        if (p.finalized) revert PaymentAlreadyFinalized();

        IConfidentialWrapper wrapper = IConfidentialWrapper(p.wrapper);

        wrapper.finalizeUnwrap(p.unwrapRequestId, handlesList, cleartexts, decryptionProof);

        IERC20 underlying = wrapper.underlyingToken();
        uint256 underlyingAmount = uint256(p.amount);
        uint8 tokenDecimals = wrapper.underlyingDecimals();
        if (tokenDecimals > 6) {
            underlyingAmount = underlyingAmount * (10 ** (tokenDecimals - 6));
        } else if (tokenDecimals < 6) {
            underlyingAmount = underlyingAmount / (10 ** (6 - tokenDecimals));
        }

        underlying.safeTransfer(p.receiver, underlyingAmount);
        p.finalized = true;

        if (p.relayerFee > 0) {
            (bool sent, ) = payable(msg.sender).call{value: p.relayerFee}("");
            if (!sent) {
                (bool refunded, ) = payable(p.sender).call{value: p.relayerFee}("");
                refunded;
            }
        }

        emit PaymentFinalized(paymentId, p.receiver, p.amount, true);
    }

    /// @notice Cancel payment after timeout. Refunds sender.
    function cancel(uint256 paymentId) external {
        Payment storage p = payments[paymentId];
        if (p.sender != msg.sender) revert NotSender();
        if (p.finalized || p.cancelled) revert PaymentAlreadyFinalized();
        if (block.timestamp < p.createdAt + PAYMENT_TIMEOUT) revert TooEarly();

        IConfidentialWrapper wrapper = IConfidentialWrapper(p.wrapper);

        wrapper.cancelUnwrap(p.unwrapRequestId);
        wrapper.transferPlaintext(p.sender, p.amount);

        p.cancelled = true;

        if (p.relayerFee > 0) {
            (bool sent, ) = payable(p.sender).call{value: p.relayerFee}("");
            sent;
        }

        emit PaymentCancelled(paymentId, p.sender);
    }

    /// @notice Get payment details
    function getPayment(uint256 paymentId) external view returns (
        address sender, address receiver, address wrapper,
        uint64 amount, uint256 unwrapRequestId, bytes32 handle,
        uint256 relayerFee, string memory memo, uint256 createdAt,
        bool finalized, bool cancelled
    ) {
        Payment storage p = payments[paymentId];
        return (
            p.sender, p.receiver, p.wrapper,
            p.amount, p.unwrapRequestId, p.handle,
            p.relayerFee, p.memo, p.createdAt, p.finalized, p.cancelled
        );
    }
}
