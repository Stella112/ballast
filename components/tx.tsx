"use client";
import { useState } from "react";
import { usePublicClient, useWriteContract } from "wagmi";
import type { Abi, Address, Hash, TransactionReceipt } from "viem";
import { BaseError } from "viem";
import { Button, Notice, TxLink } from "./ui";

export type TxState =
  | { s: "idle" }
  | { s: "wallet" }
  | { s: "pending"; hash: Hash }
  | { s: "ok"; hash: Hash; receipt: TransactionReceipt }
  | { s: "reverted"; hash: Hash; receipt: TransactionReceipt }
  | { s: "error"; message: string };

export function errMsg(e: unknown): string {
  if (e instanceof BaseError) {
    const m = e.shortMessage || e.message;
    const reason = (e as BaseError & { cause?: { reason?: string; data?: { errorName?: string } } }).walk?.() as { reason?: string; data?: { errorName?: string; args?: unknown[] } } | undefined;
    const name = reason?.data?.errorName;
    return name ? `${m} (${name}${reason?.data?.args ? `: ${reason.data.args.map(String).join(", ")}` : ""})` : m;
  }
  return e instanceof Error ? e.message.split("\n")[0] : String(e);
}

/**
 * Runs: (optional) prepare -> simulate -> wallet -> wait for receipt.
 * Success is only reported for a mined receipt with status "success".
 */
export type WriteReq = { address: Address; abi: Abi | readonly unknown[]; functionName: string; args?: readonly unknown[]; value?: bigint; account?: Address };

export function useTx() {
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [state, setState] = useState<TxState>({ s: "idle" });

  async function run(build: () => Promise<WriteReq>, onDone?: (r: TransactionReceipt) => void) {
    try {
      setState({ s: "wallet" });
      const req = await build();
      if (client) await client.simulateContract(req as never);
      const hash = await writeContractAsync(req as never);
      setState({ s: "pending", hash });
      const receipt = await client!.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 180_000 });
      if (receipt.status === "success") {
        setState({ s: "ok", hash, receipt });
        onDone?.(receipt);
      } else setState({ s: "reverted", hash, receipt });
    } catch (e) {
      setState({ s: "error", message: errMsg(e) });
    }
  }
  return { state, run, reset: () => setState({ s: "idle" }) };
}

export function TxStatus({ state }: { state: TxState }) {
  if (state.s === "idle") return null;
  if (state.s === "wallet") return <Notice tone="neutral">Simulating, then confirm in your wallet…</Notice>;
  if (state.s === "pending") return <Notice tone="warn">Submitted — waiting for confirmation. <TxLink hash={state.hash} /></Notice>;
  if (state.s === "ok") return <Notice tone="ok">Confirmed in block {state.receipt.blockNumber.toString()} (status 1). <TxLink hash={state.hash} /></Notice>;
  if (state.s === "reverted") return <Notice tone="bad">Transaction reverted in block {state.receipt.blockNumber.toString()}. <TxLink hash={state.hash} /></Notice>;
  return <Notice tone="bad" title="Not sent / failed">{state.message}</Notice>;
}

export function TxButton({ label, busyLabel, state, onClick, disabled, variant }: { label: string; busyLabel?: string; state: TxState; onClick: () => void; disabled?: boolean; variant?: "primary" | "secondary" | "danger" }) {
  const busy = state.s === "wallet" || state.s === "pending";
  return <Button onClick={onClick} disabled={disabled || busy} variant={variant}>{busy ? busyLabel ?? "Working…" : label}</Button>;
}
