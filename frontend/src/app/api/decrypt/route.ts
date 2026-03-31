/**
 * GET /api/decrypt — health check for the mini-relayer.
 *
 * The SDK (relayerUrl="/api/decrypt", relayerRouteVersion=1) calls:
 *   /api/decrypt/keyurl, /api/decrypt/input-proof,
 *   /api/decrypt/user-decrypt, /api/decrypt/public-decrypt
 */

import { NextResponse } from "next/server";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ status: "ok", service: "zama-gateway-mini-relayer" });
}
