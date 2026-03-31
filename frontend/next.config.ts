import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@zama-fhe/relayer-sdk", "tfhe", "tkms"],
  turbopack: {},
};

export default nextConfig;
