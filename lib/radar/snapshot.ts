import { createPublicClient, http, type Address, type PublicClient, zeroAddress, getAddress } from "viem";
import { cfg, mezoTestnet, RPC_URL } from "../config";
import { TroveManagerAbi, SortedTrovesAbi, PriceFeedAbi, BorrowerOperationsAbi } from "../abis";
import { icr, interestBuffer, liquidationPrice, maxRepayable, nicr, quoteToBeat, type Quote } from "./math";

export type TroveRow = { owner: Address; nicr: bigint; icr: bigint; debt: bigint; eligible: boolean };

export type RadarSnapshot = {
  blockNumber: bigint;
  blockTimestamp: bigint;
  queriedAt: number;
  price: bigint;
  mcr: bigint;
  minNetDebt: bigint;
  gasComp: bigint;
  size: number;
  verified: { countMatches: boolean; pointersConsistent: boolean; monotonic: boolean; headTailMatch: boolean };
  /** tail-first order (index 0 = first redeemed) */
  list: TroveRow[];
  me?: {
    account: Address;
    inList: boolean;
    rawPosFromTail?: number; // 1-based
    eligibleRank?: number; // 1-based among ICR >= MCR troves, counted from tail
    eligibleCount: number;
    debtAheadEligible: bigint;
    coll: bigint;
    principal: bigint;
    interest: bigint;
    totalDebt: bigint;
    nicr: bigint;
    icr: bigint;
    liquidationPrice: bigint;
    maxRepayable: bigint;
    interestRateBps: bigint;
    neighbors: { prev: Address; next: Address }; // prev = toward head (safer), next = toward tail
    targets: { pass: number; target?: Address; targetNicr?: bigint; quote?: Quote }[];
  };
};

export function makeClient(): PublicClient {
  return createPublicClient({ chain: mezoTestnet, transport: http(RPC_URL, { batch: true, retryCount: 3 }) }) as PublicClient;
}

const TM = cfg.mezo.TroveManager;
const ST = cfg.mezo.SortedTroves;

/**
 * Full sorted-list snapshot pinned to one block. All reads use the same blockNumber.
 * The list is rebuilt from getNext pointers (not assumed from the owners array order) and verified.
 */
export async function takeSnapshot(account?: Address, passTargets = [1, 10, 50], client = makeClient()): Promise<RadarSnapshot> {
  const block = await client.getBlock({ blockTag: "latest" });
  const blockNumber = block.number;
  const at = { blockNumber } as const;

  const [count, size, head, tail, price, mcr, minNetDebt, gasComp] = await Promise.all([
    client.readContract({ address: TM, abi: TroveManagerAbi, functionName: "getTroveOwnersCount", ...at }),
    client.readContract({ address: ST, abi: SortedTrovesAbi, functionName: "getSize", ...at }),
    client.readContract({ address: ST, abi: SortedTrovesAbi, functionName: "getFirst", ...at }),
    client.readContract({ address: ST, abi: SortedTrovesAbi, functionName: "getLast", ...at }),
    client.readContract({ address: cfg.mezo.PriceFeed, abi: PriceFeedAbi, functionName: "fetchPrice", ...at }),
    client.readContract({ address: TM, abi: TroveManagerAbi, functionName: "MCR", ...at }),
    client.readContract({ address: cfg.mezo.BorrowerOperations, abi: BorrowerOperationsAbi, functionName: "minNetDebt", ...at }),
    client.readContract({ address: cfg.mezo.BorrowerOperations, abi: BorrowerOperationsAbi, functionName: "MUSD_GAS_COMPENSATION", ...at }),
  ]);

  const n = Number(count);
  const idx = Array.from({ length: n }, (_, i) => BigInt(i));
  const owners = (await client.multicall({
    contracts: idx.map((i) => ({ address: TM, abi: TroveManagerAbi, functionName: "getTroveFromTroveOwnersArray", args: [i] }) as const),
    allowFailure: false, batchSize: 4096, ...at,
  })) as Address[];

  const per = await client.multicall({
    contracts: owners.flatMap((o) => [
      { address: ST, abi: SortedTrovesAbi, functionName: "getNext", args: [o] } as const,
      { address: ST, abi: SortedTrovesAbi, functionName: "getPrev", args: [o] } as const,
      { address: TM, abi: TroveManagerAbi, functionName: "getNominalICR", args: [o] } as const,
      { address: TM, abi: TroveManagerAbi, functionName: "getCurrentICR", args: [o, price] } as const,
      { address: TM, abi: TroveManagerAbi, functionName: "getTroveDebt", args: [o] } as const,
    ]),
    allowFailure: false, batchSize: 4096, ...at,
  });

  const info = new Map<string, { next: Address; prev: Address; nicr: bigint; icr: bigint; debt: bigint }>();
  owners.forEach((o, i) => {
    info.set(o.toLowerCase(), {
      next: per[i * 5] as Address, prev: per[i * 5 + 1] as Address,
      nicr: per[i * 5 + 2] as bigint, icr: per[i * 5 + 3] as bigint, debt: per[i * 5 + 4] as bigint,
    });
  });

  // Rebuild head -> tail via getNext, then verify.
  const headToTail: Address[] = [];
  let cur: Address = head;
  let pointersConsistent = true;
  let prevAddr: Address = zeroAddress;
  while (cur !== zeroAddress && headToTail.length <= n) {
    const node = info.get(cur.toLowerCase());
    if (!node) { pointersConsistent = false; break; }
    if (node.prev.toLowerCase() !== prevAddr.toLowerCase()) pointersConsistent = false;
    headToTail.push(getAddress(cur));
    prevAddr = cur;
    cur = node.next;
  }
  let monotonic = true;
  for (let i = 1; i < headToTail.length; i++) {
    if (info.get(headToTail[i].toLowerCase())!.nicr > info.get(headToTail[i - 1].toLowerCase())!.nicr) monotonic = false;
  }
  const verified = {
    countMatches: headToTail.length === Number(size) && n === Number(size),
    pointersConsistent,
    monotonic,
    headTailMatch: headToTail.length > 0 ? headToTail[headToTail.length - 1].toLowerCase() === tail.toLowerCase() : tail === zeroAddress,
  };

  const list: TroveRow[] = headToTail.slice().reverse().map((o) => {
    const x = info.get(o.toLowerCase())!;
    return { owner: o, nicr: x.nicr, icr: x.icr, debt: x.debt, eligible: x.icr >= mcr };
  });

  const snap: RadarSnapshot = {
    blockNumber, blockTimestamp: block.timestamp, queriedAt: Date.now(), price, mcr, minNetDebt, gasComp,
    size: Number(size), verified, list,
  };

  if (account) snap.me = await describeMe(client, account, snap, passTargets);
  return snap;
}

async function describeMe(client: PublicClient, account: Address, snap: RadarSnapshot, passTargets: number[]) {
  const at = { blockNumber: snap.blockNumber } as const;
  const [ent, totalDebt, troveStruct] = await Promise.all([
    client.readContract({ address: TM, abi: TroveManagerAbi, functionName: "getEntireDebtAndColl", args: [account], ...at }),
    client.readContract({ address: TM, abi: TroveManagerAbi, functionName: "getTroveDebt", args: [account], ...at }),
    client.readContract({ address: TM, abi: TroveManagerAbi, functionName: "Troves", args: [account], ...at }),
  ]);
  const [collStored, principalStored, interestAll, pColl, pPrincipal, pInterest] = ent as readonly bigint[];
  const coll = collStored + pColl;
  const principal = principalStored + pPrincipal;
  const interest = interestAll + pInterest;
  const fullDebt = (totalDebt as bigint) + pPrincipal + pInterest;
  const interestRateBps = BigInt((troveStruct as readonly unknown[])[5] as number);

  const ok = snap.verified.countMatches && snap.verified.pointersConsistent && snap.verified.monotonic && snap.verified.headTailMatch;
  const pos = snap.list.findIndex((r) => r.owner.toLowerCase() === account.toLowerCase());
  const inList = pos >= 0;
  let eligibleRank: number | undefined;
  let debtAheadEligible = 0n;
  if (inList) {
    let r = 0;
    for (let i = 0; i <= pos; i++) if (snap.list[i].eligible) { r++; if (i < pos) debtAheadEligible += snap.list[i].debt; }
    eligibleRank = snap.list[pos].eligible ? r : undefined;
  }
  const myNicr = nicr(coll, principal);
  const buffer = interestBuffer(principal, interestRateBps, 600n); // 10 minutes of interest
  const targets = passTargets.map((k) => {
    if (!inList || !ok) return { pass: k };
    const t = snap.list[pos + k]; // toward head
    if (!t) return { pass: k };
    return {
      pass: k, target: t.owner, targetNicr: t.nicr,
      quote: quoteToBeat({ coll, principal, interest, totalDebt: fullDebt, targetNicr: t.nicr, gasComp: snap.gasComp, minNetDebt: snap.minNetDebt, buffer }),
    };
  });
  return {
    account, inList,
    rawPosFromTail: inList && ok ? pos + 1 : undefined,
    eligibleRank: ok ? eligibleRank : undefined,
    eligibleCount: snap.list.filter((r) => r.eligible).length,
    debtAheadEligible,
    coll, principal, interest, totalDebt: fullDebt,
    nicr: myNicr,
    icr: icr(coll, fullDebt, snap.price),
    liquidationPrice: liquidationPrice(coll, fullDebt, snap.mcr),
    maxRepayable: maxRepayable(fullDebt, snap.gasComp, snap.minNetDebt),
    interestRateBps,
    neighbors: {
      prev: inList && pos + 1 < snap.list.length ? snap.list[pos + 1].owner : zeroAddress,
      next: inList && pos > 0 ? snap.list[pos - 1].owner : zeroAddress,
    },
    targets,
  };
}

/** JSON-safe serialization (bigint -> string). */
export function toJSON(x: unknown): unknown {
  return JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}
