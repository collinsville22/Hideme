import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { GATEWAY_RPC, DECRYPTION_CONTRACT, DECRYPTION_ABI, getRelayerKey } from "../shared";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { decryptionId } = await request.json();
    if (!decryptionId) return NextResponse.json({ error: "Missing decryptionId" }, { status: 400 });

    const gatewayProvider = new ethers.JsonRpcProvider(GATEWAY_RPC, undefined, {
      staticNetwork: true, batchMaxCount: 1,
    });
    const decryptionContract = new ethers.Contract(DECRYPTION_CONTRACT, DECRYPTION_ABI, gatewayProvider);

    const filter = decryptionContract.filters.PublicDecryptionResponse(BigInt(decryptionId));
    const events = await decryptionContract.queryFilter(filter, -2000);

    if (events.length === 0) {
      return NextResponse.json({ ready: false });
    }

    const event = events[0] as ethers.EventLog;
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
      ["bytes", "bytes[]", "bytes"],
      event.data,
    );

    return NextResponse.json({
      ready: true,
      cleartexts: `${decoded[0]}`,
      signatures: Array.from(decoded[1] as string[]).map((s) => `${s}`),
      extraData: `${decoded[2]}`,
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err instanceof Error ? err.message : String(err)).substring(0, 500) }, { status: 500 });
  }
}
