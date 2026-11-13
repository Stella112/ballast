"use client";
import { useEffect, useState } from "react";
import { useAccount, useReadContracts, useSignTypedData } from "wagmi";
import { parseUnits } from "viem";
import { AccountGate } from "@/components/account-gate";
import { Badge, Button, Card, Field, Notice, fmt, inputCls } from "@/components/ui";
import { BallastRouterAbi } from "@/lib/abis";
import { cfg } from "@/lib/config";
import { encodeInvoice, invoiceDomain, invoiceIdOf, invoiceTypes, randomSalt, type InvoicePayload } from "@/lib/invoices/invoice";
import type { AccountState } from "@/lib/useBallast";

const LS_KEY = "ballast.invoices.v1"; // per-browser convenience list only; on-chain state is the source of truth

export default function InvoicesPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
      <p className="max-w-prose text-sm text-muted">
        An invoice is a message you sign with your wallet (no gas). The link contains the amount, expiry, memo and your signature; nothing is stored on a server.
        Each invoice can be paid once, for the exact amount, before it expires. Payments are split by your Payback policy at the moment of payment.
      </p>
      <AccountGate purpose="create invoices">{(s) => <Create s={s} />}</AccountGate>
    </div>
  );
}

function Create({ s }: { s: AccountState }) {
  const { address } = useAccount();
  const { signTypedDataAsync, isPending } = useSignTypedData();
  const [amount, setAmount] = useState("100");
  const [memo, setMemo] = useState("");
  const [hours, setHours] = useState("24");
  const [err, setErr] = useState<string>();
  const [list, setList] = useState<{ payload: InvoicePayload; link: string; invoiceId: string; createdAt: number }[]>([]);
  useEffect(() => { try { setList(JSON.parse(localStorage.getItem(LS_KEY) || "[]")); } catch { /* storage unavailable */ } }, []);
  const save = (l: typeof list) => { setList(l); try { localStorage.setItem(LS_KEY, JSON.stringify(l)); } catch { /* */ } };
  const isController = address?.toLowerCase() === s.controller.toLowerCase();

  const paid = useReadContracts({
    contracts: list.map((i) => ({ address: cfg.ballast.BallastRouter, abi: BallastRouterAbi, functionName: "invoicePaid", args: [BigInt(i.payload.tokenId), i.invoiceId as `0x${string}`] }) as const),
    query: { enabled: list.length > 0, refetchInterval: 15_000 },
  });

  async function create() {
    setErr(undefined);
    try {
      const amt = parseUnits(amount, 18);
      if (amt <= 0n) throw new Error("Amount must be positive");
      if (memo.length > 200) throw new Error("Memo too long");
      const salt = randomSalt();
      const invoiceId = invoiceIdOf(memo, salt);
      const expiry = BigInt(Math.floor(Date.now() / 1000) + Math.round(Number(hours) * 3600));
      const sig = await signTypedDataAsync({ domain: invoiceDomain, types: invoiceTypes, primaryType: "Invoice", message: { tokenId: s.tokenId, invoiceId, amount: amt, expiry } });
      const payload: InvoicePayload = { v: 1, tokenId: s.tokenId.toString(), amount: amt.toString(), expiry: expiry.toString(), memo, salt, sig };
      const link = `${window.location.origin}/pay/${encodeInvoice(payload)}`;
      save([{ payload, link, invoiceId, createdAt: Date.now() }, ...list].slice(0, 50));
    } catch (e) {
      setErr((e as Error).message.split("\n")[0]);
    }
  }

  const repayPart = s.policy.paused ? 0 : s.policy.repayBps;
  return (
    <>
      <Card title="New invoice">
        {!isController && <div className="mb-3"><Notice tone="bad">Only the NFT holder&apos;s signature is accepted by the router.</Notice></div>}
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Amount (MUSD)"><input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Memo (shown to payer)" hint="Bound to the signature"><input className={inputCls} maxLength={200} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. Logo design, Nov" /></Field>
          <Field label="Expires in (hours)"><input className={inputCls} inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
        </div>
        <p className="mt-3 text-sm text-muted">Current policy: {repayPart / 100}% repay · {s.policy.reserveBps / 100}% reserve · {(10_000 - repayPart - s.policy.reserveBps) / 100}% spendable.</p>
        <div className="mt-4"><Button onClick={create} disabled={!isController || isPending}>{isPending ? "Sign in wallet…" : "Sign & create link"}</Button></div>
        {err && <div className="mt-3"><Notice tone="bad">{err}</Notice></div>}
      </Card>

      <Card title="Your invoices (this browser)">
        {list.length === 0 ? <p className="text-sm text-muted">No invoices created in this browser yet.</p> : (
          <ul className="divide-y divide-border text-sm">
            {list.map((i, k) => {
              const isPaid = paid.data?.[k]?.result === true;
              const expired = Number(i.payload.expiry) * 1000 < Date.now();
              return (
                <li key={i.invoiceId} className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="num font-medium">{fmt(BigInt(i.payload.amount))} MUSD {i.payload.memo && <span className="font-normal text-muted">— {i.payload.memo}</span>}</div>
                    <div className="truncate font-mono text-xs text-muted">{i.invoiceId}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isPaid ? <Badge tone="ok">Paid (on-chain)</Badge> : expired ? <Badge tone="neutral">Expired</Badge> : <Badge tone="warn">Unpaid</Badge>}
                    <Button variant="secondary" onClick={() => navigator.clipboard.writeText(i.link)}>Copy link</Button>
                    <a className="text-sm text-accent-strong underline" href={i.link} target="_blank" rel="noreferrer">Open</a>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
