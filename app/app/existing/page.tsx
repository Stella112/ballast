"use client";
import { useEffect, useState } from "react";
import { useAccount, useReadContracts, useSignTypedData } from "wagmi";
import { parseUnits, type Address } from "viem";
import { RequireMezo } from "@/components/wallet";
import { Badge, Button, Card, Field, Notice, Stat, fmt, inputCls, pct } from "@/components/ui";
import { BallastRepaymentAdapterAbi, PriceFeedAbi, TroveManagerAbi } from "@/lib/abis";
import { cfg } from "@/lib/config";
import { encodeInvoice, invoiceIdOf, randomSalt } from "@/lib/invoices/invoice";
import { directInvoiceDomain, directInvoiceTypes, invoiceKeyOf, mezoRepayTypes, mezoSignaturesDomain, type DirectInvoicePayload } from "@/lib/invoices/direct";
import { icr } from "@/lib/radar/math";

const LS_KEY = "ballast.direct-invoices.v1"; // per-browser convenience list; on-chain state is the source of truth

export default function ExistingLoanPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Existing Mezo loan</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Your loan is held by your wallet, not a Ballast account, so it can&apos;t be moved into Ballast. You can still put part of an invoice payment toward it:
          you sign Mezo&apos;s own one-off repayment message for that exact amount, and the payer&apos;s transaction repays your loan and pays you the rest — in one transaction.
        </p>
      </div>
      <RequireMezo purpose="read your Mezo loan">
        <ExistingInner />
      </RequireMezo>
    </div>
  );
}

function ExistingInner() {
  const { address } = useAccount();
  const me = address as Address;
  const AD = cfg.ballast.BallastRepaymentAdapter;
  const TM = cfg.mezo.TroveManager;
  const reads = useReadContracts({
    contracts: [
      { address: TM, abi: TroveManagerAbi, functionName: "getTroveStatus", args: [me] },
      { address: TM, abi: TroveManagerAbi, functionName: "getTroveDebt", args: [me] },
      { address: TM, abi: TroveManagerAbi, functionName: "getTroveColl", args: [me] },
      { address: AD, abi: BallastRepaymentAdapterAbi, functionName: "maxRepayable", args: [me] },
      { address: AD, abi: BallastRepaymentAdapterAbi, functionName: "mezoNonce", args: [me] },
      { address: cfg.mezo.PriceFeed, abi: PriceFeedAbi, functionName: "fetchPrice" },
    ],
    query: { enabled: !!address, refetchInterval: 20_000 },
  });
  const [status, debt, coll, maxRep, nonce, price] = (reads.data ?? []).map((r) => r.result) as [number?, bigint?, bigint?, bigint?, bigint?, bigint?];

  const { signTypedDataAsync, isPending } = useSignTypedData();
  const [amount, setAmount] = useState("100");
  const [repayPct, setRepayPct] = useState("20");
  const [memo, setMemo] = useState("");
  const [hours, setHours] = useState("24");
  const [err, setErr] = useState<string>();
  const [list, setList] = useState<{ payload: DirectInvoicePayload; link: string; invoiceId: string; createdAt: number }[]>([]);
  useEffect(() => { try { setList(JSON.parse(localStorage.getItem(LS_KEY) || "[]")); } catch { /* storage unavailable */ } }, []);
  const save = (l: typeof list) => { setList(l); try { localStorage.setItem(LS_KEY, JSON.stringify(l)); } catch { /* */ } };
  const mine = list.filter((i) => i.payload.merchant.toLowerCase() === me.toLowerCase());

  const paid = useReadContracts({
    contracts: mine.map((i) => ({ address: AD, abi: BallastRepaymentAdapterAbi, functionName: "invoicePaid", args: [invoiceKeyOf(i.payload.merchant, i.invoiceId as `0x${string}`)] }) as const),
    query: { enabled: mine.length > 0, refetchInterval: 15_000 },
  });

  if (reads.isLoading) return <p className="text-sm text-muted">Reading your Mezo loan…</p>;
  if (reads.error) return <Notice tone="bad" title="Could not read Mezo testnet">{reads.error.message.split("\n")[0]}</Notice>;
  if (status !== 1) {
    return (
      <Notice tone="neutral" title="No active Mezo loan in this wallet">
        This wallet has no open Mezo trove. If your loan lives in a Ballast account, use the Account and Invoices pages instead; otherwise open a loan at testnet.mezo.org.
      </Notice>
    );
  }

  let amt = 0n, repay = 0n, formErr: string | undefined;
  try {
    amt = parseUnits(amount || "0", 18);
    const bps = Math.round(Number(repayPct) * 100);
    if (!(bps >= 0 && bps <= 10_000)) formErr = "Repay share must be 0–100%.";
    else repay = (amt * BigInt(bps)) / 10_000n;
  } catch { formErr = "Enter a valid amount."; }
  if (!formErr && maxRep !== undefined && repay > maxRep) formErr = `Repay share ${fmt(repay)} MUSD is more than your loan can accept right now (${fmt(maxRep)} MUSD above Mezo's 2,000 MUSD minimum debt). The payment would fail.`;

  async function create() {
    setErr(undefined);
    try {
      if (formErr) throw new Error(formErr);
      if (amt <= 0n) throw new Error("Amount must be positive");
      if (nonce === undefined) throw new Error("Mezo nonce not loaded");
      const salt = randomSalt();
      const invoiceId = invoiceIdOf(memo, salt);
      const expiry = BigInt(Math.floor(Date.now() / 1000) + Math.round(Number(hours) * 3600));
      const invoiceSig = await signTypedDataAsync({
        domain: directInvoiceDomain, types: directInvoiceTypes, primaryType: "DirectInvoice",
        message: { merchant: me, invoiceId, amount: amt, repayAmount: repay, expiry },
      });
      const repaySig = repay === 0n ? "0x" : await signTypedDataAsync({
        domain: mezoSignaturesDomain, types: mezoRepayTypes, primaryType: "RepayMUSD",
        message: { amount: repay, borrower: me, nonce, deadline: expiry },
      });
      const payload: DirectInvoicePayload = {
        v: 2, merchant: me, amount: amt.toString(), repayAmount: repay.toString(), expiry: expiry.toString(),
        memo, salt, invoiceSig, repaySig: repaySig as `0x${string}`, mezoNonce: nonce.toString(),
      };
      const link = `${window.location.origin}/pay/${encodeInvoice(payload)}`;
      save([{ payload, link, invoiceId, createdAt: Date.now() }, ...list].slice(0, 50));
    } catch (e) {
      setErr((e as Error).message.split("\n")[0]);
    }
  }

  return (
    <>
      <Card title="Your Mezo loan (wallet-held)" right={<Badge tone="ok">Active</Badge>}>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Total debt" value={`${fmt(debt)} MUSD`} />
          <Stat label="Collateral" value={`${fmt(coll, 18, 4)} BTC`} />
          <Stat label="ICR" value={coll !== undefined && debt !== undefined && price !== undefined ? pct(icr(coll, debt, price)) : "—"} sub={price !== undefined ? `at ${fmt(price)} MUSD/BTC` : undefined} />
          <Stat label="Repayable now" value={`${fmt(maxRep)} MUSD`} sub="above Mezo's minimum debt" />
        </div>
      </Card>

      <Card title="New invoice with loan repayment">
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="Amount (MUSD)"><input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Repay share (%)" hint="Of each payment"><input className={inputCls} inputMode="decimal" value={repayPct} onChange={(e) => setRepayPct(e.target.value)} /></Field>
          <Field label="Memo (shown to payer)" hint="Bound to the signature"><input className={inputCls} maxLength={200} value={memo} onChange={(e) => setMemo(e.target.value)} /></Field>
          <Field label="Expires in (hours)"><input className={inputCls} inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
        </div>
        <p className="mt-3 text-sm num">{fmt(repay)} MUSD repays your loan · {fmt(amt - repay)} MUSD paid to you.</p>
        {formErr && <div className="mt-3"><Notice tone="warn">{formErr}</Notice></div>}
        <div className="mt-3"><Notice tone="neutral" title="What you sign (no gas)">
          1) the invoice, and 2) Mezo&apos;s own one-off repayment message for exactly {fmt(repay)} MUSD (Mezo nonce {nonce?.toString() ?? "…"}).
          Mezo uses each nonce once, so only one such invoice can be outstanding at a time: signing any other Mezo signed action first, or another of these invoices being paid, invalidates it.
          The payer&apos;s MUSD is what repays your loan; none of yours is touched.
        </Notice></div>
        <div className="mt-4"><Button onClick={create} disabled={isPending || !!formErr}>{isPending ? "Sign in wallet…" : "Sign & create link"}</Button></div>
        {err && <div className="mt-3"><Notice tone="bad">{err}</Notice></div>}
      </Card>

      <Card title="Your invoices (this browser)">
        {mine.length === 0 ? <p className="text-sm text-muted">No invoices created in this browser yet.</p> : (
          <ul className="divide-y divide-border text-sm">
            {mine.map((i, k) => {
              const isPaid = paid.data?.[k]?.result === true;
              const expired = Number(i.payload.expiry) * 1000 < Date.now();
              const stale = !isPaid && BigInt(i.payload.repayAmount) > 0n && nonce !== undefined && nonce.toString() !== i.payload.mezoNonce;
              return (
                <li key={i.invoiceId} className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="num font-medium">{fmt(BigInt(i.payload.amount))} MUSD <span className="font-normal text-muted">· {fmt(BigInt(i.payload.repayAmount))} repays loan{i.payload.memo && ` — ${i.payload.memo}`}</span></div>
                    <div className="truncate font-mono text-xs text-muted">{i.invoiceId}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isPaid ? <Badge tone="ok">Paid (on-chain)</Badge> : expired ? <Badge tone="neutral">Expired</Badge> : stale ? <Badge tone="bad">Repay signature used up</Badge> : <Badge tone="warn">Unpaid</Badge>}
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
