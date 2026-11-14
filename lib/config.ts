import deployments from "../config/deployments.mezo-testnet.json";
import { defineChain, type Address } from "viem";

/** Single source of truth for addresses: config/deployments.mezo-testnet.json (verified, see docs/VERIFICATION.md). */
export const cfg = deployments as unknown as {
  chainId: number;
  rpcUrl: string;
  explorer: string;
  mezo: Record<"MUSD" | "BorrowerOperations" | "BorrowerOperationsSignatures" | "TroveManager" | "SortedTroves" | "HintHelpers" | "PriceFeed" | "WormholeCore" | "WormholeTokenBridge" | "PoolsRouter" | "PoolFactory" | "MusdBtcPool", Address> & { WormholeChainId: number };
  ballast: {
    BallastRouter: Address;
    BallastAccountNFT: Address;
    BallastFactory: Address;
    BallastRepaymentAdapter: Address;
    Morpho?: Address;
    MorphoBTC?: Address;
    AdaptiveCurveIrm?: Address;
    BallastMezoOracle?: Address;
    MorphoMarketId?: `0x${string}`;
    BallastHedgeFactory?: Address;
    BallastBridgeReceiver?: Address;
    BridgedUSDC?: Address;
    UsdcMusdPool?: Address;
    BallastAccount?: Address;
    tokenId?: number;
  };
  baseSepolia: {
    chainId: number;
    rpcUrl: string;
    explorer: string;
    USDC: Address;
    WormholeCore: Address;
    WormholeTokenBridge: Address;
    WormholeChainId: number;
    wormholescanApi: string;
  };
};

export const RPC_URL = process.env.NEXT_PUBLIC_MEZO_RPC_URL || cfg.rpcUrl;
export const EXPLORER = cfg.explorer; // verified explorer base only

/** Multicall3 at the canonical address; bytecode presence checked on Mezo testnet 2026-11-13. */
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

export const mezoTestnet = defineChain({
  id: 31611,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "Mezo Explorer", url: EXPLORER } },
  contracts: { multicall3: { address: MULTICALL3 } },
  testnet: true,
});

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addrUrl = (a: string) => `${EXPLORER}/address/${a}`;

/** Base Sepolia (only used for paying invoices with USDC through the Wormhole Token Bridge). */
export const baseSepoliaChain = defineChain({
  id: 84532,
  name: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [cfg.baseSepolia.rpcUrl] } },
  blockExplorers: { default: { name: "Blockscout", url: cfg.baseSepolia.explorer } },
  testnet: true,
});
export const baseTxUrl = (hash: string) => `${cfg.baseSepolia.explorer}/tx/${hash}`;
