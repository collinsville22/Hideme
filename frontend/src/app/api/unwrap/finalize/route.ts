import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";

const MAINNET_RPC = "https://ethereum-rpc.publicnode.com";
const GATEWAY_RPC = "https://rpc-zama-gateway-mainnet.t.conduit.xyz";
const DECRYPTION_CONTRACT = "0x0f6024a97684f7d90ddb0fAAD79cB15F2C888D24";
const PROTOCOL_PAYMENT = "0x7E179E45E5fe0a21015Be25185363B4F2F2F7e89";
const ZAMA_TOKEN_GATEWAY = "0xcE762c7FDaac795D31a266B9247F8958c159c6d4";

const WRAPPER_ABI = [
  "function unwrapRequests(uint256 requestId) view returns (address account, uint64 amount, bytes32 handle, uint256 createdAt)",
  "function finalizeUnwrap(uint256 requestId, bytes32[] handlesList, bytes cleartexts, bytes decryptionProof) external",
  "function isRestricted(address account) view returns (bool)",
];

const DECRYPTION_ABI = [
  "function publicDecryptionRequest(bytes32[] ctHandles, bytes extraData) external",
  "event PublicDecryptionRequest(uint256 indexed decryptionId, tuple(bytes32 ctHandle, uint256 keyId, bytes32 snsCiphertextDigest, address[] coprocessorTxSenderAddresses)[] snsCtMaterials, bytes extraData)",
  "event PublicDecryptionResponse(uint256 indexed decryptionId, bytes decryptedResult, bytes[] signatures, bytes extraData)",
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

function getRelayerKey(): string {
  const key = process.env.GATEWAY_RELAYER_PRIVATE_KEY;
  if (!key) throw new Error("GATEWAY_RELAYER_PRIVATE_KEY not set");
  return key;
}

let approvalChecked = false;

async function ensureZamaApproval(signer: ethers.Wallet): Promise<void> {
  if (approvalChecked) return;
  const zamaToken = new ethers.Contract(ZAMA_TOKEN_GATEWAY, ERC20_ABI, signer);
  const currentAllowance: bigint = await zamaToken.allowance(signer.address, PROTOCOL_PAYMENT);
  const threshold = ethers.parseUnits("1", 18);
  if (currentAllowance < threshold) {
    const tx = await zamaToken.approve(PROTOCOL_PAYMENT, ethers.parseUnits("1000", 18));
    await tx.wait();
  }
  approvalChecked = true;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { wrapperAddress, requestId } = body;

    if (!wrapperAddress || requestId === undefined) {
      return NextResponse.json({ error: "Missing wrapperAddress or requestId" }, { status: 400 });
    }

    const key = getRelayerKey();
    const mainnetProvider = new ethers.JsonRpcProvider(MAINNET_RPC, undefined, { staticNetwork: true });
    const wrapper = new ethers.Contract(wrapperAddress, WRAPPER_ABI, mainnetProvider);

    const req = await wrapper.unwrapRequests(requestId);
    const account = req[0];
    const amount = req[1];
    const handle = req[2];
    const createdAt = req[3];

    if (account === ethers.ZeroAddress) {
      return NextResponse.json({ success: true, message: "Request already finalized or not found", alreadyDone: true });
    }

    const gatewayProvider = new ethers.JsonRpcProvider(GATEWAY_RPC, undefined, {
      staticNetwork: true,
      pollingInterval: 3000,
      batchMaxCount: 1,
    });
    (gatewayProvider as unknown as { _getConnection(): { timeout: number } })._getConnection().timeout = 60000;
    const gatewaySigner = new ethers.Wallet(key, gatewayProvider);

    await ensureZamaApproval(gatewaySigner);

    const decryptionContract = new ethers.Contract(DECRYPTION_CONTRACT, DECRYPTION_ABI, gatewaySigner);
    const ctHandles = [handle];

    const decTx = await decryptionContract.publicDecryptionRequest(ctHandles, "0x");
    const decReceipt = await decTx.wait();

    let decryptionId: bigint | null = null;
    for (const log of decReceipt!.logs) {
      try {
        const parsed = decryptionContract.interface.parseLog({ topics: [...log.topics], data: log.data });
        if (parsed && parsed.name === "PublicDecryptionRequest") {
          decryptionId = parsed.args.decryptionId;
          break;
        }
      } catch { /* expected */ }
    }

    if (decryptionId === null) {
      return NextResponse.json({ error: "Could not extract decryptionId" }, { status: 500 });
    }

    const startTime = Date.now();
    const timeoutMs = 180_000;
    let decryptedResult: string | null = null;
    let signatures: string[] = [];
    let extraData = "0x";

    while (Date.now() - startTime < timeoutMs) {
      const filter = decryptionContract.filters.PublicDecryptionResponse(decryptionId);
      const events = await decryptionContract.queryFilter(filter, -1000);

      if (events.length > 0) {
        const event = events[0] as ethers.EventLog;
        const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
          ["bytes", "bytes[]", "bytes"],
          event.data,
        );
        decryptedResult = `${decoded[0]}`;
        signatures = Array.from(decoded[1] as string[]).map((s) => `${s}`);
        extraData = `${decoded[2]}`;
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    if (!decryptedResult) {
      return NextResponse.json({ error: "KMS decryption timed out" }, { status: 500 });
    }

    const numSigners = ethers.solidityPacked(["uint8"], [signatures.length]);
    const packedSigs = ethers.solidityPacked(
      signatures.map(() => "bytes"),
      signatures,
    );
    const parts: string[] = [numSigners, packedSigs];
    if (extraData && extraData.length > 2) parts.push(extraData);
    const proof = ethers.concat(parts);

    const recheck = await wrapper.unwrapRequests(requestId);
    if (recheck[0] === ethers.ZeroAddress) {
      return NextResponse.json({ success: true, message: "Already finalized", alreadyDone: true });
    }

    const mainnetSigner = new ethers.Wallet(key, mainnetProvider);
    const wrapperSigned = new ethers.Contract(wrapperAddress, WRAPPER_ABI, mainnetSigner);

    const finalizeTx = await wrapperSigned.finalizeUnwrap(
      requestId,
      ctHandles,
      decryptedResult,
      proof,
      { gasLimit: 1000000 },
    );
    const finalizeReceipt = await finalizeTx.wait();

    if (finalizeReceipt!.status === 0) {
      return NextResponse.json({ error: "finalizeUnwrap reverted on-chain", txHash: finalizeTx.hash }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      txHash: finalizeTx.hash,
      blockNumber: finalizeReceipt!.blockNumber,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message.substring(0, 500) }, { status: 500 });
  }
}
