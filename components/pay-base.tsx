"use client";
import { useEffect, useState } from "react";
import { useAccount, usePublicClient, useReadContract, useSwitchChain, useWriteContract } from "wagmi";
import { decodeEventLog, parseEventLogs, type Address, type Hex, type TransactionReceipt } from "viem";
import { Badge, Button, Card, Notice, Stat, TxLink, fmt } from "@/components/ui";
import { errMsg } from "@/components/tx";
import { BallastBridgeReceiverAbi, MUSDAbi, PoolsRouterAbi, SortedTrovesAbi, TroveManagerAbi, WormholeCoreAbi, WormholeTokenBridgeAbi } from "@/lib/abis";
import { baseSepoliaChain, baseTxUrl, cfg, mezoTestnet } from "@/lib/config";
import { addressToBytes32, encodeBridgePayload, fetchVaa, usdcFor } from "@/lib/bridge/base";
import { computeHints } from "@/lib/mezo/hints";
import { principalAfterRepay } from "@/lib/radar/math";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
type Progress = { baseTx?: Hex; sequence?: string; settleTx?: Hex };

/**
 * Pay a Ballast invoice with USDC on Base Sepolia:
 *  1) Base: approve + Wormhole Token Bridge transferTokensWithPayload(USDC → BallastBridgeReceiver on Mezo, payload = invoice)
 *  2) Guardians sign the transfer (VAA, from Wormholescan)
 *  3) Mezo: BallastBridgeReceiver.settle(vaa): redeem → swap USDC→MUSD → pay invoice (split + repay), one tx.
 */
export function PayFromBase(props: {
  invoice: { tokenId: bigint; invoiceId: Hex; amount: bigint; expiry: bigint };
  sig: Hex;
  acct?: Address;
  repayShare: bigint;
  blocked: boolean;
}) {
  const RCV = cfg.ballast.BallastBridgeReceiver;
  const W = cfg.ballast.BridgedUSDC;
  if (!RCV || !W) {
    return <Notice tone="neutral" title="Pay with USDC from Base Sepolia">Not configured on this deployment yet.</Notice>;
  }
  return <Inner {...props} rcv={RCV} wusdc={W} />;
}

function Inner({ invoice, sig, acct, repayShare, blocked, rcv, wusdc }: Parameters<typeof PayFromBase>[0] & { rcv: Address; wusdc: Address }) {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const baseClient = usePublicClient({ chainId: baseSepoliaChain.id });
  const mezoClient = usePublicClient({ chainId: mezoTestnet.id });
  const key = `ballast.base-pay.${invoice.invoiceId}`;
  const [prog, setProg] = useState<Progress>({});
  const [busy, setBusy] = useState<string>();
  const [err, setErr] = useState<string>();
  const [result, setResult] = useState<{ receipt: TransactionReceipt; paid: boolean; musdOut?: bigint; change?: bigint; usdcIn?: bigint; reason?: string }>();
  useEffect(() => { try { setProg(JSON.parse(localStorage.getItem(key) || "{}")); } catch { /* storage unavailable */ } }, [key]);
  const save = (p: Progress) => { setProg(p); try { localStorage.setItem(key, JSON.stringify(p)); } catch { /* */ } };

  // USDC to send: smallest of a few candidates the real Mezo pool turns into ≥ invoice amount (+0.3% margin).
  const [usdc, setUsdc] = useState<bigint>();
  useEffect(() => {
    let off = false;
    (async () => {
      if (!mezoClient) return;
      for (const bump of [30n, 100n, 300n, 1000n]) {
        const x = usdcFor(invoice.amount, bump);
        try {
          const out = await mezoClient.readContract({ address: cfg.mezo.PoolsRouter, abi: PoolsRouterAbi, functionName: "getAmountsOut", args: [x, [{ from: wusdc, to: cfg.mezo.MUSD, stable: true, factory: cfg.mezo.PoolFactory }]] });
          if (out[out.length - 1] >= invoice.amount) { if (!off) setUsdc(x); return; }
        } catch { /* pool read failed; try next */ }
      }
    })();
    return () => { off = true; };
  }, [mezoClient, invoice.amount, wusdc]);

  const usdcBal = useReadContract({ chainId: baseSepoliaChain.id, address: cfg.baseSepolia.USDC, abi: MUSDAbi, functionName: "balanceOf", args: [address ?? ZERO], query: { enabled: !!address, refetchInterval: 15_000 } });
  const usdcAllow = useReadContract({ chainId: baseSepoliaChain.id, address: cfg.baseSepolia.USDC, abi: MUSDAbi, functionName: "allowance", args: [address ?? ZERO, cfg.baseSepolia.WormholeTokenBridge], query: { enabled: !!address, refetchInterval: 15_000 } });
  const fee = useReadContract({ chainId: baseSepoliaChain.id, address: cfg.baseSepolia.WormholeCore, abi: WormholeCoreAbi, functionName: "messageFee" });

  // Poll Wormholescan for the signed VAA once the Base tx is known.
  const [vaa, setVaa] = useState<Hex | null>(null);
  useEffect(() => {
    if (!prog.sequence || prog.settleTx) return;
    let off = false;
    const tick = async () => {
      try { const v = await fetchVaa(BigInt(prog.sequence!)); if (!off && v) setVaa(v); } catch { /* retry */ }
    };
    tick();
    const id = setInterval(tick, 15_000);
    return () => { off = true; clearInterval(id); };
  }, [prog.sequence, prog.settleTx]);

  async function onBase<T>(label: string, f: () => Promise<T>) {
    setErr(undefined); setBusy(label);
    try {
      if (chainId !== baseSepoliaChain.id) await switchChainAsync({ chainId: baseSepoliaChain.id });
      return await f();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(undefined); }
  }

  async function approve() {
    await onBase("approve", async () => {
      const h = await writeContractAsync({ chainId: baseSepoliaChain.id, address: cfg.baseSepolia.USDC, abi: MUSDAbi, functionName: "approve", args: [cfg.baseSepolia.WormholeTokenBridge, usdc!] });
      await baseClient!.waitForTransactionReceipt({ hash: h });
      usdcAllow.refetch();
    });
  }

  async function send() {
    await onBase("send", async () => {
      const payload = encodeBridgePayload({ invoice, invoiceSig: sig, refundTo: address!, minMusdOut: invoice.amount });
      const nonce = Math.floor(Math.random() * 2 ** 31);
      const req = {
        chainId: baseSepoliaChain.id, address: cfg.baseSepolia.WormholeTokenBridge, abi: WormholeTokenBridgeAbi, functionName: "transferTokensWithPayload",
        args: [cfg.baseSepolia.USDC, usdc!, cfg.mezo.WormholeChainId, addressToBytes32(rcv), nonce, payload], value: fee.data ?? 0n, account: address,
      } as const;
      await baseClient!.simulateContract(req);
      const h = await writeContractAsync(req);
      save({ baseTx: h });
      const r = await baseClient!.waitForTransactionReceipt({ hash: h });
      if (r.status !== "success") throw new Error("Base transaction reverted");
      const logs = parseEventLogs({ abi: WormholeCoreAbi, logs: r.logs, eventName: "LogMessagePublished" })
        .filter((l) => l.address.toLowerCase() === cfg.baseSepolia.WormholeCore.toLowerCase() && l.args.sender.toLowerCase() === cfg.baseSepolia.WormholeTokenBridge.toLowerCase());
      if (logs.length !== 1) throw new Error("Could not find the Wormhole message in the Base receipt");
      save({ baseTx: h, sequence: logs[0].args.sequence.toString() });
      usdcBal.refetch();
    });
  }

  async function settle() {
    setErr(undefined); setBusy("settle");
    try {
      if (chainId !== mezoTestnet.id) await switchChainAsync({ chainId: mezoTestnet.id });
      let up = ZERO, lo = ZERO;
      if (acct && repayShare > 0n) {
        const tm = cfg.mezo.TroveManager;
        const [coll, principal, interest] = await Promise.all([
          mezoClient!.readContract({ address: tm, abi: TroveManagerAbi, functionName: "getTroveColl", args: [acct] }),
          mezoClient!.readContract({ address: tm, abi: TroveManagerAbi, functionName: "getTrovePrincipal", args: [acct] }),
          mezoClient!.readContract({ address: tm, abi: TroveManagerAbi, functionName: "getTroveInterestOwed", args: [acct] }),
        ]);
        const inList = await mezoClient!.readContract({ address: cfg.mezo.SortedTroves, abi: SortedTrovesAbi, functionName: "contains", args: [acct] });
        if (inList) [up, lo] = await computeHints(mezoClient!, coll, principalAfterRepay(principal, interest, repayShare) || 1n);
      }
      const req = { chainId: mezoTestnet.id, address: rcv, abi: BallastBridgeReceiverAbi, functionName: "settle", args: [vaa!, up, lo], account: address, gas: 3_500_000n } as const;
      await mezoClient!.simulateContract(req);
      const h = await writeContractAsync(req);
      const r = await mezoClient!.waitForTransactionReceipt({ hash: h });
      if (r.status !== "success") throw new Error("Mezo settle transaction reverted");
      save({ ...prog, settleTx: h });
      let res: NonNullable<typeof result> = { receipt: r, paid: false };
      for (const l of r.logs) {
        if (l.address.toLowerCase() !== rcv.toLowerCase()) continue;
        try {
          const ev = decodeEventLog({ abi: BallastBridgeReceiverAbi, data: l.data, topics: l.topics });
          if (ev.eventName === "BridgedInvoicePaid") res = { receipt: r, paid: true, musdOut: ev.args.musdOut, change: ev.args.change, usdcIn: ev.args.usdcIn };
          if (ev.eventName === "BridgedPaymentRefunded") res = { receipt: r, paid: false, reason: "Refunded to your Mezo address" };
        } catch { /* other events */ }
      }
      setResult(res);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(undefined); }
  }

  const enough = usdcBal.data !== undefined && usdc !== undefined && usdcBal.data >= usdc;
  const approved = usdcAllow.data !== undefined && usdc !== undefined && usdcAllow.data >= usdc;
  return (
    <Card title="Or pay with USDC on Base Sepolia" right={<Badge tone="ok">Wormhole Token Bridge</Badge>}>
      <p className="text-sm text-muted">
        Your USDC moves from Base Sepolia to Mezo through Wormhole&apos;s token bridge (guardian-signed), is swapped to MUSD in a Mezo Pools USDC/MUSD pool
        <strong> created and seeded by the Ballast team</strong> (no such pool existed on testnet), then pays this invoice: same split and loan repayment, in one Mezo transaction.
        If anything fails (expired, already paid, slippage), the MUSD or USDC is sent to your address on Mezo instead.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
        <Stat label="You send" value={usdc !== undefined ? `${fmt(usdc, 6, 2)} USDC` : "Quoting…"} sub={`covers ${fmt(invoice.amount)} MUSD; change returned on Mezo`} />
        <Stat label="Your USDC (Base Sepolia)" value={fmt(usdcBal.data, 6, 2)} />
        <Stat label="Arrives at" value="Mezo, same wallet address" sub="for change or refunds" />
      </div>
      {!address && <div className="mt-3"><Notice tone="neutral">Connect a wallet to pay from Base Sepolia.</Notice></div>}
      {address && !prog.baseTx && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" disabled={blocked || !usdc || approved || !!busy || !enough} onClick={approve}>{busy === "approve" ? "Confirm on Base…" : approved ? "USDC approved" : "1. Approve USDC (Base)"}</Button>
          <Button disabled={blocked || !usdc || !approved || !!busy || !enough} onClick={send}>{busy === "send" ? "Confirm on Base…" : "2. Send via Wormhole"}</Button>
        </div>
      )}
      {address && !enough && usdcBal.data !== undefined && !prog.baseTx && <div className="mt-3"><Notice tone="warn">Not enough USDC on Base Sepolia. Get test USDC at faucet.circle.com.</Notice></div>}
      {prog.baseTx && (
        <div className="mt-4 space-y-2 text-sm">
          <div>Base transaction: <a className="font-mono text-accent-strong underline" href={baseTxUrl(prog.baseTx)} target="_blank" rel="noreferrer">{prog.baseTx.slice(0, 10)}… ↗</a>{prog.sequence && <> · Wormhole sequence {prog.sequence}</>}</div>
          {!prog.settleTx && !vaa && prog.sequence && <Notice tone="warn">Waiting for Wormhole guardians to sign (Base finality — usually several minutes). This page checks every 15 s; you can leave and come back.</Notice>}
          {!prog.settleTx && vaa && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="ok">Guardians signed</Badge>
              <Button disabled={!!busy} onClick={settle}>{busy === "settle" ? "Confirm on Mezo…" : "3. Settle on Mezo"}</Button>
            </div>
          )}
          {prog.settleTx && <div>Mezo settlement: <TxLink hash={prog.settleTx} /></div>}
        </div>
      )}
      {err && <div className="mt-3"><Notice tone="bad">{err}</Notice></div>}
      {result && (
        <div className="mt-4">
          {result.paid ? (
            <Notice tone="ok" title="Invoice paid from Base">
              {fmt(result.usdcIn, 6, 2)} USDC → {fmt(result.musdOut)} MUSD; invoice paid (split + loan repayment in the same Mezo tx), {fmt(result.change)} MUSD change sent to you on Mezo. Block {result.receipt.blockNumber.toString()}.
            </Notice>
          ) : <Notice tone="warn" title="Not paid — refunded">{result.reason}. Block {result.receipt.blockNumber.toString()}.</Notice>}
        </div>
      )}
    </Card>
  );
}
