export const FACTORY_ADDRESS_SEPOLIA = process.env.NEXT_PUBLIC_FACTORY_ADDRESS || "0x0000000000000000000000000000000000000000";
export const FACTORY_ADDRESS_MAINNET = process.env.NEXT_PUBLIC_FACTORY_ADDRESS_MAINNET || "0x0000000000000000000000000000000000000000";

export const ACTIVE_NETWORK = (process.env.NEXT_PUBLIC_NETWORK || "sepolia") as "mainnet" | "sepolia";
export const IS_MAINNET = ACTIVE_NETWORK === "mainnet";

export const FACTORY_ADDRESS = IS_MAINNET ? FACTORY_ADDRESS_MAINNET : FACTORY_ADDRESS_SEPOLIA;

export const PAYMENTS_ADDRESS = "0xA12c43CFCe337f0f8b831551Fbd273A61b0488d5";

export const WRAPPER_FACTORY_ADDRESS = "0xde8d3122329916968BA9c5E034Bbade431687408";

export const ROUTER_V2_ADDRESS = "0x087D50Bb21a4C7A5E9394E9739809cB3AA6576Fa";

export const SEPOLIA_CHAIN_ID = 11155111;
export const MAINNET_CHAIN_ID = 1;

export const ZAMA_CONFIG_SEPOLIA = {
  aclContractAddress: "0xf0Ffdc93b7E186bC2f8CB3dAA75D86d1930A433D",
  kmsContractAddress: "0xbE0E383937d564D7FF0BC3b46c51f0bF8d5C311A",
  inputVerifierContractAddress: "0xBBC1fFCdc7C316aAAd72E807D9b0272BE8F84DA0",
  verifyingContractAddressDecryption: "0x5D8BD78e2ea6bbE41f26dFe9fdaEAa349e077478",
  verifyingContractAddressInputVerification: "0x483b9dE06E4E4C7D35CCf5837A1668487406D955",
  chainId: SEPOLIA_CHAIN_ID,
  gatewayChainId: 10901,
  network: "https://eth-sepolia.public.blastapi.io",
  relayerUrl: "https://relayer.testnet.zama.org",
};

export const ZAMA_CONFIG_MAINNET = {
  aclContractAddress: "0xcA2E8f1F656CD25C01F05d0b243Ab1ecd4a8ffb6",
  kmsContractAddress: "0x77627828a55156b04Ac0DC0eb30467f1a552BB03",
  inputVerifierContractAddress: "0xCe0FC2e05CFff1B719EFF7169f7D80Af770c8EA2",
  registryContractAddress: "0xeb5015fF021DB115aCe010f23F55C2591059bBA0",
  gatewayInputVerificationAddress: "0xcB1bB072f38bdAF0F328CdEf1Fc6eDa1DF029287",
  gatewayDecryptionAddress: "0x0f6024a97684f7d90ddb0fAAD79cB15F2C888D24",
  chainId: MAINNET_CHAIN_ID,
  gatewayChainId: 261131,
  network: "https://ethereum-rpc.publicnode.com",
  relayerUrl: "https://relayer.mainnet.zama.org",
};

export const ZAMA_CONFIG = IS_MAINNET ? ZAMA_CONFIG_MAINNET : ZAMA_CONFIG_SEPOLIA;

export const TOKEN_DECIMALS = 6;

export function formatTokenAmount(amount: bigint): string {
  const whole = amount / BigInt(10 ** TOKEN_DECIMALS);
  const frac = amount % BigInt(10 ** TOKEN_DECIMALS);
  if (frac === 0n) return whole.toLocaleString();
  return `${whole.toLocaleString()}.${frac.toString().padStart(TOKEN_DECIMALS, "0").replace(/0+$/, "")}`;
}

export function parseTokenAmount(amount: string): bigint {
  const [whole, frac = ""] = amount.split(".");
  const paddedFrac = frac.padEnd(TOKEN_DECIMALS, "0").slice(0, TOKEN_DECIMALS);
  return BigInt(whole || "0") * BigInt(10 ** TOKEN_DECIMALS) + BigInt(paddedFrac);
}

export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function getExplorerUrl(address: string): string {
  return IS_MAINNET
    ? `https://etherscan.io/address/${address}`
    : `https://sepolia.etherscan.io/address/${address}`;
}

export function getExplorerTxUrl(hash: string): string {
  return IS_MAINNET
    ? `https://etherscan.io/tx/${hash}`
    : `https://sepolia.etherscan.io/tx/${hash}`;
}
