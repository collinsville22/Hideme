"use client";

import { useState, useEffect } from "react";
import { useAccount, usePublicClient, useWriteContract, useWalletClient } from "wagmi";
import { decodeEventLog } from "viem";
import { WRAPPER_FACTORY_ADDRESS, shortenAddress } from "@/lib/constants";
import { decryptMultipleBalances } from "@/lib/fhevm";
import wrapperAbi from "@/lib/abi/ConfidentialWrapper.json";
import factoryAbi from "@/lib/abi/WrapperFactory.json";

const ZERO_HANDLE = "0x" + "0".repeat(64);
const KNOWN_TOKENS = [
  { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", symbol: "WETH", name: "Wrapped Ether", decimals: 18 },
  { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", name: "USD Coin", decimals: 6 },
  { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", symbol: "DAI", name: "Dai", decimals: 18 },
  { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", symbol: "USDT", name: "Tether", decimals: 6 },
  { address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", symbol: "WBTC", name: "Wrapped Bitcoin", decimals: 8 },
  { address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", symbol: "UNI", name: "Uniswap", decimals: 18 },
  { address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", symbol: "LINK", name: "Chainlink", decimals: 18 },
  { address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", symbol: "AAVE", name: "Aave", decimals: 18 },
];
const ERC20_ABI = [{ inputs: [{ name: "a", type: "address" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" }] as const;
const APPROVE_ABI = [{ inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], name: "approve", outputs: [{ type: "bool" }], stateMutability: "nonpayable", type: "function" }];

type PublicToken = { address: string; symbol: string; name: string; decimals: number; balance: bigint; balanceFormatted: number; wrapper: string | null; usdPrice: number | null };
type PrivateToken = { erc20: string; wrapper: string; tokenSymbol: string; tokenName: string; tokenDecimals: number; wrapperSymbol: string; handle: string; decrypted: bigint | null; usdPrice: number | null };

export default function PortfolioPage() {
  const { isConnected, address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { writeContractAsync } = useWriteContract();

  const [publicTokens, setPublicTokens] = useState<PublicToken[]>([]);
  const [privateTokens, setPrivateTokens] = useState<PrivateToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [decrypting, setDecrypting] = useState(false);
  const [decrypted, setDecrypted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wrapping, setWrapping] = useState<string | null>(null);
  const [wrapStatus, setWrapStatus] = useState<string | null>(null);
  const [batchWrapping, setBatchWrapping] = useState(false);
  const [selectedForWrap, setSelectedForWrap] = useState<Set<string>>(new Set());

  const scan = async () => {
    if (!publicClient || !address) return;
    setLoading(true); setError(null);
    try {
      const totalWrappers = await publicClient.readContract({ address: WRAPPER_FACTORY_ADDRESS as `0x${string}`, abi: factoryAbi, functionName: "totalWrappers" }) as bigint;
      let wrapperInfos: Array<{ erc20Token: string; wrapper: string; tokenName: string; tokenSymbol: string; tokenDecimals: number; wrapperName: string; wrapperSymbol: string }> = [];
      if (totalWrappers > 0n) wrapperInfos = await publicClient.readContract({ address: WRAPPER_FACTORY_ADDRESS as `0x${string}`, abi: factoryAbi, functionName: "getWrappersPaginated", args: [0n, totalWrappers > 50n ? 50n : totalWrappers] }) as typeof wrapperInfos;

      const wrapperMap = new Map<string, string>();
      for (const w of wrapperInfos) wrapperMap.set(w.erc20Token.toLowerCase(), w.wrapper);
      const allAddrs = new Set<string>();
      for (const t of KNOWN_TOKENS) allAddrs.add(t.address.toLowerCase());
      for (const w of wrapperInfos) allAddrs.add(w.erc20Token.toLowerCase());

      const pubTokens: PublicToken[] = [];
      for (const addr of allAddrs) {
        try {
          const bal = await publicClient.readContract({ address: addr as `0x${string}`, abi: ERC20_ABI, functionName: "balanceOf", args: [address as `0x${string}`] }) as bigint;
          if (bal > 0n) {
            const k = KNOWN_TOKENS.find(t => t.address.toLowerCase() === addr);
            const w = wrapperInfos.find(x => x.erc20Token.toLowerCase() === addr);
            pubTokens.push({ address: addr, symbol: k?.symbol || w?.tokenSymbol || "???", name: k?.name || w?.tokenName || "Unknown", decimals: k?.decimals || w?.tokenDecimals || 18, balance: bal, balanceFormatted: Number(bal) / (10 ** (k?.decimals || w?.tokenDecimals || 18)), wrapper: wrapperMap.get(addr) || null, usdPrice: null });
          }
        } catch { /* expected */ }
      }

      const privTokens: PrivateToken[] = [];
      for (const w of wrapperInfos) {
        try {
          const h = await publicClient.readContract({ address: w.wrapper as `0x${string}`, abi: wrapperAbi, functionName: "balanceOf", args: [address as `0x${string}`] }) as string;
          if (h !== ZERO_HANDLE) privTokens.push({ erc20: w.erc20Token, wrapper: w.wrapper, tokenSymbol: w.tokenSymbol, tokenName: w.tokenName, tokenDecimals: w.tokenDecimals, wrapperSymbol: w.wrapperSymbol, handle: h, decrypted: null, usdPrice: null });
        } catch { /* expected */ }
      }

      const allErc20s = [...new Set([...pubTokens.map(t => t.address), ...privTokens.map(t => t.erc20)])];
      if (allErc20s.length > 0) {
        try {
          const r = await fetch(`https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=${allErc20s.join(",")}&vs_currencies=usd`, { signal: AbortSignal.timeout(8000) });
          const prices = await r.json();
          for (const t of pubTokens) t.usdPrice = prices[t.address.toLowerCase()]?.usd || null;
          for (const t of privTokens) t.usdPrice = prices[t.erc20.toLowerCase()]?.usd || null;
        } catch { /* expected */ }
      }
      setPublicTokens(pubTokens); setPrivateTokens(privTokens); setDecrypted(false);
    } catch (err) { setError((err instanceof Error ? err.message : "Failed").slice(0, 200)); }
    setLoading(false);
  };

  useEffect(() => { if (address) scan(); }, [address]);

  const handleDecryptAll = async () => {
    if (!walletClient || !publicClient || !address) return;
    setDecrypting(true); setError(null);
    try {
      const totalWrappers = await publicClient.readContract({ address: WRAPPER_FACTORY_ADDRESS as `0x${string}`, abi: factoryAbi, functionName: "totalWrappers" }) as bigint;
      let wrapperInfos: Array<{ erc20Token: string; wrapper: string; tokenName: string; tokenSymbol: string; tokenDecimals: number; wrapperName: string; wrapperSymbol: string }> = [];
      if (totalWrappers > 0n) wrapperInfos = await publicClient.readContract({ address: WRAPPER_FACTORY_ADDRESS as `0x${string}`, abi: factoryAbi, functionName: "getWrappersPaginated", args: [0n, totalWrappers > 50n ? 50n : totalWrappers] }) as typeof wrapperInfos;

      const freshPriv: PrivateToken[] = [];
      for (const w of wrapperInfos) {
        try {
          const h = await publicClient.readContract({ address: w.wrapper as `0x${string}`, abi: wrapperAbi, functionName: "balanceOf", args: [address as `0x${string}`] }) as string;
          if (h !== ZERO_HANDLE) freshPriv.push({ erc20: w.erc20Token, wrapper: w.wrapper, tokenSymbol: w.tokenSymbol, tokenName: w.tokenName, tokenDecimals: w.tokenDecimals, wrapperSymbol: w.wrapperSymbol, handle: h, decrypted: null, usdPrice: privateTokens.find(t => t.wrapper === w.wrapper)?.usdPrice ?? null });
        } catch { /* expected */ }
      }

      if (freshPriv.length === 0) { setError("No encrypted balances found."); setDecrypting(false); return; }

      const results = await decryptMultipleBalances(freshPriv.map(t => ({ contractAddress: t.wrapper, handle: t.handle })), walletClient);
      setPrivateTokens(freshPriv.map(t => ({ ...t, decrypted: results.get(t.handle) ?? null }))); setDecrypted(true);
    } catch (err) { setError("Decryption failed: " + (err instanceof Error ? err.message : "Sign in wallet")); }
    setDecrypting(false);
  };

  const handleWrap = async (token: PublicToken) => {
    if (!publicClient || !address) return;
    setWrapping(token.address); setError(null);
    let wrapper = token.wrapper;
    try {
      if (wrapper) {
        const restricted = await publicClient.readContract({ address: wrapper as `0x${string}`, abi: wrapperAbi, functionName: "isRestricted", args: [address as `0x${string}`] }) as boolean;
        if (restricted) { setError("You have a pending unwrap on this wrapper. Wait for it to finalize before wrapping."); setWrapping(null); return; }
      }
      if (!wrapper) {
        setWrapStatus("Creating wrapper for " + token.symbol + "...");
        const ch = await writeContractAsync({ address: WRAPPER_FACTORY_ADDRESS as `0x${string}`, abi: factoryAbi, functionName: "createWrapper", args: [token.address as `0x${string}`] });
        const receipt = await publicClient.waitForTransactionReceipt({ hash: ch });
        for (const log of receipt.logs) { if (log.address.toLowerCase() === WRAPPER_FACTORY_ADDRESS.toLowerCase() && log.topics.length >= 3) { wrapper = ("0x" + (log.topics[2] || "").slice(26)) as string; break; } }
        if (!wrapper) throw new Error("Failed to create wrapper");
      }
      setWrapStatus("Approving " + token.symbol + "...");
      const ah = await writeContractAsync({ address: token.address as `0x${string}`, abi: APPROVE_ABI, functionName: "approve", args: [wrapper as `0x${string}`, token.balance], gas: 80000n });
      await publicClient.waitForTransactionReceipt({ hash: ah });
      setWrapStatus("Encrypting " + token.symbol + "...");
      const wh = await writeContractAsync({ address: wrapper as `0x${string}`, abi: wrapperAbi, functionName: "wrap", args: [token.balance] });
      await publicClient.waitForTransactionReceipt({ hash: wh });
      setWrapStatus(null); setWrapping(null); scan();
    } catch (err) { setError((err instanceof Error ? err.message : "Wrap failed").slice(0, 200)); setWrapStatus(null); setWrapping(null); }
  };

  const handleBatchWrap = async () => {
    if (!publicClient || !address || selectedForWrap.size === 0) return;
    setBatchWrapping(true); setError(null);
    const toWrap = publicTokens.filter(t => selectedForWrap.has(t.address));
    try {
      for (let i = 0; i < toWrap.length; i++) {
        const t = toWrap[i]; let wrapper = t.wrapper;
        if (!wrapper) {
          setWrapStatus(`Creating wrapper for ${t.symbol} (${i + 1}/${toWrap.length})...`);
          const ch = await writeContractAsync({ address: WRAPPER_FACTORY_ADDRESS as `0x${string}`, abi: factoryAbi, functionName: "createWrapper", args: [t.address as `0x${string}`] });
          const receipt = await publicClient.waitForTransactionReceipt({ hash: ch });
          for (const log of receipt.logs) { if (log.address.toLowerCase() === WRAPPER_FACTORY_ADDRESS.toLowerCase() && log.topics.length >= 3) { wrapper = ("0x" + (log.topics[2] || "").slice(26)) as string; break; } }
          if (!wrapper) throw new Error("Failed to create wrapper for " + t.symbol);
        }
        setWrapStatus(`Encrypting ${t.symbol} (${i + 1}/${toWrap.length})...`);
        const ah = await writeContractAsync({ address: t.address as `0x${string}`, abi: APPROVE_ABI, functionName: "approve", args: [wrapper as `0x${string}`, t.balance], gas: 80000n });
        await publicClient.waitForTransactionReceipt({ hash: ah });
        const wh = await writeContractAsync({ address: wrapper as `0x${string}`, abi: wrapperAbi, functionName: "wrap", args: [t.balance] });
        await publicClient.waitForTransactionReceipt({ hash: wh });
      }
      setSelectedForWrap(new Set()); setWrapStatus(null); scan();
    } catch (err) { setError((err instanceof Error ? err.message : "Batch failed").slice(0, 200)); setWrapStatus(null); }
    setBatchWrapping(false);
  };

  const handleUnwrap = async (token: PrivateToken) => {
    if (!publicClient || !address || !token.decrypted) return;
    setError(null);
    try {
      setWrapping(token.wrapper); setWrapStatus("Requesting unwrap...");
      const uh = await writeContractAsync({ address: token.wrapper as `0x${string}`, abi: wrapperAbi, functionName: "unwrap", args: [token.decrypted] });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: uh });

      let requestId: number | null = null;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== token.wrapper.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({ abi: wrapperAbi, data: log.data, topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]] });
          if (decoded.eventName === "UnwrapRequested") {
            requestId = Number((decoded.args as { requestId: bigint }).requestId);
            break;
          }
        } catch { /* expected */ }
      }

      if (requestId === null) throw new Error("Could not extract unwrap requestId");

      setWrapStatus("Unwrapping via relayer (KMS decryption ~30-60s)...");
      const resp = await fetch("/api/unwrap/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wrapperAddress: token.wrapper, requestId }),
      });
      const r = await resp.json();
      if (!resp.ok && !r.alreadyDone) throw new Error(r.error || "Finalize failed");

      setWrapStatus("Unwrap complete!");
      setTimeout(() => { setWrapping(null); setWrapStatus(null); scan(); }, 2000);
    } catch (err) { setError((err instanceof Error ? err.message : "Unwrap failed").slice(0, 200)); setWrapping(null); setWrapStatus(null); }
  };

  const publicTotal = publicTokens.reduce((s, t) => s + (t.usdPrice ? t.balanceFormatted * t.usdPrice : 0), 0);
  const privateTotal = decrypted ? privateTokens.reduce((s, t) => s + (t.decrypted !== null && t.usdPrice ? (Number(t.decrypted) / 1e6) * t.usdPrice : 0), 0) : null;
  const toggleSelect = (a: string) => setSelectedForWrap(p => { const n = new Set(p); if (n.has(a)) n.delete(a); else n.add(a); return n; });

  if (!isConnected) {
    return (
      <div className="max-w-4xl mx-auto px-8 pt-24 pb-32 text-center animate-fade-up">
        <p className="text-[10px] font-mono text-text-ghost tracking-[0.3em] uppercase mb-6">Confidential Protocol</p>
        <h1 className="text-[48px] font-editorial italic text-text-primary leading-none mb-6">Private <span className="text-gold">Portfolio</span></h1>
        <p className="text-[13px] font-mono text-text-secondary">Connect your wallet to view and manage your encrypted balances.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-8 pb-24">
      <div className="pt-16 pb-10 animate-fade-up">
        <p className="text-[10px] font-mono text-text-ghost tracking-[0.3em] uppercase mb-4">Confidential Protocol</p>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-[48px] font-editorial italic text-text-primary leading-none mb-4">
              Private <span className="text-gold">Portfolio</span>
            </h1>
            <p className="text-[13px] font-mono text-text-secondary max-w-xl">
              Move tokens between public and private. Only you can see encrypted balances.
            </p>
          </div>
          <button onClick={scan} disabled={loading}
            className="text-[9px] font-mono text-text-ghost border border-border px-3 py-1.5 hover:border-gold hover:text-gold transition-colors cursor-pointer tracking-wider uppercase disabled:opacity-50 mt-4">
            {loading ? "Scanning..." : "Refresh"}
          </button>
        </div>
      </div>

      {error && <div className="border-l-2 border-danger pl-3 py-2 mb-6 animate-fade-up"><p className="text-[10px] font-mono text-danger">{error}</p></div>}
      {wrapStatus && <div className="border border-gold/20 bg-gold-glow px-5 py-3 mb-6 animate-fade-up"><p className="text-[10px] font-mono text-gold animate-pulse">{wrapStatus}</p></div>}

      <div className="space-y-10">
        <section className="animate-fade-up delay-1">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-1.5 h-1.5 rounded-full bg-danger" />
                <p className="text-[10px] font-mono text-text-ghost tracking-[0.3em] uppercase">Exposed Balances</p>
              </div>
              <p className="text-[9px] font-mono text-danger/50">Visible to everyone on Etherscan</p>
            </div>
            {publicTotal > 0 && <p className="text-[16px] font-editorial italic text-text-secondary">${publicTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>}
          </div>

          {publicTokens.length === 0 && !loading && (
            <div className="border border-dashed border-border p-8 text-center"><p className="text-[10px] font-mono text-text-ghost">No exposed token balances found.</p></div>
          )}

          {publicTokens.length > 0 && (
            <div className="border border-border">
              <div className="grid grid-cols-12 px-5 py-2.5 border-b border-border">
                <div className="col-span-1"></div>
                <div className="col-span-4 text-[8px] font-mono text-text-ghost tracking-[0.2em] uppercase">Token</div>
                <div className="col-span-3 text-[8px] font-mono text-text-ghost tracking-[0.2em] uppercase text-right">Balance</div>
                <div className="col-span-2 text-[8px] font-mono text-text-ghost tracking-[0.2em] uppercase text-right">Value</div>
                <div className="col-span-2"></div>
              </div>

              {publicTokens.map((t, i) => (
                <div key={t.address} className={`grid grid-cols-12 px-5 py-3 border-b border-border last:border-b-0 items-center hover:bg-gold-muted transition-all animate-fade-up delay-${Math.min(i, 5)}`}>
                  <div className="col-span-1">
                    <input type="checkbox" checked={selectedForWrap.has(t.address)} onChange={() => toggleSelect(t.address)} className="w-3.5 h-3.5 accent-gold cursor-pointer" />
                  </div>
                  <div className="col-span-4 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center text-[9px] font-mono text-text-ghost font-semibold">{t.symbol.slice(0, 3)}</div>
                    <div>
                      <p className="text-[12px] font-mono text-text-primary font-semibold">{t.symbol}</p>
                      <p className="text-[8px] font-mono text-text-ghost">{t.name}</p>
                    </div>
                  </div>
                  <div className="col-span-3 text-right">
                    <p className="text-[12px] font-mono text-text-secondary">{t.balanceFormatted.toLocaleString(undefined, { maximumFractionDigits: 6 })}</p>
                  </div>
                  <div className="col-span-2 text-right">
                    {t.usdPrice ? <p className="text-[10px] font-mono text-text-ghost">${(t.balanceFormatted * t.usdPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}</p> : <span className="text-[8px] font-mono text-text-ghost/40">—</span>}
                  </div>
                  <div className="col-span-2 text-right">
                    <button onClick={() => handleWrap(t)} disabled={wrapping === t.address}
                      className="border border-gold/30 text-gold text-[8px] font-mono px-3 py-1 tracking-wider uppercase hover:bg-gold-glow transition-all cursor-pointer disabled:opacity-50">
                      {wrapping === t.address ? "..." : "Make Private"}
                    </button>
                  </div>
                </div>
              ))}

              {publicTokens.length > 1 && (
                <div className="flex items-center justify-between px-5 py-2.5 bg-surface/50 border-t border-border">
                  <button onClick={() => { if (selectedForWrap.size === publicTokens.length) setSelectedForWrap(new Set()); else setSelectedForWrap(new Set(publicTokens.map(t => t.address))); }}
                    className="text-[9px] font-mono text-text-ghost hover:text-gold cursor-pointer tracking-wide uppercase">{selectedForWrap.size === publicTokens.length ? "Deselect All" : "Select All"}</button>
                  {selectedForWrap.size > 0 && (
                    <button onClick={handleBatchWrap} disabled={batchWrapping}
                      className="px-4 py-1.5 bg-gold hover:bg-gold-dim text-background text-[9px] font-mono font-semibold tracking-wider uppercase transition-colors cursor-pointer disabled:opacity-50">
                      {batchWrapping ? "Encrypting..." : `Make ${selectedForWrap.size} Private`}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="animate-fade-up delay-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse-gold" />
                <p className="text-[10px] font-mono text-text-ghost tracking-[0.3em] uppercase">Encrypted Balances</p>
              </div>
              <p className="text-[9px] font-mono text-green-400/50">Only you can decrypt these</p>
            </div>
            <div className="flex items-center gap-4">
              {decrypted && privateTotal !== null ? (
                <p className="text-[16px] font-editorial italic text-gold">${privateTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
              ) : privateTokens.length > 0 ? (
                <p className="text-[16px] font-editorial italic text-text-ghost/20">$••••••</p>
              ) : null}
              {privateTokens.length > 0 && !decrypted && (
                <button onClick={handleDecryptAll} disabled={decrypting}
                  className="border border-gold/30 text-gold text-[9px] font-mono px-4 py-1.5 tracking-wider uppercase hover:bg-gold-glow transition-all cursor-pointer disabled:opacity-50">
                  {decrypting ? "Sign in wallet..." : "Decrypt All"}
                </button>
              )}
            </div>
          </div>

          {privateTokens.length === 0 && !loading && (
            <div className="border border-dashed border-border p-8 text-center"><p className="text-[10px] font-mono text-text-ghost">No encrypted balances. Use &quot;Make Private&quot; above.</p></div>
          )}

          {privateTokens.length > 0 && (
            <div className="border border-border">
              <div className="grid grid-cols-12 px-5 py-2.5 border-b border-border">
                <div className="col-span-5 text-[8px] font-mono text-text-ghost tracking-[0.2em] uppercase">Token</div>
                <div className="col-span-3 text-[8px] font-mono text-text-ghost tracking-[0.2em] uppercase text-right">Balance</div>
                <div className="col-span-2 text-[8px] font-mono text-text-ghost tracking-[0.2em] uppercase text-right">Value</div>
                <div className="col-span-2"></div>
              </div>

              {privateTokens.map((t, i) => (
                <div key={t.wrapper} className={`grid grid-cols-12 px-5 py-3 border-b border-border last:border-b-0 items-center hover:bg-gold-muted transition-all animate-fade-up delay-${Math.min(i, 5)}`}>
                  <div className="col-span-5 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-green-400/10 border border-green-400/20 flex items-center justify-center text-[9px] font-mono text-green-400 font-semibold">{t.tokenSymbol.slice(0, 3)}</div>
                    <div>
                      <p className="text-[12px] font-mono text-text-primary font-semibold">{t.wrapperSymbol}</p>
                      <p className="text-[8px] font-mono text-text-ghost">{t.tokenName}</p>
                    </div>
                  </div>
                  <div className="col-span-3 text-right">
                    {t.decrypted !== null ? (
                      <p className="text-[12px] font-mono text-green-400 font-semibold">{(Number(t.decrypted) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 })}</p>
                    ) : (
                      <div className="inline-block bg-surface-2 h-3 w-16 rounded-sm" />
                    )}
                  </div>
                  <div className="col-span-2 text-right">
                    {t.decrypted !== null && t.usdPrice ? <p className="text-[10px] font-mono text-text-ghost">${((Number(t.decrypted) / 1e6) * t.usdPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}</p> : <span className="text-[8px] font-mono text-text-ghost/30">—</span>}
                  </div>
                  <div className="col-span-2 text-right">
                    {t.decrypted !== null && (
                      <button onClick={() => handleUnwrap(t)} disabled={wrapping === t.wrapper}
                        className="border border-border text-text-ghost text-[8px] font-mono px-3 py-1 tracking-wider uppercase hover:border-gold hover:text-gold transition-all cursor-pointer disabled:opacity-50">
                        {wrapping === t.wrapper ? "..." : "Make Public"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="animate-fade-up delay-3">
          <div className="border border-border p-6 relative">
            <div className="absolute top-4 right-4 border border-gold/30 px-2 py-0.5">
              <span className="text-[8px] font-mono text-gold tracking-[0.2em] uppercase">FHE Powered</span>
            </div>
            <p className="text-[9px] font-mono text-text-ghost tracking-[0.2em] uppercase mb-4">How It Works</p>
            <div className="grid grid-cols-3 gap-6">
              {[
                ["1", "Make Private", "Wraps your ERC-20 into an encrypted cToken. Your balance becomes invisible on-chain."],
                ["2", "Decrypt", "Sign once to reveal all balances to yourself. Nothing changes on-chain."],
                ["3", "Make Public", "Unwraps back to plain ERC-20. Balance becomes visible again."],
              ].map(([n, title, desc]) => (
                <div key={n}>
                  <p className="text-[16px] font-editorial italic text-gold mb-1">{n}.</p>
                  <p className="text-[10px] font-mono text-text-secondary mb-1">{title}</p>
                  <p className="text-[8px] font-mono text-text-ghost leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
