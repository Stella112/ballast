"use client";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { parseAbiItem, type Address } from "viem";
import deployments from "../config/deployments.mezo-testnet.json";
import { cfg } from "./config";

const FROM_BLOCK = BigInt((deployments as { ballast: { deployTx: { BallastRouter: { block: number } } } }).ballast.deployTx.BallastRouter.block);
const invoicePaid = parseAbiItem("event InvoicePaid(uint256 indexed tokenId, bytes32 indexed invoiceId, address indexed payer, address account, address payout, uint256 amount, uint256 spendable, uint256 reserve, uint256 repaid)");
const repaid = parseAbiItem("event Repaid(address indexed source, bytes32 indexed ref, uint256 amount, uint256 debtBefore, uint256 debtAfter)");

export type ActivityItem = {
  kind: "invoice" | "repay";
  block: bigint;
  tx: `0x${string}`;
  logIndex: number;
  invoiceId?: `0x${string}`;
  payer?: Address;
  amount: bigint;
  spendable?: bigint;
  reserve?: bigint;
  repaid?: bigint;
  debtBefore?: bigint;
  debtAfter?: bigint;
  source?: Address;
};

/** Real on-chain events for one account, newest first. Reads logs in chunks from the router deploy block. */
export function useActivity(account?: Address, tokenId?: bigint) {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["activity", account, tokenId?.toString()],
    enabled: !!client && !!account && tokenId !== undefined,
    refetchInterval: 30_000,
    queryFn: async () => {
      const latest = await client!.getBlockNumber();
      const CHUNK = 50_000n;
      const items: ActivityItem[] = [];
      for (let from = FROM_BLOCK; from <= latest; from += CHUNK) {
        const to = from + CHUNK - 1n > latest ? latest : from + CHUNK - 1n;
        const [inv, rep] = await Promise.all([
          client!.getLogs({ address: cfg.ballast.BallastRouter, event: invoicePaid, args: { tokenId }, fromBlock: from, toBlock: to }),
          client!.getLogs({ address: account, event: repaid, fromBlock: from, toBlock: to }),
        ]);
        for (const l of inv) items.push({ kind: "invoice", block: l.blockNumber!, tx: l.transactionHash!, logIndex: l.logIndex!, invoiceId: l.args.invoiceId, payer: l.args.payer, amount: l.args.amount!, spendable: l.args.spendable, reserve: l.args.reserve, repaid: l.args.repaid });
        for (const l of rep) items.push({ kind: "repay", block: l.blockNumber!, tx: l.transactionHash!, logIndex: l.logIndex!, amount: l.args.amount!, debtBefore: l.args.debtBefore, debtAfter: l.args.debtAfter, source: l.args.source });
      }
      items.sort((a, b) => (a.block === b.block ? b.logIndex - a.logIndex : a.block > b.block ? -1 : 1));
      return { items, latest };
    },
  });
}
