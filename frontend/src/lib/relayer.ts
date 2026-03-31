export async function finalizeAsync(
  params: { type: "payment"; paymentId: number } | { type: "unwrap"; wrapperAddress: string; requestId: number },
  onStatus?: (msg: string) => void,
): Promise<{ txHash?: string; alreadyDone?: boolean }> {
  onStatus?.("Requesting KMS decryption...");
  const reqBody = params.type === "payment"
    ? { type: "payment", paymentId: params.paymentId }
    : { type: "unwrap", wrapperAddress: params.wrapperAddress, requestId: params.requestId };

  const reqResp = await fetch("/api/relayer/request-decrypt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reqBody),
  });
  const reqData = await reqResp.json();
  if (reqData.alreadyDone) return { alreadyDone: true };
  if (!reqResp.ok) throw new Error(reqData.error || "Failed to request decryption");

  const { decryptionId, handle } = reqData;

  onStatus?.("Waiting for KMS response...");
  const maxPolls = 60;
  let pollResult: { ready: boolean; cleartexts?: string; signatures?: string[]; extraData?: string } = { ready: false };

  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const pollResp = await fetch("/api/relayer/poll-decrypt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decryptionId }),
    });
    pollResult = await pollResp.json();
    if (pollResult.ready) break;
  }

  if (!pollResult.ready) throw new Error("KMS decryption timed out");

  onStatus?.("Submitting finalization...");
  const finBody = {
    ...reqBody,
    handle,
    cleartexts: pollResult.cleartexts,
    signatures: pollResult.signatures,
    extraData: pollResult.extraData,
  };
  const finResp = await fetch("/api/relayer/submit-finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(finBody),
  });
  const finData = await finResp.json();
  if (!finResp.ok && !finData.alreadyDone) throw new Error(finData.error || "Finalize failed");

  return { txHash: finData.txHash, alreadyDone: finData.alreadyDone };
}
