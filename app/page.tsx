import Link from "next/link";
import { Badge, Card } from "@/components/ui";

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="max-w-3xl">
        <Badge tone="accent">Live on Mezo Testnet</Badge>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight md:text-5xl">Protect your Bitcoin. Strengthen your loan.</h1>
        <p className="mt-4 text-lg text-muted">
          Ballast is the cash-flow autopilot for Bitcoin-backed loans: every MUSD payment you receive can make your Mezo loan safer.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/app" className="inline-flex min-h-10 items-center rounded-lg bg-accent px-5 text-sm font-medium text-white hover:bg-accent-strong dark:text-black">Open the app</Link>
          <Link href="/demo" className="inline-flex min-h-10 items-center rounded-lg border border-border px-5 text-sm font-medium hover:bg-surface-2">See the verified demo</Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Card title="1 · Your account owns the loan">
          <p className="text-sm text-muted">Ballast deploys a contract account controlled by an NFT in your wallet. The account opens a real Mezo trove with your BTC.</p>
        </Card>
        <Card title="2 · Get paid, automatically repay">
          <p className="text-sm text-muted">Send customers an invoice link. Each payment is split by your policy in one transaction: spendable, an MUSD reserve, and loan repayment.</p>
        </Card>
        <Card title="3 · See what it changed">
          <p className="text-sm text-muted">Redemption Radar reads Mezo&apos;s sorted trove list and shows your queue position, what it costs to move up, and the verified before/after.</p>
        </Card>
      </section>

      <Card title="Risks — read before using">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Testnet only. Contracts are unaudited.</li>
          <li>Redemptions can take collateral from healthy loans; a better queue position is not a guarantee.</li>
          <li>Liquidation is possible if BTC falls far enough. Interest accrues on your debt.</li>
          <li>The hedge reserve is uninvested MUSD. No hedge is opened (see Hedge).</li>
          <li>Paying from other chains (Base) is not available.</li>
        </ul>
      </Card>
    </div>
  );
}
