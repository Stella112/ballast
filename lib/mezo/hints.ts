import type { Address, PublicClient } from "viem";
import { cfg } from "../config";
import { HintHelpersAbi, SortedTrovesAbi } from "../abis";

/**
 * Fresh SortedTroves insert hints for a trove with (coll, principal) after the change.
 * Same method as Mezo's docs/tests: HintHelpers.getApproxHint -> SortedTroves.findInsertPosition.
 * Hints only affect gas; SortedTroves re-validates them on-chain.
 */
export async function computeHints(client: PublicClient, coll: bigint, principal: bigint): Promise<[Address, Address]> {
  const nicr = await client.readContract({
    address: cfg.mezo.HintHelpers, abi: HintHelpersAbi, functionName: "computeNominalCR", args: [coll, principal],
  });
  const size = await client.readContract({ address: cfg.mezo.SortedTroves, abi: SortedTrovesAbi, functionName: "getSize" });
  const trials = BigInt(Math.min(500, Math.max(15, Number(size) * 15)));
  const [approx] = await client.readContract({
    address: cfg.mezo.HintHelpers, abi: HintHelpersAbi, functionName: "getApproxHint",
    args: [nicr, trials, BigInt(Math.floor(Math.random() * 1e9))],
  });
  const [up, lo] = await client.readContract({
    address: cfg.mezo.SortedTroves, abi: SortedTrovesAbi, functionName: "findInsertPosition", args: [nicr, approx, approx],
  });
  return [up, lo];
}
