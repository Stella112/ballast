"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";
import { parseUnits } from "viem";
import { AccountGate } from "@/components/account-gate";
import { Addr, Badge, Button, Card, Field, Notice, Stat, TxLink, fmt, inputCls, pct } from "@/components/ui";
import { useTx, TxStatus } from "@/components/tx";
import { BallastAccountAbi } from "@/lib/abis";
import { computeHints } from "@/lib/mezo/hints";
import { principalAfterRepay } from "@/lib/radar/math";
import type { AccountState } from "@/lib/useBallast";

type Row = { owner: string; nicr: string; icr: string; debt: string; eligible: boolean; pos: number };
type Quote = { kind: "already-ahead" } | { kind: "ok"; repay: string; newNicr: string; buffer: string; newTotalDebt: string; newIcr?: string } | { kind: "exceeds-floor"; repay: string; maxRepayable: string };
type Scenario = {
  dropBps: string; price: string; myIcr: string; liquidatable: boolean; eligibleRank?: number; eligibleCount: number;
  debtAheadEligible: string; liquidatableCount: number; tcr: string; recoveryMode: boolean; redemptionsPaused: boolean;
};
type Radar = {
  blockNumber: string; blockTimestamp: string; queriedAt: number; price: string; mcr: string; size: number;
  verified: Record<string, boolean>;
  window: Row[];
  me?: {
    inList: boolean; rawPosFromTail?: number; eligibleRank?: number; eligibleCount: number; debtAheadEligible: string;
    nicr: string; icr: string; liquidationPrice: string; maxRepayable: string; totalDebt: string; principal: string; interest: string;
    targets: { pass: number; target?: string; targetNicr?: string; quote?: Quote }[];
    scenarios: Scenario[];
  };
  simulation?: { amount: string; exceedsFloor: boolean; maxRepayable: string; newNicr: string; newIcr?: string; currentIcr: string; newPosFromTail: number; ties: number; currentPosFromTail: number };
  error?: string;
};

async function fetchRadar(account: string, opts: { fresh?: boolean; simulate?: bigint } = {}): Promise<Radar> {
  const q = new URLSearchParams({ account });
  if (opts.fresh) q.set("fresh", "1");
  if (opts.simulate !== undefined) q.set("simulate", opts.simulate.toString());
  const r = await fetch(`/api/radar?${q}`, { cache: "no-store" });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "radar read failed");
  return j;
}

export default function RadarPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Redemption Radar</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Mezo redeems MUSD against troves starting from the lowest nominal collateral ratio (NICR = BTC ÷ principal), skipping troves under 110% ICR.
          Your position in that queue is not a probability — it shows how many troves would be redeemed before yours. Ranks are shown only when the full list read at one block passes all consistency checks.
        </p>
      </div>
      <AccountGate purpose="see your redemption position">{(s, refetch) => <RadarView s={s} refetchAccount={refetch} />}</AccountGate>
    </div>
  );
}

function RadarView({ s, refetchAccount }: { s: AccountState; refetchAccount: () => void }) {
  const q = useQuery({ queryKey: ["radar", s.account], queryFn: () => fetchRadar(s.account), refetchInterval: 30_000 });
  const [before, setBefore] = useState<Radar | null>(null);
  const [after, setAfter] = useState<Radar | null>(null);
  const [lastTx, setLastTx] = useState<string>();
  const [sim, setSim] = useState("");
  const [simRes, setSimRes] = useState<Radar["simulation"]>();
  const [simErr, setSimErr] = useState<string>();
  const { address } = useAccount();
  const client = usePublicClient();
  const tx = useTx();

  if (s.status !== 1) return <Notice tone="neutral" title="No active trove">Open a trove from the Account page to appear in the redemption queue.</Notice>;
  if (q.isLoading) return <p className="text-sm text-muted">Reading all troves at one block (server-side)…</p>;
  if (q.error) return <Notice tone="bad" title="Radar read failed">{(q.error as Error).message}. The RPC may be rate-limited; retry shortly.</Notice>;
  const d = q.data!;
  const allOk = Object.values(d.verified).every(Boolean);
  const me = d.me!;
  const ageS = Math.max(0, Math.round(Date.now() / 1000 - Number(d.blockTimestamp)));

  async function repayQuote(pass: number) {
    // Re-quote at a fresh block immediately before sending.
    const fresh = await fetchRadar(s.account, { fresh: true });
    const t = fresh.me?.targets.find((x) => x.pass === pass);
    if (!t?.quote || t.quote.kind !== "ok") throw new Error("Quote no longer reachable at the latest block");
    const amt = BigInt(t.quote.repay);
    if (amt > s.freeMUSD) throw new Error(`Account holds ${fmt(s.freeMUSD)} free MUSD; needs ${fmt(amt)}`);
    setBefore(fresh); setAfter(null);
    const [up, lo] = await computeHints(client!, s.coll, principalAfterRepay(s.principal, s.interest, amt) || 1n);
    return { address: s.account, abi: BallastAccountAbi, functionName: "repay", args: [amt, up, lo], account: address };
  }

  return (
    <>
      <Card title="Snapshot" right={allOk ? <Badge tone="ok">List verified</Badge> : <Badge tone="bad">List inconsistent — ranks hidden</Badge>}>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Block" value={d.blockNumber} sub={`${ageS}s old · fetched ${new Date(d.queriedAt).toLocaleTimeString()}`} />
          <Stat label="Your position from tail" value={allOk && me.rawPosFromTail ? `#${me.rawPosFromTail} of ${d.size}` : "—"} sub="#1 is redeemed first" />
          <Stat label="Redemption-eligible order" value={allOk && me.eligibleRank ? `#${me.eligibleRank} of ${me.eligibleCount}` : "—"} sub="Troves ≥110% ICR" />
          <Stat label="Debt of eligible troves ahead" value={`${fmt(me.debtAheadEligible, 18, 0)} MUSD`} sub="Context, not a guarantee" />
          <Stat label="Your NICR" value={me.nicr} sub="coll × 1e20 ÷ principal" />
          <Stat label="Your ICR" value={pct(me.icr)} sub={`at ${fmt(d.price)} MUSD/BTC`} />
          <Stat label="Liquidation price (est.)" value={`${fmt(me.liquidationPrice)} MUSD`} sub="ICR < 110% below this" />
          <Stat label="Max repay before floor" value={`${fmt(me.maxRepayable)} MUSD`} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted">
          Checks: {Object.entries(d.verified).map(([k, v]) => <Badge key={k} tone={v ? "ok" : "bad"}>{k}</Badge>)}
          <Button variant="secondary" className="ml-auto" onClick={() => q.refetch()}>Refresh</Button>
        </div>
      </Card>

      <Card title="Neighbours (your window of the queue)">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs uppercase text-muted"><tr><th className="py-2">Pos</th><th>Trove</th><th className="text-right">NICR</th><th className="text-right">ICR</th><th className="text-right">Debt (MUSD)</th></tr></thead>
            <tbody className="num">
              {d.window.slice().reverse().map((r) => {
                const mine = r.owner.toLowerCase() === s.account.toLowerCase();
                return (
                  <tr key={r.owner} className={`border-t border-border ${mine ? "bg-accent-soft font-semibold" : ""}`}>
                    <td className="py-1.5">#{r.pos}{mine && " (you)"}</td><td><Addr a={r.owner} /></td>
                    <td className="text-right">{r.nicr}</td><td className="text-right">{pct(r.icr)}</td><td className="text-right">{fmt(r.debt, 18, 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">Higher rows are safer (redeemed later). Equal NICRs have no guaranteed order.</p>
      </Card>

      <Card title="Repay to move up">
        <ul className="space-y-3">
          {me.targets.map((t) => (
            <li key={t.pass} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
              <div>
                <div className="font-medium">Pass the next {t.pass} trove{t.pass > 1 ? "s" : ""}</div>
                <div className="text-xs text-muted">{t.target ? <>target <Addr a={t.target} /> NICR {t.targetNicr}</> : "not enough troves above you"}</div>
              </div>
              {t.quote?.kind === "ok" && (
                <div className="num text-right">
                  {fmt(t.quote.repay, 18, 6)} MUSD <span className="text-xs text-muted">(incl. interest + 10-min buffer)</span>
                  {t.quote.newIcr && <div className="text-xs text-muted">ICR after: {pct(me.icr)} → <span className="text-text">{pct(t.quote.newIcr)}</span></div>}
                </div>
              )}
              {t.quote?.kind === "exceeds-floor" && <Badge tone="warn">Not reachable without closing ({fmt(t.quote.repay)} &gt; {fmt(t.quote.maxRepayable)})</Badge>}
              {t.quote?.kind === "already-ahead" && <Badge tone="ok">Already ahead</Badge>}
              {t.quote?.kind === "ok" && (
                <Button variant="secondary" disabled={tx.state.s === "wallet" || tx.state.s === "pending"} onClick={() =>
                  tx.run(() => repayQuote(t.pass), async (rcpt) => {
                    setLastTx(rcpt.transactionHash);
                    refetchAccount();
                    setAfter(await fetchRadar(s.account, { fresh: true }));
                    q.refetch();
                  })}>Repay from account</Button>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">Quotes are recomputed at the latest block right before sending. Other troves can move in between; a quote is not a guarantee.</p>
        <div className="mt-3"><TxStatus state={tx.state} /></div>
        {before && after && (
          <div className="mt-4 rounded-lg border border-border p-4 text-sm">
            <div className="mb-2 font-semibold">Verified before / after <TxLink hash={lastTx} /></div>
            <div className="grid gap-2 md:grid-cols-2 num">
              <div>Before (block {before.blockNumber}): #{before.me?.rawPosFromTail} · NICR {before.me?.nicr} · debt {fmt(before.me?.totalDebt)}</div>
              <div>After (block {after.blockNumber}): #{after.me?.rawPosFromTail} · NICR {after.me?.nicr} · debt {fmt(after.me?.totalDebt)}</div>
            </div>
            <div className="mt-2">{after.me?.rawPosFromTail === before.me?.rawPosFromTail ? <Badge tone="neutral">No rank change</Badge> : <Badge tone="ok">Moved {(after.me?.rawPosFromTail ?? 0) - (before.me?.rawPosFromTail ?? 0)} position(s) toward safety</Badge>}</div>
          </div>
        )}
      </Card>

      <Card title="If BTC falls…" right={<Badge tone="sim">Projection</Badge>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs uppercase text-muted">
              <tr><th className="py-2">BTC move</th><th className="text-right">BTC price</th><th className="text-right">Your ICR</th><th>Your trove</th><th>System (Mezo)</th></tr>
            </thead>
            <tbody className="num">
              {me.scenarios.map((x) => (
                <tr key={x.dropBps} className="border-t border-border align-top">
                  <td className="py-2">{x.dropBps === "0" ? "Now" : `−${Number(x.dropBps) / 100}%`}</td>
                  <td className="text-right">{fmt(x.price, 18, 0)}</td>
                  <td className="text-right">{pct(x.myIcr)}</td>
                  <td className="pl-4">
                    {x.liquidatable ? <Badge tone="bad">Liquidatable (ICR &lt; {pct(d.mcr)})</Badge>
                      : allOk && x.eligibleRank ? <span>Redemption order #{x.eligibleRank} of {x.eligibleCount} eligible</span>
                      : <span className="text-muted">—</span>}
                    {x.liquidatableCount > 0 && <div className="text-xs text-muted">{x.liquidatableCount} trove(s) below {pct(d.mcr)}</div>}
                  </td>
                  <td>
                    <div>TCR {pct(x.tcr)}</div>
                    {x.redemptionsPaused ? <Badge tone="bad">Redemptions paused (TCR &lt; {pct(d.mcr)})</Badge>
                      : x.recoveryMode ? <Badge tone="warn">Recovery mode (TCR &lt; 150%)</Badge>
                      : <span className="text-xs text-muted">Normal mode</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">
          Same block as the snapshot; only the BTC price changes. Your ICR uses your current debt and collateral. System TCR and recovery mode come from Mezo&apos;s own
          <code className="mx-1">getTCR</code>/<code className="mx-1">checkRecoveryMode</code> at each price. Redemption order assumes no other trove is liquidated or adjusted first —
          a real price fall would change the list. Not a forecast or a guarantee.
        </p>
      </Card>

      <Card title="What if I repay…">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Amount (MUSD)"><input className={inputCls} inputMode="decimal" value={sim} onChange={(e) => setSim(e.target.value)} placeholder="e.g. 25" /></Field>
          <Button variant="secondary" onClick={async () => {
            setSimErr(undefined);
            try { setSimRes((await fetchRadar(s.account, { simulate: parseUnits(sim || "0", 18) })).simulation); } catch (e) { setSimErr((e as Error).message); }
          }}>Simulate</Button>
        </div>
        {simErr && <div className="mt-3"><Notice tone="bad">{simErr}</Notice></div>}
        {simRes && (
          <div className="mt-3 text-sm">
            {simRes.exceedsFloor ? <Notice tone="warn">Exceeds the repayable maximum ({fmt(simRes.maxRepayable)} MUSD) — Mezo would revert. Reaching further requires closing the trove.</Notice> : (
              <div className="space-y-1 num">
                <p>Projected position: #{simRes.currentPosFromTail} → <strong>#{simRes.newPosFromTail}</strong> (NICR {simRes.newNicr}){simRes.ties > 0 && ` · ${simRes.ties} trove(s) tie at this NICR; order between ties is not guaranteed`}.</p>
                {simRes.newIcr && <p>Collateral ratio (ICR): {pct(simRes.currentIcr)} → <strong>{pct(simRes.newIcr)}</strong> at {fmt(d.price)} MUSD/BTC.</p>}
                <p className="text-xs text-muted">Simulation at the same snapshot; nothing is sent.</p>
              </div>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
