"use client";

import Link from "next/link";
import { shortenAddress, formatTokenAmount, getExplorerUrl } from "@/lib/constants";

interface TokenCardProps {
  address: string;
  name: string;
  symbol: string;
  initialSupply: bigint;
  creator: string;
  createdAt: bigint;
  mintable?: boolean;
  burnable?: boolean;
  maxSupply?: bigint;
  description?: string;
  logoUri?: string;
}

export function TokenCard({
  address,
  name,
  symbol,
  initialSupply,
  creator,
  createdAt,
  mintable,
  burnable,
  description,
  logoUri,
}: TokenCardProps) {
  const date = new Date(Number(createdAt) * 1000);
  const timeAgo = getTimeAgo(date);

  return (
    <Link href={`/token/${address}`} className="block group cursor-pointer">
      <div className="border border-border hover:border-border-hover transition-colors">
        <div className="flex items-center">
          <div className="w-16 h-16 sm:w-24 sm:h-24 flex-shrink-0 border-r border-border flex items-center justify-center bg-gold-glow group-hover:bg-gold-muted transition-colors overflow-hidden">
            {logoUri ? (
              <img src={logoUri} alt={symbol} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden'); }} />
            ) : null}
            <span className={`text-[14px] sm:text-[22px] font-editorial italic text-gold ${logoUri ? 'hidden' : ''}`}>
              {symbol}
            </span>
          </div>

          <div className="flex-1 px-3 sm:px-5 py-3 sm:py-4 min-w-0">
            <div className="flex items-start justify-between gap-2 sm:gap-4">
              <div className="min-w-0">
                <h3 className="text-[13px] sm:text-[15px] font-editorial italic text-text-primary truncate group-hover:text-gold transition-colors">
                  {name}
                </h3>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-[9px] sm:text-[10px] font-mono text-text-ghost tracking-[0.15em] uppercase">
                    {shortenAddress(address)}
                  </p>
                  <span
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(getExplorerUrl(address), '_blank'); }}
                    className="text-[8px] sm:text-[9px] font-mono text-text-ghost hover:text-gold transition-colors tracking-wide uppercase cursor-pointer hidden sm:inline"
                  >
                    etherscan &rarr;
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1.5 sm:hidden text-[10px] font-mono text-text-ghost">
                  <span>{formatTokenAmount(initialSupply)} supply</span>
                  <span>&middot;</span>
                  <span>{timeAgo}</span>
                </div>
              </div>

              <div className="flex-shrink-0 flex items-center gap-1.5">
                {mintable === false && (
                  <div className="border border-green-500/30 px-1.5 py-0.5 hidden sm:block">
                    <span className="text-[7px] font-mono text-green-400 tracking-[0.15em] uppercase">Fixed</span>
                  </div>
                )}
                {burnable && (
                  <div className="border border-gold/30 px-1.5 py-0.5 hidden sm:block">
                    <span className="text-[7px] font-mono text-gold tracking-[0.15em] uppercase">Burn</span>
                  </div>
                )}
                <div className="border border-border px-1.5 sm:px-2 py-0.5">
                  <span className="text-[7px] sm:text-[8px] font-mono text-text-ghost tracking-[0.2em] uppercase">
                    FHE-128
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-0 flex-shrink-0">
            <DataCol label="Supply" value={formatTokenAmount(initialSupply)} />
            <DataCol label="Issuer" value={shortenAddress(creator)} />
            <DataCol label="Issued" value={timeAgo} />
          </div>

          <div className="w-8 sm:w-12 flex-shrink-0 flex items-center justify-center text-text-ghost group-hover:text-gold transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </div>
        </div>
      </div>
    </Link>
  );
}

function DataCol({ label, value }: { label: string; value: string }) {
  return (
    <div className="w-28 px-4 py-4 border-l border-border">
      <p className="text-[8px] font-mono text-text-ghost tracking-[0.2em] uppercase mb-0.5">
        {label}
      </p>
      <p className="text-[12px] font-mono text-text-secondary truncate">{value}</p>
    </div>
  );
}

function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `${diffD}d`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
