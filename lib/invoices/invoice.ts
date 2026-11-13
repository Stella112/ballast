import { encodeAbiParameters, keccak256, toHex, type Address, type Hex } from "viem";
import { cfg } from "../config";

/**
 * Invoice links carry everything needed to pay; nothing is stored server-side.
 * invoiceId = keccak256(abi.encode(memo, salt)) so the memo shown to the payer is bound to the
 * controller's EIP-712 signature (tampering with the memo changes invoiceId -> BadSignature on-chain).
 */
export type InvoicePayload = {
  v: 1;
  tokenId: string;
  amount: string; // wei
  expiry: string; // unix seconds
  memo: string;
  salt: Hex;
  sig: Hex;
};

export const invoiceTypes = {
  Invoice: [
    { name: "tokenId", type: "uint256" },
    { name: "invoiceId", type: "bytes32" },
    { name: "amount", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
} as const;

export const invoiceDomain = {
  name: "BallastRouter",
  version: "1",
  chainId: cfg.chainId,
  verifyingContract: cfg.ballast.BallastRouter as Address,
} as const;

export function invoiceIdOf(memo: string, salt: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "string" }, { type: "bytes32" }], [memo, salt]));
}

export function randomSalt(): Hex {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return toHex(b);
}

export function encodeInvoice(p: InvoicePayload): string {
  const json = JSON.stringify(p);
  const b64 = typeof window === "undefined" ? Buffer.from(json).toString("base64") : btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeInvoice(s: string): InvoicePayload | null {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const json = typeof window === "undefined" ? Buffer.from(b64, "base64").toString() : decodeURIComponent(escape(atob(b64)));
    const p = JSON.parse(json);
    if (p.v !== 1 || !/^0x[0-9a-fA-F]{64}$/.test(p.salt) || !/^0x[0-9a-fA-F]+$/.test(p.sig)) return null;
    BigInt(p.tokenId); BigInt(p.amount); BigInt(p.expiry);
    if (typeof p.memo !== "string" || p.memo.length > 200) return null;
    return p as InvoicePayload;
  } catch {
    return null;
  }
}
