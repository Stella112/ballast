"use client";
import { useEffect, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { formatUnits, isAddress, parseUnits, zeroAddress, type Address } from "viem";
import { AccountGate } from "@/components/account-gate";
import { Addr, Badge, Card, Field, Notice, TxLink, fmt, inputCls } from "@/components/ui";
import { TxButton, TxStatus, useTx } from "@/components/tx";
import { BallastAccountAbi, BallastRouterAbi } from "@/lib/abis";
import { cfg } from "@/lib/config";
import { useActivity } from "@/lib/useActivity";
import type { AccountState } from "@/lib/useBallast";

const PRESETS = [
  { key: "btc", name: "Keep my BTC", repay: 20, reserve: 5, buffer: "0", desc: "20% of each payment repays your loan, 5% goes to the hedge reserve, 75% is yours." },
  { key: "debt", name: "Get out of debt", repay: 60, reserve: 0, buffer: "0", desc: "Pay the loan down fast: 60% repays, 40% is yours." },
  { key: "cash", name: "Keep cash available", repay: 10, reserve: 0, buffer: "500", desc: "10% repays, 90% is yours — and repayments wait until your wallet holds the cash buffer (500 MUSD by default)." },
] as const;

export default function PaybackPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Payback policy</h1>
      <p className="max-w-prose text-sm text-muted">
        Every payment to your account is split by this policy in the same transaction. These are plain percentages you choose — no optimisation engine.
        Repayments stop at Mezo&apos;s minimum debt (about 2,000 MUSD): anything above that cap goes to you instead.
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
  const [buffer, setBuffer] = useState<string>(formatUnits(s.policy.minCash, 18));
  let minCash = 0n, bufferOk = true;
  try { minCash = parseUnits(buffer || "0", 18); } catch { bufferOk = false; }
  useEffect(() => { setRepay(s.policy.repayBps / 100); setReserve(s.policy.reserveBps / 100); setPaused(s.policy.paused); }, [s.policy.repayBps, s.policy.reserveBps, s.policy.paused]);
  const tx = useTx();
  const rb = Math.round(repay * 100), vb = Math.round(reserve * 100);
  const valid = Number.isInteger(rb) && Number.isInteger(vb) && rb >= 0 && vb >= 0 && rb + vb <= 10_000 && (payout === "" || isAddress(payout)) && bufferOk;
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
          <div><span className="text-muted">Cash buffer</span> <span className="num font-semibold">{fmt(s.policy.minCash)} MUSD</span></div>
          <div><span className="text-muted">Hedge reserve held</span> <span className="num font-semibold">{fmt(s.hedgeReserve)} MUSD</span> <span className="text-muted">(uninvested)</span></div>
        </div>
      </Card>

      <Card title="Choose a preset">
        <div className="grid gap-3 md:grid-cols-2">
          {PRESETS.map((p) => (
            <button key={p.key} onClick={() => { setRepay(p.repay); setReserve(p.reserve); setBuffer(p.buffer); setPaused(false); }}
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
          <Field label="Hedge reserve %" hint="Kept in the account as MUSD until you open a hedge (Hedge page)."><input className={inputCls} type="number" min={0} max={100} step={0.01} value={reserve} onChange={(e) => setReserve(Number(e.target.value))} /></Field>
          <Field label="Spendable recipient" hint="Empty = current NFT holder"><input className={inputCls + " font-mono"} placeholder="0x… (optional)" value={payout} onChange={(e) => setPayout(e.target.value)} /></Field>
        </div>
        <div className="mt-4 max-w-xs">
          <Field label="Minimum cash buffer (MUSD)" hint="While your payout wallet holds less than this, the repay share tops it up first. 0 = off.">
            <input className={inputCls} inputMode="decimal" value={buffer} onChange={(e) => setBuffer(e.target.value)} />
          </Field>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} /> Pause repayment (repay share is paid out as spendable instead)
        </label>
        {!valid && <div className="mt-3"><Notice tone="bad">Repay + reserve must be ≤ 100% in steps of 0.01%, and the recipient must be a valid address.</Notice></div>}
        {valid && split.data && (
          <div className="mt-4 rounded-lg bg-surface-2 p-3 text-sm">
            For a 100 MUSD payment (computed by the router contract): <span className="num font-medium">{fmt(split.data[0])}</span> to you · <span className="num font-medium">{fmt(split.data[1])}</span> hedge reserve · <span className="num font-medium">{fmt(split.data[2])}</span> repaid (before the cash buffer and Mezo&apos;s minimum-debt cap). Rounding dust goes to you.
          </div>
        )}
        <div className="mt-4">
          <TxButton label="Save policy on-chain" state={tx.state} disabled={!valid || !isController} onClick={() =>
            tx.run(async () => ({ address: s.account, abi: BallastAccountAbi, functionName: "setPolicy", args: [rb, vb, paused, (payout || zeroAddress) as Address, minCash], account: address }), refetch)} />
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
