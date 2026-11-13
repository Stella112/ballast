"use client";
import { useEffect, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { isAddress, zeroAddress, type Address } from "viem";
import { AccountGate } from "@/components/account-gate";
import { Addr, Badge, Card, Field, Notice, TxLink, fmt, inputCls } from "@/components/ui";
import { TxButton, TxStatus, useTx } from "@/components/tx";
import { BallastAccountAbi, BallastRouterAbi } from "@/lib/abis";
import { cfg } from "@/lib/config";
import { useActivity } from "@/lib/useActivity";
import type { AccountState } from "@/lib/useBallast";

const PRESETS = [
  { key: "btc", name: "Keep my BTC", repay: 40, reserve: 10, desc: "Prioritise loan safety: 40% of each payment repays debt, 10% builds an MUSD reserve, 50% is yours to spend." },
  { key: "debt", name: "Get out of debt", repay: 75, reserve: 0, desc: "Pay the loan down fast: 75% repays debt, 25% spendable." },
  { key: "cash", name: "Keep cash available", repay: 10, reserve: 5, desc: "Mostly spendable: 10% repays debt, 5% reserve, 85% spendable." },
  { key: "demo", name: "Demo split", repay: 20, reserve: 5, desc: "20% repay · 5% reserve · 75% spendable (used in the recorded demo)." },
] as const;

export default function PaybackPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Payback policy</h1>
      <p className="max-w-prose text-sm text-muted">
        Each invoice payment through the Ballast router is split by this policy in the same transaction. These are plain percentages you choose — no optimisation engine.
        If a repayment would push your net debt below Mezo&apos;s floor, the whole payment reverts (nothing is partially applied).
      </p>
      <AccountGate purpose="set your payback policy">{(s, refetch) => <Policy s={s} refetch={refetch} />}</AccountGate>
    </div>
  );
}

function Policy({ s, refetch }: { s: AccountState; refetch: () => void }) {
  const { address } = useAccount();
  const [repay, setRepay] = useState(s.policy.repayBps / 100);
  const [reserve, setReserve] = useState(s.policy.reserveBps / 100);
  const [paused, setPaused] = useState(s.policy.paused);
  const [payout, setPayout] = useState<string>(s.policy.payout === zeroAddress ? "" : s.policy.payout);
  useEffect(() => { setRepay(s.policy.repayBps / 100); setReserve(s.policy.reserveBps / 100); setPaused(s.policy.paused); }, [s.policy.repayBps, s.policy.reserveBps, s.policy.paused]);
  const tx = useTx();
  const rb = Math.round(repay * 100), vb = Math.round(reserve * 100);
  const valid = Number.isInteger(rb) && Number.isInteger(vb) && rb >= 0 && vb >= 0 && rb + vb <= 10_000 && (payout === "" || isAddress(payout));
  const sample = 100n * 10n ** 18n;
  const split = useReadContract({ address: cfg.ballast.BallastRouter, abi: BallastRouterAbi, functionName: "computeSplit", args: [sample, rb, vb, paused], query: { enabled: valid } });
  const isController = address?.toLowerCase() === s.controller.toLowerCase();
  const activity = useActivity(s.account, s.tokenId);
  const recent = activity.data?.items.filter((i) => i.kind === "invoice").slice(0, 5) ?? [];

  return (
    <>
      <Card title="Current on-chain policy" right={s.policy.paused ? <Badge tone="warn">Paused</Badge> : <Badge tone="ok">Active</Badge>}>
        <div className="flex flex-wrap gap-6 text-sm">
          <div><span className="text-muted">Repay</span> <span className="num font-semibold">{s.policy.repayBps / 100}%</span></div>
          <div><span className="text-muted">Reserve</span> <span className="num font-semibold">{s.policy.reserveBps / 100}%</span></div>
          <div><span className="text-muted">Spendable</span> <span className="num font-semibold">{(10_000 - s.policy.repayBps - s.policy.reserveBps) / 100}%</span></div>
          <div><span className="text-muted">Spendable goes to</span> <Addr a={s.payout} /></div>
          <div><span className="text-muted">Hedge reserve held</span> <span className="num font-semibold">{fmt(s.hedgeReserve)} MUSD</span> <span className="text-muted">(uninvested)</span></div>
        </div>
      </Card>

      <Card title="Choose a preset">
        <div className="grid gap-3 md:grid-cols-2">
          {PRESETS.map((p) => (
            <button key={p.key} onClick={() => { setRepay(p.repay); setReserve(p.reserve); setPaused(false); }}
              className={`rounded-lg border p-4 text-left transition hover:bg-surface-2 ${repay === p.repay && reserve === p.reserve ? "border-accent" : "border-border"}`}>
              <div className="font-medium">{p.name}</div>
              <div className="mt-1 text-sm text-muted">{p.desc}</div>
            </button>
          ))}
        </div>
      </Card>

      <Card title="Edit">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Repay % of each payment"><input className={inputCls} type="number" min={0} max={100} step={0.01} value={repay} onChange={(e) => setRepay(Number(e.target.value))} /></Field>
          <Field label="Hedge reserve %" hint="Kept in the account as plain MUSD. No hedge is opened."><input className={inputCls} type="number" min={0} max={100} step={0.01} value={reserve} onChange={(e) => setReserve(Number(e.target.value))} /></Field>
          <Field label="Spendable recipient" hint="Empty = current NFT holder"><input className={inputCls + " font-mono"} placeholder="0x… (optional)" value={payout} onChange={(e) => setPayout(e.target.value)} /></Field>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} /> Pause repayment (repay share is paid out as spendable instead)
        </label>
        {!valid && <div className="mt-3"><Notice tone="bad">Repay + reserve must be ≤ 100% in steps of 0.01%, and the recipient must be a valid address.</Notice></div>}
        {valid && split.data && (
          <div className="mt-4 rounded-lg bg-surface-2 p-3 text-sm">
            For a 100 MUSD payment (computed by the router contract): <span className="num font-medium">{fmt(split.data[0])}</span> spendable · <span className="num font-medium">{fmt(split.data[1])}</span> reserve · <span className="num font-medium">{fmt(split.data[2])}</span> repaid. Rounding dust goes to spendable.
          </div>
        )}
        <div className="mt-4">
          <TxButton label="Save policy on-chain" state={tx.state} disabled={!valid || !isController} onClick={() =>
            tx.run(async () => ({ address: s.account, abi: BallastAccountAbi, functionName: "setPolicy", args: [rb, vb, paused, (payout || zeroAddress) as Address], account: address }), refetch)} />
        </div>
        <div className="mt-3"><TxStatus state={tx.state} /></div>
      </Card>

      <Card title="Recent invoice receipts">
        {activity.isLoading ? <p className="text-sm text-muted">Reading events…</p> : recent.length === 0 ? <p className="text-sm text-muted">No invoice payments yet.</p> : (
          <ul className="divide-y divide-border text-sm">
            {recent.map((r) => (
              <li key={r.tx + r.logIndex} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="num">{fmt(r.amount)} MUSD → {fmt(r.spendable)} / {fmt(r.reserve)} / {fmt(r.repaid)} repaid</span>
                <span className="text-muted">block {r.block.toString()} · <TxLink hash={r.tx} /></span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
