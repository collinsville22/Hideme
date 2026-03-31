import type { Metadata } from "next";
import { IBM_Plex_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";

const ibmPlex = IBM_Plex_Mono({
  variable: "--font-ibm-plex",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "HideMe — Confidential Tokens",
  description:
    "Issue, transfer, and manage tokens with FHE-encrypted balances on Ethereum.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${ibmPlex.variable} ${instrumentSerif.variable} antialiased min-h-screen`}>
        <Providers>
          <div className="min-h-screen flex flex-col">
            <Header />
            <main className="flex-1">{children}</main>
            <footer className="border-t border-border mt-auto">
              <div className="max-w-7xl mx-auto px-8 py-6 flex items-center justify-between">
                <span className="text-[11px] text-text-ghost font-mono tracking-wide">
                  HIDEME PROTOCOL / V0.1.0
                </span>
                <span className="text-[11px] text-text-ghost font-mono hidden sm:block">
                  ZAMA FHEVM / TFHE-128 / POST-QUANTUM
                </span>
              </div>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
