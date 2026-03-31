"use client";

import { use } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from "wagmi";
import { useState, useEffect } from "react";
import { PAYMENTS_ADDRESS, shortenAddress, getExplorerTxUrl, TOKEN_DECIMALS } from "@/lib/constants";
import paymentsAbi from "@/lib/abi/ConfidentialPayments.json";
import Link from "next/link";

export default function PayPage({ params }: { params: Promise<{ txHash: string }> }) {
  const { txHash } = use(params);
  const { isConnected } = useAccount();
  const publicClient = usePublicClient();

  const [linkData, setLinkData] = useState<{
    linkId: string;
    token: string;
    merchant: string;
    amount: bigint;
    memo: string;
    expiry: bigint;
    paid: boolean;
    cancelled: boolean;
    tokenName: string;
    tokenSymbol: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { data: payHash, writeContractAsync, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: paySuccess } = useWaitForTransactionReceipt({ hash: payHash });

  useEffect(() => {
    if (!publicClient || !txHash) return;

    (async () => {
      try {
        setLoading(true);
        const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });

        if (!receipt) {
          setError("Transaction not found");
          return;
        }

        let linkId: string | null = null;

        for (const log of receipt.logs) {
          if (log.address.toLowerCase() === PAYMENTS_ADDRESS.toLowerCase() && log.topics.length >= 3) {
            linkId = log.topics[1] as string;
            break;
          }
        }

        if (!linkId) {
          setError("Could not find payment link in transaction");
          return;
        }

        const result = await publicClient.readContract({
          address: PAYMENTS_ADDRESS as `0x${string}`,
          abi: paymentsAbi,
          functionName: "getLink",
          args: [linkId],
        });

        const [token, merchant, amount, memo, expiry, paid, cancelled] = result as [string, string, bigint, string, bigint, boolean, boolean, string, bigint];

        const tokenAbi = [
          { inputs: [], name: "name", outputs: [{ type: "string" }], stateMutability: "view", type: "function" },
          { inputs: [], name: "symbol", outputs: [{ type: "string" }], stateMutability: "view", type: "function" },
        ];
        const [tokenName, tokenSymbol] = await Promise.all([
          publicClient.readContract({ address: token as `0x${string}`, abi: tokenAbi, functionName: "name" }),
          publicClient.readContract({ address: token as `0x${string}`, abi: tokenAbi, functionName: "symbol" }),
        ]);

        setLinkData({
          linkId,
          token,
          merchant,
          amount,
          memo,
          expiry,
          paid,
          cancelled,
          tokenName: tokenName as string,
          tokenSymbol: tokenSymbol as string,
        });
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load payment link");
      } finally {
        setLoading(false);
      }
    })();
  }, [publicClient, txHash]);

  const handlePay = async () => {
    if (!linkData) return;
    try {
      await writeContractAsync({
        address: PAYMENTS_ADDRESS as `0x${string}`,
        abi: paymentsAbi,
        functionName: "payLink",
        args: [linkData.linkId as `0x${string}`],
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message.slice(0, 150) : "Payment failed");
    }
  };

  if (loading) {
    return (
      <div className="max-w-lg mx-auto px-8 py-24 text-center">
        <p className="text-[11px] font-mono text-text-ghost animate-pulse">Loading payment link...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-lg mx-auto px-8 py-24 text-center space-y-4">
        <p className="text-[11px] font-mono text-red-400">{error}</p>
        <Link href="/" className="text-[10px] font-mono text-text-ghost hover:text-gold transition-colors cursor-pointer">
          &larr; Back to Registry
        </Link>
      </div>
    );
  }

  if (!linkData) return null;

  const displayAmount = Number(linkData.amount) / 10 ** TOKEN_DECIMALS;
  const isExpired = linkData.expiry > 0n && BigInt(Math.floor(Date.now() / 1000)) > linkData.expiry;

  if (paySuccess) {
    return (
      <div className="max-w-lg mx-auto px-8 py-16">
        <div className="border border-gold/30 p-8 text-center space-y-6">
          <div className="w-16 h-16 mx-auto border border-gold/30 flex items-center justify-center">
            <span className="text-gold text-[24px]">&#10003;</span>
          </div>
          <p className="text-[10px] font-mono text-text-ghost tracking-[0.3em] uppercase">Payment Successful</p>
          <p className="text-[20px] font-editorial italic text-gold">
            {displayAmount} {linkData.tokenSymbol}
          </p>
          <p className="text-[11px] font-mono text-text-tertiary">
            Sent to {shortenAddress(linkData.merchant)}
          </p>
          <p className="text-[10px] font-mono text-text-ghost">
            Amount encrypted on-chain via FHE. Only the recipient can see the balance change.
          </p>
          {payHash && (
            <a href={getExplorerTxUrl(payHash)} target="_blank" rel="noopener noreferrer"
              className="inline-block text-[10px] font-mono text-gold hover:text-gold-dim transition-colors tracking-wide uppercase cursor-pointer">
              View on Etherscan &rarr;
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-8 py-16">
      <Link href="/" className="text-[10px] font-mono text-text-ghost tracking-[0.2em] uppercase hover:text-text-tertiary transition-colors cursor-pointer">
        &larr; HideMe
      </Link>

      <div className="mt-8 border border-border">
        <div className="px-6 py-4 border-b border-border">
          <p className="text-[9px] font-mono text-text-ghost tracking-[0.3em] uppercase mb-1">
            Payment Request
          </p>
          <p className="text-[24px] font-editorial italic text-gold">
            {displayAmount} <span className="text-[14px] text-text-tertiary">{linkData.tokenSymbol}</span>
          </p>
        </div>

        <div className="divide-y divide-border">
          {linkData.memo && (
            <div className="px-6 py-3 flex justify-between">
              <span className="text-[9px] font-mono text-text-ghost tracking-[0.15em] uppercase">Memo</span>
              <span className="text-[11px] font-mono text-text-secondary">{linkData.memo}</span>
            </div>
          )}
          <div className="px-6 py-3 flex justify-between">
            <span className="text-[9px] font-mono text-text-ghost tracking-[0.15em] uppercase">Token</span>
            <span className="text-[11px] font-mono text-text-secondary">{linkData.tokenName}</span>
          </div>
          <div className="px-6 py-3 flex justify-between">
            <span className="text-[9px] font-mono text-text-ghost tracking-[0.15em] uppercase">To</span>
            <span className="text-[11px] font-mono text-text-secondary">{shortenAddress(linkData.merchant)}</span>
          </div>
          {linkData.expiry > 0n && (
            <div className="px-6 py-3 flex justify-between">
              <span className="text-[9px] font-mono text-text-ghost tracking-[0.15em] uppercase">Expires</span>
              <span className={`text-[11px] font-mono ${isExpired ? "text-red-400" : "text-text-secondary"}`}>
                {new Date(Number(linkData.expiry) * 1000).toLocaleString()}
              </span>
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-border">
          <p className="text-[9px] font-mono text-text-ghost leading-relaxed">
            This payment uses Fully Homomorphic Encryption. The transfer amount encrypts on-chain —
            only you and the recipient can see the balance change.
          </p>
        </div>

        <div className="px-6 py-4 border-t border-border">
          {linkData.paid ? (
            <div className="text-center py-2">
              <span className="text-[11px] font-mono text-green-400">Already Paid</span>
            </div>
          ) : linkData.cancelled ? (
            <div className="text-center py-2">
              <span className="text-[11px] font-mono text-red-400">Cancelled</span>
            </div>
          ) : isExpired ? (
            <div className="text-center py-2">
              <span className="text-[11px] font-mono text-red-400">Expired</span>
            </div>
          ) : (
            <button
              onClick={handlePay}
              disabled={!isConnected || isPending || isConfirming}
              className="w-full py-3 bg-gold hover:bg-gold-dim disabled:bg-surface-2 disabled:text-text-ghost text-background text-[11px] font-mono font-semibold tracking-[0.15em] uppercase transition-colors cursor-pointer"
            >
              {!isConnected
                ? "Connect Wallet to Pay"
                : isPending
                  ? "Confirm in Wallet..."
                  : isConfirming
                    ? "Processing..."
                    : `Pay ${displayAmount} ${linkData.tokenSymbol}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
