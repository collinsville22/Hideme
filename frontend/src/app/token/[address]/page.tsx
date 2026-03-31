"use client";

import { use } from "react";
import { TokenDetail } from "@/components/TokenDetail";

export default function TokenPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);

  return (
    <div className="max-w-3xl mx-auto">
      <TokenDetail address={address} />
    </div>
  );
}
