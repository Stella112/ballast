"use client";
import { use, useState } from "react";
import { useAccount, usePublicClient, useReadContract, useReadContracts } from "wagmi";
import { decodeEventLog, parseUnits, stringToHex, zeroAddress, type Address, type TransactionReceipt } from "viem";
import { RequireMezo } from "@/components/wallet";
import { Addr, Badge, Card, Field, Notice, Stat, TxLink, fmt, inputCls, pct } from "@/components/ui";
import { TxButton, TxStatus, useTx } from "@/components/tx";
import { BallastAccountAbi, BallastFactoryAbi, BallastRouterAbi, MUSDAbi, SortedTrovesAbi, TroveManagerAbi } from "@/lib/abis";
import { cfg } from "@/lib/config";
import { computeHints } from "@/lib/mezo/hints";
import { principalAfterRepay } from "@/lib/radar/math";
import { PayMusdFromBase } from "@/components/pay-base-musd";

/** Open pay link for one Ballast account: anyone can send any amount of MUSD; the account's policy splits it. */
export default function PayAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const ok = /^\d{1,12}$/.test(id);
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Pay Ballast account #{ok ? id : "?"}</h1>
      {ok ? <Inner accountId={BigInt(id)} /> : <Notice tone="bad" title="Invalid pay link">This link does not name a Ballast account.</Notice>}
    </div>
  );
}

function Inner({ accountId }: { accountId: bigint }) {
  const RT = cfg.ballast.BallastRouter;
  const client = usePublicClient();
  const { address } = useAccount();
  const [amount, setAmount] = useState("100");
  const [reference, setReference] = useState("");
  let amt = 0n;
  try { amt = parseUnits(amount || "0", 18); } catch { /* invalid */ }
  const refOk = new TextEncoder().encode(reference).length <= 31;

  const account = useReadContract({ address: cfg.ballast.BallastFactory, abi: BallastFactoryAbi, functionName: "accountOf", args: [accountId] });
  const acct = account.data as Address | undefined;
  const known = !!acct && acct !== zeroAddress;
  const reads = useReadContracts({
    contracts: known ? [
      { address: acct!, abi: BallastAccountAbi, functionName: "payoutAddress" },
      { address: acct!, abi: BallastAccountAbi, functionName: "quoteSplit", args: [amt] },
      { address: acct!, abi: BallastAccountAbi, functionName: "currentICR" },
    ] : [],
    query: { enabled: known, refetchInterval: 15_000 },
  });
  const [payout, split, icrNow] = (reads.data ?? []).map((r) => r.result) as [Address?, (readonly bigint[] | undefined)?, bigint?];
  const bal = useReadContract({ address: cfg.mezo.MUSD, abi: MUSDAbi, functionName: "balanceOf", args: [address!], query: { enabled: !!address, refetchInterval: 15_000 } });
  const allowance = useReadContract({ address: cfg.mezo.MUSD, abi: MUSDAbi, functionName: "allowance", args: [address!, RT], query: { enabled: !!address, refetchInterval: 15_000 } });
  const approveTx = useTx();
  const payTx = useTx();
  const [result, setResult] = useState<{ receipt: TransactionReceipt; toOwner?: bigint; toReserve?: bigint; repaid?: bigint; icrBefore?: bigint; icrAfter?: bigint } | null>(null);

  if (account.isLoading) return <p className="text-sm text-muted">Reading Mezo testnet…</p>;
  if (!known) return <Notice tone="bad" title="Unknown account">No Ballast account #{accountId.toString()} exists on Mezo testnet.</Notice>;
  const enough = bal.data !== undefined && bal.data >= amt;
  const approved = allowance.data !== undefined && allowance.data >= amt;
  const repay = split?.[2] ?? 0n;

  async function pay() {
    let up: Address = zeroAddress, lo: Address = zeroAddress;
    if (repay > 0n) {
      const tm = cfg.mezo.TroveManager;
      const [coll, principal, interest, inList] = await Promise.all([
        client!.readContract({ address: tm, abi: TroveManagerAbi, functionName: "getTroveColl", args: [acct!] }),
        client!.readContract({ address: tm, abi: TroveManagerAbi, functionName: "getTrovePrincipal", args: [acct!] }),
        client!.readContract({ address: tm, abi: TroveManagerAbi, functionName: "getTroveInterestOwed", args: [acct!] }),
        client!.readContract({ address: cfg.mezo.SortedTroves, abi: SortedTrovesAbi, functionName: "contains", args: [acct!] }),
      ]);
      if (inList) [up, lo] = await computeHints(client!, coll, principalAfterRepay(principal, interest, repay) || 1n);
    }
    return { address: RT, abi: BallastRouterAbi, functionName: "payWithHints", args: [accountId, amt, stringToHex(reference, { size: 32 }), up, lo], account: address };
  }

  function onPaid(receipt: TransactionReceipt) {
    const r: NonNullable<typeof result> = { receipt };
    for (const l of receipt.logs) {
      if (l.address.toLowerCase() !== RT.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: BallastRouterAbi, data: l.data, topics: l.topics });
        if (ev.eventName === "Payment") Object.assign(r, { toOwner: ev.args.toOwner, toReserve: ev.args.toReserve, repaid: ev.args.repaid, icrBefore: ev.args.icrBefore, icrAfter: ev.args.icrAfter });
      } catch { /* other events */ }
    }
    setResult(r);
    reads.refetch(); bal.refetch(); allowance.refetch();
  }

  return (
    <>
      <Card title="Send MUSD" right={<Badge tone="neutral">Mezo Testnet · chain 31611</Badge>}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Amount (MUSD)"><input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Reference (optional)" hint="Logged on-chain with the payment; max 31 characters"><input className={inputCls} maxLength={31} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. order-1001" /></Field>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
          <Stat label="Recipient account" value={<Addr a={acct} />} sub={<>owner payout <Addr a={payout} /></>} />
          <Stat label="Loan collateral ratio now" value={icrNow && icrNow > 0n ? pct(icrNow) : "—"} sub="read from Mezo" />
        </div>
        {split && amt > 0n && (
          <div className="mt-4 rounded-lg bg-surface-2 p-3 text-sm">
            Split by the owner&apos;s policy right now: <span className="num font-medium">{fmt(split[0])}</span> MUSD to the owner, <span className="num font-medium">{fmt(split[1])}</span> to their hedge reserve,
            <span className="num font-medium"> {fmt(split[2])}</span> repays their Mezo loan. You choose none of the destinations.
          </div>
        )}
      </Card>
      {!refOk && <Notice tone="bad">Reference is too long.</Notice>}
      <RequireMezo purpose="pay this account">
        <Card title="Pay">
          {!enough && bal.data !== undefined && <div className="mb-3"><Notice tone="warn">Your MUSD balance is {fmt(bal.data)} — not enough.</Notice></div>}
          <div className="flex flex-wrap gap-2">
            <TxButton variant="secondary" label={approved && amt > 0n ? "MUSD approved" : `1. Approve ${fmt(amt)} MUSD`} state={approveTx.state} disabled={approved || amt === 0n || !enough}
              onClick={() => approveTx.run(async () => ({ address: cfg.mezo.MUSD, abi: MUSDAbi, functionName: "approve", args: [RT, amt], account: address }), () => allowance.refetch())} />
            <TxButton label="2. Pay" state={payTx.state} disabled={!approved || amt === 0n || !enough || !refOk} onClick={() => payTx.run(pay, onPaid)} />
          </div>
          <p className="mt-2 text-xs text-muted">One transaction: the router pulls your MUSD, pays the owner, credits the reserve and repays the loan. If any part fails, nothing moves.</p>
          <div className="mt-3 space-y-2"><TxStatus state={approveTx.state} /><TxStatus state={payTx.state} /></div>
        </Card>
      </RequireMezo>
      {refOk && <PayMusdFromBase acct={acct!} amount={amt} reference={reference} />}
      {result && (
        <Card title="Receipt (from the router's Payment event)">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <Stat label="Block" value={result.receipt.blockNumber.toString()} sub={<TxLink hash={result.receipt.transactionHash} />} />
            <Stat label="To owner" value={`${fmt(result.toOwner)} MUSD`} />
            <Stat label="To hedge reserve" value={`${fmt(result.toReserve)} MUSD`} />
            <Stat label="Loan repaid" value={`${fmt(result.repaid)} MUSD`} />
            <Stat label="Collateral ratio before" value={result.icrBefore ? pct(result.icrBefore) : "—"} />
            <Stat label="Collateral ratio after" value={result.icrAfter ? pct(result.icrAfter) : "—"} />
          </div>
        </Card>
      )}
    </>
  );
}
