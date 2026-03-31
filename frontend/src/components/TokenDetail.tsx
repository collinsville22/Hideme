"use client";

import { useState, useEffect, useCallback } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useWalletClient,
  usePublicClient,
} from "wagmi";
import tokenAbi from "@/lib/abi/HideMeToken.json";
import factoryAbi from "@/lib/abi/HideMeFactory.json";
import {
  shortenAddress,
  formatTokenAmount,
  getExplorerUrl,
  getExplorerTxUrl,
  TOKEN_DECIMALS,
  parseTokenAmount,
  FACTORY_ADDRESS,
} from "@/lib/constants";
import { encryptAmount, decryptUserBalance } from "@/lib/fhevm";
import Link from "next/link";

interface TokenDetailProps {
  address: string;
}

interface TransferEvent {
  from: string;
  to: string;
  txHash: string;
  blockNumber: number;
}

export function TokenDetail({ address }: TokenDetailProps) {
  const { address: userAddress, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [activePanel, setActivePanel] = useState<
    "transfer" | "mint" | "burn" | "observers" | "history" | null
  >(null);

  const [burnAmount, setBurnAmount] = useState("");

  const [showRenounceConfirm, setShowRenounceConfirm] = useState(false);

  const [transferTo, setTransferTo] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferStatus, setTransferStatus] = useState<string | null>(null);
  const [isEncrypting, setIsEncrypting] = useState(false);

  const [mintTo, setMintTo] = useState("");
  const [mintAmount, setMintAmount] = useState("");

  const [decryptedBalance, setDecryptedBalance] = useState<bigint | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decryptError, setDecryptError] = useState<string | null>(null);

  const [transfers, setTransfers] = useState<TransferEvent[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const tokenAddr = address as `0x${string}`;

  const { data: nameData } = useReadContract({ address: tokenAddr, abi: tokenAbi, functionName: "name" });
  const { data: symbolData } = useReadContract({ address: tokenAddr, abi: tokenAbi, functionName: "symbol" });
  const { data: totalSupplyData } = useReadContract({ address: tokenAddr, abi: tokenAbi, functionName: "totalSupply" });
  const { data: ownerData } = useReadContract({ address: tokenAddr, abi: tokenAbi, functionName: "owner" });
  const { data: observersData } = useReadContract({ address: tokenAddr, abi: tokenAbi, functionName: "getObservers" });
  const { data: mintableData } = useReadContract({ address: tokenAddr, abi: tokenAbi, functionName: "mintable" });
  const { data: burnableData } = useReadContract({ address: tokenAddr, abi: tokenAbi, functionName: "burnable" });
  const { data: maxSupplyData } = useReadContract({ address: tokenAddr, abi: tokenAbi, functionName: "maxSupply" });

  const { data: tokenInfoData } = useReadContract({
    address: FACTORY_ADDRESS as `0x${string}`,
    abi: factoryAbi,
    functionName: "tokenInfo",
    args: [tokenAddr],
  });
  const tokenMetaArr = tokenInfoData as unknown[] | undefined;
  const tokenMeta = tokenMetaArr ? {
    description: tokenMetaArr[9] as string,
    logoUri: tokenMetaArr[10] as string,
    website: tokenMetaArr[11] as string,
  } : null;
  const { data: balanceHandleData, refetch: refetchBalance } = useReadContract({
    address: tokenAddr, abi: tokenAbi, functionName: "balanceOf",
    args: userAddress ? [userAddress] : undefined,
  });

  const name = nameData as string | undefined;
  const symbol = symbolData as string | undefined;
  const totalSupply = totalSupplyData as bigint | undefined;
  const owner = ownerData as string | undefined;
  const observersList = observersData as string[] | undefined;
  const isMintable = mintableData as boolean | undefined;
  const isBurnable = burnableData as boolean | undefined;
  const maxSupplyVal = maxSupplyData as bigint | undefined;
  const ownerRenounced = owner === "0x0000000000000000000000000000000000000000";
  const balanceHandle = balanceHandleData as string | undefined;

  const isOwner = userAddress && owner && owner.toLowerCase() === userAddress.toLowerCase();
  const hasBalance = balanceHandle && balanceHandle !== "0x0000000000000000000000000000000000000000000000000000000000000000";

  const { data: mintHash, writeContract: writeMint, isPending: mintPending } = useWriteContract();
  const { isLoading: mintConfirming, isSuccess: mintSuccess } = useWaitForTransactionReceipt({ hash: mintHash });

  const { data: burnHash, writeContract: writeBurn, isPending: burnPending } = useWriteContract();
  const { isLoading: burnConfirming, isSuccess: burnSuccess } = useWaitForTransactionReceipt({ hash: burnHash });

  const handleBurn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!burnAmount) return;
    const rawAmount = parseTokenAmount(burnAmount);
    writeBurn({
      address: tokenAddr, abi: tokenAbi, functionName: "burn",
      args: [rawAmount],
    });
  };

  const { data: renounceHash, writeContract: writeRenounce, isPending: renouncePending } = useWriteContract();
  const { isLoading: renounceConfirming, isSuccess: renounceSuccess } = useWaitForTransactionReceipt({ hash: renounceHash });

  const handleMint = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mintTo || !mintAmount) return;
    const rawAmount = parseTokenAmount(mintAmount);
    writeMint({
      address: tokenAddr, abi: tokenAbi, functionName: "mint",
      args: [mintTo as `0x${string}`, rawAmount],
    });
  };

  const [usePlaintext, setUsePlaintext] = useState(false);
  const { data: transferHash, writeContractAsync: writeTransferAsync, isPending: transferPending } = useWriteContract();
  const { isLoading: transferConfirming, isSuccess: transferSuccess } = useWaitForTransactionReceipt({ hash: transferHash });

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferTo || !transferAmount || !userAddress) return;
    setTransferStatus(null);

    try {
      const amountBigInt = parseTokenAmount(transferAmount);

      if (usePlaintext) {
        setTransferStatus("Confirm in wallet...");
        await writeTransferAsync({
          address: tokenAddr,
          abi: tokenAbi,
          functionName: "transferPlaintext",
          args: [transferTo as `0x${string}`, amountBigInt],
        });
        setTransferStatus("Confirming on-chain...");
      } else {
        setIsEncrypting(true);
        setTransferStatus("Encrypting amount (first time downloads 4.5MB key)...");

        const { handle, inputProof } = await encryptAmount(
          tokenAddr,
          userAddress,
          amountBigInt,
        );

        setIsEncrypting(false);

        setTransferStatus("Confirm in wallet...");
        await writeTransferAsync({
          address: tokenAddr,
          abi: tokenAbi,
          functionName: "transfer",
          args: [transferTo as `0x${string}`, handle, inputProof],
        });
        setTransferStatus("Confirming on-chain...");
      }
    } catch (err: unknown) {
      setIsEncrypting(false);
      const msg = err instanceof Error ? err.message : "Transfer failed";
      setTransferStatus(msg.slice(0, 300));
    }
  };

  const handleDecrypt = async () => {
    if (!walletClient || !publicClient) {
      setDecryptError("Wallet not connected. Please connect your wallet first.");
      return;
    }
    setIsDecrypting(true);
    setDecryptError(null);
    setDecryptedBalance(null);

    try {
      const freshHandle = await publicClient.readContract({
        address: tokenAddr,
        abi: tokenAbi,
        functionName: "balanceOf",
        args: [userAddress as `0x${string}`],
        blockTag: "latest",
      }) as string;

      const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";
      if (!freshHandle || freshHandle === ZERO) {
        setDecryptError("No encrypted balance found for your address.");
        setIsDecrypting(false);
        return;
      }

      const clearValue = await decryptUserBalance(
        address,
        freshHandle,
        walletClient as Parameters<typeof decryptUserBalance>[2],
      );
      setDecryptedBalance(clearValue);
      refetchBalance();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Decryption failed";
      setDecryptError(msg.slice(0, 500));
    } finally {
      setIsDecrypting(false);
    }
  };

  const loadHistory = useCallback(async () => {
    if (!publicClient) return;
    setLoadingHistory(true);
    try {
      const logs = await publicClient.getLogs({
        address: tokenAddr,
        event: {
          type: "event",
          name: "Transfer",
          inputs: [
            { type: "address", name: "from", indexed: true },
            { type: "address", name: "to", indexed: true },
            { type: "uint256", name: "amount", indexed: false },
          ],
        },
        fromBlock: "earliest",
        toBlock: "latest",
      });

      const events: TransferEvent[] = logs.map((log) => ({
        from: log.args.from as string,
        to: log.args.to as string,
        txHash: log.transactionHash,
        blockNumber: Number(log.blockNumber),
      })).reverse();

      setTransfers(events);
    } catch { /* expected */
      setTransfers([]);
    } finally {
      setLoadingHistory(false);
    }
  }, [publicClient, tokenAddr]);

  useEffect(() => {
    if (activePanel === "history") {
      loadHistory();
    }
  }, [activePanel, loadHistory]);

  return (
    <div className="px-8 py-12 animate-fade-up max-w-4xl mx-auto">
      <Link
        href="/"
        className="text-[10px] font-mono text-text-ghost tracking-[0.2em] uppercase hover:text-text-tertiary transition-colors cursor-pointer"
      >
        &larr; Registry
      </Link>

      <div className="mt-8 mb-10 flex items-start gap-5">
        <div className="w-14 h-14 flex-shrink-0 border border-gold/30 flex items-center justify-center bg-gold-glow overflow-hidden">
          {tokenMeta?.logoUri ? (
            <img src={tokenMeta.logoUri} alt={symbol || ""} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          ) : (
            <span className="text-[20px] font-editorial italic text-gold">
              {symbol?.slice(0, 3) || "?"}
            </span>
          )}
        </div>
        <div>
          <h1 className="text-[28px] font-editorial italic text-text-primary leading-none">
            {name || "Loading..."}
          </h1>
          <p className="text-[11px] font-mono text-text-ghost tracking-[0.15em] uppercase mt-1.5">
            {symbol} &middot; {shortenAddress(address)}
          </p>
          {tokenMeta?.description && (
            <p className="text-[11px] font-mono text-text-tertiary mt-2 max-w-md">
              {tokenMeta.description}
            </p>
          )}
          {tokenMeta?.website && (
            <a href={tokenMeta.website} target="_blank" rel="noopener noreferrer"
              className="text-[10px] font-mono text-gold hover:text-gold-dim transition-colors mt-1 inline-block cursor-pointer">
              {tokenMeta.website} &rarr;
            </a>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {isMintable === false && (
          <span className="border border-green-500/30 text-green-400 px-2 py-0.5 text-[8px] font-mono tracking-wider uppercase">Fixed Supply</span>
        )}
        {isMintable === true && (
          <span className="border border-yellow-500/30 text-yellow-400 px-2 py-0.5 text-[8px] font-mono tracking-wider uppercase">Mintable</span>
        )}
        {isBurnable && (
          <span className="border border-green-500/30 text-green-400 px-2 py-0.5 text-[8px] font-mono tracking-wider uppercase">Burnable</span>
        )}
        {ownerRenounced && (
          <span className="border border-green-500/30 text-green-400 px-2 py-0.5 text-[8px] font-mono tracking-wider uppercase">Ownership Renounced</span>
        )}
        {maxSupplyVal && maxSupplyVal > 0n && (
          <span className="border border-border text-text-ghost px-2 py-0.5 text-[8px] font-mono tracking-wider uppercase">Max: {formatTokenAmount(maxSupplyVal)}</span>
        )}
        <span className="border border-green-500/30 text-green-400 px-2 py-0.5 text-[8px] font-mono tracking-wider uppercase">No Pause</span>
        <span className="border border-green-500/30 text-green-400 px-2 py-0.5 text-[8px] font-mono tracking-wider uppercase">No Blacklist</span>
      </div>

      <div className="border border-border mb-8 overflow-x-auto">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 min-w-0">
          <MetaCell label="Contract" value={shortenAddress(address)} />
          <MetaCell label="Owner" value={ownerRenounced ? "Renounced" : owner ? shortenAddress(owner) : "..."} />
          <MetaCell label="Supply" value={totalSupply !== undefined ? formatTokenAmount(totalSupply) : "..."} />
          <MetaCell label="Decimals" value={String(TOKEN_DECIMALS)} />
          <MetaCell label="Encryption" value="TFHE-128" />
          <MetaCell label="Observers" value={observersList ? String(observersList.length) : "0"} />
        </div>
      </div>

      {isConnected && (
        <div className="border border-border mb-8">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <span className="text-[9px] font-mono text-text-ghost tracking-[0.2em] uppercase">
              Your Encrypted Balance
            </span>
            {hasBalance && <div className="w-1.5 h-1.5 bg-gold animate-pulse-gold" />}
          </div>
          <div className="px-5 py-4">
            {hasBalance ? (
              <div>
                {decryptedBalance !== null ? (
                  <div className="mb-4">
                    <p className="text-[9px] font-mono text-text-ghost tracking-[0.2em] uppercase mb-1">
                      Decrypted Balance
                    </p>
                    <p className="text-[24px] font-editorial italic text-gold">
                      {formatTokenAmount(decryptedBalance)}
                      <span className="text-[13px] text-text-tertiary ml-2 font-mono not-italic">
                        {symbol}
                      </span>
                    </p>
                  </div>
                ) : null}

                <code className="text-[10px] font-mono text-text-ghost break-all leading-relaxed block mb-3">
                  {balanceHandle}
                </code>

                {decryptError && (
                  <div className="border-l-2 border-danger pl-3 py-1 mb-3">
                    <p className="text-[10px] font-mono text-danger">{decryptError}</p>
                  </div>
                )}

                <div className="border-t border-border pt-3 flex items-center justify-between">
                  <p className="text-[10px] font-mono text-text-ghost">
                    Ciphertext handle &mdash; decrypt via EIP-712 signature
                  </p>
                  <button
                    onClick={handleDecrypt}
                    disabled={isDecrypting}
                    className="text-[10px] font-mono text-gold hover:text-gold-dim disabled:text-text-ghost transition-colors cursor-pointer tracking-wide uppercase"
                  >
                    {isDecrypting ? "Decrypting (sign in wallet)..." : decryptedBalance !== null ? "Refresh" : "Decrypt"} &rarr;
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-[11px] font-mono text-text-ghost">
                No balance found for connected address.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-0 border-b border-border mb-0">
        <ActionTab label="Transfer" active={activePanel === "transfer"} onClick={() => setActivePanel(activePanel === "transfer" ? null : "transfer")} />
        {isOwner && isMintable && <ActionTab label="Mint" active={activePanel === "mint"} onClick={() => setActivePanel(activePanel === "mint" ? null : "mint")} />}
        {isBurnable && <ActionTab label="Burn" active={activePanel === "burn"} onClick={() => setActivePanel(activePanel === "burn" ? null : "burn")} />}
        <ActionTab label={`Observers (${observersList?.length || 0})`} active={activePanel === "observers"} onClick={() => setActivePanel(activePanel === "observers" ? null : "observers")} />
        <ActionTab label="History" active={activePanel === "history"} onClick={() => setActivePanel(activePanel === "history" ? null : "history")} />
      </div>

      {activePanel === "transfer" && (
        <form onSubmit={handleTransfer} className="border border-t-0 border-border p-5 animate-slide-down space-y-4">
          <input
            type="text"
            value={transferTo}
            onChange={(e) => setTransferTo(e.target.value)}
            placeholder="Recipient address (0x...)"
            className="input-field text-[12px]"
          />
          <input
            type="text"
            value={transferAmount}
            onChange={(e) => setTransferAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder={`Amount (e.g. 1.5 = 1,500,000 raw with ${TOKEN_DECIMALS} decimals)`}
            className="input-field text-[12px]"
          />

          <div className="flex items-center gap-3 border border-border p-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={usePlaintext} onChange={() => setUsePlaintext(!usePlaintext)} className="accent-gold w-3.5 h-3.5" />
              <span className="text-[10px] font-mono text-text-ghost">Use on-chain encryption</span>
            </label>
            <p className="text-[8px] font-mono text-text-ghost/50">
              {usePlaintext
                ? "Amount visible in tx calldata but encryption happens on-chain (more reliable)"
                : "Amount encrypted client-side via TFHE WASM (amount hidden in calldata)"}
            </p>
          </div>

          {transferStatus && (
            <div className={`text-[11px] font-mono ${transferSuccess ? "text-gold" : transferStatus.includes("fail") || transferStatus.includes("error") ? "text-danger" : "text-text-tertiary"}`}>
              {transferSuccess ? "Transfer confirmed." : transferStatus}
            </div>
          )}

          {transferSuccess && transferHash && (
            <a
              href={getExplorerTxUrl(transferHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-mono text-gold hover:text-gold-dim transition-colors cursor-pointer tracking-wide uppercase"
            >
              View transaction &nearr;
            </a>
          )}

          <button
            type="submit"
            disabled={!isConnected || transferPending || transferConfirming || isEncrypting}
            className="w-full py-2.5 bg-gold hover:bg-gold-dim disabled:bg-surface-2 disabled:text-text-ghost text-background text-[11px] font-mono font-semibold tracking-[0.15em] uppercase transition-colors cursor-pointer"
          >
            {!isConnected
              ? "Connect Wallet"
              : isEncrypting
                ? "Encrypting..."
                : transferPending
                  ? "Confirm in Wallet..."
                  : transferConfirming
                    ? "Confirming..."
                    : usePlaintext ? "Send (On-Chain Encrypt)" : "Encrypt & Send"}
          </button>
        </form>
      )}

      {activePanel === "mint" && isOwner && (
        <form onSubmit={handleMint} className="border border-t-0 border-border p-5 animate-slide-down space-y-4">
          <input
            type="text" value={mintTo} onChange={(e) => setMintTo(e.target.value)}
            placeholder="Mint to address (0x...)" className="input-field text-[12px]"
          />
          <input
            type="text" value={mintAmount}
            onChange={(e) => setMintAmount(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="Amount (e.g. 200 = 200 tokens)" className="input-field text-[12px]"
          />
          {mintSuccess && (
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-gold" />
              <p className="text-[11px] font-mono text-gold">Mint confirmed</p>
            </div>
          )}
          {mintSuccess && mintHash && (
            <a href={getExplorerTxUrl(mintHash)} target="_blank" rel="noopener noreferrer"
              className="text-[10px] font-mono text-gold hover:text-gold-dim transition-colors cursor-pointer tracking-wide uppercase">
              View transaction &nearr;
            </a>
          )}
          <button
            type="submit" disabled={mintPending || mintConfirming}
            className="w-full py-2.5 bg-gold hover:bg-gold-dim disabled:bg-surface-2 disabled:text-text-ghost text-background text-[11px] font-mono font-semibold tracking-[0.15em] uppercase transition-colors cursor-pointer"
          >
            {mintPending ? "Confirm in Wallet..." : mintConfirming ? "Minting..." : "Mint Tokens"}
          </button>
        </form>
      )}

      {activePanel === "burn" && isBurnable && (
        <form onSubmit={handleBurn} className="border border-t-0 border-border p-5 animate-slide-down space-y-4">
          <input
            type="text" value={burnAmount}
            onChange={(e) => setBurnAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="Amount to burn (e.g. 10)"
            className="input-field text-[12px]"
          />
          <p className="text-[10px] font-mono text-text-ghost">
            Burning permanently destroys tokens from your balance and reduces total supply.
          </p>
          {burnSuccess && (
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-gold" />
              <p className="text-[11px] font-mono text-gold">Burn confirmed</p>
            </div>
          )}
          {burnSuccess && burnHash && (
            <a href={getExplorerTxUrl(burnHash)} target="_blank" rel="noopener noreferrer"
              className="text-[10px] font-mono text-gold hover:text-gold-dim transition-colors cursor-pointer tracking-wide uppercase">
              View transaction &rarr;
            </a>
          )}
          <button
            type="submit" disabled={!isConnected || burnPending || burnConfirming}
            className="w-full py-2.5 bg-gold hover:bg-gold-dim disabled:bg-surface-2 disabled:text-text-ghost text-background text-[11px] font-mono font-semibold tracking-[0.15em] uppercase transition-colors cursor-pointer"
          >
            {burnPending ? "Confirm in Wallet..." : burnConfirming ? "Burning..." : "Burn Tokens"}
          </button>
        </form>
      )}

      {activePanel === "observers" && (
        <div className="border border-t-0 border-border p-5 animate-slide-down">
          {observersList && observersList.length > 0 ? (
            <div className="space-y-0">
              {observersList.map((obs, i) => (
                <div key={i} className="flex items-center justify-between py-3 border-b border-border last:border-b-0">
                  <div className="flex items-center gap-3">
                    <div className="w-1.5 h-1.5 bg-gold" />
                    <code className="text-[12px] font-mono text-text-secondary">{obs}</code>
                  </div>
                  <span className="text-[9px] font-mono text-text-ghost tracking-[0.15em] uppercase">
                    Full Decrypt Access
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] font-mono text-text-ghost">
              No compliance observers registered for this token.
            </p>
          )}
        </div>
      )}

      {activePanel === "history" && (
        <div className="border border-t-0 border-border animate-slide-down">
          {loadingHistory ? (
            <div className="p-5">
              <p className="text-[11px] font-mono text-text-ghost">Loading transfer history...</p>
            </div>
          ) : transfers.length > 0 ? (
            <div>
              <div className="hidden sm:grid grid-cols-12 px-5 py-2 border-b border-border text-[8px] font-mono text-text-ghost tracking-[0.2em] uppercase">
                <div className="col-span-1">#</div>
                <div className="col-span-3">From</div>
                <div className="col-span-3">To</div>
                <div className="col-span-2">Amount</div>
                <div className="col-span-3 text-right">Tx</div>
              </div>
              {transfers.map((tx, i) => {
                const isMint = tx.from === "0x0000000000000000000000000000000000000000";
                return (
                  <div key={i} className="border-b border-border last:border-b-0">
                    <div className="hidden sm:grid grid-cols-12 px-5 py-2.5 text-[11px] font-mono">
                      <div className="col-span-1 text-text-ghost">{transfers.length - i}</div>
                      <div className="col-span-3 text-text-secondary">
                        {isMint ? <span className="text-gold">MINT</span> : shortenAddress(tx.from)}
                      </div>
                      <div className="col-span-3 text-text-secondary">{shortenAddress(tx.to)}</div>
                      <div className="col-span-2 text-text-ghost">
                        <span className="redacted-bar w-12 inline-block" title="Encrypted" />
                      </div>
                      <div className="col-span-3 text-right">
                        <a href={getExplorerTxUrl(tx.txHash)} target="_blank" rel="noopener noreferrer"
                          className="text-text-ghost hover:text-gold transition-colors cursor-pointer">
                          {tx.txHash.slice(0, 10)}... &nearr;
                        </a>
                      </div>
                    </div>
                    <div className="sm:hidden px-4 py-3 text-[11px] font-mono space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-text-ghost">#{transfers.length - i}</span>
                        <span className={isMint ? "text-gold" : "text-text-secondary"}>
                          {isMint ? "MINT" : `${shortenAddress(tx.from)} → ${shortenAddress(tx.to)}`}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="redacted-bar w-12 inline-block" title="Encrypted" />
                        <a href={getExplorerTxUrl(tx.txHash)} target="_blank" rel="noopener noreferrer"
                          className="text-text-ghost hover:text-gold transition-colors cursor-pointer text-[10px]">
                          {tx.txHash.slice(0, 8)}... &nearr;
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-5">
              <p className="text-[11px] font-mono text-text-ghost">
                No transfers recorded yet.
              </p>
            </div>
          )}
        </div>
      )}

      {isOwner && !ownerRenounced && (
        <div className="mt-8 border border-border p-5">
          <p className="text-[9px] font-mono text-text-ghost tracking-[0.2em] uppercase mb-3">
            Owner Actions
          </p>
          {renounceSuccess ? (
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-green-400" />
              <p className="text-[11px] font-mono text-green-400">Ownership renounced permanently</p>
            </div>
          ) : !showRenounceConfirm ? (
            <button
              onClick={() => setShowRenounceConfirm(true)}
              disabled={renouncePending || renounceConfirming}
              className="text-[10px] font-mono text-red-400 border border-red-500/30 px-4 py-2 hover:bg-red-500/10 transition-colors cursor-pointer tracking-wide uppercase"
            >
              Renounce Ownership
            </button>
          ) : (
            <div className="border border-red-500/30 p-4 space-y-3 animate-fade-up">
              <p className="text-[11px] font-mono text-red-400 font-semibold">
                This is PERMANENT
              </p>
              <p className="text-[10px] font-mono text-text-ghost leading-relaxed">
                You will permanently lose all owner privileges including minting tokens
                and managing observers. This action cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowRenounceConfirm(false)}
                  className="flex-1 py-2 border border-border text-text-ghost text-[10px] font-mono tracking-wider uppercase hover:border-border-hover transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    writeRenounce({ address: tokenAddr, abi: tokenAbi, functionName: "renounceOwnership" });
                    setShowRenounceConfirm(false);
                  }}
                  disabled={renouncePending || renounceConfirming}
                  className="flex-1 py-2 bg-red-500/20 border border-red-500/30 text-red-400 text-[10px] font-mono tracking-wider uppercase hover:bg-red-500/30 transition-colors cursor-pointer"
                >
                  {renouncePending ? "Confirm in Wallet..." : renounceConfirming ? "Renouncing..." : "Confirm Renounce"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-10 border-t border-border pt-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-[9px] font-mono text-text-ghost tracking-[0.15em] uppercase mb-1">
            Contract Address
          </p>
          <code className="text-[11px] font-mono text-text-tertiary break-all">{address}</code>
        </div>
        <a
          href={getExplorerUrl(address)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 text-[10px] font-mono text-text-ghost hover:text-gold transition-colors tracking-[0.15em] uppercase cursor-pointer"
        >
          View on Etherscan &nearr;
        </a>
      </div>
    </div>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3 border-b border-r border-border">
      <p className="text-[8px] font-mono text-text-ghost tracking-[0.2em] uppercase mb-0.5">{label}</p>
      <p className="text-[12px] font-mono text-text-secondary truncate">{value}</p>
    </div>
  );
}

function ActionTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-5 py-2.5 text-[10px] font-mono tracking-[0.15em] uppercase transition-colors cursor-pointer border-b-2 ${
        active ? "border-gold text-gold" : "border-transparent text-text-ghost hover:text-text-tertiary"
      }`}
    >
      {label}
    </button>
  );
}
