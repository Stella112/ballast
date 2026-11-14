import { NextResponse } from "next/server";
import { isAddress, type Address } from "viem";
import { takeSnapshot, toJSON } from "@/lib/radar/snapshot";
import { icr, maxRepayable, nicr, principalAfterRepay } from "@/lib/radar/math";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-side read so browsers never walk the list. Short in-memory cache per account; every
// response carries the block number + query time so the UI shows freshness.
const cache = new Map<string, { at: number; body: unknown }>();
const TTL_MS = 12_000;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const account = url.searchParams.get("account");
  const fresh = url.searchParams.get("fresh") === "1";
  if (account && !isAddress(account)) return NextResponse.json({ error: "bad account" }, { status: 400 });
  const key = (account ?? "").toLowerCase();
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.body);
  try {
    const snap = await takeSnapshot((account ?? undefined) as Address | undefined, [1, 10, 50]);
    // Return a window around the account rather than the full list.
    const i = snap.me?.inList ? snap.list.findIndex((r) => r.owner.toLowerCase() === key) : -1;
    const window = i >= 0 ? snap.list.slice(Math.max(0, i - 5), i + 6).map((r, k) => ({ ...r, pos: Math.max(0, i - 5) + k + 1 })) : [];
    // Optional what-if: projected position after repaying `simulate` wei (same block snapshot).
    let simulation: unknown = undefined;
    const simRaw = url.searchParams.get("simulate");
    if (simRaw && snap.me?.inList && /^\d{1,40}$/.test(simRaw)) {
      const amt = BigInt(simRaw);
      const m = snap.me;
      const cap = maxRepayable(m.totalDebt, snap.gasComp, snap.minNetDebt);
      const newPrincipal = principalAfterRepay(m.principal, m.interest, amt);
      const newNicr = nicr(m.coll, newPrincipal);
      const others = snap.list.filter((r) => r.owner.toLowerCase() !== key);
      const below = others.filter((r) => r.nicr < newNicr).length;
      const ties = others.filter((r) => r.nicr === newNicr).length;
      const exceedsFloor = amt > cap;
      // Repayment reduces total debt one-for-one; post-repayment ICR at the snapshot price.
      const newIcr = exceedsFloor ? undefined : icr(m.coll, m.totalDebt - amt, snap.price);
      simulation = { amount: amt, exceedsFloor, maxRepayable: cap, newPrincipal, newNicr, newIcr, currentIcr: m.icr, newPosFromTail: below + 1, ties, currentPosFromTail: m.rawPosFromTail };
    }
    const body = toJSON({ ...snap, list: undefined, window, simulation, tailPreview: snap.list.slice(0, 5).map((r, k) => ({ ...r, pos: k + 1 })) });
    if (!simRaw) cache.set(key, { at: Date.now(), body });
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 300) : "radar read failed" }, { status: 502 });
  }
}
