"use client";
import { useEffect, useState } from "react";
import { useAccount, usePublicClient, useReadContract, useSwitchChain, useWriteContract } from "wagmi";
import { decodeEventLog, parseAbi, parseEventLogs, stringToHex, zeroAddress, type Address, type Hex, type TransactionReceipt } from "viem";
import { Badge, Button, Card, Notice, Stat, TxLink, fmt, pct } from "@/components/ui";
import { errMsg } from "@/components/tx";
import { BallastAccountAbi, BallastBaseGatewayAbi, MUSDAbi, SortedTrovesAbi, TroveManagerAbi, WormholeCoreAbi } from "@/lib/abis";
import { baseSepoliaChain, baseTxUrl, cfg, mezoTestnet } from "@/lib/config";
import { fetchVaa } from "@/lib/bridge/base";
import { computeHints } from "@/lib/mezo/hints";
import { principalAfterRepay } from "@/lib/radar/math";

// Wormhole NTT transceiver entry point (v2.0.0). Anyone may deliver a guardian-signed message.
const TransceiverAbi = parseAbi(["function receiveMessage(bytes encodedMessage)"]);
const NTT_UNIT = 10n ** 10n; // NTT carries 8 decimals; MUSD has 18
type Progress = { baseTx?: Hex; sequence?: string; deliverTx?: Hex; applyTx?: Hex };

/**
 * Pay a Ballast Account with MUSD held on Base Sepolia:
 *  1) Base: approve + BallastBaseGateway.pay(account, amount, reference) -> MUSD's own Wormhole NTT bridge, recipient = the account on Mezo
 *  2) Guardians sign the transfer
 *  3) Mezo (anyone / keeper): deliver the message (MUSD lands in the account), then account.processIncome() applies the owner's policy.
 */
export function PayMusdFromBase({ acct, amount, reference }: { acct: Address; amount: bigint; reference: string }) {
  const G = cfg.ballast.BallastBaseGateway, BM = cfg.baseSepolia.MUSD, BX = cfg.baseSepolia.MusdNttTransceiver, MX = cfg.mezo.MusdNttTransceiver;
  if (!G || !BM || !BX || !MX) return null;
  return <Inner acct={acct} amount={amount} reference={reference} gateway={G} baseMusd={BM} baseXcv={BX} mezoXcv={MX} />;
}

function Inner({ acct, amount, reference, gateway, baseMusd, baseXcv, mezoXcv }: { acct: Address; amount: bigint; reference: string; gateway: Address; baseMusd: Address; baseXcv: Address; mezoXcv: Address }) {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const baseClient = usePublicClient({ chainId: baseSepoliaChain.id });
  const mezoClient = usePublicClient({ chainId: mezoTestnet.id });
  const key = `ballast.base-musd.${acct.toLowerCase()}`;
  const [prog, setProg] = useState<Progress>({});
  const [busy, setBusy] = useState<string>();
  const [err, setErr] = useState<string>();
  const [result, setResult] = useState<{ receipt: TransactionReceipt; amount?: bigint; toOwner?: bigint; toReserve?: bigint; repaid?: bigint; icrBefore?: bigint; icrAfter?: bigint }>();
  useEffect(() => { try { setProg(JSON.parse(localStorage.getItem(key) || "{}")); } catch { /* storage unavailable */ } }, [key]);
  const save = (p: Progress) => { setProg(p); try { localStorage.setItem(key, JSON.stringify(p)); } catch { /* */ } };

  const bal = useReadContract({ chainId: baseSepoliaChain.id, address: baseMusd, abi: MUSDAbi, functionName: "balanceOf", args: [address ?? zeroAddress], query: { enabled: !!address, refetchInterval: 15_000 } });
  const allow = useReadContract({ chainId: baseSepoliaChain.id, address: baseMusd, abi: MUSDAbi, functionName: "allowance", args: [address ?? zeroAddress, gateway], query: { enabled: !!address, refetchInterval: 15_000 } });
  const pending = useReadContract({ chainId: mezoTestnet.id, address: acct, abi: BallastAccountAbi, functionName: "pendingIncome", query: { refetchInterval: 15_000 } });

  const [vaa, setVaa] = useState<Hex | null>(null);
  useEffect(() => {
    if (!prog.sequence || prog.deliverTx) return;
    let off = false;
    const tick = async () => { try { const v = await fetchVaa(BigInt(prog.sequence!), baseXcv); if (!off && v) setVaa(v); } catch { /* retry */ } };
    tick();
    const id = setInterval(tick, 15_000);
    return () => { off = true; clearInterval(id); };
  }, [prog.sequence, prog.deliverTx, baseXcv]);

  const dust = amount % NTT_UNIT !== 0n;
  const enough = bal.data !== undefined && bal.data >= amount;
  const approved = allow.data !== undefined && allow.data >= amount && amount > 0n;

  async function run<T>(label: string, chain: 31611 | 84532, f: () => Promise<T>) {
    setErr(undefined); setBusy(label);
    try {
      if (chainId !== chain) await switchChainAsync({ chainId: chain });
      return await f();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(undefined); }
  }

  const approve = () => run("approve", baseSepoliaChain.id, async () => {
    const h = await writeContractAsync({ chainId: baseSepoliaChain.id, address: baseMusd, abi: MUSDAbi, functionName: "approve", args: [gateway, amount] });
    await baseClient!.waitForTransactionReceipt({ hash: h });
    allow.refetch();
  });

  const send = () => run("send", baseSepoliaChain.id, async () => {
    const req = { chainId: baseSepoliaChain.id, address: gateway, abi: BallastBaseGatewayAbi, functionName: "pay", args: [acct, amount, stringToHex(reference, { size: 32 })], account: address } as const;
    await baseClient!.simulateContract(req);
    const h = await writeContractAsync(req);
    save({ baseTx: h });
    const r = await baseClient!.waitForTransactionReceipt({ hash: h });
    if (r.status !== "success") throw new Error("Base transaction reverted");
    const logs = parseEventLogs({ abi: WormholeCoreAbi, logs: r.logs, eventName: "LogMessagePublished" })
      .filter((l) => l.address.toLowerCase() === cfg.baseSepolia.WormholeCore.toLowerCase() && l.args.sender.toLowerCase() === baseXcv.toLowerCase());
    if (logs.length !== 1) throw new Error("Could not find the Wormhole message in the Base receipt");
    save({ baseTx: h, sequence: logs[0].args.sequence.toString() });
    bal.refetch();
  });

  const deliver = () => run("deliver", mezoTestnet.id, async () => {
    const req = { chainId: mezoTestnet.id, address: mezoXcv, abi: TransceiverAbi, functionName: "receiveMessage", args: [vaa!], account: address } as const;
    await mezoClient!.simulateContract(req);
    const h = await writeContractAsync(req);
    const r = await mezoClient!.waitForTransactionReceipt({ hash: h });
    if (r.status !== "success") throw new Error("Delivery reverted on Mezo");
    save({ ...prog, deliverTx: h });
    pending.refetch();
  });

  const apply = () => run("apply", mezoTestnet.id, async () => {
    const income = await mezoClient!.readContract({ address: acct, abi: BallastAccountAbi, functionName: "pendingIncome" });
    if (income === 0n) throw new Error("Nothing to apply: the policy was already applied to this payment (a keeper may have done it).");
    const split = await mezoClient!.readContract({ address: acct, abi: BallastAccountAbi, functionName: "quoteSplit", args: [income] });
    let up: Address = zeroAddress, lo: Address = zeroAddress;
    if (split[2] > 0n) {
      const tm = cfg.mezo.TroveManager;
      const [coll, principal, interest, inList] = await Promise.all([
        mezoClient!.readContract({ address: tm, abi: TroveManagerAbi, functionName: "getTroveColl", args: [acct] }),
        mezoClient!.readContract({ address: tm, abi: TroveManagerAbi, functionName: "getTrovePrincipal", args: [acct] }),
        mezoClient!.readContract({ address: tm, abi: TroveManagerAbi, functionName: "getTroveInterestOwed", args: [acct] }),
        mezoClient!.readContract({ address: cfg.mezo.SortedTroves, abi: SortedTrovesAbi, functionName: "contains", args: [acct] }),
      ]);
      if (inList) [up, lo] = await computeHints(mezoClient!, coll, principalAfterRepay(principal, interest, split[2]) || 1n);
    }
    const req = { chainId: mezoTestnet.id, address: acct, abi: BallastAccountAbi, functionName: "processIncome", args: [up, lo], account: address } as const;
    await mezoClient!.simulateContract(req);
    const h = await writeContractAsync(req);
    const receipt = await mezoClient!.waitForTransactionReceipt({ hash: h });
    if (receipt.status !== "success") throw new Error("Applying the policy reverted");
    const res: NonNullable<typeof result> = { receipt };
    for (const l of receipt.logs) {
      if (l.address.toLowerCase() !== acct.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: BallastAccountAbi, data: l.data, topics: l.topics });
        if (ev.eventName === "PaymentApplied") Object.assign(res, { amount: ev.args.amount, toOwner: ev.args.toOwner, toReserve: ev.args.toReserve, repaid: ev.args.repaid, icrBefore: ev.args.icrBefore, icrAfter: ev.args.icrAfter });
      } catch { /* other events */ }
    }
    setResult(res);
    save({ ...prog, applyTx: h });
    pending.refetch();
  });

  return (
    <Card title="Or pay with MUSD from Base Sepolia" right={<Badge tone="ok">Wormhole NTT (MUSD&apos;s own bridge)</Badge>}>
      <p className="text-sm text-muted">
        Your MUSD on Base goes through Ballast&apos;s Base gateway into the Wormhole Native Token Transfers bridge that MUSD already uses, with this Ballast account as the recipient on Mezo.
        When it lands, anyone can apply the owner&apos;s policy (a keeper step): the sender cannot change where the money goes.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
        <Stat label="You send" value={`${fmt(amount)} MUSD`} sub="on Base Sepolia" />
        <Stat label="Your MUSD (Base Sepolia)" value={fmt(bal.data)} />
        <Stat label="Waiting in the account" value={`${fmt(pending.data)} MUSD`} sub="arrived, policy not yet applied" />
      </div>
      {!address && <div className="mt-3"><Notice tone="neutral">Connect a wallet to pay from Base Sepolia.</Notice></div>}
      {dust && amount > 0n && <div className="mt-3"><Notice tone="warn">The bridge carries 8 decimal places. Use an amount with at most 8 decimals.</Notice></div>}
      {address && !prog.baseTx && (
        <>
          {bal.data !== undefined && !enough && amount > 0n && <div className="mt-3"><Notice tone="warn">You hold {fmt(bal.data)} MUSD on Base Sepolia, which is not enough.</Notice></div>}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" disabled={amount === 0n || dust || approved || !!busy || !enough} onClick={approve}>{busy === "approve" ? "Confirm on Base…" : approved ? "MUSD approved" : "1. Approve MUSD (Base)"}</Button>
            <Button disabled={amount === 0n || dust || !approved || !!busy || !enough} onClick={send}>{busy === "send" ? "Confirm on Base…" : "2. Send through the gateway"}</Button>
          </div>
        </>
      )}
      {prog.baseTx && (
        <ol className="mt-4 space-y-2 text-sm">
          <li>Sent on Base Sepolia: <a className="font-mono text-accent-strong underline-offset-2 hover:underline" href={baseTxUrl(prog.baseTx)} target="_blank" rel="noreferrer">{prog.baseTx.slice(0, 10)}… ↗</a>{prog.sequence && <span className="text-muted"> · bridge message #{prog.sequence}</span>}</li>
          {!prog.deliverTx && <li>{vaa ? <Badge tone="ok">Signed by the Wormhole guardians</Badge> : <Badge tone="warn">Waiting for the Wormhole guardians (usually 15 to 30 minutes on testnet)</Badge>}</li>}
          {prog.deliverTx && <li>Delivered on Mezo: <TxLink hash={prog.deliverTx} /></li>}
          {prog.applyTx && <li>Policy applied: <TxLink hash={prog.applyTx} /></li>}
        </ol>
      )}
      {address && prog.sequence && !prog.applyTx && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" disabled={!vaa || !!prog.deliverTx || !!busy} onClick={deliver}>{busy === "deliver" ? "Confirm on Mezo…" : prog.deliverTx ? "Delivered" : "3. Deliver on Mezo"}</Button>
          <Button disabled={!prog.deliverTx || !!busy} onClick={apply}>{busy === "apply" ? "Confirm on Mezo…" : "4. Apply the owner's policy"}</Button>
        </div>
      )}
      {prog.applyTx && <div className="mt-3"><Button variant="secondary" onClick={() => { save({}); setResult(undefined); setVaa(null); }}>Make another payment</Button></div>}
      {err && <div className="mt-3"><Notice tone="bad">{err}</Notice></div>}
      {result && (
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
          <Stat label="Block" value={result.receipt.blockNumber.toString()} sub={<TxLink hash={result.receipt.transactionHash} />} />
          <Stat label="To owner" value={`${fmt(result.toOwner)} MUSD`} />
          <Stat label="To hedge reserve" value={`${fmt(result.toReserve)} MUSD`} />
          <Stat label="Loan repaid" value={`${fmt(result.repaid)} MUSD`} />
          <Stat label="Collateral ratio before" value={result.icrBefore ? pct(result.icrBefore) : "—"} />
          <Stat label="Collateral ratio after" value={result.icrAfter ? pct(result.icrAfter) : "—"} />
        </div>
      )}
    </Card>
  );
}
