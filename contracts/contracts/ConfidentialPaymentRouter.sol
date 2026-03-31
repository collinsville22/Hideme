// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title ConfidentialPaymentRouter - Send any ERC-20 confidentially (deprecated, use V2)
/// @notice One-step confidential payments: sender deposits ERC-20, contract holds funds,
///         marks for KMS decryption, then anyone submits the proof to release funds to receiver.
contract ConfidentialPaymentRouter is ZamaEthereumConfig {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error ZeroAmount();
    error PaymentNotFound();
    error PaymentAlreadyFinalized();
    error PaymentExpired();
    error NotCreator();

    event PaymentCreated(
        uint256 indexed paymentId,
        address indexed sender,
        address indexed receiver,
        address token,
        bytes32 handle,
        string memo
    );
    event PaymentFinalized(uint256 indexed paymentId, address indexed receiver, bool success);
    event PaymentCancelled(uint256 indexed paymentId, address indexed sender);
    event PaymentRequestCreated(uint256 indexed requestId, address indexed creator, address token, uint64 amount, string memo);

    struct Payment {
        address sender;
        address receiver;
        address token;
        uint64 amount;
        uint256 rawAmount;
        bytes32 handle;
        string memo;
        uint256 createdAt;
        bool finalized;
        bool cancelled;
    }

    struct PaymentRequest {
        address creator;
        address token;
        uint64 amount;
        string memo;
        uint256 expiry;
        bool fulfilled;
        uint256 paymentId;
    }

    mapping(uint256 => Payment) public payments;
    mapping(uint256 => PaymentRequest) public paymentRequests;
    uint256 public paymentCount;
    uint256 public requestCount;
    uint256 public constant PAYMENT_TIMEOUT = 1 days;

    mapping(bytes32 => euint64) internal _internalBalances;

    /// @notice Send ERC-20 confidentially. Contract holds funds until KMS proof is submitted.
    /// @param token ERC-20 token to send
    /// @param receiver Recipient address
    /// @param amount Amount in token's native decimals
    /// @param memo Description
    /// @return paymentId Unique payment identifier
    function send(
        address token,
        address receiver,
        uint256 amount,
        string calldata memo
    ) external returns (uint256 paymentId) {
        if (receiver == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        uint8 tokenDecimals = IERC20Metadata(token).decimals();
        uint64 adjustedAmount;
        if (tokenDecimals > 6) {
            adjustedAmount = uint64(amount / (10 ** (tokenDecimals - 6)));
        } else if (tokenDecimals < 6) {
            adjustedAmount = uint64(amount * (10 ** (6 - tokenDecimals)));
        } else {
            adjustedAmount = uint64(amount);
        }

        ebool canProcess = FHE.asEbool(true);
        FHE.allowThis(canProcess);
        FHE.makePubliclyDecryptable(canProcess);

        bytes32 handle = ebool.unwrap(canProcess);

        paymentId = paymentCount++;
        payments[paymentId] = Payment({
            sender: msg.sender,
            receiver: receiver,
            token: token,
            amount: adjustedAmount,
            rawAmount: amount,
            handle: handle,
            memo: memo,
            createdAt: block.timestamp,
            finalized: false,
            cancelled: false
        });

        emit PaymentCreated(paymentId, msg.sender, receiver, token, handle, memo);
    }

    /// @notice Finalize a payment with KMS decryption proof. Anyone can call this.
    /// @param paymentId The payment to finalize
    /// @param handlesList Handles that were decrypted
    /// @param cleartexts ABI-encoded decrypted values
    /// @param decryptionProof KMS signatures
    function finalize(
        uint256 paymentId,
        bytes32[] calldata handlesList,
        bytes calldata cleartexts,
        bytes calldata decryptionProof
    ) external {
        Payment storage p = payments[paymentId];
        if (p.sender == address(0)) revert PaymentNotFound();
        if (p.finalized) revert PaymentAlreadyFinalized();
        if (p.cancelled) revert PaymentNotFound();

        FHE.checkSignatures(handlesList, cleartexts, decryptionProof);

        bool canProcess = abi.decode(cleartexts, (bool));

        p.finalized = true;

        if (canProcess) {
            IERC20(p.token).safeTransfer(p.receiver, p.rawAmount);
        } else {
            IERC20(p.token).safeTransfer(p.sender, p.rawAmount);
        }

        emit PaymentFinalized(paymentId, p.receiver, canProcess);
    }

    /// @notice Cancel a payment and get refund (only after timeout)
    function cancel(uint256 paymentId) external {
        Payment storage p = payments[paymentId];
        if (p.sender != msg.sender) revert NotCreator();
        if (p.finalized) revert PaymentAlreadyFinalized();
        if (block.timestamp < p.createdAt + PAYMENT_TIMEOUT) revert PaymentExpired();

        p.cancelled = true;
        IERC20(p.token).safeTransfer(p.sender, p.rawAmount);
        emit PaymentCancelled(paymentId, msg.sender);
    }

    /// @notice Create a payment request link
    /// @param token ERC-20 token to request
    /// @param amount Amount in 6 decimals (0 = any amount)
    /// @param memo Description
    /// @param expiry Unix timestamp (0 = no expiry)
    /// @return requestId Unique request identifier
    function createRequest(
        address token,
        uint64 amount,
        string calldata memo,
        uint256 expiry
    ) external returns (uint256 requestId) {
        requestId = requestCount++;
        paymentRequests[requestId] = PaymentRequest({
            creator: msg.sender,
            token: token,
            amount: amount,
            memo: memo,
            expiry: expiry,
            fulfilled: false,
            paymentId: 0
        });

        emit PaymentRequestCreated(requestId, msg.sender, token, amount, memo);
    }

    /// @notice Pay a payment request (fulfills the invoice)
    /// @param requestId The request to fulfill
    /// @param amount Amount in token's native decimals
    /// @return paymentId The created payment ID
    function payRequest(uint256 requestId, uint256 amount) external returns (uint256 paymentId) {
        PaymentRequest storage req = paymentRequests[requestId];
        require(req.creator != address(0), "Request not found");
        require(!req.fulfilled, "Already fulfilled");
        if (req.expiry > 0 && block.timestamp > req.expiry) revert PaymentExpired();

        uint256 actualAmount = amount;
        if (req.amount > 0) {
            uint8 tokenDecimals = IERC20Metadata(req.token).decimals();
            if (tokenDecimals > 6) {
                actualAmount = uint256(req.amount) * (10 ** (tokenDecimals - 6));
            } else if (tokenDecimals < 6) {
                actualAmount = uint256(req.amount) / (10 ** (6 - tokenDecimals));
            } else {
                actualAmount = uint256(req.amount);
            }
        }

        paymentId = this.send(req.token, req.creator, actualAmount, req.memo);
        req.fulfilled = true;
        req.paymentId = paymentId;
    }

    /// @notice Send to multiple recipients in one transaction
    /// @param token ERC-20 token
    /// @param receivers Array of recipient addresses
    /// @param amounts Array of amounts in token's native decimals
    /// @param memos Array of memos
    /// @return paymentIds Array of payment IDs
    function batchSend(
        address token,
        address[] calldata receivers,
        uint256[] calldata amounts,
        string[] calldata memos
    ) external returns (uint256[] memory paymentIds) {
        require(receivers.length == amounts.length, "Length mismatch");
        require(receivers.length == memos.length, "Length mismatch");

        paymentIds = new uint256[](receivers.length);
        for (uint256 i = 0; i < receivers.length; i++) {
            paymentIds[i] = this.send(token, receivers[i], amounts[i], memos[i]);
        }
    }

    /// @notice Get payment details
    function getPayment(uint256 paymentId) external view returns (
        address sender, address receiver, address token,
        uint64 amount, uint256 rawAmount, bytes32 handle,
        string memory memo, uint256 createdAt, bool finalized, bool cancelled
    ) {
        Payment storage p = payments[paymentId];
        return (p.sender, p.receiver, p.token, p.amount, p.rawAmount, p.handle, p.memo, p.createdAt, p.finalized, p.cancelled);
    }

    /// @notice Get payment request details
    function getRequest(uint256 requestId) external view returns (
        address creator, address token, uint64 amount,
        string memory memo, uint256 expiry, bool fulfilled, uint256 paymentId
    ) {
        PaymentRequest storage r = paymentRequests[requestId];
        return (r.creator, r.token, r.amount, r.memo, r.expiry, r.fulfilled, r.paymentId);
    }
}
