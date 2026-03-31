"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { IS_MAINNET } from "@/lib/constants";

export function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-8">
        <div className="h-16 flex items-center justify-between border-b border-border">
          <div className="flex items-center gap-10">
            <Link href="/" className="flex items-center gap-3 group">
              <img src="/logo.png" alt="HideMe" className="w-9 h-9 rounded-full object-cover" />
              <div className="flex flex-col">
                <span className="text-[13px] font-semibold text-text-primary tracking-[0.15em] uppercase">
                  HideMe
                </span>
              </div>
            </Link>

            <nav className="hidden sm:flex items-center gap-1">
              <NavLink href="/" active={pathname === "/"}>
                Registry
              </NavLink>
              <NavLink href="/payments" active={pathname === "/payments"}>
                Payments
              </NavLink>
              <NavLink href="/portfolio" active={pathname === "/portfolio"}>
                Portfolio
              </NavLink>
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-full ${IS_MAINNET ? "bg-gold" : "bg-success"} animate-pulse-gold`} />
              <span className="text-[10px] font-mono text-text-ghost tracking-widest uppercase">
                {IS_MAINNET ? "Mainnet" : "Sepolia"}
              </span>
            </div>
            <div className="h-5 w-px bg-border hidden md:block" />
            <ConnectButton
              chainStatus="none"
              showBalance={false}
              accountStatus={{ smallScreen: "avatar", largeScreen: "address" }}
            />
          </div>
        </div>
      </div>
    </header>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 text-[12px] font-mono tracking-wide uppercase transition-colors cursor-pointer ${
        active
          ? "text-gold"
          : "text-text-ghost hover:text-text-tertiary"
      }`}
    >
      {children}
    </Link>
  );
}
