"use client";
import { useState } from "react";
import { AccountGate } from "@/components/account-gate";
import { Addr, Badge, Button, Card, Notice, TxLink, fmt } from "@/components/ui";
import { useActivity } from "@/lib/useActivity";
import type { AccountState } from "@/lib/useBallast";

export default function ActivityPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
      <AccountGate purpose="see account activity">{(s) => <List s={s} />}</AccountGate>
    </div>
  );
}

function List({ s }: { s: AccountState }) {
  const q = useActivity(s.account, s.tokenId);
  const [filter, setFilter] = useState<"all" | "invoice" | "repay">("all");
  if (q.isLoading) return <p className="text-sm text-muted">Reading events from the chain…</p>;
  if (q.error) return <Notice tone="bad" title="Could not read events">{(q.error as Error).message.split("\n")[0]}</Notice>;
  const items = (q.data?.items ?? []).filter((i) => filter === "all" || i.kind === filter);
  return (
    <Card title="On-chain events" right={<span className="text-xs text-muted">up to block {q.data?.latest.toString()}</span>}>
      <div className="mb-4 flex gap-2" role="group" aria-label="Filter">
        {(["all", "invoice", "repay"] as const).map((f) => (
          <Button key={f} variant={filter === f ? "primary" : "secondary"} onClick={() => setFilter(f)}>{f === "all" ? "All" : f === "invoice" ? "Invoice payments" : "Loan repayments"}</Button>
        ))}
      </div>
      {items.length === 0 ? <p className="text-sm text-muted">No events yet.</p> : (
        <ul className="divide-y divide-border text-sm">
          {items.map((i) => (
            <li key={i.tx + i.logIndex} className="flex flex-col gap-1 py-3 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                {i.kind === "invoice" ? <Badge tone="accent">Invoice paid</Badge> : <Badge tone="ok">Loan repaid</Badge>}
                {i.kind === "invoice" ? (
                  <span className="num">{fmt(i.amount)} MUSD from <Addr a={i.payer} /> → {fmt(i.spendable)} spendable · {fmt(i.reserve)} reserve · {fmt(i.repaid)} repaid</span>
                ) : (
                  <span className="num">{fmt(i.amount, 18, 6)} MUSD · debt {fmt(i.debtBefore, 18, 4)} → {fmt(i.debtAfter, 18, 4)} · via {i.source?.toLowerCase() === s.controller.toLowerCase() ? "controller" : <Addr a={i.source} />}</span>
                )}
              </div>
              <span className="text-xs text-muted">block {i.block.toString()} · <TxLink hash={i.tx} /></span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
