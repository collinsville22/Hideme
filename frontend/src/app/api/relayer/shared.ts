import { ethers } from "ethers";

export const MAINNET_RPC = "https://ethereum-rpc.publicnode.com";
export const GATEWAY_RPC = "https://rpc-zama-gateway-mainnet.t.conduit.xyz";
export const DECRYPTION_CONTRACT = "0x0f6024a97684f7d90ddb0fAAD79cB15F2C888D24";
export const PROTOCOL_PAYMENT = "0x7E179E45E5fe0a21015Be25185363B4F2F2F7e89";
export const ZAMA_TOKEN_GATEWAY = "0xcE762c7FDaac795D31a266B9247F8958c159c6d4";
export const ROUTER_V2 = "0x087D50Bb21a4C7A5E9394E9739809cB3AA6576Fa";

export const ROUTER_V2_ABI = [
  "function getPayment(uint256 paymentId) view returns (address sender, address receiver, address wrapper, uint64 amount, uint256 unwrapRequestId, bytes32 handle, uint256 relayerFee, string memo, uint256 createdAt, bool finalized, bool cancelled)",
  "function finalize(uint256 paymentId, bytes32[] handlesList, bytes cleartexts, bytes decryptionProof) external",
  "function paymentCount() view returns (uint256)",
];

export const WRAPPER_ABI = [
  "function unwrapRequests(uint256 requestId) view returns (address account, uint64 amount, bytes32 handle, uint256 createdAt)",
  "function finalizeUnwrap(uint256 requestId, bytes32[] handlesList, bytes cleartexts, bytes decryptionProof) external",
  "function isRestricted(address account) view returns (bool)",
];

export const DECRYPTION_ABI = [
  "function publicDecryptionRequest(bytes32[] ctHandles, bytes extraData) external",
  "event PublicDecryptionRequest(uint256 indexed decryptionId, tuple(bytes32 ctHandle, uint256 keyId, bytes32 snsCiphertextDigest, address[] coprocessorTxSenderAddresses)[] snsCtMaterials, bytes extraData)",
  "event PublicDecryptionResponse(uint256 indexed decryptionId, bytes decryptedResult, bytes[] signatures, bytes extraData)",
];

export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

export function getRelayerKey(): string {
  const key = process.env.GATEWAY_RELAYER_PRIVATE_KEY;
  if (!key) throw new Error("GATEWAY_RELAYER_PRIVATE_KEY not set");
  return key;
}

let approvalChecked = false;

export async function ensureZamaApproval(signer: ethers.Wallet): Promise<void> {
  if (approvalChecked) return;
  const zamaToken = new ethers.Contract(ZAMA_TOKEN_GATEWAY, ERC20_ABI, signer);
  const currentAllowance: bigint = await zamaToken.allowance(signer.address, PROTOCOL_PAYMENT);
  if (currentAllowance < ethers.parseUnits("1", 18)) {
    const tx = await zamaToken.approve(PROTOCOL_PAYMENT, ethers.parseUnits("1000", 18));
    await tx.wait();
  }
  approvalChecked = true;
}

export function buildDecryptionProof(signatures: string[], extraData: string): string {
  const numSigners = ethers.solidityPacked(["uint8"], [signatures.length]);
  const packedSigs = ethers.solidityPacked(signatures.map(() => "bytes"), signatures);
  const parts: string[] = [numSigners, packedSigs];
  if (extraData && extraData.length > 2) parts.push(extraData);
  return ethers.concat(parts);
}
