"use client";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import type { Address } from "viem";
import { cfg } from "./config";
import { BallastAccountAbi, BallastAccountNFTAbi, BallastFactoryAbi, MUSDAbi, TroveManagerAbi, PriceFeedAbi, BorrowerOperationsAbi } from "./abis";

const F = cfg.ballast.BallastFactory;
const NFT = cfg.ballast.BallastAccountNFT;
const TM = cfg.mezo.TroveManager;

export const TROVE_STATUS = ["None", "Active", "Closed by owner", "Closed by liquidation", "Closed by redemption"] as const;

/** Accounts whose NFT is currently held by the connected wallet (ownerOf is the authority). */
export function useMyAccounts() {
  const { address } = useAccount();
  const next = useReadContract({ address: F, abi: BallastFactoryAbi, functionName: "nextTokenId" });
  const n = next.data ? Number(next.data) - 1 : 0;
  const ids = Array.from({ length: n }, (_, i) => BigInt(i + 1));
  const owners = useReadContracts({
    contracts: ids.flatMap((id) => [
      { address: NFT, abi: BallastAccountNFTAbi, functionName: "ownerOf", args: [id] } as const,
      { address: F, abi: BallastFactoryAbi, functionName: "accountOf", args: [id] } as const,
    ]),
    query: { enabled: n > 0 },
  });
  const mine = ids
    .map((id, i) => ({ tokenId: id, owner: owners.data?.[i * 2]?.result as Address | undefined, account: owners.data?.[i * 2 + 1]?.result as Address | undefined }))
    .filter((x) => address && x.owner?.toLowerCase() === address.toLowerCase() && x.account);
  return { mine, isLoading: next.isLoading || owners.isLoading, refetch: () => { next.refetch(); owners.refetch(); } };
}

export function useAccountState(account?: Address) {
  const en = { enabled: !!account } as const;
  const q = useReadContracts({
    contracts: account
      ? [
          { address: account, abi: BallastAccountAbi, functionName: "controller" },
          { address: account, abi: BallastAccountAbi, functionName: "tokenId" },
          { address: account, abi: BallastAccountAbi, functionName: "policy" },
          { address: account, abi: BallastAccountAbi, functionName: "payoutAddress" },
          { address: account, abi: BallastAccountAbi, functionName: "hedgeReserve" },
          { address: account, abi: BallastAccountAbi, functionName: "freeMUSD" },
          { address: account, abi: BallastAccountAbi, functionName: "maxRepayable" },
          { address: TM, abi: TroveManagerAbi, functionName: "getTroveStatus", args: [account] },
          { address: TM, abi: TroveManagerAbi, functionName: "getEntireDebtAndColl", args: [account] },
          { address: TM, abi: TroveManagerAbi, functionName: "getTroveDebt", args: [account] },
          { address: cfg.mezo.PriceFeed, abi: PriceFeedAbi, functionName: "fetchPrice" },
          { address: cfg.mezo.MUSD, abi: MUSDAbi, functionName: "balanceOf", args: [account] },
          { address: cfg.mezo.BorrowerOperations, abi: BorrowerOperationsAbi, functionName: "minNetDebt" },
          { address: cfg.mezo.BorrowerOperations, abi: BorrowerOperationsAbi, functionName: "MUSD_GAS_COMPENSATION" },
          { address: TM, abi: TroveManagerAbi, functionName: "MCR" },
        ]
      : [],
    query: { ...en, refetchInterval: 20_000 },
  });
  const r = q.data?.map((x) => x.result);
  if (!r || r.some((x) => x === undefined)) return { data: undefined, isLoading: q.isLoading, error: q.error, refetch: q.refetch };
  const [controller, tokenId, policy, payout, hedgeReserve, freeMUSD, maxRepayable, status, ent, troveDebt, price, musdBal, minNetDebt, gasComp, mcr] = r;
  const e = ent as readonly bigint[];
  const coll = e[0] + e[3];
  const principal = e[1] + e[4];
  const interest = e[2] + e[5];
  const totalDebt = (troveDebt as bigint) + e[4] + e[5];
  const p = policy as { repayBps: number; reserveBps: number; paused: boolean; payout: Address };
  return {
    isLoading: false, error: null, refetch: q.refetch,
    data: {
      account: account!, controller: controller as Address, tokenId: tokenId as bigint,
      policy: p, payout: payout as Address,
      hedgeReserve: hedgeReserve as bigint, freeMUSD: freeMUSD as bigint, musdBal: musdBal as bigint, maxRepayable: maxRepayable as bigint,
      status: Number(status), coll, principal, interest, totalDebt, price: price as bigint,
      minNetDebt: minNetDebt as bigint, gasComp: gasComp as bigint, mcr: mcr as bigint,
    },
  };
}

export type AccountState = NonNullable<ReturnType<typeof useAccountState>["data"]>;
