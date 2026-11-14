"use client";
import { useState } from "react";
import { Badge, Card, Field, Notice, Stat, inputCls } from "@/components/ui";
import { simulateHedge, type HedgeInputs } from "@/lib/hedge/sim";

const n = (x: number, dp = 2) => (Number.isFinite(x) ? x.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }) : "—");

const FIELDS: { key: keyof HedgeInputs; label: string; hint?: string }[] = [
  { key: "collateral", label: "MUSD collateral posted" },
  { key: "size", label: "Short size (MUSD of BTC borrowed)" },
  { key: "entry", label: "BTC price at open (MUSD)", hint: "Assumption" },
  { key: "aprPct", label: "BTC borrow APR (%)", hint: "Assumption" },
  { key: "days", label: "Held for (days)" },
  { key: "swapFeePct", label: "Cost per swap (%)", hint: "Fee + slippage, assumption" },
  { key: "lltvPct", label: "Market liquidation LTV (%)", hint: "Assumption" },
];

export default function HedgePage() {
  const [x, setX] = useState<HedgeInputs>({ collateral: 1000, size: 300, entry: 68_000, movePct: -20, aprPct: 8, days: 30, swapFeePct: 0.3, lltvPct: 86 });
  let r: ReturnType<typeof simulateHedge> | null = null;
  try { r = simulateHedge(x); } catch { r = null; }
  const set = (k: keyof HedgeInputs) => (e: React.ChangeEvent<HTMLInputElement>) => setX({ ...x, [k]: Number(e.target.value) });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Hedge</h1>
        <Badge tone="sim">SIMULATION — NO REAL HEDGE OPENED</Badge>
      </div>
      <Notice tone="sim" title="Not live — every number on this page is synthetic">
        Ballast does not open any hedge. The required market does not exist on Mezo testnet (see below). The “hedge reserve” in your account is plain, uninvested MUSD that you can withdraw at any time.
      </Notice>

      <Card title="Simulator (synthetic)" right={<Badge tone="sim">Assumptions only</Badge>}>
        <p className="mb-4 max-w-prose text-sm text-muted">
          Proposed design: post MUSD as collateral, borrow tokenized BTC, sell it for MUSD, and later buy the BTC back to repay. If BTC falls, buying back costs less; if BTC rises, it costs more and the position can be liquidated.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FIELDS.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint}>
              <input className={inputCls} type="number" inputMode="decimal" value={x[f.key]} onChange={set(f.key)} />
            </Field>
          ))}
          <Field label={`BTC move until close: ${x.movePct > 0 ? "+" : ""}${x.movePct}%`}>
            <input className="w-full accent-[var(--accent)]" type="range" min={-50} max={100} step={1} value={x.movePct} onChange={set("movePct")} aria-label="BTC price move in percent" />
          </Field>
        </div>
        {!r ? <div className="mt-4"><Notice tone="bad">Enter positive numbers.</Notice></div> : (
          <>
            <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
              <Stat label="BTC borrowed" value={`${n(r.btcBorrowed, 6)} BTC`} sub={`owed at close ${n(r.btcOwed, 6)}`} />
              <Stat label="BTC price at close" value={`${n(r.liquidated ? r.liquidationPrice : r.exitPrice, 0)}`} sub={r.liquidated ? "liquidated here first" : "MUSD/BTC"} />
              <Stat label="Liquidation price" value={`${n(r.liquidationPrice, 0)}`} sub="BTC price that liquidates the short" />
              <Stat label="Simulated P/L" value={<span className={r.pnl >= 0 ? "text-ok" : "text-bad"}>{r.pnl >= 0 ? "+" : ""}{n(r.pnl)} MUSD</span>} sub={`interest ${n(r.interestCost)} · swaps ${n(r.swapCost)}`} />
            </div>
            <div className="mt-4">
              {r.liquidated ? (
                <Notice tone="bad" title="This scenario liquidates the short">BTC reaches {n(r.liquidationPrice, 0)} before your exit price. A real liquidation also charges a penalty not modelled here, so the loss would be larger than shown.</Notice>
              ) : r.pnl > 0 ? (
                <Notice tone="ok" title="Simulated gain">In this scenario {n(r.pnl)} MUSD could be sent to repay your Mezo loan after the BTC loan is closed. Not a forecast.</Notice>
              ) : (
                <Notice tone="warn" title="Simulated loss">The hedge loses {n(-r.pnl)} MUSD in this scenario — hedging costs money when BTC doesn&apos;t fall enough.</Notice>
              )}
            </div>
          </>
        )}
      </Card>

      <Card title="Why it isn't live (checked 2026-11-14)">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-border">
            <tr><td className="py-2 pr-4 text-muted">Morpho deployment on Mezo testnet (chain 31611)</td><td><Badge tone="bad">NOT FOUND</Badge></td></tr>
            <tr><td className="py-2 pr-4 text-muted">Market with BTC as the <em>borrowed</em> asset and MUSD collateral</td><td><Badge tone="bad">NOT FOUND</Badge></td></tr>
            <tr><td className="py-2 pr-4 text-muted">Mezo mainnet Morpho market</td><td><Badge tone="neutral">Opposite direction</Badge> <span className="text-xs text-muted">BTC collateral / mUSDC loan</span></td></tr>
            <tr><td className="py-2 pr-4 text-muted">Lender liquidity, oracle, swap path on testnet</td><td><Badge tone="neutral">UNVERIFIED</Badge></td></tr>
          </tbody>
        </table>
        <p className="mt-4 text-sm text-muted">
          Sources: Morpho&apos;s published addresses (docs.morpho.org) and Mezo&apos;s contracts reference and lending-vault docs (mezo.org/docs). Ballast will only enable a real hedge after a funded market, oracle and swap path are verified on-chain.
          A short can lose money and be liquidated even while the BTC securing your Mezo loan rises.
        </p>
      </Card>
    </div>
  );
}
