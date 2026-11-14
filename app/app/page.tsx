"use client";
import { useState } from "react";
import { useAccount, useBalance, usePublicClient, useReadContract } from "wagmi";
import { parseEther, parseUnits, isAddress, type Address } from "viem";
import { AccountGate } from "@/components/account-gate";
import { Addr, Badge, Button, Card, Field, Notice, Stat, fmt, inputCls, pct } from "@/components/ui";
import { TxButton, TxStatus, useTx } from "@/components/tx";
import { BallastAccountAbi, BallastAccountNFTAbi, BorrowerOperationsAbi } from "@/lib/abis";
import { cfg, mezoTestnet } from "@/lib/config";
import { computeHints } from "@/lib/mezo/hints";
import { TROVE_STATUS, type AccountState } from "@/lib/useBallast";
import { icr, liquidationPrice, principalAfterRepay } from "@/lib/radar/math";

export default function AccountPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
      <AccountGate purpose="view your Ballast account">{(s, refetch) => <Overview s={s} refetch={refetch} />}</AccountGate>
    </div>
  );
}

function Overview({ s, refetch }: { s: AccountState; refetch: () => void }) {
  const { data: btc } = useBalance({ address: s.account, chainId: mezoTestnet.id, query: { refetchInterval: 20_000 } });
  const active = s.status === 1;
  const ratio = active ? icr(s.coll, s.totalDebt, s.price) : 0n;
  return (
    <>
      <Card title="Ballast account" right={<Badge tone={active ? "ok" : "neutral"}>Trove: {TROVE_STATUS[s.status] ?? s.status}</Badge>}>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Account NFT" value={`#${s.tokenId}`} sub={<Addr a={cfg.ballast.BallastAccountNFT} />} />
          <Stat label="Account contract" value={<Addr a={s.account} />} sub="Owns the Mezo trove" />
          <Stat label="Controller (NFT holder)" value={<Addr a={s.controller} />} />
          <Stat label="Payback policy" value={s.policy.paused ? "Paused" : `${s.policy.repayBps / 100}% repay`} sub={`${s.policy.reserveBps / 100}% reserve`} />
        </div>
      </Card>

      {active ? (
        <Card title="Mezo loan (live)">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="BTC collateral (in Mezo)" value={`${fmt(s.coll, 18, 6)} BTC`} />
            <Stat label="Total debt" value={`${fmt(s.totalDebt)} MUSD`} sub={`principal ${fmt(s.principal)} · interest ${fmt(s.interest, 18, 4)}`} />
            <Stat label="Collateral ratio (ICR)" value={pct(ratio)} sub={`min ${pct(s.mcr)} · BTC ${fmt(s.price)} MUSD`} />
            <Stat label="Liquidation price (est.)" value={`${fmt(liquidationPrice(s.coll, s.totalDebt, s.mcr))} MUSD`} sub="Below this, liquidation is possible" />
          </div>
          <p className="mt-4 text-xs text-muted">
            Total debt includes the 200 MUSD gas-compensation deposit. Interest accrues continuously. A collateral ratio above the minimum does not protect from redemption — see Radar.
          </p>
        </Card>
      ) : (
        <OpenTrove s={s} onDone={refetch} />
      )}

      <Card title="Funds held by the account">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Free MUSD" value={fmt(s.freeMUSD)} sub="Withdrawable by controller" />
          <Stat label="Hedge reserve" value={fmt(s.hedgeReserve)} sub="MUSD set aside for a hedge" />
          <Stat label="Free BTC" value={btc ? `${fmt(btc.value, 18, 6)}` : "—"} sub="Not locked in Mezo" />
          <Stat label="Max repay (to floor)" value={fmt(s.maxRepayable)} sub={`net debt floor ${fmt(s.minNetDebt, 18, 0)} MUSD`} />
        </div>
      </Card>

      <Income s={s} refetch={refetch} />
      <PayLinkAndTransfer s={s} refetch={refetch} />

      {active && <Actions s={s} freeBtc={btc?.value ?? 0n} refetch={refetch} />}
    </>
  );
}

/** Keeper: MUSD that arrived in the account directly (e.g. from a bridge). Anyone can apply the owner's policy to it. */
function Income({ s, refetch }: { s: AccountState; refetch: () => void }) {
  const { address } = useAccount();
  const client = usePublicClient();
  const tx = useTx();
  const q = useReadContract({ address: s.account, abi: BallastAccountAbi, functionName: "quoteSplit", args: [s.pendingIncome], query: { enabled: s.pendingIncome > 0n } });
  return (
    <Card title="Income waiting for your policy" right={s.pendingIncome > 0n ? <Badge tone="warn">{fmt(s.pendingIncome)} MUSD</Badge> : <Badge tone="neutral">None</Badge>}>
      <p className="text-sm text-muted">
        MUSD sent straight to the account address (for example by a bridge) waits here until the policy is applied. Anyone — a keeper bot, the payer, or you — can trigger it;
        the caller cannot change the split or the destinations.
      </p>
      {s.pendingIncome > 0n && q.data && (
        <p className="mt-3 text-sm num">Would split: {fmt(q.data[0])} to you · {fmt(q.data[1])} hedge reserve · {fmt(q.data[2])} repays the loan.</p>
      )}
      <div className="mt-3">
        <TxButton label="Apply policy now" state={tx.state} disabled={s.pendingIncome === 0n || !q.data} onClick={() => tx.run(async () => {
          const zero = "0x0000000000000000000000000000000000000000" as Address;
          const repay = q.data![2];
          const [up, lo] = repay > 0n ? await computeHints(client!, s.coll, principalAfterRepay(s.principal, s.interest, repay) || 1n) : [zero, zero];
          return { address: s.account, abi: BallastAccountAbi, functionName: "processIncome", args: [up, lo], account: address };
        }, refetch)} />
      </div>
      <div className="mt-3"><TxStatus state={tx.state} /></div>
    </Card>
  );
}

function PayLinkAndTransfer({ s, refetch }: { s: AccountState; refetch: () => void }) {
  const { address } = useAccount();
  const tx = useTx();
  const [to, setTo] = useState("");
  const isController = address?.toLowerCase() === s.controller.toLowerCase();
  const link = typeof window === "undefined" ? "" : `${window.location.origin}/pay/a/${s.tokenId.toString()}`;
  return (
    <>
      <Card title="Your pay link">
        <p className="text-sm text-muted">Anyone can pay any amount of MUSD to this link; your policy splits it. Other apps call <code>BallastRouter.pay(accountId, amount, reference)</code> for the same result.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="break-all rounded bg-surface-2 px-2 py-1 text-xs">{link}</code>
          <Button variant="secondary" onClick={() => navigator.clipboard.writeText(link)}>Copy</Button>
        </div>
      </Card>
      <Card title="Transfer this account">
        <Notice tone="warn" title="This hands over everything">
          Whoever holds the account NFT controls the whole account: the Mezo loan and its BTC collateral, the MUSD and reserve held here, and the hedge module. The new holder also takes on the debt.
          Only plain wallet addresses are accepted (not contracts). Your custom payout address is cleared so income follows the new holder.
        </Notice>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="New holder (wallet address)"><input className={inputCls + " font-mono"} placeholder="0x…" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Button variant="danger" disabled={!isController || !isAddress(to) || tx.state.s === "pending" || tx.state.s === "wallet"} onClick={() =>
            tx.run(async () => ({ address: cfg.ballast.BallastAccountNFT, abi: BallastAccountNFTAbi, functionName: "transferFrom", args: [s.controller, to as Address, s.tokenId], account: address }), refetch)}>Transfer account</Button>
        </div>
        <div className="mt-3"><TxStatus state={tx.state} /></div>
      </Card>
    </>
  );
}

function OpenTrove({ s, onDone }: { s: AccountState; onDone: () => void }) {
  const { address } = useAccount();
  const client = usePublicClient();
  const [debt, setDebt] = useState("2000");
  const [coll, setColl] = useState("0.048");
  const tx = useTx();
  let d = 0n, c = 0n;
  try { d = parseUnits(debt || "0", 18); c = parseEther(coll || "0"); } catch { /* invalid input */ }
  const fee = useReadContract({ address: cfg.mezo.BorrowerOperations, abi: BorrowerOperationsAbi, functionName: "getBorrowingFee", args: [d], query: { enabled: d > 0n } });
  const composite = d + (fee.data ?? 0n) + s.gasComp;
  const ratio = icr(c, composite, s.price);
  const tooSmall = d + (fee.data ?? 0n) < s.minNetDebt;
  const belowMcr = ratio < s.mcr;
  return (
    <Card title="Open a Mezo loan from this account">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Borrow (MUSD sent to the account)" hint={`Minimum net debt ${fmt(s.minNetDebt, 18, 0)} MUSD incl. fee`}>
          <input className={inputCls} inputMode="decimal" value={debt} onChange={(e) => setDebt(e.target.value)} />
        </Field>
        <Field label="BTC collateral (from your wallet)">
          <input className={inputCls} inputMode="decimal" value={coll} onChange={(e) => setColl(e.target.value)} />
        </Field>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
        <div><dt className="text-muted">Borrowing fee</dt><dd className="num">{fmt(fee.data)} MUSD</dd></div>
        <div><dt className="text-muted">Gas compensation</dt><dd className="num">{fmt(s.gasComp)} MUSD</dd></div>
        <div><dt className="text-muted">Total opening debt</dt><dd className="num">{fmt(composite)} MUSD</dd></div>
        <div><dt className="text-muted">Collateral ratio</dt><dd className={`num ${belowMcr ? "text-bad" : ""}`}>{pct(ratio)}</dd></div>
      </dl>
      {tooSmall && <div className="mt-3"><Notice tone="warn">Below Mezo&apos;s minimum net debt.</Notice></div>}
      {belowMcr && <div className="mt-3"><Notice tone="bad">Collateral ratio below the {pct(s.mcr)} minimum — Mezo will reject this.</Notice></div>}
      <div className="mt-4">
        <TxButton label="Open trove" state={tx.state} disabled={tooSmall || belowMcr || c === 0n} onClick={() =>
          tx.run(async () => {
            const [up, lo] = await computeHints(client!, c, composite);
            return { address: s.account, abi: BallastAccountAbi, functionName: "openTrove", args: [d, up, lo], value: c, account: address };
          }, onDone)} />
      </div>
      <div className="mt-3"><TxStatus state={tx.state} /></div>
    </Card>
  );
}

function Actions({ s, freeBtc, refetch }: { s: AccountState; freeBtc: bigint; refetch: () => void }) {
  const { address } = useAccount();
  const client = usePublicClient();
  const tx = useTx();
  const [amt, setAmt] = useState("");
  const [to, setTo] = useState<string>(address ?? "");
  let a = 0n;
  try { a = parseUnits(amt || "0", 18); } catch { /* */ }
  const toOk = isAddress(to);
  const isController = address?.toLowerCase() === s.controller.toLowerCase();
  const go = (fn: () => Promise<unknown>) => () => tx.run(fn as never, () => { setAmt(""); refetch(); });

  return (
    <Card title="Controller actions">
      {!isController && <div className="mb-3"><Notice tone="bad">Connected wallet is not the NFT holder; the contract will reject these.</Notice></div>}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Amount"><input className={inputCls} inputMode="decimal" placeholder="0.0" value={amt} onChange={(e) => setAmt(e.target.value)} /></Field>
        <Field label="Recipient (for withdrawals)"><input className={inputCls + " font-mono"} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <TxButton label="Repay MUSD" state={tx.state} disabled={a === 0n || a > s.freeMUSD || a > s.maxRepayable} onClick={go(async () => {
          const [up, lo] = await computeHints(client!, s.coll, principalAfterRepay(s.principal, s.interest, a) || 1n);
          return { address: s.account, abi: BallastAccountAbi, functionName: "repay", args: [a, up, lo], account: address };
        })} />
        <TxButton variant="secondary" label="Withdraw MUSD" state={tx.state} disabled={a === 0n || a > s.freeMUSD || !toOk} onClick={go(async () => ({ address: s.account, abi: BallastAccountAbi, functionName: "withdrawMUSD", args: [to as Address, a], account: address }))} />
        <TxButton variant="secondary" label="Borrow more MUSD" state={tx.state} disabled={a === 0n} onClick={go(async () => {
          const [up, lo] = await computeHints(client!, s.coll, s.principal + a);
          return { address: s.account, abi: BallastAccountAbi, functionName: "borrow", args: [a, up, lo], account: address };
        })} />
        <TxButton variant="secondary" label="Withdraw free BTC" state={tx.state} disabled={a === 0n || a > freeBtc || !toOk} onClick={go(async () => ({ address: s.account, abi: BallastAccountAbi, functionName: "withdrawBTC", args: [to as Address, a], account: address }))} />
        <TxButton variant="secondary" label="Withdraw reserve" state={tx.state} disabled={a === 0n || a > s.hedgeReserve || !toOk} onClick={go(async () => ({ address: s.account, abi: BallastAccountAbi, functionName: "withdrawReserve", args: [to as Address, a], account: address }))} />
      </div>
      <p className="mt-3 text-xs text-muted">
        Repay uses your MUSD held by the account (not the reserve) and is limited to {fmt(s.maxRepayable)} MUSD so net debt stays above Mezo&apos;s floor. Closing the trove requires {fmt(s.totalDebt - s.gasComp)} MUSD free in the account.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="danger" disabled={s.freeMUSD < s.totalDebt - s.gasComp || tx.state.s === "pending"} onClick={go(async () => ({ address: s.account, abi: BallastAccountAbi, functionName: "closeTrove", account: address }))}>Close trove</Button>
      </div>
      <div className="mt-3"><TxStatus state={tx.state} /></div>
    </Card>
  );
}
