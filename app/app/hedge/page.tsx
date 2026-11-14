"use client";
import { useState } from "react";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { parseUnits, zeroAddress, type Address } from "viem";
import { AccountGate } from "@/components/account-gate";
import { Addr, Badge, Card, Field, Notice, Stat, fmt, inputCls, pct } from "@/components/ui";
import { TxButton, TxStatus, useTx } from "@/components/tx";
import { BallastHedgeAbi, BallastHedgeFactoryAbi, MorphoAbi, MUSDAbi, PoolsRouterAbi, PriceFeedAbi } from "@/lib/abis";
import { cfg } from "@/lib/config";
import type { AccountState } from "@/lib/useBallast";

const LLTV = 860000000000000000n; // 86%, the only LLTV enabled on the Ballast Morpho instance
const WAD = 10n ** 18n;
const B = cfg.ballast;
const route = (from: Address, to: Address) => [{ from, to, stable: false, factory: cfg.mezo.PoolFactory }] as const;

export default function HedgePage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Hedge</h1>
        <Badge tone="ok">Live on Mezo testnet</Badge>
      </div>
      <Notice tone="warn" title="How this market exists — read before using">
        Morpho has no deployment on Mezo testnet, so Ballast deployed the official open-source Morpho Blue v1.0.0 contracts and created a market where you post MUSD and borrow BTC.
        <strong> The BTC lending liquidity was supplied by the Ballast team.</strong> Prices come from Mezo&apos;s own PriceFeed; swaps go through Mezo&apos;s real MUSD/BTC pool.
        A short loses money if BTC rises, costs interest and swap fees, and can be liquidated even while the BTC securing your Mezo loan gains value. Testnet, unaudited.
      </Notice>
      {!B.Morpho || !B.MorphoMarketId || !B.BallastHedgeFactory ? <Notice tone="bad">Hedge contracts are not configured.</Notice> : <><Market /><AccountGate purpose="hedge">{(s) => <HedgeInner s={s} />}</AccountGate></>}
    </div>
  );
}

function useMarket() {
  const q = useReadContracts({
    contracts: [
      { address: B.Morpho!, abi: MorphoAbi, functionName: "market", args: [B.MorphoMarketId!] },
      { address: cfg.mezo.PriceFeed, abi: PriceFeedAbi, functionName: "fetchPrice" },
      { address: cfg.mezo.PoolsRouter, abi: PoolsRouterAbi, functionName: "getAmountsOut", args: [WAD / 1000n, route(B.MorphoBTC!, cfg.mezo.MUSD)] },
    ],
    query: { refetchInterval: 20_000 },
  });
  const [m, price, out] = (q.data ?? []).map((r) => r.result) as [(readonly bigint[] | undefined)?, bigint?, (readonly bigint[] | undefined)?];
  return {
    q,
    totalSupply: m?.[0], totalBorrow: m?.[2],
    oraclePrice: price, // MUSD per BTC (1e18)
    poolPrice: out ? out[out.length - 1] * 1000n : undefined, // MUSD per BTC selling 0.001 BTC
  };
}

function Market() {
  const k = useMarket();
  const avail = k.totalSupply !== undefined && k.totalBorrow !== undefined ? k.totalSupply - k.totalBorrow : undefined;
  return (
    <Card title="Market (Morpho Blue, deployed by Ballast)" right={<Badge tone="neutral">BTC loan · MUSD collateral · LLTV 86%</Badge>}>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="BTC supplied" value={`${fmt(k.totalSupply, 18, 6)} BTC`} sub="by the Ballast team" />
        <Stat label="BTC borrowed" value={`${fmt(k.totalBorrow, 18, 6)} BTC`} />
        <Stat label="Available to borrow" value={`${fmt(avail, 18, 6)} BTC`} />
        <Stat label="BTC price" value={`${fmt(k.oraclePrice, 18, 0)}`} sub={<>Mezo oracle · pool {fmt(k.poolPrice, 18, 0)}</>} />
      </div>
      <p className="mt-3 text-xs text-muted">
        Morpho <Addr a={B.Morpho} /> · oracle <Addr a={B.BallastMezoOracle} /> · IRM <Addr a={B.AdaptiveCurveIrm} /> · market <span className="font-mono">{B.MorphoMarketId!.slice(0, 10)}…</span>.
        Borrowing and liquidation use the Mezo oracle price; selling and buying BTC use the pool price, which can differ on testnet.
      </p>
    </Card>
  );
}

function HedgeInner({ s }: { s: AccountState }) {
  const { address } = useAccount();
  const isController = address?.toLowerCase() === s.controller.toLowerCase();
  const h = useReadContract({ address: B.BallastHedgeFactory!, abi: BallastHedgeFactoryAbi, functionName: "hedgeOf", args: [s.tokenId], query: { refetchInterval: 20_000 } });
  const hedge = h.data as Address | undefined;
  const createTx = useTx();

  if (h.isLoading) return <p className="text-sm text-muted">Loading…</p>;
  if (!hedge || hedge === zeroAddress) {
    return (
      <Card title="Hedge module">
        <p className="mb-3 text-sm text-muted">Each Ballast account gets its own hedge contract, controlled by whoever holds the account NFT. Creating it costs only gas.</p>
        <TxButton label="Create hedge module" state={createTx.state} disabled={!isController}
          onClick={() => createTx.run(async () => ({ address: B.BallastHedgeFactory!, abi: BallastHedgeFactoryAbi, functionName: "create", args: [s.tokenId], account: address }), () => h.refetch())} />
        <div className="mt-3"><TxStatus state={createTx.state} /></div>
      </Card>
    );
  }
  return <Position hedge={hedge} isController={isController} s={s} />;
}

function Position({ hedge, isController, s }: { hedge: Address; isController: boolean; s: AccountState }) {
  const { address } = useAccount();
  const k = useMarket();
  const q = useReadContracts({
    contracts: [
      { address: hedge, abi: BallastHedgeAbi, functionName: "positionInfo" },
      { address: cfg.mezo.MUSD, abi: MUSDAbi, functionName: "balanceOf", args: [hedge] },
      { address: B.MorphoBTC!, abi: MUSDAbi, functionName: "balanceOf", args: [hedge] },
      { address: cfg.mezo.MUSD, abi: MUSDAbi, functionName: "balanceOf", args: [address ?? zeroAddress] },
      { address: cfg.mezo.MUSD, abi: MUSDAbi, functionName: "allowance", args: [address ?? zeroAddress, hedge] },
    ],
    query: { refetchInterval: 15_000 },
  });
  const [info, heldMusd, heldBtc, myMusd, allowance] = (q.data ?? []).map((r) => r.result) as [(readonly bigint[] | undefined)?, bigint?, bigint?, bigint?, bigint?];
  const collateral = info?.[0] ?? 0n, shares = info?.[1] ?? 0n, owed = info?.[2] ?? 0n;
  const open = shares > 0n;

  // Cost to buy back what is owed (+2% buffer for fees and interest until the tx lands), quoted by the real pool.
  const need = useReadContract({
    address: cfg.mezo.PoolsRouter, abi: PoolsRouterAbi, functionName: "getAmountsOut",
    args: [(owed * 102n) / 100n, route(B.MorphoBTC!, cfg.mezo.MUSD)], query: { enabled: open, refetchInterval: 15_000 },
  });
  const needMusd = need.data ? need.data[need.data.length - 1] : undefined;
  const buyback = useReadContract({
    address: cfg.mezo.PoolsRouter, abi: PoolsRouterAbi, functionName: "getAmountsOut",
    args: [owed, route(B.MorphoBTC!, cfg.mezo.MUSD)], query: { enabled: open, refetchInterval: 15_000 },
  });
  const markValue = buyback.data ? buyback.data[buyback.data.length - 1] : undefined;

  const [coll, setColl] = useState("80");
  const [borrow, setBorrow] = useState("0.0005");
  let c = 0n, b = 0n;
  try { c = parseUnits(coll || "0", 18); b = parseUnits(borrow || "0", 18); } catch { /* invalid input */ }
  const sale = useReadContract({
    address: cfg.mezo.PoolsRouter, abi: PoolsRouterAbi, functionName: "getAmountsOut",
    args: [b, route(B.MorphoBTC!, cfg.mezo.MUSD)], query: { enabled: !open && b > 0n },
  });
  const saleOut = sale.data ? sale.data[sale.data.length - 1] : undefined;
  const ltvNew = k.oraclePrice && c > 0n ? (b * k.oraclePrice) / c : undefined; // WAD
  const liqPriceNew = b > 0n ? (LLTV * c) / b : undefined; // MUSD per BTC
  const ltvNow = k.oraclePrice && collateral > 0n ? (owed * k.oraclePrice) / collateral : undefined;
  const liqPriceNow = owed > 0n ? (LLTV * collateral) / owed : undefined;
  const topUp = needMusd !== undefined && heldMusd !== undefined && needMusd > heldMusd ? needMusd - heldMusd : 0n;

  const approveTx = useTx(), openTx = useTx(), topTx = useTx(), closeTx = useTx(), sendTx = useTx();
  const refresh = () => { q.refetch(); k.q.refetch(); need.refetch(); };

  return (
    <>
      <Card title="Your hedge" right={open ? <Badge tone="warn">Short open</Badge> : <Badge tone="neutral">No position</Badge>}>
        <p className="mb-3 text-xs text-muted">Module <Addr a={hedge} /> · controlled by the NFT holder <Addr a={s.controller} />{!isController && " (not your connected wallet)"}</p>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="MUSD collateral (Morpho)" value={fmt(collateral)} />
          <Stat label="BTC owed" value={fmt(owed, 18, 8)} sub="incl. interest to last accrual" />
          <Stat label="Held in module" value={`${fmt(heldMusd)} MUSD`} sub={`${fmt(heldBtc, 18, 8)} BTC`} />
          <Stat label="LTV / liquidation price" value={open ? pct(ltvNow) : "—"} sub={open ? `liquidatable if BTC ≥ ${fmt(liqPriceNow, 18, 0)}` : "86% max"} />
        </div>
        {open && markValue !== undefined && heldMusd !== undefined && (
          <p className="mt-3 text-sm num">
            Estimated P/L if closed now: <strong className={heldMusd >= markValue ? "text-ok" : "text-bad"}>{heldMusd >= markValue ? "+" : "−"}{fmt(heldMusd >= markValue ? heldMusd - markValue : markValue - heldMusd)} MUSD</strong>
            <span className="text-xs text-muted"> (MUSD held − pool value of BTC owed; buy-back fees not included)</span>
          </p>
        )}
      </Card>

      {!open ? (
        <Card title="Open a short">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="MUSD collateral (from your wallet)" hint={`Wallet: ${fmt(myMusd)} MUSD. Move MUSD from your account on the Account page.`}><input className={inputCls} inputMode="decimal" value={coll} onChange={(e) => setColl(e.target.value)} /></Field>
            <Field label="BTC to borrow and sell" hint={`Pool pays ≈ ${fmt(saleOut)} MUSD`}><input className={inputCls} inputMode="decimal" value={borrow} onChange={(e) => setBorrow(e.target.value)} /></Field>
          </div>
          <p className="mt-3 text-sm num">LTV at open {pct(ltvNew)} (max 86%) · liquidatable if BTC ≥ {fmt(liqPriceNew, 18, 0)} MUSD on Mezo&apos;s oracle.</p>
          {ltvNew !== undefined && ltvNew > LLTV && <div className="mt-3"><Notice tone="bad">Above the market&apos;s 86% LLTV — Morpho will reject this borrow.</Notice></div>}
          <div className="mt-4 flex flex-wrap gap-2">
            <TxButton variant="secondary" label={allowance !== undefined && allowance >= c ? "MUSD approved" : `1. Approve ${fmt(c)} MUSD`} state={approveTx.state} disabled={!isController || c === 0n || (allowance ?? 0n) >= c}
              onClick={() => approveTx.run(async () => ({ address: cfg.mezo.MUSD, abi: MUSDAbi, functionName: "approve", args: [hedge, c], account: address }), refresh)} />
            <TxButton label="2. Open short" state={openTx.state} disabled={!isController || c === 0n || b === 0n || (allowance ?? 0n) < c || saleOut === undefined}
              onClick={() => openTx.run(async () => ({ address: hedge, abi: BallastHedgeAbi, functionName: "open", args: [c, b, (saleOut! * 99n) / 100n], account: address }), refresh)} />
          </div>
          <p className="mt-2 text-xs text-muted">One transaction: posts collateral to Morpho, borrows BTC, sells it in Mezo&apos;s MUSD/BTC pool (≤1% slippage).</p>
          <div className="mt-3 space-y-2"><TxStatus state={approveTx.state} /><TxStatus state={openTx.state} /></div>
          {(heldMusd ?? 0n) + (heldBtc ?? 0n) > 0n && (
            <div className="mt-4 border-t border-border pt-4">
              <p className="mb-2 text-sm">The module holds {fmt(heldMusd)} MUSD and {fmt(heldBtc, 18, 8)} BTC. Send it to your Ballast account to repay your Mezo loan from there.</p>
              <TxButton variant="secondary" label="Send to my Ballast account" state={sendTx.state} disabled={!isController}
                onClick={() => sendTx.run(async () => ({ address: hedge, abi: BallastHedgeAbi, functionName: "sendToAccount", account: address }), refresh)} />
              <div className="mt-2"><TxStatus state={sendTx.state} /></div>
            </div>
          )}
        </Card>
      ) : (
        <Card title="Close the short">
          <p className="text-sm num">
            Buying back {fmt(owed, 18, 8)} BTC (+2% buffer) costs ≈ {fmt(needMusd)} MUSD in the pool. The module holds {fmt(heldMusd)} MUSD
            {topUp > 0n ? <>, so <strong>{fmt(topUp)} MUSD</strong> will be pulled from your wallet to cover the difference.</> : "."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {topUp > 0n && (
              <TxButton variant="secondary" label={(allowance ?? 0n) >= topUp ? "Top-up approved" : `1. Approve ${fmt(topUp)} MUSD top-up`} state={topTx.state} disabled={!isController || (allowance ?? 0n) >= topUp}
                onClick={() => topTx.run(async () => ({ address: cfg.mezo.MUSD, abi: MUSDAbi, functionName: "approve", args: [hedge, topUp], account: address }), refresh)} />
            )}
            <TxButton label={topUp > 0n ? "2. Close short" : "Close short"} state={closeTx.state} disabled={!isController || needMusd === undefined || (topUp > 0n && (allowance ?? 0n) < topUp)}
              onClick={() => closeTx.run(async () => ({ address: hedge, abi: BallastHedgeAbi, functionName: "close", args: [(heldMusd ?? 0n) + topUp, owed, topUp], account: address }), refresh)} />
          </div>
          <p className="mt-2 text-xs text-muted">One transaction: buys BTC in the pool, repays the whole Morpho debt (interest accrued first), withdraws your MUSD collateral to the module.</p>
          <div className="mt-3 space-y-2"><TxStatus state={topTx.state} /><TxStatus state={closeTx.state} /></div>
        </Card>
      )}
    </>
  );
}
