import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";

const GATEWAY_RPC = "https://rpc-zama-gateway-mainnet.t.conduit.xyz";
const DECRYPTION_CONTRACT = "0x0f6024a97684f7d90ddb0fAAD79cB15F2C888D24";
const PROTOCOL_PAYMENT = "0x7E179E45E5fe0a21015Be25185363B4F2F2F7e89";
const ZAMA_TOKEN_GATEWAY = "0xcE762c7FDaac795D31a266B9247F8958c159c6d4";

const DECRYPTION_ABI = [
  `function publicDecryptionRequest(
    bytes32[] ctHandles,
    bytes extraData
  ) external`,

  `event PublicDecryptionRequest(
    uint256 indexed decryptionId,
    tuple(bytes32 ctHandle, uint256 keyId, bytes32 snsCiphertextDigest, address[] coprocessorTxSenderAddresses)[] snsCtMaterials,
    bytes extraData
  )`,

  `event PublicDecryptionResponse(
    uint256 indexed decryptionId,
    bytes decryptedResult,
    bytes[] signatures,
    bytes extraData
  )`,
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

let cachedSigner: ethers.Wallet | null = null;

function getRelayerSigner(): ethers.Wallet {
  if (cachedSigner) return cachedSigner;
  const key = process.env.GATEWAY_RELAYER_PRIVATE_KEY;
  if (!key) throw new Error("GATEWAY_RELAYER_PRIVATE_KEY not set");
  const provider = new ethers.JsonRpcProvider(GATEWAY_RPC, undefined, {
    staticNetwork: true,
    pollingInterval: 3000,
    batchMaxCount: 1,
  });
  provider._getConnection().timeout = 60000;
  cachedSigner = new ethers.Wallet(key, provider);
  return cachedSigner;
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
    const { handles, extraData = "0x00" } = body;

    if (!handles || !Array.isArray(handles) || handles.length === 0) {
      return NextResponse.json({ error: "Missing handles array" }, { status: 400 });
    }

    const signer = getRelayerSigner();
    await ensureZamaApproval(signer);

    const decryptionContract = new ethers.Contract(DECRYPTION_CONTRACT, DECRYPTION_ABI, signer);

    const ctHandles = handles.map((h: string) => h.startsWith("0x") ? h : `0x${h}`);
    const extraDataBytes = extraData.startsWith("0x") ? extraData : `0x${extraData}`;

    const tx = await decryptionContract.publicDecryptionRequest(ctHandles, extraDataBytes);
    const receipt = await tx.wait();

    let decryptionId: bigint | null = null;
    for (const log of receipt!.logs) {
      try {
        const parsed = decryptionContract.interface.parseLog({
          topics: [...log.topics],
          data: log.data,
        });
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
    const pollMs = 3_000;

    while (Date.now() - startTime < timeoutMs) {
      const filter = decryptionContract.filters.PublicDecryptionResponse(decryptionId);
      const events = await decryptionContract.queryFilter(filter, -1000);

      if (events.length > 0) {
        const event = events[0] as ethers.EventLog;

        const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
          ["bytes", "bytes[]", "bytes"],
          event.data,
        );

        const decryptedResult = `${decoded[0]}`;
        const signatures = Array.from(decoded[1] as string[]).map((s) => `${s}`);
        const extraData = `${decoded[2]}`;

        return NextResponse.json({
          decryptedResult,
          signatures,
          extraData,
          handles: ctHandles,
          decryptionId: decryptionId.toString(),
        });
      }

      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    return NextResponse.json({ error: "Public decryption timed out" }, { status: 500 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message.substring(0, 500) }, { status: 500 });
  }
}
