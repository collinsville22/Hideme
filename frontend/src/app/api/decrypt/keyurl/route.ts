import { NextResponse } from "next/server";

const KEY_RESPONSE = {
  response: {
    fhe_key_info: [
      {
        fhe_public_key: {
          data_id: "fhe-public-key-data-id",
          urls: [
            "https://zama-mpc-mainnet-public-833bcdac.s3.eu-central-1.amazonaws.com/PUB-p1/PublicKey/0400000000000000000000000000000000000000000000000000000000000001",
          ],
        },
      },
    ],
    crs: {
      "2048": {
        data_id: "crs-data-id",
        urls: [
          "https://zama-mpc-mainnet-public-833bcdac.s3.eu-central-1.amazonaws.com/PUB-p1/CRS/0500000000000000000000000000000000000000000000000000000000000001",
        ],
      },
    },
  },
};

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(KEY_RESPONSE);
}
