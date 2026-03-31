"use client";

import { useState } from "react";
import { useReadContract } from "wagmi";
import { FACTORY_ADDRESS } from "@/lib/constants";
import factoryAbi from "@/lib/abi/HideMeFactory.json";
import { TokenCard } from "@/components/TokenCard";
import { CreateTokenForm } from "@/components/CreateTokenForm";

export default function HomePage() {
  const [showCreate, setShowCreate] = useState(false);
  const { data: totalTokens } = useReadContract({
    address: FACTORY_ADDRESS as `0x${string}`,
    abi: factoryAbi,
    functionName: "totalTokens",
  });

  const { data: tokens, isLoading } = useReadContract({
    address: FACTORY_ADDRESS as `0x${string}`,
    abi: factoryAbi,
    functionName: "getTokensPaginated",
    args: [0n, 50n],
  });

  const tokenList =
    (tokens as Array<{
      tokenAddress: string;
      name: string;
      symbol: string;
      initialSupply: bigint;
      creator: string;
      createdAt: bigint;
      mintable: boolean;
      burnable: boolean;
      maxSupply: bigint;
      description: string;
      logoUri: string;
      website: string;
    }>) || [];

  const count = totalTokens != null ? Number(totalTokens) : 0;

  return (
    <div className="max-w-7xl mx-auto px-8">
      <section className="pt-24 pb-32 relative">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-16 items-start">
          <div className="lg:col-span-7">
            <p className="text-[10px] font-mono text-text-ghost tracking-[0.3em] uppercase mb-6 animate-fade-up">
              Confidential Token Infrastructure
            </p>

            <h1 className="animate-fade-up delay-1">
              <span className="block text-[48px] sm:text-[64px] lg:text-[72px] font-editorial italic text-text-primary leading-[0.95] tracking-tight">
                What&apos;s yours
              </span>
              <span className="block text-[48px] sm:text-[64px] lg:text-[72px] font-editorial italic text-gold leading-[0.95] tracking-tight">
                stays yours.
              </span>
            </h1>

            <div className="mt-10 max-w-md animate-fade-up delay-2">
              <p className="text-[13px] text-text-secondary font-mono leading-relaxed">
                Issue ERC-20 tokens where balances and transfer amounts
                are encrypted end-to-end using fully homomorphic encryption.
                Only holders can view their own data.
              </p>
            </div>

            <div className="mt-10 flex items-center gap-5 animate-fade-up delay-3">
              <button
                onClick={() => setShowCreate(true)}
                className="group inline-flex items-center gap-3 cursor-pointer"
              >
                <span className="inline-flex items-center justify-center w-10 h-10 border border-gold/40 group-hover:border-gold group-hover:bg-gold-muted transition-all">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gold">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </span>
                <span className="text-[12px] font-mono text-text-primary tracking-wide uppercase group-hover:text-gold transition-colors">
                  Issue Token
                </span>
              </button>

              <a
                href="https://docs.zama.org/protocol"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] font-mono text-text-ghost tracking-wide uppercase hover:text-text-tertiary transition-colors cursor-pointer"
              >
                Documentation &rarr;
              </a>
            </div>
          </div>

          <div className="lg:col-span-5 hidden lg:block animate-fade-up delay-4">
            <div className="border border-border p-6 relative">
              <div className="absolute top-4 right-4 border border-gold/30 px-2 py-0.5">
                <span className="text-[9px] font-mono text-gold tracking-[0.2em] uppercase">
                  Classified
                </span>
              </div>

              <p className="text-[9px] font-mono text-text-ghost tracking-[0.2em] uppercase mb-5">
                BALANCE RECORD / FHE-128
              </p>

              <div className="space-y-4">
                <DataField label="HOLDER" value="0x37B8...0494" />
                <DataField label="TOKEN" value="HideMe Test Token" />
                <DataField label="BALANCE" redacted />
                <DataField label="ALLOWANCE" redacted />
                <DataField label="TX_AMOUNT" redacted />

                <hr className="rule-gold" />

                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-mono text-text-ghost tracking-[0.2em] uppercase">
                    CLEARANCE
                  </span>
                  <span className="text-[10px] font-mono text-gold">
                    HOLDER ONLY
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mb-20 animate-fade-up delay-5">
        <div className="border-t border-b border-border py-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8">
            <StatBlock label="Encrypted" value="Balances" sub="TFHE ciphertext" accent />
            <StatBlock label="Encrypted" value="Amounts" sub="Transfer values" accent />
            <StatBlock label="Visible" value="Addresses" sub="Sender + receiver" />
            <StatBlock label="Visible" value="Supply" sub="Total on-chain" />
          </div>
        </div>
      </section>

      <section className="pb-24">
        <div className="flex items-end justify-between mb-8">
          <div>
            <p className="text-[10px] font-mono text-text-ghost tracking-[0.3em] uppercase mb-1">
              Token Registry
            </p>
            <h2 className="text-[28px] font-editorial italic text-text-primary leading-none">
              Issued tokens
              {count > 0 && (
                <span className="text-[14px] text-text-ghost font-mono not-italic ml-3">
                  ({count})
                </span>
              )}
            </h2>
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="text-[11px] font-mono text-text-ghost tracking-wide uppercase hover:text-gold transition-colors cursor-pointer hidden sm:block"
          >
            {showCreate ? "Close" : "+ New"}
          </button>
        </div>

        {showCreate && (
          <div className="mb-10 border border-gold/20 p-6 animate-slide-down">
            <div className="flex items-center justify-between mb-6">
              <p className="text-[10px] font-mono text-gold tracking-[0.3em] uppercase">
                Issue New Token
              </p>
              <button
                onClick={() => setShowCreate(false)}
                className="text-[10px] font-mono text-text-ghost hover:text-text-tertiary transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
            <CreateTokenForm />
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="border border-border p-5 animate-pulse">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-surface-2" />
                  <div className="flex-1 space-y-2">
                    <div className="w-40 h-4 bg-surface-2" />
                    <div className="w-24 h-3 bg-surface-2" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : tokenList.length > 0 ? (
          <div className="space-y-2">
            {tokenList.map((t, i) => (
              <div
                key={i}
                className="animate-fade-up"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <TokenCard
                  address={t.tokenAddress}
                  name={t.name}
                  symbol={t.symbol}
                  initialSupply={t.initialSupply}
                  creator={t.creator}
                  createdAt={t.createdAt}
                  mintable={t.mintable}
                  burnable={t.burnable}
                  maxSupply={t.maxSupply}
                  description={t.description}
                  logoUri={t.logoUri}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="border border-dashed border-border py-24 flex flex-col items-center">
            <p className="text-[13px] font-editorial italic text-text-tertiary mb-4">
              No tokens have been issued yet.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="text-[11px] font-mono text-gold tracking-wide uppercase hover:text-gold-dim transition-colors cursor-pointer"
            >
              Be the first &rarr;
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function DataField({
  label,
  value,
  redacted,
}: {
  label: string;
  value?: string;
  redacted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[10px] font-mono text-text-ghost tracking-[0.15em] uppercase">
        {label}
      </span>
      {redacted ? (
        <div className="flex items-center gap-1.5">
          <div className="redacted-bar w-24" />
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-ghost">
            <rect x="3" y="11" width="18" height="11" rx="1" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
      ) : (
        <span className="text-[11px] font-mono text-text-secondary">{value}</span>
      )}
    </div>
  );
}

function StatBlock({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div>
      <p className="text-[9px] font-mono text-text-ghost tracking-[0.2em] uppercase mb-1">
        {label}
      </p>
      <p className={`text-[16px] font-editorial italic ${accent ? "text-gold" : "text-text-tertiary"}`}>
        {value}
      </p>
      <p className="text-[10px] font-mono text-text-ghost mt-0.5">{sub}</p>
    </div>
  );
}
