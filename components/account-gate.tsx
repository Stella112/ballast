"use client";
import { useAccount } from "wagmi";
import { useMyAccounts, useAccountState, type AccountState } from "@/lib/useBallast";
import { cfg } from "@/lib/config";
import { BallastFactoryAbi } from "@/lib/abis";
import { RequireMezo } from "./wallet";
import { Card, Notice } from "./ui";
import { TxButton, TxStatus, useTx } from "./tx";

/** Resolves the connected wallet's Ballast account and renders children with live state. */
export function AccountGate({ children, purpose }: { children: (s: AccountState, refetch: () => void) => React.ReactNode; purpose?: string }) {
  return (
    <RequireMezo purpose={purpose}>
      <Inner>{children}</Inner>
    </RequireMezo>
  );
}

function Inner({ children }: { children: (s: AccountState, refetch: () => void) => React.ReactNode }) {
  const { address } = useAccount();
  const { mine, isLoading, refetch } = useMyAccounts();
  const acct = mine[0]?.account;
  const st = useAccountState(acct);
  const tx = useTx();

  if (isLoading) return <p className="text-sm text-muted">Looking up your Ballast account…</p>;
  if (!acct)
    return (
      <Card title="Create your Ballast account">
        <p className="mb-4 max-w-prose text-sm text-muted">
          Ballast deploys a contract account that will own your Mezo trove, and mints an NFT to your wallet. Whoever holds the NFT controls the account.
          While the account has an active loan the NFT cannot be transferred (hackathon safety restriction). The NFT controls BTC-backed assets — do not treat it as a collectible.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <TxButton label="Create account (mint NFT)" state={tx.state} onClick={() => tx.run(async () => ({ address: cfg.ballast.BallastFactory, abi: BallastFactoryAbi, functionName: "createAccount", account: address }), () => refetch())} />
        </div>
        <div className="mt-3"><TxStatus state={tx.state} /></div>
      </Card>
    );
  if (st.error) return <Notice tone="bad" title="Could not read account state">{String(st.error.message).split("\n")[0]} — the RPC may be stale or rate-limited. Retry shortly.</Notice>;
  if (!st.data) return <p className="text-sm text-muted">Reading live Mezo state…</p>;
  if (mine.length > 1) {
    /* only the first account is shown in this MVP */
  }
  return <>{children(st.data, () => st.refetch())}</>;
}
