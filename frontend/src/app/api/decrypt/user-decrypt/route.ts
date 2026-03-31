import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";

const GATEWAY_RPC = "https://rpc-zama-gateway-mainnet.t.conduit.xyz";

const DECRYPTION_CONTRACT = "0x0f6024a97684f7d90ddb0fAAD79cB15F2C888D24";
const PROTOCOL_PAYMENT = "0x7E179E45E5fe0a21015Be25185363B4F2F2F7e89";
const ZAMA_TOKEN_GATEWAY = "0xcE762c7FDaac795D31a266B9247F8958c159c6d4";

const DECRYPTION_ABI = [
  `function userDecryptionRequest(
    tuple(bytes32 ctHandle, address contractAddress)[] ctHandleContractPairs,
    tuple(uint256 startTimestamp, uint256 durationDays) requestValidity,
    tuple(uint256 chainId, address[] addresses) contractsInfo,
    address userAddress,
    bytes publicKey,
    bytes signature,
    bytes extraData
  ) external`,

  `function isUserDecryptionReady(
    address userAddress,
    tuple(bytes32 ctHandle, address contractAddress)[] ctHandleContractPairs,
    bytes extraData
  ) external view returns (bool)`,

  `event UserDecryptionRequest(
    uint256 indexed decryptionId,
    tuple(bytes32 ctHandle, uint256 keyId, bytes32 snsCiphertextDigest, address[] coprocessorTxSenderAddresses)[] snsCtMaterials,
    address userAddress,
    bytes publicKey,
    bytes extraData
  )`,

  `event UserDecryptionResponse(
    uint256 indexed decryptionId,
    uint256 indexShare,
    bytes userDecryptedShare,
    bytes signature,
    bytes extraData
  )`,

  `event UserDecryptionResponseThresholdReached(
    uint256 indexed decryptionId
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
  if (!key) {
    throw new Error("GATEWAY_RELAYER_PRIVATE_KEY env var is not set");
  }
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
  const currentAllowance: bigint = await zamaToken.allowance(
    signer.address,
    PROTOCOL_PAYMENT,
  );

  const threshold = ethers.parseUnits("1", 18);
  if (currentAllowance < threshold) {
    const tx = await zamaToken.approve(
      PROTOCOL_PAYMENT,
      ethers.parseUnits("1000", 18),
    );
    await tx.wait();
  }
  approvalChecked = true;
}

async function waitForDecryptionResponse(
  decryptionContract: ethers.Contract,
  decryptionId: bigint,
  timeoutMs: number = 180_000,
  pollIntervalMs: number = 3_000,
): Promise<Array<{ payload: string; signature: string }>> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const thresholdFilter =
      decryptionContract.filters.UserDecryptionResponseThresholdReached(
        decryptionId,
      );
    const thresholdEvents = await decryptionContract.queryFilter(
      thresholdFilter,
      -1000,
    );

    if (thresholdEvents.length > 0) {
      const responseFilter =
        decryptionContract.filters.UserDecryptionResponse(decryptionId);
      const responseEvents = await decryptionContract.queryFilter(
        responseFilter,
        -1000,
      );

      const sortedEvents = [...responseEvents].sort((a, b) => {
        const aLog = a as ethers.EventLog;
        const bLog = b as ethers.EventLog;
        return Number(aLog.args.indexShare) - Number(bLog.args.indexShare);
      });

      const shares = sortedEvents.map((event) => {
        const log = event as ethers.EventLog;
        const userDecryptedShare = log.args.userDecryptedShare as string;
        const sig = log.args.signature as string;
        return {
          payload: userDecryptedShare.replace(/^0x/, ""),
          signature: sig.replace(/^0x/, ""),
        };
      });

      return shares;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `Decryption response timed out after ${timeoutMs}ms for id=${decryptionId}`,
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();

    const {
      handleContractPairs,
      requestValidity,
      contractsChainId,
      contractAddresses,
      userAddress,
      signature,
      publicKey,
      extraData = "0x00",
    } = body;

    if (
      !handleContractPairs ||
      !Array.isArray(handleContractPairs) ||
      handleContractPairs.length === 0
    ) {
      return NextResponse.json(
        { error: "Missing or invalid handleContractPairs" },
        { status: 400 },
      );
    }
    if (!userAddress || !signature || !publicKey) {
      return NextResponse.json(
        { error: "Missing userAddress, signature, or publicKey" },
        { status: 400 },
      );
    }
    if (!requestValidity?.startTimestamp || !requestValidity?.durationDays) {
      return NextResponse.json(
        { error: "Missing requestValidity" },
        { status: 400 },
      );
    }

    const signer = getRelayerSigner();
    await ensureZamaApproval(signer);

    const decryptionContract = new ethers.Contract(
      DECRYPTION_CONTRACT,
      DECRYPTION_ABI,
      signer,
    );

    const ctHandlePairs = handleContractPairs.map(
      (pair: { handle: string; contractAddress: string }) => ({
        ctHandle: pair.handle.startsWith("0x")
          ? pair.handle
          : `0x${pair.handle}`,
        contractAddress: ethers.getAddress(pair.contractAddress),
      }),
    );

    const requestValidityStruct = {
      startTimestamp: BigInt(requestValidity.startTimestamp),
      durationDays: BigInt(requestValidity.durationDays),
    };

    const checksummedAddresses = (contractAddresses || []).map(
      (a: string) => ethers.getAddress(a),
    );
    const contractsInfo = {
      chainId: BigInt(contractsChainId || "1"),
      addresses: checksummedAddresses,
    };

    const checksummedUserAddress = ethers.getAddress(userAddress);

    const pubKeyBytes = publicKey.startsWith("0x")
      ? publicKey
      : `0x${publicKey}`;
    const sigBytes = signature.startsWith("0x")
      ? signature
      : `0x${signature}`;
    const extraDataBytes = extraData.startsWith("0x")
      ? extraData
      : `0x${extraData}`;

    const tx = await decryptionContract.userDecryptionRequest(
      ctHandlePairs,
      requestValidityStruct,
      contractsInfo,
      checksummedUserAddress,
      pubKeyBytes,
      sigBytes,
      extraDataBytes,
    );
    const receipt = await tx.wait();

    let decryptionId: bigint | null = null;

    for (const log of receipt!.logs) {
      try {
        const parsed = decryptionContract.interface.parseLog({
          topics: [...log.topics],
          data: log.data,
        });
        if (parsed && parsed.name === "UserDecryptionRequest") {
          decryptionId = parsed.args.decryptionId;
          break;
        }
      } catch { /* expected */ }
    }

    if (decryptionId === null) {
      return NextResponse.json(
        { error: "Could not extract decryptionId from tx receipt" },
        { status: 500 },
      );
    }

    const shares = await waitForDecryptionResponse(
      decryptionContract,
      decryptionId,
      180_000,
      3_000,
    );

    return NextResponse.json({ response: shares });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message.substring(0, 500) },
      { status: 500 },
    );
  }
}
