"use client";

import { useState } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { FACTORY_ADDRESS, getExplorerTxUrl, TOKEN_DECIMALS } from "@/lib/constants";
import factoryAbi from "@/lib/abi/HideMeFactory.json";
import Link from "next/link";

type Template = "fixed" | "mintable" | "custom";

interface TokenConfig {
  name: string;
  symbol: string;
  initialSupply: string;
  description: string;
  logoUri: string;
  website: string;
  observers: string;
  mintable: boolean;
  burnable: boolean;
  maxSupply: string;
}

const TEMPLATES: Record<Template, { label: string; desc: string; defaults: Partial<TokenConfig> }> = {
  fixed: {
    label: "Fixed Supply",
    desc: "No additional minting possible. Maximum investor trust. Burnable.",
    defaults: { mintable: false, burnable: true, maxSupply: "" },
  },
  mintable: {
    label: "Mintable",
    desc: "Owner can mint up to a max cap. Good for governance tokens.",
    defaults: { mintable: true, burnable: true, maxSupply: "" },
  },
  custom: {
    label: "Custom",
    desc: "Full control over all token parameters.",
    defaults: { mintable: false, burnable: false, maxSupply: "" },
  },
};

export function CreateTokenForm() {
  const { isConnected } = useAccount();
  const [step, setStep] = useState(1);
  const [template, setTemplate] = useState<Template>("fixed");
  const [config, setConfig] = useState<TokenConfig>({
    name: "",
    symbol: "",
    initialSupply: "",
    description: "",
    logoUri: "",
    website: "",
    observers: "",
    mintable: false,
    burnable: true,
    maxSupply: "",
  });
  const [error, setError] = useState<string | null>(null);

  const { data: hash, writeContractAsync, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const set = (field: keyof TokenConfig, value: string | boolean) =>
    setConfig((c) => ({ ...c, [field]: value }));

  const selectTemplate = (t: Template) => {
    setTemplate(t);
    const d = TEMPLATES[t].defaults;
    setConfig((c) => ({ ...c, ...d }));
  };

  const handleDeploy = async () => {
    setError(null);
    if (!config.name || !config.symbol || !config.initialSupply) {
      setError("Name, symbol, and initial supply are required.");
      return;
    }

    const observerAddrs = config.observers
      .split(",")
      .map((a) => a.trim())
      .filter((a) => a.length > 0);

    for (const addr of observerAddrs) {
      if (!addr.startsWith("0x") || addr.length !== 42) {
        setError(`Invalid observer address: ${addr}`);
        return;
      }
    }

    const rawSupply = BigInt(
      Math.round(parseFloat(config.initialSupply) * 10 ** TOKEN_DECIMALS),
    );
    const rawMaxSupply = config.maxSupply
      ? BigInt(Math.round(parseFloat(config.maxSupply) * 10 ** TOKEN_DECIMALS))
      : 0n;

    if (rawMaxSupply > 0n && rawSupply > rawMaxSupply) {
      setError("Initial supply cannot exceed max supply.");
      return;
    }

    try {
      await writeContractAsync({
        address: FACTORY_ADDRESS as `0x${string}`,
        abi: factoryAbi,
        functionName: "createToken",
        args: [
          {
            name: config.name,
            symbol: config.symbol.toUpperCase(),
            initialSupply: rawSupply,
            observers: observerAddrs as `0x${string}`[],
            mintable: config.mintable,
            burnable: config.burnable,
            maxSupply: rawMaxSupply,
            description: config.description,
            logoUri: config.logoUri,
            website: config.website,
          },
        ],
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Deployment failed";
      setError(msg.slice(0, 200));
    }
  };

  if (isSuccess && hash) {
    return (
      <div className="border border-gold/30 p-8 text-center space-y-6">
        <div className="w-16 h-16 mx-auto border border-gold/30 flex items-center justify-center">
          <span className="text-gold text-[24px]">&#10003;</span>
        </div>
        <div>
          <p className="text-[10px] font-mono text-text-ghost tracking-[0.3em] uppercase mb-2">
            Token Deployed
          </p>
          <p className="text-[20px] font-editorial italic text-text-primary">
            {config.name} ({config.symbol.toUpperCase()})
          </p>
        </div>

        <div className="flex items-center justify-center gap-2">
          {!config.mintable && (
            <span className="border border-green-500/30 text-green-400 px-2 py-0.5 text-[9px] font-mono tracking-wider uppercase">
              Fixed Supply
            </span>
          )}
          {config.burnable && (
            <span className="border border-gold/30 text-gold px-2 py-0.5 text-[9px] font-mono tracking-wider uppercase">
              Burnable
            </span>
          )}
          <span className="border border-border text-text-ghost px-2 py-0.5 text-[9px] font-mono tracking-wider uppercase">
            FHE-128
          </span>
        </div>

        <a
          href={getExplorerTxUrl(hash)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-[11px] font-mono text-gold hover:text-gold-dim transition-colors tracking-wide uppercase cursor-pointer"
        >
          View on Etherscan &rarr;
        </a>

        <Link
          href="/"
          className="block text-[11px] font-mono text-text-ghost hover:text-text-tertiary transition-colors tracking-wide uppercase cursor-pointer"
        >
          &larr; Back to Registry
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2">
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <button
              onClick={() => s < step && setStep(s)}
              className={`w-7 h-7 flex items-center justify-center text-[10px] font-mono transition-colors cursor-pointer ${
                s === step
                  ? "border border-gold text-gold"
                  : s < step
                    ? "border border-gold/30 text-gold/60"
                    : "border border-border text-text-ghost"
              }`}
            >
              {s}
            </button>
            {s < 4 && (
              <div className={`w-8 h-px ${s < step ? "bg-gold/30" : "bg-border"}`} />
            )}
          </div>
        ))}
        <span className="text-[10px] font-mono text-text-ghost ml-2 tracking-wider uppercase">
          {step === 1 && "Template"}
          {step === 2 && "Details"}
          {step === 3 && "Privacy"}
          {step === 4 && "Review"}
        </span>
      </div>

      {step === 1 && (
        <div className="space-y-4 animate-fade-up">
          <p className="text-[10px] font-mono text-text-ghost tracking-[0.2em] uppercase">
            Choose Token Type
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(Object.entries(TEMPLATES) as [Template, typeof TEMPLATES.fixed][]).map(
              ([key, t]) => (
                <button
                  key={key}
                  onClick={() => selectTemplate(key)}
                  className={`border p-4 text-left transition-colors cursor-pointer ${
                    template === key
                      ? "border-gold bg-gold-glow"
                      : "border-border hover:border-border-hover"
                  }`}
                >
                  <p className="text-[13px] font-editorial italic text-text-primary mb-1">
                    {t.label}
                  </p>
                  <p className="text-[10px] font-mono text-text-ghost leading-relaxed">
                    {t.desc}
                  </p>
                  {key === "fixed" && (
                    <span className="inline-block mt-2 border border-green-500/30 text-green-400 px-1.5 py-0.5 text-[8px] font-mono tracking-wider uppercase">
                      Recommended
                    </span>
                  )}
                </button>
              ),
            )}
          </div>
          <button
            onClick={() => setStep(2)}
            className="w-full py-2.5 bg-gold hover:bg-gold-dim text-background text-[11px] font-mono font-semibold tracking-[0.15em] uppercase transition-colors cursor-pointer"
          >
            Next: Token Details
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4 animate-fade-up">
          <p className="text-[10px] font-mono text-text-ghost tracking-[0.2em] uppercase">
            Token Details
          </p>
          <input
            type="text"
            value={config.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Token Name (e.g. HideMe Dollar)"
            className="input-field text-[12px]"
          />
          <input
            type="text"
            value={config.symbol}
            onChange={(e) => set("symbol", e.target.value.toUpperCase().slice(0, 10))}
            placeholder="Symbol (e.g. hmUSD)"
            className="input-field text-[12px]"
          />
          <input
            type="text"
            value={config.initialSupply}
            onChange={(e) => set("initialSupply", e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="Initial Supply (e.g. 1000000)"
            className="input-field text-[12px]"
          />
          {config.mintable && (
            <input
              type="text"
              value={config.maxSupply}
              onChange={(e) => set("maxSupply", e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="Max Supply Cap (leave empty for no cap)"
              className="input-field text-[12px]"
            />
          )}
          <textarea
            value={config.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="Description (optional)"
            rows={2}
            className="input-field text-[12px] resize-none"
          />
          <div>
            <input
              type="text"
              value={config.logoUri}
              onChange={(e) => set("logoUri", e.target.value)}
              placeholder="Logo Image URL (optional, e.g. https://...png)"
              className="input-field text-[12px]"
            />
            {config.logoUri && (
              <div className="mt-2 flex items-center gap-3">
                <div className="w-10 h-10 border border-border overflow-hidden flex-shrink-0">
                  <img
                    src={config.logoUri}
                    alt="preview"
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).src = ""; }}
                  />
                </div>
                <span className="text-[9px] font-mono text-text-ghost">Preview</span>
              </div>
            )}
          </div>
          <input
            type="text"
            value={config.website}
            onChange={(e) => set("website", e.target.value)}
            placeholder="Website URL (optional)"
            className="input-field text-[12px]"
          />

          {template === "custom" && (
            <div className="border border-border p-4 space-y-3">
              <p className="text-[9px] font-mono text-text-ghost tracking-[0.2em] uppercase">
                Custom Settings
              </p>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.mintable}
                  onChange={(e) => set("mintable", e.target.checked)}
                  className="accent-gold"
                />
                <span className="text-[11px] font-mono text-text-secondary">
                  Mintable (owner can create new tokens)
                </span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.burnable}
                  onChange={(e) => set("burnable", e.target.checked)}
                  className="accent-gold"
                />
                <span className="text-[11px] font-mono text-text-secondary">
                  Burnable (holders can destroy tokens)
                </span>
              </label>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => setStep(1)}
              className="flex-1 py-2.5 border border-border text-text-ghost text-[11px] font-mono tracking-[0.15em] uppercase hover:border-border-hover transition-colors cursor-pointer"
            >
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              className="flex-1 py-2.5 bg-gold hover:bg-gold-dim text-background text-[11px] font-mono font-semibold tracking-[0.15em] uppercase transition-colors cursor-pointer"
            >
              Next: Privacy
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4 animate-fade-up">
          <p className="text-[10px] font-mono text-text-ghost tracking-[0.2em] uppercase">
            Privacy & Compliance
          </p>

          <div className="border border-border p-4 space-y-3">
            <p className="text-[9px] font-mono text-text-ghost tracking-[0.2em] uppercase mb-2">
              Encryption Model
            </p>
            <div className="grid grid-cols-2 gap-4 text-[10px] font-mono">
              <div>
                <span className="text-gold">Encrypted</span>
                <p className="text-text-ghost mt-0.5">Balances, transfer amounts, allowances</p>
              </div>
              <div>
                <span className="text-text-secondary">Visible</span>
                <p className="text-text-ghost mt-0.5">Addresses, total supply, token metadata</p>
              </div>
            </div>
          </div>

          <div>
            <p className="text-[10px] font-mono text-text-ghost tracking-[0.15em] uppercase mb-2">
              Compliance Observers (optional)
            </p>
            <textarea
              value={config.observers}
              onChange={(e) => set("observers", e.target.value)}
              placeholder="Comma-separated addresses (e.g. 0xAbc..., 0xDef...)"
              rows={2}
              className="input-field text-[12px] resize-none"
            />
            <p className="text-[9px] font-mono text-text-ghost mt-1.5">
              Observers can decrypt all balances for audit/compliance. Leave empty for maximum privacy.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep(2)}
              className="flex-1 py-2.5 border border-border text-text-ghost text-[11px] font-mono tracking-[0.15em] uppercase hover:border-border-hover transition-colors cursor-pointer"
            >
              Back
            </button>
            <button
              onClick={() => setStep(4)}
              className="flex-1 py-2.5 bg-gold hover:bg-gold-dim text-background text-[11px] font-mono font-semibold tracking-[0.15em] uppercase transition-colors cursor-pointer"
            >
              Next: Review
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4 animate-fade-up">
          <p className="text-[10px] font-mono text-text-ghost tracking-[0.2em] uppercase">
            Review & Deploy
          </p>

          <div className="border border-border divide-y divide-border">
            <ReviewRow label="Name" value={config.name || "---"} />
            <ReviewRow label="Symbol" value={config.symbol.toUpperCase() || "---"} />
            <ReviewRow label="Initial Supply" value={config.initialSupply || "0"} />
            <ReviewRow
              label="Type"
              value={config.mintable ? "Mintable" : "Fixed Supply"}
              accent={!config.mintable}
            />
            {config.mintable && config.maxSupply && (
              <ReviewRow label="Max Supply" value={config.maxSupply} />
            )}
            <ReviewRow label="Burnable" value={config.burnable ? "Yes" : "No"} />
            <ReviewRow label="Encryption" value="TFHE-128 (Post-Quantum)" />
            <ReviewRow
              label="Observers"
              value={
                config.observers.split(",").filter((a) => a.trim()).length > 0
                  ? `${config.observers.split(",").filter((a) => a.trim()).length} address(es)`
                  : "None"
              }
            />
          </div>

          <div className="border border-border p-4">
            <p className="text-[9px] font-mono text-text-ghost tracking-[0.2em] uppercase mb-2">
              Trust Indicators
            </p>
            <div className="flex flex-wrap gap-2">
              {!config.mintable ? (
                <Badge color="green">Fixed Supply</Badge>
              ) : (
                <Badge color="yellow">Mintable</Badge>
              )}
              {config.mintable && !config.maxSupply && (
                <Badge color="red">No Max Cap</Badge>
              )}
              {config.mintable && config.maxSupply && (
                <Badge color="yellow">Capped at {config.maxSupply}</Badge>
              )}
              {config.burnable && <Badge color="green">Burnable</Badge>}
              <Badge color="green">No Pause</Badge>
              <Badge color="green">No Blacklist</Badge>
              <Badge color="green">No Hidden Fees</Badge>
            </div>
          </div>

          {error && (
            <div className="border-l-2 border-danger pl-3 py-1">
              <p className="text-[10px] font-mono text-danger">{error}</p>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => setStep(3)}
              className="flex-1 py-2.5 border border-border text-text-ghost text-[11px] font-mono tracking-[0.15em] uppercase hover:border-border-hover transition-colors cursor-pointer"
            >
              Back
            </button>
            <button
              onClick={handleDeploy}
              disabled={!isConnected || isPending || isConfirming}
              className="flex-1 py-2.5 bg-gold hover:bg-gold-dim disabled:bg-surface-2 disabled:text-text-ghost text-background text-[11px] font-mono font-semibold tracking-[0.15em] uppercase transition-colors cursor-pointer"
            >
              {!isConnected
                ? "Connect Wallet"
                : isPending
                  ? "Confirm in Wallet..."
                  : isConfirming
                    ? "Deploying..."
                    : "Deploy Token"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="text-[9px] font-mono text-text-ghost tracking-[0.15em] uppercase">{label}</span>
      <span className={`text-[11px] font-mono ${accent ? "text-green-400" : "text-text-secondary"}`}>{value}</span>
    </div>
  );
}

function Badge({ children, color }: { children: React.ReactNode; color: "green" | "yellow" | "red" }) {
  const colors = {
    green: "border-green-500/30 text-green-400",
    yellow: "border-yellow-500/30 text-yellow-400",
    red: "border-red-500/30 text-red-400",
  };
  return (
    <span className={`border ${colors[color]} px-2 py-0.5 text-[8px] font-mono tracking-wider uppercase`}>
      {children}
    </span>
  );
}
