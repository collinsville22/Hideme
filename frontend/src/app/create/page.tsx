"use client";

import { CreateTokenForm } from "@/components/CreateTokenForm";
import Link from "next/link";

export default function CreatePage() {
  return (
    <div className="max-w-lg mx-auto px-8 py-16">
      <Link
        href="/"
        className="text-[10px] font-mono text-text-ghost tracking-[0.2em] uppercase hover:text-text-tertiary transition-colors cursor-pointer"
      >
        &larr; Registry
      </Link>

      <div className="mt-8 mb-10">
        <p className="text-[10px] font-mono text-text-ghost tracking-[0.3em] uppercase mb-2">
          Deploy Contract
        </p>
        <h1 className="text-[32px] font-editorial italic text-text-primary leading-[1.05]">
          Issue a confidential token
        </h1>
        <p className="mt-3 text-[12px] font-mono text-text-tertiary leading-relaxed">
          Deploys a new ERC-20 with FHE-encrypted balances via the HideMe factory contract.
        </p>
      </div>

      <div className="border border-border p-6">
        <CreateTokenForm />
      </div>
    </div>
  );
}
