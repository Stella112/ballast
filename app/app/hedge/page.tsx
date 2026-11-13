import { Badge, Card, Notice } from "@/components/ui";

export default function HedgePage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Hedge</h1>
        <Badge tone="sim">SIMULATION — NO REAL HEDGE OPENED</Badge>
      </div>
      <Notice tone="sim" title="Not live">
        Ballast does not open any hedge. The “hedge reserve” in your account is plain, uninvested MUSD that you can withdraw at any time.
      </Notice>
      <Card title="Status of the planned integration">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-border">
            <tr><td className="py-2 pr-4 text-muted">Morpho deployment on Mezo testnet</td><td><Badge tone="neutral">UNVERIFIED</Badge></td></tr>
            <tr><td className="py-2 pr-4 text-muted">Market with a BTC ERC-20 as the <em>loan</em> asset and MUSD collateral</td><td><Badge tone="neutral">UNVERIFIED</Badge></td></tr>
            <tr><td className="py-2 pr-4 text-muted">Lender liquidity, oracle, LLTV</td><td><Badge tone="neutral">UNVERIFIED</Badge></td></tr>
            <tr><td className="py-2 pr-4 text-muted">Swap path BTC ↔ MUSD on testnet</td><td><Badge tone="neutral">UNVERIFIED</Badge></td></tr>
          </tbody>
        </table>
        <p className="mt-4 text-sm text-muted">
          Planned approach (roadmap only): post MUSD as collateral on a verified market, borrow a recognised BTC token from real lenders, sell it for MUSD, and buy it back to close.
          A short like this can lose money and can be liquidated even while the BTC securing your Mezo loan rises. It will only be enabled after every item above is verified on-chain.
        </p>
      </Card>
    </div>
  );
}
