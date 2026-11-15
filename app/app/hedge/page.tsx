"use client";
import { useState } from "react";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { parseUnits, zeroAddress, type Address } from "viem";
import { AccountGate } from "@/components/account-gate";
import { Addr, Badge, Card, Field, Notice, Stat, fmt, inputCls, pct } from "@/components/ui";
import { TxButton, TxStatus, useTx } from "@/components/tx";
import { BallastAccountAbi, BallastHedgeAbi, BallastHedgeFactoryAbi, MorphoAbi, MUSDAbi, PoolsRouterAbi, PriceFeedAbi } from "@/lib/abis";
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
      <SimulatedDrop />
    </div>
  );
}

/** A BTC price drop cannot be caused on testnet, so this card is arithmetic only. Opening and closing above are real. */
function SimulatedDrop() {
  const k = useMarket();
  const [btc, setBtc] = useState("0.0005");
  const [coll, setColl] = useState("80");
  const entry = k.poolPrice ? Number(k.poolPrice) / 1e18 : 0; // MUSD per BTC received when selling
  const q = Number(btc) || 0, c = Number(coll) || 0;
  const feePct = 0.6; // two pool swaps, assumed
  const rows = [10, 20, 30].map((d) => {
    const exit = entry * (1 - d / 100);
    const pnl = q * entry - q * exit - (q * entry * feePct) / 100;
    return { d, exit, pnl };
  });
  const liq = q > 0 ? (0.86 * c) / q : 0;
  const n = (x: number, dp = 2) => (Number.isFinite(x) ? x.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }) : "—");
  return (
    <Card title="What a BTC drop would do" right={<Badge tone="sim">SIMULATED — not a real price move</Badge>}>
      <p className="mb-4 max-w-prose text-sm text-muted">
        Nobody can make BTC fall on a testnet, so this part is a calculation, not a transaction. It shows what closing a short of this size would pay toward your loan if BTC fell after you opened it.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="BTC borrowed and sold"><input className={inputCls} inputMode="decimal" value={btc} onChange={(e) => setBtc(e.target.value)} /></Field>
        <Field label="MUSD collateral posted"><input className={inputCls} inputMode="decimal" value={coll} onChange={(e) => setColl(e.target.value)} /></Field>
        <Stat label="Sale price today (pool)" value={`${n(entry, 0)} MUSD/BTC`} sub={`you'd hold ${n(q * entry)} MUSD`} />
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead className="text-left text-xs uppercase text-muted"><tr><th className="py-2">BTC move</th><th className="text-right">Buy-back price</th><th className="text-right">Simulated gain toward the loan</th></tr></thead>
          <tbody className="num">
            {rows.map((r) => (
              <tr key={r.d} className="border-t border-border"><td className="py-2">−{r.d}%</td><td className="text-right">{n(r.exit, 0)}</td><td className="text-right text-ok">+{n(r.pnl)} MUSD</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">
        Assumes {feePct}% total swap cost and ignores borrow interest. If BTC rises instead, the same arithmetic is a loss, and the short becomes liquidatable at about {n(liq, 0)} MUSD/BTC on Mezo&apos;s oracle.
        Simulated figures are never shown as transactions.
      </p>
    </Card>
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
  const h = useReadContracts({
    contracts: [
      { address: B.BallastHedgeFactory!, abi: BallastHedgeFactoryAbi, functionName: "hedgeOf", args: [s.tokenId] },
      { address: s.account, abi: BallastAccountAbi, functionName: "hedgeModule" },
      { address: s.account, abi: BallastAccountAbi, functionName: "hedgePosted" },
    ],
    query: { refetchInterval: 20_000 },
  });
  const [created, attached, posted] = (h.data ?? []).map((r) => r.result) as [Address?, Address?, bigint?];
  const createTx = useTx(), attachTx = useTx();

  if (h.isLoading) return <p className="text-sm text-muted">Loading…</p>;
  if (!created || created === zeroAddress) {
    return (
      <Card title="Set up the hedge (step 1 of 2)">
        <p className="mb-3 text-sm text-muted">Your Ballast account opens the hedge through its own hedge module, which holds the Morpho position. Creating it costs only gas.</p>
        <TxButton label="Create hedge module" state={createTx.state} disabled={!isController}
          onClick={() => createTx.run(async () => ({ address: B.BallastHedgeFactory!, abi: BallastHedgeFactoryAbi, functionName: "create", args: [s.tokenId], account: address }), () => h.refetch())} />
        <div className="mt-3"><TxStatus state={createTx.state} /></div>
      </Card>
    );
  }
  if (!attached || attached.toLowerCase() !== created.toLowerCase()) {
    return (
      <Card title="Set up the hedge (step 2 of 2)">
        <p className="mb-3 text-sm text-muted">Attach module <Addr a={created} /> to your account so the account can fund the hedge from its hedge reserve.</p>
        <TxButton label="Attach to my account" state={attachTx.state} disabled={!isController}
          onClick={() => attachTx.run(async () => ({ address: s.account, abi: BallastAccountAbi, functionName: "setHedgeModule", args: [created], account: address }), () => h.refetch())} />
        <div className="mt-3"><TxStatus state={attachTx.state} /></div>
      </Card>
    );
  }
  return <Position hedge={created} posted={posted ?? 0n} isController={isController} s={s} onChange={() => h.refetch()} />;
}

function Position({ hedge, posted, isController, s, onChange }: { hedge: Address; posted: bigint; isController: boolean; s: AccountState; onChange: () => void }) {
  const { address } = useAccount();
  const k = useMarket();
  const q = useReadContracts({
    contracts: [
      { address: hedge, abi: BallastHedgeAbi, functionName: "positionInfo" },
      { address: cfg.mezo.MUSD, abi: MUSDAbi, functionName: "balanceOf", args: [hedge] },
      { address: B.MorphoBTC!, abi: MUSDAbi, functionName: "balanceOf", args: [hedge] },
      { address: s.account, abi: BallastAccountAbi, functionName: "hedgeReserve" },
      { address: s.account, abi: BallastAccountAbi, functionName: "ownerMUSD" },
    ],
    query: { refetchInterval: 15_000 },
  });
  const [info, heldMusd, heldBtc, reserveNow, ownerNow] = (q.data ?? []).map((r) => r.result) as [(readonly bigint[] | undefined)?, bigint?, bigint?, bigint?, bigint?];
  const collateral = info?.[0] ?? 0n, shares = info?.[1] ?? 0n, owed = info?.[2] ?? 0n;
  const open = shares > 0n;
  const reserve = reserveNow ?? s.hedgeReserve;

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
  const canTopUp = topUp <= reserve + (ownerNow ?? 0n);

  const openTx = useTx(), closeTx = useTx();
  const refresh = () => { q.refetch(); k.q.refetch(); need.refetch(); onChange(); };

  return (
    <>
      <Card title="Your account's hedge" right={open ? <Badge tone="warn">Short open</Badge> : <Badge tone="neutral">No position</Badge>}>
        <p className="mb-3 text-xs text-muted">Opened and closed by your Ballast account <Addr a={s.account} /> (controlled by the NFT holder <Addr a={s.controller} />{!isController && ", not your connected wallet"}). Position held in its module <Addr a={hedge} />.</p>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Hedge reserve (in account)" value={`${fmt(reserve)} MUSD`} sub="funds new hedges" />
          <Stat label="MUSD collateral (Morpho)" value={fmt(collateral)} sub={`account put in ${fmt(posted)}`} />
          <Stat label="BTC owed" value={fmt(owed, 18, 8)} sub="incl. interest to last accrual" />
          <Stat label="LTV / liquidation price" value={open ? pct(ltvNow) : "—"} sub={open ? `liquidatable if BTC ≥ ${fmt(liqPriceNow, 18, 0)}` : "86% max"} />
        </div>
        {open && markValue !== undefined && heldMusd !== undefined && (
          <p className="mt-3 text-sm num">
            Sale proceeds held: {fmt(heldMusd)} MUSD. Estimated P/L if closed now: <strong className={heldMusd >= markValue ? "text-ok" : "text-bad"}>{heldMusd >= markValue ? "+" : "−"}{fmt(heldMusd >= markValue ? heldMusd - markValue : markValue - heldMusd)} MUSD</strong>
            <span className="text-xs text-muted"> (MUSD held − pool value of BTC owed; buy-back fees not included)</span>
          </p>
        )}
        {!open && (heldBtc ?? 0n) > 0n && <p className="mt-3 text-xs text-muted">Module still holds {fmt(heldBtc, 18, 8)} BTC dust.</p>}
      </Card>

      {!open ? (
        <Card title="Open a short from the hedge reserve">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="MUSD collateral (from the account's hedge reserve)" hint={`Reserve: ${fmt(reserve)} MUSD. It fills from the hedge share of each payment.`}><input className={inputCls} inputMode="decimal" value={coll} onChange={(e) => setColl(e.target.value)} /></Field>
            <Field label="BTC to borrow and sell" hint={`Pool pays ≈ ${fmt(saleOut)} MUSD`}><input className={inputCls} inputMode="decimal" value={borrow} onChange={(e) => setBorrow(e.target.value)} /></Field>
          </div>
          <p className="mt-3 text-sm num">LTV at open {pct(ltvNew)} (max 86%) · liquidatable if BTC ≥ {fmt(liqPriceNew, 18, 0)} MUSD on Mezo&apos;s oracle.</p>
          {ltvNew !== undefined && ltvNew > LLTV && <div className="mt-3"><Notice tone="bad">Above the market&apos;s 86% LLTV. Morpho will reject this borrow.</Notice></div>}
          {c > reserve && <div className="mt-3"><Notice tone="warn">The hedge reserve holds {fmt(reserve)} MUSD, less than this collateral. Receive more payments with a hedge share, or lower the amount.</Notice></div>}
          <div className="mt-4 flex flex-wrap gap-2">
            <TxButton label="Open short" state={openTx.state} disabled={!isController || c === 0n || b === 0n || c > reserve || saleOut === undefined}
              onClick={() => openTx.run(async () => ({ address: s.account, abi: BallastAccountAbi, functionName: "openHedge", args: [c, b, (saleOut! * 99n) / 100n], account: address }), refresh)} />
          </div>
          <p className="mt-2 text-xs text-muted">One transaction from your account: takes the collateral from the hedge reserve, posts it to Morpho, borrows BTC and sells it in Mezo&apos;s MUSD/BTC pool (≤1% slippage).</p>
          <div className="mt-3"><TxStatus state={openTx.state} /></div>
        </Card>
      ) : (
        <Card title="Close the short">
          <p className="text-sm num">
            Buying back {fmt(owed, 18, 8)} BTC (+2% buffer) costs ≈ {fmt(needMusd)} MUSD in the pool. The sale proceeds are {fmt(heldMusd)} MUSD
            {topUp > 0n ? <>, so the hedge lost money: <strong>{fmt(topUp)} MUSD</strong> will come from the hedge reserve (then your MUSD in the account) to cover the difference.</> : ". If more comes back than the account put in, the difference repays your Mezo loan."}
          </p>
          {!canTopUp && <div className="mt-3"><Notice tone="bad">The account does not hold enough MUSD to cover the difference. Deposit MUSD into the account first.</Notice></div>}
          <div className="mt-4 flex flex-wrap gap-2">
            <TxButton label="Close short" state={closeTx.state} disabled={!isController || needMusd === undefined || !canTopUp}
              onClick={() => closeTx.run(async () => ({ address: s.account, abi: BallastAccountAbi, functionName: "closeHedge", args: [(heldMusd ?? 0n) + topUp, owed, topUp, zeroAddress, zeroAddress], account: address }), refresh)} />
          </div>
          <p className="mt-2 text-xs text-muted">One transaction from your account: buys BTC in the pool, repays the whole Morpho debt (interest accrued first), and brings the collateral and any leftover back into the account. Gains repay the loan; the rest returns to the hedge reserve.</p>
          <div className="mt-3"><TxStatus state={closeTx.state} /></div>
        </Card>
      )}
    </>
  );
}
