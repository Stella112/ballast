import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { Providers } from "@/components/providers";
import { ConnectButton } from "@/components/wallet";

export const metadata: Metadata = {
  title: "Ballast — Protect your Bitcoin. Strengthen your loan.",
  description: "The cash-flow autopilot for Bitcoin-backed loans on Mezo testnet. Unaudited testnet demo.",
};

const nav = [
  ["/app", "Account"],
  ["/app/payback", "Payback"],
  ["/app/radar", "Radar"],
  ["/app/invoices", "Invoices"],
  ["/app/activity", "Activity"],
  ["/app/hedge", "Hedge"],
  ["/demo", "Demo"],
] as const;

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
                <span aria-hidden className="inline-block h-5 w-5 rounded-sm bg-accent" />
                Ballast
              </Link>
              <nav aria-label="Main" className="order-3 flex w-full gap-1 overflow-x-auto text-sm sm:order-2 sm:w-auto">
                {nav.map(([href, label]) => (
                  <Link key={href} href={href} className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-muted hover:bg-surface-2 hover:text-text">{label}</Link>
                ))}
              </nav>
              <div className="order-2 sm:order-3"><ConnectButton /></div>
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
          <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-muted">
            Ballast is an unaudited hackathon prototype on Mezo testnet. It does not guarantee protection from redemption or liquidation. Source and evidence: docs/ in the repository.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
