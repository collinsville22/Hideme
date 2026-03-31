import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import {
  MAINNET_RPC, ROUTER_V2, ROUTER_V2_ABI, WRAPPER_ABI,
  getRelayerKey, buildDecryptionProof,
} from "../shared";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { type, paymentId, wrapperAddress, requestId, handle, cleartexts, signatures, extraData } = await request.json();

    const key = getRelayerKey();
    const mainnetProvider = new ethers.JsonRpcProvider(MAINNET_RPC, undefined, { staticNetwork: true });
    const mainnetSigner = new ethers.Wallet(key, mainnetProvider);
    const proof = buildDecryptionProof(signatures, extraData);
    const ctHandles = [handle];

    if (type === "payment") {
      const router = new ethers.Contract(ROUTER_V2, ROUTER_V2_ABI, mainnetProvider);
      const payment = await router.getPayment(paymentId);
      if (payment[9]) return NextResponse.json({ success: true, alreadyDone: true });

      const routerSigned = new ethers.Contract(ROUTER_V2, ROUTER_V2_ABI, mainnetSigner);
      const tx = await routerSigned.finalize(paymentId, ctHandles, cleartexts, proof, { gasLimit: 1000000 });
      return NextResponse.json({ success: true, txHash: tx.hash });
    } else if (type === "unwrap") {
      const wrapper = new ethers.Contract(wrapperAddress, WRAPPER_ABI, mainnetProvider);
      const req = await wrapper.unwrapRequests(requestId);
      if (req[0] === ethers.ZeroAddress) return NextResponse.json({ success: true, alreadyDone: true });

      const wrapperSigned = new ethers.Contract(wrapperAddress, WRAPPER_ABI, mainnetSigner);
      const tx = await wrapperSigned.finalizeUnwrap(requestId, ctHandles, cleartexts, proof, { gasLimit: 1000000 });
      return NextResponse.json({ success: true, txHash: tx.hash });
    }

    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err instanceof Error ? err.message : String(err)).substring(0, 500) }, { status: 500 });
  }
}
