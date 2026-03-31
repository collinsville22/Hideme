import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { mainnet, sepolia, hardhat } from "wagmi/chains";
import { http, fallback } from "wagmi";
import { IS_MAINNET } from "./constants";

export const config = getDefaultConfig({
  appName: "HideMe",
  projectId: process.env.NEXT_PUBLIC_WALLET_CONNECT_ID || "21fef48091f12692cad574a6f7753643",
  chains: IS_MAINNET ? [mainnet] : [sepolia, hardhat],
  transports: IS_MAINNET
    ? {
        [mainnet.id]: fallback([
          http("https://ethereum-rpc.publicnode.com"),
          http("https://eth.drpc.org"),
          http("https://rpc.mevblocker.io"),
        ]),
      }
    : { [sepolia.id]: http(), [hardhat.id]: http() },
  ssr: true,
});
