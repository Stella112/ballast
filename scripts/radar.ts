// Prints a verified Redemption Radar snapshot. Read-only.
// Usage: pnpm radar [account]   (default: demo account from config)
import { formatUnits, type Address } from "viem";
import { cfg } from "../lib/config";
import { takeSnapshot } from "../lib/radar/snapshot";

const f = (x: bigint, d = 18, p = 4) => Number(formatUnits(x, d)).toFixed(p);

async function main() {
  const account = (process.argv[2] || cfg.ballast.BallastAccount) as Address;
  const t0 = Date.now();
  const s = await takeSnapshot(account);
  console.log(`block ${s.blockNumber} (ts ${s.blockTimestamp}) fetched in ${Date.now() - t0} ms`);
  console.log(`price ${f(s.price, 18, 2)} MUSD/BTC  MCR ${f(s.mcr)}  size ${s.size}  verified ${JSON.stringify(s.verified)}`);
  const m = s.me!;
  if (!m) return;
  console.log(`account ${m.account} inList=${m.inList} rawPosFromTail=${m.rawPosFromTail} eligibleRank=${m.eligibleRank}/${m.eligibleCount}`);
  console.log(`  coll ${f(m.coll, 18, 6)} BTC  principal ${f(m.principal)}  interest ${f(m.interest, 18, 6)}  totalDebt ${f(m.totalDebt)}`);
  console.log(`  NICR ${m.nicr}  ICR ${f(m.icr)}  liqPrice≈${f(m.liquidationPrice, 18, 2)}  maxRepayable ${f(m.maxRepayable)}  rate ${m.interestRateBps}bps`);
  console.log(`  debt of eligible troves ahead (redeemed first): ${f(m.debtAheadEligible, 18, 2)} MUSD`);
  console.log(`  neighbors: safer(prev)=${m.neighbors.prev} riskier(next)=${m.neighbors.next}`);
  for (const t of m.targets) {
    const q = t.quote;
    console.log(`  pass ${t.pass}: target ${t.target ?? "-"} NICR ${t.targetNicr ?? "-"} -> ${q ? (q.kind === "ok" ? `repay ${f(q.repay, 18, 6)} MUSD (buffer ${f(q.buffer, 18, 6)}), new NICR ${q.newNicr}` : q.kind === "exceeds-floor" ? `NOT REACHABLE without closing: needs ${f(q.repay)} > maxRepayable ${f(q.maxRepayable)}` : "already ahead") : "n/a"}`);
  }
  // around me (tail-first index)
  const i = s.list.findIndex((r) => r.owner.toLowerCase() === account.toLowerCase());
  for (let k = Math.max(0, i - 2); k <= Math.min(s.list.length - 1, i + 3); k++) {
    const r = s.list[k];
    console.log(`  #${k + 1}${k === i ? " <== me" : ""} ${r.owner} NICR ${r.nicr} ICR ${f(r.icr)} eligible=${r.eligible}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
