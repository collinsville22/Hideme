import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";

const GATEWAY_RPC = "https://rpc-zama-gateway-mainnet.t.conduit.xyz";
const INPUT_VERIFICATION_CONTRACT = "0xcB1bB072f38bdAF0F328CdEf1Fc6eDa1DF029287";
const PROTOCOL_PAYMENT = "0x7E179E45E5fe0a21015Be25185363B4F2F2F7e89";
const ZAMA_TOKEN_GATEWAY = "0xcE762c7FDaac795D31a266B9247F8958c159c6d4";

const INPUT_VERIFICATION_ABI = [
  `function verifyProofRequest(
    uint256 contractChainId,
    address contractAddress,
    address userAddress,
    bytes ciphertextWithZKProof,
    bytes extraData
  ) external`,

  `function isProofVerified(uint256 zkProofId) external view returns (bool)`,

  `event VerifyProofRequest(
    uint256 indexed zkProofId,
    uint256 indexed contractChainId,
    address contractAddress,
    address userAddress,
    bytes ciphertextWithZKProof,
    bytes extraData
  )`,

  `event VerifyProofResponse(
    uint256 indexed zkProofId,
    bytes32[] ctHandles,
    bytes[] signatures
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
  const threshold = ethers.parseUnits("2", 18);
  if (currentAllowance < threshold) {
    const tx = await zamaToken.approve(PROTOCOL_PAYMENT, ethers.parseUnits("1000", 18));
    await tx.wait();
  }
  approvalChecked = true;
}

async function waitForProofResponse(
  contract: ethers.Contract,
  zkProofId: bigint,
  timeoutMs: number = 180_000,
  pollIntervalMs: number = 3_000,
): Promise<{ handles: string[]; signatures: string[] }> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const filter = contract.filters.VerifyProofResponse(zkProofId);
    const events = await contract.queryFilter(filter, -1000);

    if (events.length > 0) {
      const event = events[0] as ethers.EventLog;
      const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
        ["bytes32[]", "bytes[]"],
        event.data,
      );
      const rawHandles = decoded[0] as string[];
      const rawSigs = decoded[1] as string[];

      const handles = rawHandles.map((h) => `${h}`);
      const signatures = rawSigs.map((s) => `${s}`);

      return { handles, signatures };
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Proof verification timed out after ${timeoutMs}ms`);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();

    const {
      contractAddress,
      userAddress,
      ciphertextWithInputVerification,
      contractChainId,
      extraData = "00",
    } = body;

    if (!contractAddress || !userAddress || !ciphertextWithInputVerification) {
      return NextResponse.json(
        { error: "Missing contractAddress, userAddress, or ciphertextWithInputVerification" },
        { status: 400 },
      );
    }

    const signer = getRelayerSigner();
    await ensureZamaApproval(signer);

    const ivContract = new ethers.Contract(
      INPUT_VERIFICATION_CONTRACT,
      INPUT_VERIFICATION_ABI,
      signer,
    );

    const ciphertextBytes = ciphertextWithInputVerification.startsWith("0x")
      ? ciphertextWithInputVerification
      : `0x${ciphertextWithInputVerification}`;
    const extraDataBytes = extraData.startsWith("0x")
      ? extraData
      : `0x${extraData}`;

    const tx = await ivContract.verifyProofRequest(
      BigInt(contractChainId || "1"),
      ethers.getAddress(contractAddress),
      ethers.getAddress(userAddress),
      ciphertextBytes,
      extraDataBytes,
    );
    const receipt = await tx.wait();

    let zkProofId: bigint | null = null;
    for (const log of receipt!.logs) {
      try {
        const parsed = ivContract.interface.parseLog({
          topics: [...log.topics],
          data: log.data,
        });
        if (parsed && parsed.name === "VerifyProofRequest") {
          zkProofId = parsed.args.zkProofId;
          break;
        }
      } catch { /* expected */ }
    }

    if (zkProofId === null) {
      return NextResponse.json(
        { error: "Could not extract zkProofId from tx receipt" },
        { status: 500 },
      );
    }

    const result = await waitForProofResponse(ivContract, zkProofId, 180_000, 3_000);

    return NextResponse.json({
      response: {
        handles: result.handles,
        signatures: result.signatures,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message.substring(0, 500) }, { status: 500 });
  }
}
