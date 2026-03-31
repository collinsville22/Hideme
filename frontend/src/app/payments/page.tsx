"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useAccount, useReadContract, useWriteContract, usePublicClient, useSendTransaction } from "wagmi";
import { parseUnits, decodeEventLog, encodeFunctionData } from "viem";
import { ROUTER_V2_ADDRESS, WRAPPER_FACTORY_ADDRESS, shortenAddress, getExplorerTxUrl } from "@/lib/constants";
import routerV2Abi from "@/lib/abi/ConfidentialPaymentRouterV2.json";
import factoryAbi from "@/lib/abi/WrapperFactory.json";

type TokenInfo = { address: string; name: string; symbol: string; decimals: number; logoURI?: string };

const FEATURED = ["USDC", "DAI", "WETH", "USDT", "WBTC", "UNI", "LINK", "AAVE"];

let _tokenListCache: TokenInfo[] | null = null;
let _tokenListPromise: Promise<TokenInfo[]> | null = null;
let _addressIndex: Map<string, TokenInfo> | null = null;

function fetchTokenList(): Promise<TokenInfo[]> {
  if (_tokenListCache) return Promise.resolve(_tokenListCache);
  if (_tokenListPromise) return _tokenListPromise;
  _tokenListPromise = (async () => {
    const seen = new Map<string, TokenInfo>();
    try {
      const r = await fetch("https://tokens.coingecko.com/ethereum/all.json", { signal: AbortSignal.timeout(12000) });
      for (const t of ((await r.json()).tokens || []) as Array<{ address: string; name: string; symbol: string; decimals: number; logoURI?: string }>)
        seen.set(t.address.toLowerCase(), { address: t.address, name: t.name, symbol: t.symbol, decimals: t.decimals, logoURI: t.logoURI });
    } catch { /* expected */ }
    try {
      const r = await fetch("https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/dist/tokens/eth/tokens-eth.json", { signal: AbortSignal.timeout(12000) });
      for (const t of (await r.json()) as Array<{ address: string; name: string; symbol: string; decimals: number; logo?: { src?: string } }>) {
        const a = t.address.toLowerCase();
        if (!seen.has(a)) seen.set(a, { address: t.address, name: t.name, symbol: t.symbol, decimals: t.decimals, logoURI: t.logo?.src || undefined });
      }
    } catch { /* expected */ }
    if (seen.size < 500) {
      try {
        const r = await fetch("https://tokens.uniswap.org", { signal: AbortSignal.timeout(10000) });
        for (const t of ((await r.json()).tokens || []) as Array<{ chainId?: number; address: string; name: string; symbol: string; decimals: number; logoURI?: string }>) {
          if (t.chainId && t.chainId !== 1) continue;
          const a = t.address.toLowerCase();
          if (!seen.has(a)) seen.set(a, { address: t.address, name: t.name, symbol: t.symbol, decimals: t.decimals, logoURI: t.logoURI });
        }
      } catch { /* expected */ }
    }
    _tokenListCache = Array.from(seen.values());
    _addressIndex = seen;
    return _tokenListCache;
  })();
  _tokenListPromise.catch(() => { _tokenListPromise = null; });
  return _tokenListPromise;
}

function TokenSelector({ selected, onSelect }: { selected: TokenInfo | null; onSelect: (t: TokenInfo) => void }) {
  const publicClient = usePublicClient();
  const [allTokens, setAllTokens] = useState<TokenInfo[]>([]);
  const [query, setQuery] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [isLooking, setIsLooking] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => { fetchTokenList().then(setAllTokens); }, []);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowDropdown(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);

  const featured = useMemo(() => FEATURED.map(s => allTokens.find(t => t.symbol === s)).filter(Boolean) as TokenInfo[], [allTokens]);
  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    if (q.startsWith("0x")) {
      if (q.length >= 42 && _addressIndex) { const e = _addressIndex.get(q); return e ? [e] : []; }
      if (q.length > 4) return allTokens.filter(t => t.address.toLowerCase().startsWith(q)).slice(0, 20);
      return [];
    }
    const exact = allTokens.filter(t => t.symbol.toLowerCase() === q);
    const partial = allTokens.filter(t => t.symbol.toLowerCase() !== q && (t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)));
    return [...exact, ...partial].slice(0, 25);
  }, [query, allTokens]);
  const isAddress = query.startsWith("0x") && query.length >= 42;

  const lookupOnChain = async () => {
    if (!publicClient || !isAddress) return;
    setLookupError(null); setIsLooking(true);
    try {
      const abi = [
        { inputs: [], name: "name", outputs: [{ type: "string" }], stateMutability: "view", type: "function" },
        { inputs: [], name: "symbol", outputs: [{ type: "string" }], stateMutability: "view", type: "function" },
        { inputs: [], name: "decimals", outputs: [{ type: "uint8" }], stateMutability: "view", type: "function" },
      ];
      const a = query as `0x${string}`;
      const [n, s, d] = await Promise.all([publicClient.readContract({ address: a, abi, functionName: "name" }), publicClient.readContract({ address: a, abi, functionName: "symbol" }), publicClient.readContract({ address: a, abi, functionName: "decimals" })]);
      onSelect({ address: query, name: n as string, symbol: s as string, decimals: Number(d) });
      setQuery(""); setShowDropdown(false);
    } catch { setLookupError("Not a valid ERC-20 contract."); } finally { setIsLooking(false); }
  };
  const pick = (t: TokenInfo) => { onSelect(t); setQuery(""); setShowDropdown(false); setLookupError(null); };

  return (
    <div className="space-y-3">
      <p className="text-[9px] font-mono text-text-ghost tracking-[0.2em] uppercase">
        Select Token {allTokens.length > 0 && <span className="text-text-ghost/40">({allTokens.length.toLocaleString()})</span>}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {featured.map(t => (
          <button key={t.address} onClick={() => pick(t)}
            className={`border px-3 py-1.5 text-[9px] font-mono transition-all cursor-pointer flex items-center gap-1.5 ${
              selected?.address.toLowerCase() === t.address.toLowerCase() ? "border-gold text-gold bg-gold-muted" : "border-border text-text-ghost hover:border-border-hover hover:bg-gold-glow"
            }`}>
            {t.logoURI && <img src={t.logoURI} alt="" className="w-3.5 h-3.5 rounded-full" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />}
            {t.symbol}
          </button>
        ))}
      </div>
      <div className="relative" ref={dropdownRef}>
        <input type="text" value={query} onChange={(e) => { setQuery(e.target.value); setShowDropdown(true); setLookupError(null); }} onFocus={() => query && setShowDropdown(true)}
          placeholder="Search by name, symbol, or paste contract address..." className="input-field text-[11px] w-full" />
        {showDropdown && query.length >= 1 && (
          <div className="absolute z-50 mt-1 w-full border border-border bg-background max-h-60 overflow-y-auto">
            {results.length > 0 ? results.map(t => (
              <button key={t.address} onClick={() => pick(t)} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gold-muted transition-all cursor-pointer text-left border-b border-border/30 last:border-b-0">
                {t.logoURI ? <img src={t.logoURI} alt="" className="w-5 h-5 rounded-full flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} /> : <div className="w-5 h-5 rounded-full bg-surface-2 flex-shrink-0 flex items-center justify-center text-[7px] font-mono text-text-ghost">{t.symbol.slice(0, 2)}</div>}
                <div className="flex-1 min-w-0">
                  <div><span className="text-[11px] font-mono text-text-secondary">{t.symbol}</span><span className="text-[9px] font-mono text-text-ghost ml-2">{t.name}</span></div>
                  <p className="text-[8px] font-mono text-text-ghost/40 truncate">{t.address}</p>
                </div>
              </button>
            )) : isAddress ? (
              <div className="px-4 py-3"><button onClick={lookupOnChain} disabled={isLooking} className="border border-gold/40 text-gold text-[9px] font-mono px-3 py-1.5 tracking-wider uppercase hover:bg-gold-glow cursor-pointer disabled:opacity-50">{isLooking ? "Looking up..." : "Lookup On-Chain"}</button></div>
            ) : query.length >= 2 ? <p className="px-4 py-3 text-[10px] font-mono text-text-ghost">No tokens found</p> : null}
          </div>
        )}
      </div>
      {lookupError && <p className="text-[9px] font-mono text-danger">{lookupError}</p>}
      {selected && (
        <div className="flex items-center gap-3 border border-gold/20 bg-gold-glow px-4 py-2.5">
          {selected.logoURI && <img src={selected.logoURI} alt="" className="w-5 h-5 rounded-full" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />}
          <p className="text-[10px] font-mono text-gold flex-1">{selected.symbol} <span className="text-text-ghost">— {selected.name}</span></p>
          <button onClick={() => onSelect(null as unknown as TokenInfo)} className="text-[9px] font-mono text-text-ghost hover:text-danger cursor-pointer">&#10005;</button>
        </div>
      )}
    </div>
  );
}

const ERC20_BALANCE_ABI = [{ inputs: [{ name: "account", type: "address" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" }] as const;

function useTokenBalance(token: TokenInfo | null) {
  const { address } = useAccount();
  const { data: rawBalance, isLoading } = useReadContract({ address: token?.address as `0x${string}` | undefined, abi: ERC20_BALANCE_ABI, functionName: "balanceOf", args: address ? [address] : undefined, query: { enabled: !!token && !!address } });
  return { balance: rawBalance !== undefined && token ? Number(rawBalance) / (10 ** token.decimals) : null, isLoading };
}

function BalanceBar({ token, onSetAmount }: { token: TokenInfo | null; onSetAmount: (v: string) => void }) {
  const { balance, isLoading } = useTokenBalance(token);
  if (!token) return null;
  return (
    <div className="flex items-center justify-between px-1 py-1">
      <p className="text-[9px] font-mono text-text-ghost">
        Balance: {isLoading ? <span className="text-text-ghost/40">loading...</span> : balance !== null ? <span className="text-text-secondary">{balance < 0.000001 && balance > 0 ? "< 0.000001" : balance.toLocaleString(undefined, { maximumFractionDigits: 6 })} {token.symbol}</span> : <span className="text-text-ghost/40">—</span>}
      </p>
      {balance !== null && balance > 0 && (
        <div className="flex gap-1.5">
          <button onClick={() => onSetAmount((balance * 0.5).toFixed(Math.min(token.decimals, 6)))} className="text-[8px] font-mono text-text-ghost border border-border px-2 py-0.5 hover:border-gold hover:text-gold transition-colors cursor-pointer tracking-wider uppercase">50%</button>
          <button onClick={() => onSetAmount(balance.toFixed(Math.min(token.decimals, 6)))} className="text-[8px] font-mono text-gold border border-gold/30 px-2 py-0.5 hover:bg-gold-glow transition-colors cursor-pointer tracking-wider uppercase">Max</button>
        </div>
      )}
    </div>
  );
}

export default function PaymentsPage() {
  const [activeTab, setActiveTab] = useState<"send" | "batch">("send");

  return (
    <div className="max-w-4xl mx-auto px-8 pb-24">
      <div className="pt-16 pb-10 animate-fade-up">
        <p className="text-[10px] font-mono text-text-ghost tracking-[0.3em] uppercase mb-4">Confidential Protocol</p>
        <h1 className="text-[48px] font-editorial italic text-text-primary leading-none mb-4">
          Private <span className="text-gold">Payments</span>
        </h1>
        <p className="text-[13px] font-mono text-text-secondary max-w-xl">
          Send any ERC-20 token with encrypted amounts. Receiver gets plain tokens directly — no setup needed.
        </p>
      </div>

      <div className="flex gap-0 border-b border-border mb-10 animate-fade-up delay-1">
        {(["send", "batch"] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-5 py-2.5 text-[10px] font-mono tracking-[0.15em] uppercase transition-colors cursor-pointer border-b-2 ${
              activeTab === tab ? "border-gold text-gold" : "border-transparent text-text-ghost hover:text-text-tertiary"
            }`}>{tab}</button>
        ))}
      </div>

      {activeTab === "send" && <SendTab />}
      {activeTab === "batch" && <BatchTab />}
    </div>
  );
}

function SendTab() {
  const { isConnected, address: walletAddress } = useAccount();
  const publicClient = usePublicClient();
  const [token, setToken] = useState<TokenInfo | null>(null);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [wrapperAddr, setWrapperAddr] = useState<string | null>(null);

  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();
  const erc20ApproveAbi = [{ inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], name: "approve", outputs: [{ type: "bool" }], stateMutability: "nonpayable", type: "function" }];

  useEffect(() => {
    if (!token || !publicClient) { setWrapperAddr(null); return; }
    publicClient.readContract({ address: WRAPPER_FACTORY_ADDRESS as `0x${string}`, abi: factoryAbi, functionName: "getWrapper", args: [token.address as `0x${string}`] })
      .then(a => { const s = a as string; setWrapperAddr(s === "0x0000000000000000000000000000000000000000" ? null : s); })
      .catch(() => setWrapperAddr(null));
  }, [token, publicClient]);

  const handleSend = async () => {
    if (!token || !recipient || !amount || !publicClient || !walletAddress) return;
    setError(null); setTxHash(null);
    const rawAmount = parseUnits(amount, token.decimals);

    try {
      const bal = await publicClient.readContract({ address: token.address as `0x${string}`, abi: ERC20_BALANCE_ABI, functionName: "balanceOf", args: [walletAddress] });
      if (BigInt(bal.toString()) < rawAmount) { setError(`Insufficient ${token.symbol} balance.`); return; }
    } catch { /* expected */ }
    if (!wrapperAddr) { setError("No confidential wrapper for this token. Create one in the Registry first."); return; }

    try {
      setStep(1);
      const allowanceAbi = [{ inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], name: "allowance", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" }] as const;
      let needsApprove = true;
      try {
        const a = await publicClient.readContract({ address: token.address as `0x${string}`, abi: allowanceAbi, functionName: "allowance", args: [walletAddress as `0x${string}`, ROUTER_V2_ADDRESS as `0x${string}`] }) as bigint;
        needsApprove = a < rawAmount;
      } catch { /* expected */ }

      if (needsApprove) {
        setStatus("Approving (one-time for this token)...");
        const ah = await writeContractAsync({ address: token.address as `0x${string}`, abi: erc20ApproveAbi, functionName: "approve", args: [ROUTER_V2_ADDRESS as `0x${string}`, 115792089237316195423570985008687907853269984665640564039457584007913129639935n], gas: 80000n });
        await publicClient.waitForTransactionReceipt({ hash: ah });
      }

      setStep(2);
      setStatus("Encrypting & sending...");
      const cd = encodeFunctionData({ abi: routerV2Abi, functionName: "send", args: [token.address as `0x${string}`, recipient as `0x${string}`, rawAmount, ""] });
      const sh = await sendTransactionAsync({ to: ROUTER_V2_ADDRESS as `0x${string}`, data: cd, value: 50000000000000n, gas: 1500000n });
      setTxHash(sh);
      setStatus("Confirming...");
      const receipt = await publicClient.waitForTransactionReceipt({ hash: sh });
      if (receipt.status === "reverted") throw new Error("Send reverted");

      let paymentId = 0n;
      for (const log of receipt.logs) {
        try { const d = decodeEventLog({ abi: routerV2Abi, data: log.data, topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]] }); if (d.eventName === "PaymentCreated") { paymentId = (d.args as { paymentId: bigint }).paymentId; break; } } catch { /* expected */ }
      }

      setStep(3);
      setStatus("Relayer delivering tokens to receiver...");
      const fr = await fetch("/api/payments/finalize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentId: Number(paymentId) }) });
      const res = await fr.json();
      if (!fr.ok && !res.alreadyDone) throw new Error(res.error || "Finalize failed");

      setStep(4);
      if (res.txHash) setTxHash(res.txHash);
      setStatus(null);
    } catch (err: unknown) { setError((err instanceof Error ? err.message : "Failed").slice(0, 300)); setStep(0); }
  };

  return (
    <div className="space-y-6 animate-fade-up delay-2">
      <div className="border border-border p-5 relative">
        <div className="absolute top-3 right-3 border border-gold/30 px-2 py-0.5">
          <span className="text-[8px] font-mono text-gold tracking-[0.2em] uppercase">FHE Encrypted</span>
        </div>
        <p className="text-[9px] font-mono text-text-ghost tracking-[0.2em] uppercase mb-3">How It Works</p>
        <div className="grid grid-cols-3 gap-5">
          {[["1", "Approve", "One-time token approval"], ["2", "Encrypt & Send", "FHE wraps + transfers"], ["3", "Auto-deliver", "Relayer sends plain tokens"]].map(([n, title, desc]) => (
            <div key={n}>
              <p className="text-[16px] font-editorial italic text-gold mb-1">{n}.</p>
              <p className="text-[10px] font-mono text-text-secondary mb-0.5">{title}</p>
              <p className="text-[8px] font-mono text-text-ghost">{desc}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="border border-border p-5 space-y-5">
        <TokenSelector selected={token} onSelect={setToken} />

        {token && (
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${wrapperAddr ? "bg-green-400" : "bg-danger"}`} />
            <p className="text-[9px] font-mono text-text-ghost">
              {wrapperAddr ? <>Wrapper: <span className="text-text-secondary">c{token.symbol}</span> at {shortenAddress(wrapperAddr)}</> : "No wrapper — create one in the Registry first"}
            </p>
          </div>
        )}

        <div>
          <p className="text-[9px] font-mono text-text-ghost tracking-[0.2em] uppercase mb-2">Recipient</p>
          <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="0x..." className="input-field text-[12px]" />
        </div>

        <div>
          <p className="text-[9px] font-mono text-text-ghost tracking-[0.2em] uppercase mb-2">Amount</p>
          <input type="text" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={`0.0 ${token?.symbol || ""}`} className="input-field text-[12px]" />
          <BalanceBar token={token} onSetAmount={setAmount} />
        </div>
      </div>

      {step > 0 && step < 4 && (
        <div className="border border-border p-5 space-y-3 animate-fade-up">
          <div className="flex justify-between text-[10px] font-mono">
            <span className="text-text-ghost">Progress</span>
            <span className="text-gold">{step}/3</span>
          </div>
          <div className="w-full bg-surface-2 h-1">
            <div className="bg-gold h-1 transition-all" style={{ width: `${(step / 3) * 100}%` }} />
          </div>
          {status && <p className="text-[10px] font-mono text-text-tertiary">{status}</p>}
        </div>
      )}

      {step === 4 && (
        <div className="border border-gold/20 bg-gold-glow p-6 space-y-4 animate-fade-up">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
            <p className="text-[13px] font-mono text-green-400">Payment complete</p>
          </div>
          <p className="text-[11px] font-mono text-text-secondary">
            {amount} {token?.symbol} sent to {shortenAddress(recipient)} — encrypted on-chain, plain tokens delivered.
          </p>
          <div className="grid grid-cols-3 border border-border">
            {[["Encrypted", "Transfer amount: 0"], ["Verified", "KMS proof validated"], ["Delivered", `Plain ${token?.symbol} to receiver`]].map(([label, value]) => (
              <div key={label} className="px-4 py-3 border-r border-border last:border-r-0">
                <p className="text-[8px] font-mono text-text-ghost tracking-[0.2em] uppercase mb-0.5">{label}</p>
                <p className="text-[10px] font-mono text-text-secondary">{value}</p>
              </div>
            ))}
          </div>
          {txHash && <a href={getExplorerTxUrl(txHash)} target="_blank" rel="noopener noreferrer" className="text-[9px] font-mono text-gold hover:text-gold-dim transition-colors cursor-pointer tracking-wide uppercase">View on Etherscan &rarr;</a>}
          <button onClick={() => { setStep(0); setStatus(null); setAmount(""); setRecipient(""); setError(null); setTxHash(null); }}
            className="text-[9px] font-mono text-text-ghost hover:text-text-tertiary cursor-pointer tracking-wider uppercase">Send Another</button>
        </div>
      )}

      {error && <div className="border-l-2 border-danger pl-3 py-2"><p className="text-[10px] font-mono text-danger">{error}</p></div>}

      {step === 0 && (
        <button onClick={handleSend} disabled={!isConnected || !token || !recipient || !amount || !wrapperAddr}
          className="w-full py-3 bg-gold hover:bg-gold-dim disabled:bg-surface-2 disabled:text-text-ghost text-background text-[11px] font-mono font-semibold tracking-[0.15em] uppercase transition-colors cursor-pointer">
          {!isConnected ? "Connect Wallet" : !wrapperAddr && token ? "Wrapper Required" : `Send ${amount || "0"} ${token?.symbol || "tokens"} Encrypted`}
        </button>
      )}
    </div>
  );
}

function BatchTab() {
  const { isConnected, address: walletAddress } = useAccount();
  const publicClient = usePublicClient();
  const [token, setToken] = useState<TokenInfo | null>(null);
  const [rows, setRows] = useState([{ address: "", amount: "" }, { address: "", amount: "" }, { address: "", amount: "" }]);
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wrapperAddr, setWrapperAddr] = useState<string | null>(null);

  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();
  const erc20ApproveAbi = [{ inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], name: "approve", outputs: [{ type: "bool" }], stateMutability: "nonpayable", type: "function" }];

  useEffect(() => {
    if (!token || !publicClient) { setWrapperAddr(null); return; }
    publicClient.readContract({ address: WRAPPER_FACTORY_ADDRESS as `0x${string}`, abi: factoryAbi, functionName: "getWrapper", args: [token.address as `0x${string}`] })
      .then(a => { const s = a as string; setWrapperAddr(s === "0x0000000000000000000000000000000000000000" ? null : s); })
      .catch(() => setWrapperAddr(null));
  }, [token, publicClient]);

  const updateRow = (i: number, field: string, value: string) => setRows(r => r.map((row, idx) => idx === i ? { ...row, [field]: value } : row));
  const validRows = rows.filter(r => r.address.length === 42 && r.amount);
  const totalAmount = validRows.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);

  const handleBatch = async () => {
    if (!token || validRows.length === 0 || !publicClient || !walletAddress || !wrapperAddr) return;
    setError(null);
    const totalSteps = validRows.length * 2 + 1;
    try {
      setStep(1);
      const totalRaw = validRows.reduce((sum, r) => sum + parseUnits(r.amount, token.decimals), 0n);
      setStatus("Approving...");
      const ah = await writeContractAsync({ address: token.address as `0x${string}`, abi: erc20ApproveAbi, functionName: "approve", args: [ROUTER_V2_ADDRESS as `0x${string}`, totalRaw], gas: 80000n });
      await publicClient.waitForTransactionReceipt({ hash: ah });

      for (let i = 0; i < validRows.length; i++) {
        const row = validRows[i];
        setStep(2 + i * 2); setStatus(`Encrypting & sending to ${shortenAddress(row.address)} (${i + 1}/${validRows.length})...`);
        const cd = encodeFunctionData({ abi: routerV2Abi, functionName: "send", args: [token.address as `0x${string}`, row.address as `0x${string}`, parseUnits(row.amount, token.decimals), ""] });
        const sh = await sendTransactionAsync({ to: ROUTER_V2_ADDRESS as `0x${string}`, data: cd, value: 50000000000000n, gas: 1500000n });
        const receipt = await publicClient.waitForTransactionReceipt({ hash: sh });
        if (receipt.status === "reverted") throw new Error(`Send to ${shortenAddress(row.address)} reverted`);

        let paymentId = 0;
        for (const log of receipt.logs) { try { const d = decodeEventLog({ abi: routerV2Abi, data: log.data, topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]] }); if (d.eventName === "PaymentCreated") { paymentId = Number((d.args as { paymentId: bigint }).paymentId); break; } } catch { /* expected */ } }

        setStep(3 + i * 2); setStatus(`Delivering to ${shortenAddress(row.address)} (${i + 1}/${validRows.length})...`);
        const resp = await fetch("/api/payments/finalize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentId }) });
        const r = await resp.json();
        if (!resp.ok && !r.alreadyDone) throw new Error(`Finalize failed: ${r.error}`);
      }
      setStep(totalSteps + 1); setStatus(null);
    } catch (err: unknown) { setError((err instanceof Error ? err.message : "Failed").slice(0, 300)); setStep(0); }
  };

  const isDone = step > 0 && !status && !error;

  return (
    <div className="space-y-6 animate-fade-up delay-2">
      <div className="border border-border p-5">
        <p className="text-[9px] font-mono text-text-ghost tracking-[0.2em] uppercase mb-2">Batch Payments</p>
        <p className="text-[10px] font-mono text-text-secondary">Pay multiple recipients. Each payment is encrypted separately.</p>
      </div>

      <div className="border border-border p-5 space-y-5">
        <TokenSelector selected={token} onSelect={setToken} />
        <BalanceBar token={token} onSetAmount={() => {}} />
      </div>

      <div className="border border-border overflow-hidden">
        <div className="grid grid-cols-12 px-5 py-2.5 border-b border-border">
          <div className="col-span-1 text-[8px] font-mono text-text-ghost tracking-[0.2em] uppercase">#</div>
          <div className="col-span-7 text-[8px] font-mono text-text-ghost tracking-[0.2em] uppercase">Recipient</div>
          <div className="col-span-3 text-[8px] font-mono text-text-ghost tracking-[0.2em] uppercase">Amount</div>
          <div className="col-span-1"></div>
        </div>
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-12 px-5 py-2.5 border-b border-border last:border-b-0 gap-2 items-center hover:bg-gold-glow transition-all">
            <div className="col-span-1 text-[10px] font-mono text-text-ghost">{i + 1}</div>
            <div className="col-span-7"><input type="text" value={row.address} onChange={(e) => updateRow(i, "address", e.target.value)} placeholder="0x..." className="w-full bg-transparent text-[10px] font-mono text-text-secondary outline-none border-b border-transparent focus:border-gold" /></div>
            <div className="col-span-3"><input type="text" value={row.amount} onChange={(e) => updateRow(i, "amount", e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" className="w-full bg-transparent text-[10px] font-mono text-text-secondary outline-none border-b border-transparent focus:border-gold" /></div>
            <div className="col-span-1 text-right">{rows.length > 1 && <button onClick={() => setRows(r => r.filter((_, idx) => idx !== i))} className="text-[9px] font-mono text-text-ghost hover:text-danger cursor-pointer">&#10005;</button>}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <button onClick={() => setRows(r => [...r, { address: "", amount: "" }])} className="text-[9px] font-mono text-gold hover:text-gold-dim cursor-pointer tracking-wide uppercase">+ Add Row</button>
        <span className="text-[9px] font-mono text-text-ghost">{validRows.length} recipient{validRows.length !== 1 ? "s" : ""} — {totalAmount} {token?.symbol || ""}</span>
      </div>

      {step > 0 && !isDone && (
        <div className="border border-border p-5 space-y-2">
          <div className="w-full bg-surface-2 h-1"><div className="bg-gold h-1 transition-all" style={{ width: `${Math.min((step / (validRows.length * 2 + 1)) * 100, 100)}%` }} /></div>
          {status && <p className="text-[10px] font-mono text-text-tertiary">{status}</p>}
        </div>
      )}

      {isDone && (
        <div className="border border-gold/20 bg-gold-glow p-6 space-y-3 animate-fade-up">
          <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-green-400" /><p className="text-[13px] font-mono text-green-400">Batch complete</p></div>
          <p className="text-[11px] font-mono text-text-secondary">{validRows.length} payments sent with encrypted amounts.</p>
          <button onClick={() => { setStep(0); setStatus(null); setError(null); setRows([{ address: "", amount: "" }, { address: "", amount: "" }, { address: "", amount: "" }]); }}
            className="text-[9px] font-mono text-text-ghost hover:text-text-tertiary cursor-pointer tracking-wider uppercase">New Batch</button>
        </div>
      )}

      {error && <div className="border-l-2 border-danger pl-3 py-2"><p className="text-[10px] font-mono text-danger">{error}</p></div>}

      {step === 0 && (
        <button onClick={handleBatch} disabled={!isConnected || validRows.length === 0 || !token || !wrapperAddr}
          className="w-full py-3 bg-gold hover:bg-gold-dim disabled:bg-surface-2 disabled:text-text-ghost text-background text-[11px] font-mono font-semibold tracking-[0.15em] uppercase transition-colors cursor-pointer">
          {!isConnected ? "Connect Wallet" : `Pay ${validRows.length} Recipients Encrypted`}
        </button>
      )}
    </div>
  );
}
