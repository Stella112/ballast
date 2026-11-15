import Link from "next/link";
import { Badge, Card } from "@/components/ui";

const EXP = "https://explorer.test.mezo.org/tx/";

// Real v3 testnet transactions (docs/TEST_EVIDENCE.md). Recorded results, not live state.
const PROOFS = [
  { title: "One payment, split three ways", body: "100 MUSD through the router: 75 to the owner, 5 to the hedge reserve, 20 repaid. Ratio 134.15% → 135.33%.", hash: "0xbec250c4a877f3b637b8935e1713115d8d5989626614c9e97f3cdf12938bbd5e" },
  { title: "Anyone can trigger, nobody can redirect", body: "50 MUSD sent straight to the account; a non-owner wallet applied the owner's policy.", hash: "0x93bbadeb9ad67c95f32ca5507ee6b7d9b28cec00d4c327dd857868aaf4b1a9cd" },
  { title: "The account sold whole", body: "The NFT was listed in an escrow contract with the loan open, then released to a buyer.", hash: "0x43626e6369e6e8304ee33348492fe1b0c45f08333d404e8937a36bd5c208b8d9" },
  { title: "Hedge opened by the account", body: "80 MUSD from the hedge reserve posted on Morpho Blue, BTC borrowed and sold on Mezo Pools, then closed.", hash: "0x09d17ce366ce7ef78439386f04b6238476f19d99a51a4a74651cf3c66c3cc447" },
];

const SPLIT = [
  { label: "Repays the loan", amount: "20 MUSD", pct: 20, cls: "bg-ok" },
  { label: "Hedge reserve", amount: "5 MUSD", pct: 5, cls: "bg-sim" },
  { label: "Yours to spend", amount: "75 MUSD", pct: 75, cls: "bg-accent" },
];

export default function Home() {
  return (
    <div className="space-y-14">
      <section className="grid items-center gap-10 pt-4 md:grid-cols-[1.15fr_1fr] md:pt-8">
        <div>
          <Badge tone="accent">Live on Mezo Testnet</Badge>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight md:text-6xl md:leading-[1.05]">
            Protect your Bitcoin.<br /><span className="text-accent-strong">Strengthen your loan.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted">
            Ballast is the cash-flow autopilot for Bitcoin-backed loans. Every MUSD payment you receive can repay part of your Mezo loan and move it further from redemption and liquidation.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/app" className="inline-flex min-h-11 items-center rounded-lg bg-accent px-6 text-sm font-medium text-white transition hover:bg-accent-strong dark:text-black">Open the app</Link>
            <Link href="/demo" className="inline-flex min-h-11 items-center rounded-lg border border-border px-6 text-sm font-medium transition hover:bg-surface-2">See the recorded run</Link>
            <Link href="/pay/a/1" className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-accent-strong underline-offset-4 hover:underline">Try the pay link →</Link>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted">Incoming payment</div>
              <div className="num mt-1 text-3xl font-semibold">100 MUSD</div>
            </div>
            <Badge tone="neutral">Example · Keep my BTC</Badge>
          </div>
          <div className="mt-6 space-y-4">
            {SPLIT.map((s) => (
              <div key={s.label}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">{s.label}</span>
                  <span className="num text-muted">{s.amount}</span>
                </div>
                <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-surface-2">
                  <div className={`h-full rounded-full ${s.cls}`} style={{ width: `${s.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-6 border-t border-border pt-4 text-xs text-muted">
            You set the percentages. This exact split ran on testnet:{" "}
            <a className="font-mono text-accent-strong underline-offset-2 hover:underline" href={EXP + PROOFS[0].hash} target="_blank" rel="noreferrer">0xbec250…bd5e ↗</a>
          </p>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold tracking-tight">How it works</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Card title="1 · Your account owns the loan">
            <p className="text-sm text-muted">Ballast deploys a contract account and mints its NFT to your wallet. The account opens a real Mezo loan with your BTC. Whoever holds the NFT controls it, so it can be transferred or sold whole.</p>
          </Card>
          <Card title="2 · Get paid, repay automatically">
            <p className="text-sm text-muted">Share your pay link or an invoice, or let any app call the router. Each payment is split by your policy in one transaction. No signature per payment.</p>
          </Card>
          <Card title="3 · See what it changed">
            <p className="text-sm text-muted">Redemption Radar reads Mezo&apos;s own sorted list of loans: your place in line, the MUSD ahead of you, your liquidation price, and what it costs to move back.</p>
          </Card>
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-xl font-semibold tracking-tight">Proven on Mezo testnet</h2>
          <span className="text-xs text-muted">Recorded 15 Nov 2026 · each card links to its transaction</span>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {PROOFS.map((p) => (
            <a key={p.hash} href={EXP + p.hash} target="_blank" rel="noreferrer" className="group rounded-xl border border-border bg-surface p-5 transition hover:border-accent">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold">{p.title}</h3>
                <Badge tone="ok">Real tx</Badge>
              </div>
              <p className="mt-2 text-sm text-muted">{p.body}</p>
              <p className="mt-3 font-mono text-xs text-accent-strong group-hover:underline">{p.hash.slice(0, 14)}…{p.hash.slice(-6)} ↗</p>
            </a>
          ))}
        </div>
      </section>

      <Card title="Risks — read before using">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
          <li>Testnet only. Contracts are unaudited.</li>
          <li>Redemptions can take collateral from healthy loans; a better place in line is a snapshot, not a guarantee.</li>
          <li>Liquidation is possible if BTC falls far enough. Interest accrues on your debt.</li>
          <li>The hedge reserve is plain MUSD until you open a hedge. Hedges run on a Morpho Blue market deployed and funded by the Ballast team; they can lose money and be liquidated.</li>
          <li>Paying with USDC from Base Sepolia uses Wormhole&apos;s token bridge and a small USDC/MUSD pool seeded by the Ballast team. Paying with MUSD from Base over Wormhole NTT is built and deployed, but has not completed a live run yet.</li>
        </ul>
      </Card>
    </div>
  );
}
