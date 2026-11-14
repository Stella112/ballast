"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient, useReadContract, useReadContracts } from "wagmi";
import { decodeEventLog, type TransactionReceipt } from "viem";
import { RequireMezo } from "@/components/wallet";
import { Addr, Badge, Card, Notice, Stat, fmt, TxLink } from "@/components/ui";
import { TxButton, TxStatus, useTx } from "@/components/tx";
import { BallastRepaymentAdapterAbi, MUSDAbi, TroveManagerAbi } from "@/lib/abis";
import { cfg } from "@/lib/config";
import { invoiceIdOf } from "@/lib/invoices/invoice";
import { directInvoiceDomain, directInvoiceTypes, invoiceKeyOf, mezoRepayTypes, mezoSignaturesDomain, type DirectInvoicePayload } from "@/lib/invoices/direct";
import { computeHints } from "@/lib/mezo/hints";
import { principalAfterRepay } from "@/lib/radar/math";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

/** Pay an invoice from a borrower whose Mezo loan is held by their wallet (BallastRepaymentAdapter). */
export function PayDirect({ inv }: { inv: DirectInvoicePayload }) {
  const AD = cfg.ballast.BallastRepaymentAdapter;
  const merchant = inv.merchant;
  const amount = BigInt(inv.amount);
  const repay = BigInt(inv.repayAmount);
  const expiry = BigInt(inv.expiry);
  const invoiceId = invoiceIdOf(inv.memo, inv.salt);
  const client = usePublicClient();
  const { address } = useAccount();

  const reads = useReadContracts({
    contracts: [
      { address: AD, abi: BallastRepaymentAdapterAbi, functionName: "invoicePaid", args: [invoiceKeyOf(merchant, invoiceId)] },
      { address: AD, abi: BallastRepaymentAdapterAbi, functionName: "maxRepayable", args: [merchant] },
      { address: AD, abi: BallastRepaymentAdapterAbi, functionName: "mezoNonce", args: [merchant] },
      { address: cfg.mezo.TroveManager, abi: TroveManagerAbi, functionName: "getTroveStatus", args: [merchant] },
    ],
    query: { refetchInterval: 15_000 },
  });
  const [paid, maxRep, nonce, status] = (reads.data ?? []).map((r) => r.result) as [boolean?, bigint?, bigint?, number?];

  const sigs = useQuery({
    queryKey: ["direct-sigs", invoiceId, merchant],
    enabled: !!client,
    queryFn: async () => {
      const invoiceOk = await client!.verifyTypedData({
        address: merchant, domain: directInvoiceDomain, types: directInvoiceTypes, primaryType: "DirectInvoice",
        message: { merchant, invoiceId, amount, repayAmount: repay, expiry }, signature: inv.invoiceSig,
      });
      const repayOk = repay === 0n ? true : await client!.verifyTypedData({
        address: merchant, domain: mezoSignaturesDomain, types: mezoRepayTypes, primaryType: "RepayMUSD",
        message: { amount: repay, borrower: merchant, nonce: BigInt(inv.mezoNonce), deadline: expiry }, signature: inv.repaySig,
      });
      return { invoiceOk, repayOk };
    },
  });

  const bal = useReadContract({ address: cfg.mezo.MUSD, abi: MUSDAbi, functionName: "balanceOf", args: [address!], query: { enabled: !!address, refetchInterval: 15_000 } });
  const allowance = useReadContract({ address: cfg.mezo.MUSD, abi: MUSDAbi, functionName: "allowance", args: [address!, AD], query: { enabled: !!address, refetchInterval: 15_000 } });
  const approveTx = useTx();
  const payTx = useTx();
  const [result, setResult] = useState<{ receipt: TransactionReceipt; repaid?: bigint; toMerchant?: bigint; debtBefore?: bigint; debtAfter?: bigint } | null>(null);

  const expired = Number(expiry) * 1000 < Date.now();
  const blockers: string[] = [];
  if (sigs.data?.invoiceOk === false) blockers.push("The invoice signature does not match the merchant (forged or edited link).");
  if (sigs.data?.repayOk === false) blockers.push("The Mezo repayment signature does not match this invoice.");
  if (paid) blockers.push("This invoice has already been paid.");
  if (expired) blockers.push("This invoice has expired.");
  if (repay > 0n && status !== undefined && status !== 1) blockers.push("The merchant has no active Mezo loan, so the repayment cannot happen.");
  if (repay > 0n && nonce !== undefined && nonce.toString() !== inv.mezoNonce && !paid) blockers.push("The merchant's one-off Mezo repayment signature has already been used or replaced (their Mezo nonce moved on). Ask for a new link.");
  if (repay > 0n && maxRep !== undefined && repay > maxRep) blockers.push(`The repayment (${fmt(repay)} MUSD) is more than the merchant's loan can accept now (${fmt(maxRep)} MUSD); the payment would revert.`);
  const enough = bal.data !== undefined && bal.data >= amount;
  const approved = allowance.data !== undefined && allowance.data >= amount;

  async function pay() {
    let up: `0x${string}` = ZERO, lo: `0x${string}` = ZERO;
    if (repay > 0n) {
      const tm = cfg.mezo.TroveManager;
      const [coll, principal, interest] = await Promise.all([
        client!.readContract({ address: tm, abi: TroveManagerAbi, functionName: "getTroveColl", args: [merchant] }),
        client!.readContract({ address: tm, abi: TroveManagerAbi, functionName: "getTrovePrincipal", args: [merchant] }),
        client!.readContract({ address: tm, abi: TroveManagerAbi, functionName: "getTroveInterestOwed", args: [merchant] }),
      ]);
      [up, lo] = await computeHints(client!, coll, principalAfterRepay(principal, interest, repay) || 1n);
    }
    return {
      address: AD, abi: BallastRepaymentAdapterAbi, functionName: "payDirectInvoice", account: address,
      args: [{ merchant, invoiceId, amount, repayAmount: repay, expiry }, inv.invoiceSig, { deadline: expiry, signature: repay > 0n ? inv.repaySig : "0x", upperHint: up, lowerHint: lo }],
    };
  }

  function onPaid(receipt: TransactionReceipt) {
    const r: NonNullable<typeof result> = { receipt };
    for (const l of receipt.logs) {
      if (l.address.toLowerCase() !== AD.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: BallastRepaymentAdapterAbi, data: l.data, topics: l.topics });
        if (ev.eventName === "DirectInvoicePaid") Object.assign(r, { repaid: ev.args.repaid, toMerchant: ev.args.toMerchant, debtBefore: ev.args.debtBefore, debtAfter: ev.args.debtAfter });
      } catch { /* other events */ }
    }
    setResult(r);
    reads.refetch(); bal.refetch(); allowance.refetch();
  }

  return (
    <>
      {(reads.error || sigs.error) && <Notice tone="bad" title="Could not read Mezo testnet">{String((reads.error || sigs.error)?.message).split("\n")[0]}</Notice>}
      <Card title={<span className="num text-2xl">{fmt(amount)} MUSD</span>} right={paid ? <Badge tone="ok">Paid</Badge> : expired ? <Badge tone="bad">Expired</Badge> : <Badge tone="warn">Awaiting payment</Badge>}>
        {inv.memo && <p className="mb-4 text-sm">“{inv.memo}”</p>}
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Merchant" value={<Addr a={merchant} />} sub="Mezo loan held by this wallet" />
          <Stat label="Signatures" value={sigs.data ? (sigs.data.invoiceOk && sigs.data.repayOk ? "Valid" : "Invalid") : sigs.error ? "Check failed" : "Checking…"} sub="invoice + Mezo one-off repayment" />
          <Stat label="Network" value="Mezo Testnet" sub="chain 31611" />
          <Stat label="Expires" value={new Date(Number(expiry) * 1000).toLocaleString()} />
        </div>
        <div className="mt-4 rounded-lg bg-surface-2 p-3 text-sm">
          In one transaction: <span className="num font-medium">{fmt(amount - repay)}</span> MUSD goes to the merchant and <span className="num font-medium">{fmt(repay)}</span> MUSD repays their Mezo loan
          (Mezo&apos;s <code>repayMUSDWithSignature</code>, authorised once by the merchant).
        </div>
      </Card>

      {blockers.map((b) => <Notice key={b} tone="bad">{b}</Notice>)}
      <RequireMezo purpose="pay this invoice">
        <Card title="Pay">
          {!enough && bal.data !== undefined && <div className="mb-3"><Notice tone="warn">Your MUSD balance is {fmt(bal.data)} — not enough.</Notice></div>}
          <div className="flex flex-wrap gap-2">
            <TxButton variant="secondary" label={approved ? "MUSD approved" : `1. Approve ${fmt(amount)} MUSD`} state={approveTx.state} disabled={approved || blockers.length > 0 || !enough}
              onClick={() => approveTx.run(async () => ({ address: cfg.mezo.MUSD, abi: MUSDAbi, functionName: "approve", args: [AD, amount], account: address }), () => allowance.refetch())} />
            <TxButton label="2. Pay invoice" state={payTx.state} disabled={!approved || blockers.length > 0 || !enough} onClick={() => payTx.run(pay, onPaid)} />
          </div>
          <p className="mt-2 text-xs text-muted">Approval is for this exact amount. If the repayment fails, the whole payment reverts and nothing moves.</p>
          <div className="mt-3 space-y-2"><TxStatus state={approveTx.state} /><TxStatus state={payTx.state} /></div>
        </Card>
      </RequireMezo>

      {result && (
        <Card title="Receipt (from on-chain events)">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <Stat label="Block" value={result.receipt.blockNumber.toString()} sub={<TxLink hash={result.receipt.transactionHash} />} />
            <Stat label="To merchant" value={`${fmt(result.toMerchant)} MUSD`} />
            <Stat label="Loan repaid" value={`${fmt(result.repaid)} MUSD`} />
            <Stat label="Merchant debt before" value={result.debtBefore !== undefined ? fmt(result.debtBefore, 18, 4) : "—"} />
            <Stat label="Merchant debt after" value={result.debtAfter !== undefined ? fmt(result.debtAfter, 18, 4) : "—"} />
          </div>
        </Card>
      )}
    </>
  );
}
