import { IS_MAINNET, ZAMA_CONFIG } from "./constants";

type FhevmInstance = Record<string, unknown>;

let instance: FhevmInstance | null = null;
let sdkLoaded = false;
let sdkLoading: Promise<void> | null = null;

const ZAMA_API_KEY = typeof window !== "undefined"
  ? (process.env.NEXT_PUBLIC_ZAMA_API_KEY || "")
  : "";

const USE_MINI_RELAYER =
  process.env.NEXT_PUBLIC_USE_MINI_RELAYER === "true";

function loadSdkScript(): Promise<void> {
  if (sdkLoaded) return Promise.resolve();
  if (sdkLoading) return sdkLoading;

  sdkLoading = new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Cannot load SDK on server"));
      return;
    }

    const w = window as Window & { RelayerSdk?: unknown; "@zama-fhe/relayer-sdk"?: unknown };
    if (w.RelayerSdk || w["@zama-fhe/relayer-sdk"]) {
      sdkLoaded = true;
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = "/sdk/relayer-sdk.js";
    script.onload = () => {
      sdkLoaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error("Failed to load relayer-sdk.js"));
    document.head.appendChild(script);
  });

  return sdkLoading;
}

function getSdk(): Record<string, unknown> | undefined {
  const w = window as Window & { relayerSDK?: Record<string, unknown> };
  return w.relayerSDK;
}

let sdkInitialized = false;

export async function getFhevmInstance(): Promise<FhevmInstance> {
  if (instance) return instance;

  await loadSdkScript();
  const sdk = getSdk();

  if (!sdk) {
    throw new Error("relayerSDK global not found after loading script");
  }
  if (!sdk.createInstance) {
    throw new Error("relayerSDK loaded but createInstance not found. Keys: " + Object.keys(sdk).slice(0, 10).join(", "));
  }

  if (!sdkInitialized && typeof sdk.initSDK === "function") {
    await (sdk.initSDK as (opts: { tfheParams: string; kmsParams: string }) => Promise<void>)({
      tfheParams: "/sdk/tfhe_bg.wasm",
      kmsParams: "/sdk/kms_lib_bg.wasm",
    });
    sdkInitialized = true;
  }

  return initInstance(sdk);
}

async function initInstance(sdk: Record<string, unknown>): Promise<FhevmInstance> {
  const baseConfig = IS_MAINNET ? sdk.MainnetConfig : sdk.SepoliaConfig;

  const auth = IS_MAINNET && ZAMA_API_KEY && !USE_MINI_RELAYER
    ? { __type: "ApiKeyHeader" as const, value: ZAMA_API_KEY }
    : undefined;

  const relayerBaseUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/decrypt`
    : "/api/decrypt";

  const relayerOverrides = USE_MINI_RELAYER
    ? { relayerUrl: relayerBaseUrl, relayerRouteVersion: 1 as const }
    : {};

  const createInstance = sdk.createInstance as (opts: Record<string, unknown>) => Promise<FhevmInstance>;
  instance = await createInstance({
    ...(baseConfig as Record<string, unknown>),
    network: ZAMA_CONFIG.network,
    ...(auth ? { auth } : {}),
    ...relayerOverrides,
  });

  return instance;
}

export async function encryptAmount(
  contractAddress: string,
  userAddress: string,
  amount: bigint,
): Promise<{ handle: `0x${string}`; inputProof: `0x${string}` }> {
  const fhevm = await getFhevmInstance() as Record<string, (...args: unknown[]) => unknown>;
  const input = fhevm.createEncryptedInput(contractAddress, userAddress) as Record<string, (...args: unknown[]) => unknown>;
  input.add64(amount);
  const encrypted = await input.encrypt() as { handles: unknown[]; inputProof: unknown };

  const toHex = (v: unknown): `0x${string}` => {
    if (typeof v === "string") return v.startsWith("0x") ? v as `0x${string}` : `0x${v}` as `0x${string}`;
    if (v instanceof Uint8Array) {
      return `0x${Array.from(v).map(b => b.toString(16).padStart(2, "0")).join("")}` as `0x${string}`;
    }
    return `0x${String(v)}` as `0x${string}`;
  };

  return {
    handle: toHex(encrypted.handles[0]),
    inputProof: toHex(encrypted.inputProof),
  };
}

export async function decryptUserBalance(
  contractAddress: string,
  ciphertextHandle: string,
  walletClient: {
    signTypedData: (args: {
      domain: Record<string, unknown>;
      types: Record<string, Array<{ name: string; type: string }>>;
      primaryType: string;
      message: Record<string, unknown>;
    }) => Promise<string>;
    account: { address: string };
  },
): Promise<bigint> {
  const fhevm = await getFhevmInstance() as Record<string, (...args: unknown[]) => unknown>;
  const keypair = fhevm.generateKeypair() as { publicKey: unknown; privateKey: unknown };

  const startTimeStamp = Math.floor(Date.now() / 1000);
  const durationDays = 10;
  const contractAddresses = [contractAddress];

  const eip712 = fhevm.createEIP712(
    keypair.publicKey,
    contractAddresses,
    startTimeStamp,
    durationDays,
  ) as { domain: Record<string, unknown>; types: Record<string, unknown>; message: Record<string, unknown> };

  const signature = await walletClient.signTypedData({
    domain: eip712.domain,
    types: {
      UserDecryptRequestVerification:
        eip712.types.UserDecryptRequestVerification as unknown as Array<{ name: string; type: string }>,
    },
    primaryType: "UserDecryptRequestVerification",
    message: eip712.message,
  });

  const result = await fhevm.userDecrypt(
    [{ handle: ciphertextHandle, contractAddress }],
    keypair.privateKey,
    keypair.publicKey,
    signature.replace("0x", ""),
    contractAddresses,
    walletClient.account.address,
    startTimeStamp,
    durationDays,
  ) as Record<string, unknown>;

  const value = result[ciphertextHandle];
  return BigInt(value as string | number | bigint);
}

export async function decryptMultipleBalances(
  pairs: Array<{ contractAddress: string; handle: string }>,
  walletClient: {
    signTypedData: (args: {
      domain: Record<string, unknown>;
      types: Record<string, Array<{ name: string; type: string }>>;
      primaryType: string;
      message: Record<string, unknown>;
    }) => Promise<string>;
    account: { address: string };
  },
): Promise<Map<string, bigint>> {
  if (pairs.length === 0) return new Map();

  const fhevm = await getFhevmInstance() as Record<string, (...args: unknown[]) => unknown>;
  const keypair = fhevm.generateKeypair() as { publicKey: unknown; privateKey: unknown };

  const startTimeStamp = Math.floor(Date.now() / 1000);
  const durationDays = 10;
  const contractAddresses = [...new Set(pairs.map(p => p.contractAddress))];

  const eip712 = fhevm.createEIP712(
    keypair.publicKey,
    contractAddresses,
    startTimeStamp,
    durationDays,
  ) as { domain: Record<string, unknown>; types: Record<string, unknown>; message: Record<string, unknown> };

  const signature = await walletClient.signTypedData({
    domain: eip712.domain,
    types: {
      UserDecryptRequestVerification:
        eip712.types.UserDecryptRequestVerification as unknown as Array<{ name: string; type: string }>,
    },
    primaryType: "UserDecryptRequestVerification",
    message: eip712.message,
  });

  const handleContractPairs = pairs.map(p => ({
    handle: p.handle,
    contractAddress: p.contractAddress,
  }));

  const result = await fhevm.userDecrypt(
    handleContractPairs,
    keypair.privateKey,
    keypair.publicKey,
    signature.replace("0x", ""),
    contractAddresses,
    walletClient.account.address,
    startTimeStamp,
    durationDays,
  ) as Record<string, unknown>;

  const decrypted = new Map<string, bigint>();
  for (const pair of pairs) {
    const value = result[pair.handle];
    if (value !== undefined) {
      decrypted.set(pair.handle, BigInt(value as string | number | bigint));
    }
  }
  return decrypted;
}
