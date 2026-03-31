import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import {
  GATEWAY_RPC, DECRYPTION_CONTRACT, DECRYPTION_ABI,
  MAINNET_RPC, ROUTER_V2, ROUTER_V2_ABI, WRAPPER_ABI,
  getRelayerKey, ensureZamaApproval,
} from "../shared";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { type, paymentId, wrapperAddress, requestId } = await request.json();

    let handle: string;

    if (type === "payment") {
      const provider = new ethers.JsonRpcProvider(MAINNET_RPC, undefined, { staticNetwork: true });
      const router = new ethers.Contract(ROUTER_V2, ROUTER_V2_ABI, provider);
      const payment = await router.getPayment(paymentId);
      if (payment[9]) return NextResponse.json({ alreadyDone: true });
      if (payment[10]) return NextResponse.json({ error: "Payment cancelled" }, { status: 400 });
      handle = payment[5];
    } else if (type === "unwrap") {
      const provider = new ethers.JsonRpcProvider(MAINNET_RPC, undefined, { staticNetwork: true });
      const wrapper = new ethers.Contract(wrapperAddress, WRAPPER_ABI, provider);
      const req = await wrapper.unwrapRequests(requestId);
      if (req[0] === ethers.ZeroAddress) return NextResponse.json({ alreadyDone: true });
      handle = req[2];
    } else {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    const key = getRelayerKey();
    const gatewayProvider = new ethers.JsonRpcProvider(GATEWAY_RPC, undefined, {
      staticNetwork: true, pollingInterval: 3000, batchMaxCount: 1,
    });
    const gatewaySigner = new ethers.Wallet(key, gatewayProvider);
    await ensureZamaApproval(gatewaySigner);

    const decryptionContract = new ethers.Contract(DECRYPTION_CONTRACT, DECRYPTION_ABI, gatewaySigner);
    const decTx = await decryptionContract.publicDecryptionRequest([handle], "0x");
    const decReceipt = await decTx.wait();

    let decryptionId: string | null = null;
    for (const log of decReceipt!.logs) {
      try {
        const parsed = decryptionContract.interface.parseLog({ topics: [...log.topics], data: log.data });
        if (parsed && parsed.name === "PublicDecryptionRequest") {
          decryptionId = parsed.args.decryptionId.toString();
          break;
        }
      } catch { /* expected */ }
    }

    if (!decryptionId) {
      return NextResponse.json({ error: "Could not extract decryptionId" }, { status: 500 });
    }

    return NextResponse.json({ decryptionId, handle });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err instanceof Error ? err.message : String(err)).substring(0, 500) }, { status: 500 });
  }
}
