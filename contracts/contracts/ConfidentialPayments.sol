// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

interface IHideMeToken {
    function transferPlaintext(address to, uint64 amount) external returns (bool);
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
}

/// @title ConfidentialPayments - Payment links for HideMe confidential tokens
/// @notice Create shareable payment requests. Funds transfer directly between
///         payer and merchant via the token's transferPlaintext (encrypts on-chain).
///         The payment link amount is visible off-chain, but the on-chain balance
///         changes are fully encrypted via FHE.
contract ConfidentialPayments is ZamaEthereumConfig {
    error LinkNotFound();
    error LinkAlreadyPaid();
    error LinkExpired();
    error LinkNotExpired();
    error NotMerchant();
    error LinkCancelled();

    event LinkCreated(bytes32 indexed linkId, address indexed merchant, address token);
    event LinkPaid(bytes32 indexed linkId, address indexed payer, uint256 paidAt);
    event LinkCancelledEvent(bytes32 indexed linkId);

    struct PaymentLink {
        address token;
        address merchant;
        uint64 amount;
        string memo;
        uint256 expiry;
        bool paid;
        bool cancelled;
        address payer;
        uint256 paidAt;
    }

    mapping(bytes32 => PaymentLink) public links;
    mapping(address => bytes32[]) public linksByMerchant;
    uint256 public totalLinks;

    /// @notice Create a payment link
    /// @param token HideMe token address
    /// @param amount Amount in raw token units (e.g. 50000000 = 50 tokens with 6 decimals)
    /// @param memo Human-readable description
    /// @param expiry Unix timestamp after which link expires (0 = never)
    /// @return linkId Unique identifier for this payment link
    function createPaymentLink(
        address token,
        uint64 amount,
        string calldata memo,
        uint256 expiry
    ) external returns (bytes32 linkId) {
        linkId = keccak256(abi.encodePacked(msg.sender, token, amount, memo, block.timestamp, totalLinks));

        links[linkId] = PaymentLink({
            token: token,
            merchant: msg.sender,
            amount: amount,
            memo: memo,
            expiry: expiry,
            paid: false,
            cancelled: false,
            payer: address(0),
            paidAt: 0
        });

        linksByMerchant[msg.sender].push(linkId);
        totalLinks++;

        emit LinkCreated(linkId, msg.sender, token);
    }

    /// @notice Pay a payment link (calls token.transferPlaintext which encrypts on-chain)
    /// @param linkId The payment link identifier
    function payLink(bytes32 linkId) external {
        PaymentLink storage link = links[linkId];
        if (link.merchant == address(0)) revert LinkNotFound();
        if (link.paid) revert LinkAlreadyPaid();
        if (link.cancelled) revert LinkCancelled();
        if (link.expiry > 0 && block.timestamp > link.expiry) revert LinkExpired();

        link.paid = true;
        link.payer = msg.sender;
        link.paidAt = block.timestamp;

        IHideMeToken(link.token).transferPlaintext(link.merchant, link.amount);

        emit LinkPaid(linkId, msg.sender, block.timestamp);
    }

    /// @notice Cancel an unpaid payment link (merchant only)
    /// @param linkId The payment link identifier
    function cancelLink(bytes32 linkId) external {
        PaymentLink storage link = links[linkId];
        if (link.merchant != msg.sender) revert NotMerchant();
        if (link.paid) revert LinkAlreadyPaid();

        link.cancelled = true;
        emit LinkCancelledEvent(linkId);
    }

    /// @notice Get merchant's payment link IDs
    function getMerchantLinks(address merchant) external view returns (bytes32[] memory) {
        return linksByMerchant[merchant];
    }

    /// @notice Get payment link details
    function getLink(bytes32 linkId) external view returns (
        address token,
        address merchant,
        uint64 amount,
        string memory memo,
        uint256 expiry,
        bool paid,
        bool cancelled,
        address payer,
        uint256 paidAt
    ) {
        PaymentLink storage l = links[linkId];
        return (l.token, l.merchant, l.amount, l.memo, l.expiry, l.paid, l.cancelled, l.payer, l.paidAt);
    }
}
