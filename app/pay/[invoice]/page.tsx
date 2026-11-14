"use client";
import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient, useReadContract, useReadContracts } from "wagmi";
import { decodeEventLog, type Address, type TransactionReceipt } from "viem";
import { RequireMezo } from "@/components/wallet";
import { Addr, Badge, Card, Notice, Stat, TxLink, fmt } from "@/components/ui";
import { TxButton, TxStatus, useTx } from "@/components/tx";
import { BallastAccountAbi, BallastFactoryAbi, BallastRouterAbi, MUSDAbi, TroveManagerAbi, SortedTrovesAbi } from "@/lib/abis";
import { cfg } from "@/lib/config";
import { decodeInvoice, invoiceDomain, invoiceIdOf, invoiceTypes } from "@/lib/invoices/invoice";
import { decodeDirectInvoice } from "@/lib/invoices/direct";
import { PayDirect } from "@/components/pay-direct";
import { computeHints } from "@/lib/mezo/hints";
import { principalAfterRepay } from "@/lib/radar/math";

export default function PayPage({ params }: { params: Promise<{ invoice: string }> }) {
  const { invoice } = use(params);
  const inv = decodeInvoice(invoice);
  const direct = inv ? null : decodeDirectInvoice(invoice);
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Pay invoice</h1>
      {inv ? <PayInner inv={inv} /> : direct ? <PayDirect inv={direct} /> : <Notice tone="bad" title="Invalid invoice link">This link could not be decoded. Ask the merchant for a new one.</Notice>}
    </div>
  );
}

function PayInner({ inv }: { inv: NonNullable<ReturnType<typeof decodeInvoice>> }) {
  const tokenId = BigInt(inv.tokenId);
  const amount = BigInt(inv.amount);
  const expiry = BigInt(inv.expiry);
  const invoiceId = invoiceIdOf(inv.memo, inv.salt);
  const client = usePublicClient();
  const { address } = useAccount();

  const account = useReadContract({ address: cfg.ballast.BallastFactory, abi: BallastFactoryAbi, functionName: "accountOf", args: [tokenId] });
  const acct = account.data as Address | undefined;
  const reads = useReadContracts({
    contracts: acct ? [
      { address: acct, abi: BallastAccountAbi, functionName: "controller" },
      { address: acct, abi: BallastAccountAbi, functionName: "policy" },
      { address: acct, abi: BallastAccountAbi, functionName: "payoutAddress" },
      { address: cfg.ballast.BallastRouter, abi: BallastRouterAbi, functionName: "invoicePaid", args: [tokenId, invoiceId] },
      { address: acct, abi: BallastAccountAbi, functionName: "maxRepayable" },
    ] : [],
    query: { enabled: !!acct, refetchInterval: 15_000 },
  });
  const [controller, policy, payout, paid, maxRep] = (reads.data ?? []).map((r) => r.result) as [Address?, { repayBps: number; reserveBps: number; paused: boolean }?, Address?, boolean?, bigint?];
  const split = useReadContract({ address: cfg.ballast.BallastRouter, abi: BallastRouterAbi, functionName: "computeSplit", args: [amount, policy?.repayBps ?? 0, policy?.reserveBps ?? 0, policy?.paused ?? false], query: { enabled: !!policy } });

  const sigOk = useQuery({
    queryKey: ["sig", invoiceId, controller],
    enabled: !!controller && !!client,
    queryFn: () => client!.verifyTypedData({ address: controller!, domain: invoiceDomain, types: invoiceTypes, primaryType: "Invoice", message: { tokenId, invoiceId, amount, expiry }, signature: inv.sig }),
  });

  const bal = useReadContract({ address: cfg.mezo.MUSD, abi: MUSDAbi, functionName: "balanceOf", args: [address!], query: { enabled: !!address, refetchInterval: 15_000 } });
  const allowance = useReadContract({ address: cfg.mezo.MUSD, abi: MUSDAbi, functionName: "allowance", args: [address!, cfg.ballast.BallastRouter], query: { enabled: !!address, refetchInterval: 15_000 } });

  const approveTx = useTx();
  const payTx = useTx();
  const [result, setResult] = useState<{ receipt: TransactionReceipt; spendable?: bigint; reserve?: bigint; repaid?: bigint; debtBefore?: bigint; debtAfter?: bigint } | null>(null);

  const expired = Number(expiry) * 1000 < Date.now();
  const repayShare = split.data?.[2] ?? 0n;
  const floorBlocked = maxRep !== undefined && repayShare > maxRep;
  const blockers: string[] = [];
  if (account.data === "0x0000000000000000000000000000000000000000") blockers.push("Unknown Ballast account.");
  if (sigOk.data === false) blockers.push("Signature does not match the account's current controller (invoice forged, edited, or NFT changed hands).");
  if (paid) blockers.push("This invoice has already been paid.");
  if (expired) blockers.push("This invoice has expired.");
  if (floorBlocked) blockers.push(`The repay share (${fmt(repayShare)} MUSD) exceeds what the merchant's loan can accept (${fmt(maxRep)} MUSD); the payment would revert.`);
  const enough = bal.data !== undefined && bal.data >= amount;
  const approved = allowance.data !== undefined && allowance.data >= amount;

  async function pay() {
    const tm = cfg.mezo.TroveManager;
    const [coll, principal, interest] = await Promise.all([
      client!.readContract({ address: tm, abi: TroveManagerAbi, functionName: "getTroveColl", args: [acct!] }),
      client!.readContract({ address: tm, abi: TroveManagerAbi, functionName: "getTrovePrincipal", args: [acct!] }),
      client!.readContract({ address: tm, abi: TroveManagerAbi, functionName: "getTroveInterestOwed", args: [acct!] }),
    ]);
    const inList = await client!.readContract({ address: cfg.mezo.SortedTroves, abi: SortedTrovesAbi, functionName: "contains", args: [acct!] });
    const zero = "0x0000000000000000000000000000000000000000" as Address;
    const [up, lo] = inList && repayShare > 0n ? await computeHints(client!, coll, principalAfterRepay(principal, interest, repayShare) || 1n) : [zero, zero];
    return { address: cfg.ballast.BallastRouter, abi: BallastRouterAbi, functionName: "payInvoice", args: [{ tokenId, invoiceId, amount, expiry }, inv.sig, up, lo], account: address };
  }

  function onPaid(receipt: TransactionReceipt) {
    const r: NonNullable<typeof result> = { receipt };
    for (const l of receipt.logs) {
      try {
        if (l.address.toLowerCase() === cfg.ballast.BallastRouter.toLowerCase()) {
          const ev = decodeEventLog({ abi: BallastRouterAbi, data: l.data, topics: l.topics });
          if (ev.eventName === "InvoicePaid") Object.assign(r, { spendable: ev.args.spendable, reserve: ev.args.reserve, repaid: ev.args.repaid });
        }
        if (acct && l.address.toLowerCase() === acct.toLowerCase()) {
          const ev = decodeEventLog({ abi: BallastAccountAbi, data: l.data, topics: l.topics });
          if (ev.eventName === "Repaid") Object.assign(r, { debtBefore: ev.args.debtBefore, debtAfter: ev.args.debtAfter });
        }
      } catch { /* other contracts' logs */ }
    }
    setResult(r);
    reads.refetch(); bal.refetch(); allowance.refetch();
  }

  return (
    <>
      {(account.error || reads.error || sigOk.error) && (
        <Notice tone="bad" title="Could not read Mezo testnet">{String((account.error || reads.error || sigOk.error)?.message).split("\n")[0]}</Notice>
      )}
      <Card title={<span className="num text-2xl">{fmt(amount)} MUSD</span>} right={paid ? <Badge tone="ok">Paid</Badge> : expired ? <Badge tone="bad">Expired</Badge> : <Badge tone="warn">Awaiting payment</Badge>}>
        {inv.memo && <p className="mb-4 text-sm">“{inv.memo}”</p>}
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Merchant account" value={<Addr a={acct} />} sub={`Ballast #${inv.tokenId}`} />
          <Stat label="Merchant signature" value={sigOk.data === true ? "Valid" : sigOk.data === false ? "Invalid" : sigOk.error ? "Check failed" : "Checking…"} sub={<>signer <Addr a={controller} /></>} />
          <Stat label="Network" value="Mezo Testnet" sub="chain 31611" />
          <Stat label="Expires" value={new Date(Number(expiry) * 1000).toLocaleString()} />
        </div>
        {split.data && (
          <div className="mt-4 rounded-lg bg-surface-2 p-3 text-sm">
            Your payment will be split by the merchant&apos;s current policy: <span className="num font-medium">{fmt(split.data[0])}</span> to the merchant (<Addr a={payout} />), <span className="num font-medium">{fmt(split.data[1])}</span> to their reserve, <span className="num font-medium">{fmt(split.data[2])}</span> repays their Mezo loan.
          </div>
        )}
      </Card>

      {blockers.map((b) => <Notice key={b} tone="bad">{b}</Notice>)}
      <RequireMezo purpose="pay this invoice">
        <Card title="Pay">
          {!enough && bal.data !== undefined && <div className="mb-3"><Notice tone="warn">Your MUSD balance is {fmt(bal.data)} — not enough.</Notice></div>}
          <div className="flex flex-wrap gap-2">
            <TxButton variant="secondary" label={approved ? "MUSD approved" : `1. Approve ${fmt(amount)} MUSD`} state={approveTx.state} disabled={approved || blockers.length > 0 || !enough}
              onClick={() => approveTx.run(async () => ({ address: cfg.mezo.MUSD, abi: MUSDAbi, functionName: "approve", args: [cfg.ballast.BallastRouter, amount], account: address }), () => allowance.refetch())} />
            <TxButton label="2. Pay invoice" state={payTx.state} disabled={!approved || blockers.length > 0 || !enough} onClick={() => payTx.run(pay, onPaid)} />
          </div>
          <p className="mt-2 text-xs text-muted">Approval is for this exact amount. The payment, split and loan repayment happen atomically in step 2 — if any part fails, nothing moves.</p>
          <div className="mt-3 space-y-2"><TxStatus state={approveTx.state} /><TxStatus state={payTx.state} /></div>
        </Card>
      </RequireMezo>

      {result && (
        <Card title="Receipt (from on-chain events)">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <Stat label="Block" value={result.receipt.blockNumber.toString()} sub={<TxLink hash={result.receipt.transactionHash} />} />
            <Stat label="To merchant" value={`${fmt(result.spendable)} MUSD`} />
            <Stat label="To reserve" value={`${fmt(result.reserve)} MUSD`} />
            <Stat label="Loan repaid" value={`${fmt(result.repaid)} MUSD`} />
            <Stat label="Merchant debt before" value={result.debtBefore !== undefined ? fmt(result.debtBefore, 18, 4) : "—"} />
            <Stat label="Merchant debt after" value={result.debtAfter !== undefined ? fmt(result.debtAfter, 18, 4) : "—"} />
          </div>
        </Card>
      )}
    </>
  );
}
