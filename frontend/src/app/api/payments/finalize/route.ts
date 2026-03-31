import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";

const MAINNET_RPC = "https://ethereum-rpc.publicnode.com";
const GATEWAY_RPC = "https://rpc-zama-gateway-mainnet.t.conduit.xyz";
const ROUTER_V2 = "0x087D50Bb21a4C7A5E9394E9739809cB3AA6576Fa";
const DECRYPTION_CONTRACT = "0x0f6024a97684f7d90ddb0fAAD79cB15F2C888D24";
const PROTOCOL_PAYMENT = "0x7E179E45E5fe0a21015Be25185363B4F2F2F7e89";
const ZAMA_TOKEN_GATEWAY = "0xcE762c7FDaac795D31a266B9247F8958c159c6d4";

const ROUTER_V2_ABI = [
  "function getPayment(uint256 paymentId) view returns (address sender, address receiver, address wrapper, uint64 amount, uint256 unwrapRequestId, bytes32 handle, uint256 relayerFee, string memo, uint256 createdAt, bool finalized, bool cancelled)",
  "function finalize(uint256 paymentId, bytes32[] handlesList, bytes cleartexts, bytes decryptionProof) external",
  "function paymentCount() view returns (uint256)",
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

const activeFinalizations = new Map<number, Promise<NextResponse>>();

function buildDecryptionProof(signatures: string[], extraData: string): string {
  const numSigners = ethers.solidityPacked(["uint8"], [signatures.length]);
  const packedSigs = ethers.solidityPacked(
    signatures.map(() => "bytes"),
    signatures
  );
  const parts = [numSigners, packedSigs];
  if (extraData && extraData.length > 2) parts.push(extraData);
  return ethers.concat(parts);
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
    const { paymentId } = body;

    if (paymentId === undefined || paymentId === null) {
      return NextResponse.json({ error: "Missing paymentId" }, { status: 400 });
    }

    const existing = activeFinalizations.get(paymentId);
    if (existing) return existing;

    const promise = doFinalize(paymentId);
    activeFinalizations.set(paymentId, promise);
    const result = await promise;
    activeFinalizations.delete(paymentId);
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message.substring(0, 500) }, { status: 500 });
  }
}

async function doFinalize(paymentId: number): Promise<NextResponse> {
  try {
    const key = getRelayerKey();
    const mainnetProvider = new ethers.JsonRpcProvider(MAINNET_RPC, undefined, { staticNetwork: true });
    const router = new ethers.Contract(ROUTER_V2, ROUTER_V2_ABI, mainnetProvider);
    const payment = await router.getPayment(paymentId);

    const isFinalized = payment[9];
    const isCancelled = payment[10];
    const handle = payment[5];

    if (isFinalized) {
      return NextResponse.json({ success: true, message: "Payment already finalized", alreadyDone: true });
    }
    if (isCancelled) {
      return NextResponse.json({ error: "Payment was cancelled" }, { status: 400 });
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

    const paymentRecheck = await router.getPayment(paymentId);
    if (paymentRecheck[9]) {
      return NextResponse.json({ success: true, message: "Payment already finalized", alreadyDone: true });
    }

    const mainnetSigner = new ethers.Wallet(key, mainnetProvider);
    const routerSigned = new ethers.Contract(ROUTER_V2, ROUTER_V2_ABI, mainnetSigner);

    const proof = buildDecryptionProof(signatures, extraData);

    const finalizeTx = await routerSigned.finalize(
      paymentId,
      ctHandles,
      decryptedResult,
      proof,
      { gasLimit: 1000000 }
    );
    const finalizeReceipt = await finalizeTx.wait();

    if (finalizeReceipt!.status === 0) {
      const recheckFinal = await router.getPayment(paymentId);
      if (recheckFinal[9]) {
        return NextResponse.json({ success: true, message: "Payment finalized by another call", alreadyDone: true });
      }
      return NextResponse.json({
        error: "finalize reverted on-chain",
        txHash: finalizeTx.hash,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      txHash: finalizeTx.hash,
      blockNumber: finalizeReceipt!.blockNumber,
      paymentId,
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("reverted") || message.includes("execution reverted")) {
      try {
        const mainnetProvider = new ethers.JsonRpcProvider(MAINNET_RPC, undefined, { staticNetwork: true });
        const router = new ethers.Contract(ROUTER_V2, ROUTER_V2_ABI, mainnetProvider);
        const payment = await router.getPayment(paymentId);
        if (payment[9]) {
          return NextResponse.json({ success: true, message: "Payment finalized", alreadyDone: true });
        }
      } catch { /* expected */ }
    }

    return NextResponse.json({ error: message.substring(0, 500) }, { status: 500 });
  }
}
