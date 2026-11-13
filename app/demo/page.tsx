import Link from "next/link";
import { Addr, Badge, Card, TxLink } from "@/components/ui";
import { cfg } from "@/lib/config";

// Past runs: copied from docs/TEST_EVIDENCE.md (each hash links to the explorer; receipts status 1).
const PAST = [
  { what: "Account #1 created (NFT minted)", block: 16762107, hash: "0xc8c82af3b6baf50c7d516e124e2d7ae91dee2c680274caf1bf2f492cac3c7815" },
  { what: "Account opens Mezo trove: 2000 MUSD against 0.048 BTC", block: 16762136, hash: "0x73e6312cd962106ef5b07f6a2db4e1e8572580c0d9df9b4b404ebd8c26514940" },
  { what: "Controller repays 10 MUSD (debt −10.000000 exactly)", block: 16762177, hash: "0xa50903d6df72f25c049975d07898160ae6230f76f10687f6366eeb79c16692ad" },
  { what: "Policy set: 20% repay / 5% reserve / 75% spendable", block: 16762223, hash: "0x7a4e019a6461fbeebd998e5083db19e3d493668146249547b85072da2dac5e4a" },
  { what: "Separate wallet pays 100 MUSD invoice → 75 / 5 / 20, debt −20 exactly, same tx", block: 16762254, hash: "0x3b9dce365e1ca8b2e043cc663fbc21c24b5f5364a7c90b2cd68be9571a3e5bc7" },
  { what: "Radar quote 12.756783 MUSD to pass next trove → repaid → rank #165 → #166", block: 16762619, hash: "0xea07e53b0a2664cffc796b8e1063c0174979068ef0f200ccd5d810c3bd798c75" },
];

export default function DemoPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Judge walkthrough</h1>
      <Card title="What you need">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>A browser wallet (e.g. MetaMask) with <strong>two accounts</strong>: a merchant and a payer. No admin keys are involved anywhere.</li>
          <li>Testnet BTC for gas (and for collateral on the merchant) from <a className="underline" href="https://faucet.test.mezo.org/" target="_blank" rel="noreferrer">faucet.test.mezo.org</a>.</li>
          <li>Testnet MUSD for the payer: the merchant can borrow it from their own trove and send it, or mint via <a className="underline" href="https://testnet.mezo.org" target="_blank" rel="noreferrer">testnet.mezo.org</a>.</li>
          <li>Opening a trove needs ≥ 1,800 MUSD net debt plus a 200 MUSD gas deposit — at ~68k MUSD/BTC that means roughly 0.05 BTC collateral at ~150% ratio.</li>
        </ul>
      </Card>
      <Card title="Run it fresh">
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li><Link className="underline" href="/app">Account</Link> (merchant wallet): create account → open trove.</li>
          <li><Link className="underline" href="/app/payback">Payback</Link>: pick “Demo split” (20/5/75) → save.</li>
          <li><Link className="underline" href="/app/radar">Radar</Link>: note your position, NICR and quotes.</li>
          <li><Link className="underline" href="/app/invoices">Invoices</Link>: sign a 100 MUSD invoice → copy the link.</li>
          <li>Switch to the payer wallet, open the link: approve → pay. The receipt shows the split and the merchant&apos;s debt before/after from on-chain events.</li>
          <li>Back as merchant: Radar and <Link className="underline" href="/app/activity">Activity</Link> show the new state at a newer block.</li>
        </ol>
      </Card>
      <Card title="Past run on Mezo testnet" right={<Badge tone="neutral">Recorded 2026-11-13 · not live state</Badge>}>
        <p className="mb-3 text-sm text-muted">Demo account <Addr a={cfg.ballast.BallastAccount} />, NFT #1. Every row links to its explorer transaction.</p>
        <ul className="divide-y divide-border text-sm">
          {PAST.map((p) => (
            <li key={p.hash} className="flex flex-col gap-1 py-2 md:flex-row md:items-center md:justify-between">
              <span>{p.what}</span>
              <span className="text-xs text-muted">block {p.block} · <TxLink hash={p.hash} /></span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
