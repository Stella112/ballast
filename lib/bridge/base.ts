import { encodeAbiParameters, pad, toHex, type Address, type Hex } from "viem";
import { cfg } from "../config";

/** Wormhole payload the Base Sepolia transfer carries; must match BallastBridgeReceiver.BridgePayload. */
export function encodeBridgePayload(p: {
  invoice: { tokenId: bigint; invoiceId: Hex; amount: bigint; expiry: bigint };
  invoiceSig: Hex;
  refundTo: Address;
  minMusdOut: bigint;
}): Hex {
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "version", type: "uint8" },
          {
            name: "invoice",
            type: "tuple",
            components: [
              { name: "tokenId", type: "uint256" },
              { name: "invoiceId", type: "bytes32" },
              { name: "amount", type: "uint256" },
              { name: "expiry", type: "uint256" },
            ],
          },
          { name: "invoiceSig", type: "bytes" },
          { name: "refundTo", type: "address" },
          { name: "minMusdOut", type: "uint256" },
        ],
      },
    ],
    [{ version: 1, invoice: p.invoice, invoiceSig: p.invoiceSig, refundTo: p.refundTo, minMusdOut: p.minMusdOut }],
  );
}

export const addressToBytes32 = (a: Address): Hex => pad(a, { size: 32 });

/** Fetch the guardian-signed VAA for a Base Sepolia token-bridge message from Wormholescan (testnet). null = not yet. */
export async function fetchVaa(sequence: bigint): Promise<Hex | null> {
  const emitter = addressToBytes32(cfg.baseSepolia.WormholeTokenBridge).slice(2).toLowerCase();
  const url = `${cfg.baseSepolia.wormholescanApi}/api/v1/vaas/${cfg.baseSepolia.WormholeChainId}/${emitter}/${sequence.toString()}`;
  const r = await fetch(url, { cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Wormholescan HTTP ${r.status}`);
  const j = await r.json();
  const b64: string | undefined = j?.data?.vaa;
  if (!b64) return null;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return toHex(bytes);
}

/** USDC (6 decimals) to send so the Mezo pool returns at least `musd` (18 decimals): start at 1:1 + 1%. */
export const usdcFor = (musd: bigint, bumpBps: bigint) => ((musd / 10n ** 12n + 1n) * (10_000n + bumpBps)) / 10_000n + 1n;
