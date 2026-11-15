import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { Providers } from "@/components/providers";
import { ConnectButton } from "@/components/wallet";
import { Logo, NavLinks } from "@/components/nav";

export const metadata: Metadata = {
  title: "Ballast — Protect your Bitcoin. Strengthen your loan.",
  description: "The cash-flow autopilot for Bitcoin-backed loans on Mezo testnet. Unaudited testnet demo.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <Providers>
          <div className="border-b border-warn/30 bg-warn-soft px-4 py-1.5 text-center text-xs text-warn">
            Mezo <strong>Testnet</strong> (chain 31611) only · test assets, no real value · unaudited contracts
          </div>
          <header className="border-b border-border bg-surface">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
              <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
                <Logo />
                Ballast
              </Link>
              <NavLinks />
              <div className="order-2 sm:order-3"><ConnectButton /></div>
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
          <footer className="mt-8 border-t border-border">
            <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 text-xs text-muted md:flex-row md:items-center md:justify-between">
              <p className="max-w-2xl">Ballast is an unaudited hackathon prototype on Mezo testnet. It does not guarantee protection from redemption or liquidation.</p>
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                <a className="hover:text-text" href="https://github.com/Stella112/ballast" target="_blank" rel="noreferrer">GitHub</a>
                <a className="hover:text-text" href="https://github.com/Stella112/ballast/blob/main/docs/TEST_EVIDENCE.md" target="_blank" rel="noreferrer">Evidence</a>
                <a className="hover:text-text" href="https://github.com/Stella112/ballast/blob/main/docs/DEPLOYMENTS.md" target="_blank" rel="noreferrer">Contracts</a>
                <a className="hover:text-text" href="https://explorer.test.mezo.org" target="_blank" rel="noreferrer">Mezo explorer</a>
              </div>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
