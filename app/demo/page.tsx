import Link from "next/link";
import { Addr, Badge, Card, TxLink } from "@/components/ui";
import { cfg } from "@/lib/config";

// Past runs: copied from docs/TEST_EVIDENCE.md (each hash links to the explorer; receipts status 1).
const PAST = [
  { what: "Account #1 created (NFT minted)", block: 16791716, hash: "0xc27190d237b434623e0f25f98fff95dd2d77730eddd78b9b11b757bd64af3114" },
  { what: "Account opens its Mezo loan: 2,100 MUSD against 0.048 BTC", block: 16791736, hash: "0x1c12b684ebebac2154275e09462345386ee597cce37f7c4ad13b58fb62dee76e" },
  { what: "Separate wallet pays 100 MUSD through the router → 75 owner / 5 hedge reserve / 20 repaid, ratio 134.15% → 135.33%", block: 16791774, hash: "0xbec250c4a877f3b637b8935e1713115d8d5989626614c9e97f3cdf12938bbd5e" },
  { what: "Keeper: a non-owner wallet applies the policy to 50 MUSD sent straight to the account", block: 16791808, hash: "0x93bbadeb9ad67c95f32ca5507ee6b7d9b28cec00d4c327dd857868aaf4b1a9cd" },
  { what: "Account NFT listed in an escrow contract with the loan open", block: 16791829, hash: "0x2d8e01521db67bb4542be4383d3f1a053f219c17a890c19f99995ccd630f857a" },
  { what: "Escrow releases the NFT to a buyer: the whole account moves", block: 16791831, hash: "0x43626e6369e6e8304ee33348492fe1b0c45f08333d404e8937a36bd5c208b8d9" },
  { what: "Account opens a BTC short from its hedge reserve (Morpho Blue + Mezo Pools)", block: 16791891, hash: "0x09d17ce366ce7ef78439386f04b6238476f19d99a51a4a74651cf3c66c3cc447" },
  { what: "Account closes the short; funds return to the account", block: 16791907, hash: "0xd6a52ed49876862609d15578cf56b51b5372a38a2f45065aa8337675363ded54" },
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
      <Card title="Past run on Mezo testnet" right={<Badge tone="neutral">Recorded 2026-11-15 · not live state</Badge>}>
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
