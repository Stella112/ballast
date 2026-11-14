import { encodeAbiParameters, isAddress, keccak256, type Address, type Hex } from "viem";
import { cfg } from "../config";
import { invoiceVersion } from "./invoice";

/**
 * Invoice for a borrower whose Mezo loan is held directly by their wallet (not a Ballast account).
 * The merchant signs TWO messages off-chain (no gas):
 *  1. DirectInvoice (BallastRepaymentAdapter domain): merchant, invoiceId, amount, repayAmount, expiry.
 *  2. Mezo's own RepayMUSD (BorrowerOperationsSignatures domain): exact repayAmount, current Mezo nonce, deadline.
 * The second is ONE-OFF: Mezo consumes the nonce. Any other Mezo signed operation by the merchant first
 * invalidates it. It is never a standing permission.
 */
export type DirectInvoicePayload = {
  v: 2;
  merchant: Address;
  amount: string; // wei
  repayAmount: string; // wei, part of amount
  expiry: string; // unix seconds (also the Mezo signature deadline)
  memo: string;
  salt: Hex;
  invoiceSig: Hex;
  repaySig: Hex; // empty "0x" when repayAmount = 0
  mezoNonce: string; // the nonce the repay signature was made for
};

export const directInvoiceTypes = {
  DirectInvoice: [
    { name: "merchant", type: "address" },
    { name: "invoiceId", type: "bytes32" },
    { name: "amount", type: "uint256" },
    { name: "repayAmount", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
} as const;

export const directInvoiceDomain = {
  name: "BallastRepaymentAdapter",
  version: "1",
  chainId: cfg.chainId,
  verifyingContract: cfg.ballast.BallastRepaymentAdapter,
} as const;

/** Mezo BorrowerOperationsSignatures EIP-712 (verified against the live contract's eip712Domain and source). */
export const mezoRepayTypes = {
  RepayMUSD: [
    { name: "amount", type: "uint256" },
    { name: "borrower", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const mezoSignaturesDomain = {
  name: "BorrowerOperationsSignatures",
  version: "1",
  chainId: cfg.chainId,
  verifyingContract: cfg.mezo.BorrowerOperationsSignatures,
} as const;

export function decodeDirectInvoice(s: string): DirectInvoicePayload | null {
  try {
    if (invoiceVersion(s) !== 2) return null;
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const json = typeof window === "undefined" ? Buffer.from(b64, "base64").toString() : decodeURIComponent(escape(atob(b64)));
    const p = JSON.parse(json);
    if (!isAddress(p.merchant) || !/^0x[0-9a-fA-F]{64}$/.test(p.salt)) return null;
    if (!/^0x[0-9a-fA-F]+$/.test(p.invoiceSig) || !/^0x[0-9a-fA-F]*$/.test(p.repaySig)) return null;
    const amount = BigInt(p.amount), repay = BigInt(p.repayAmount);
    BigInt(p.expiry); BigInt(p.mezoNonce);
    if (repay > amount || amount <= 0n) return null;
    if (typeof p.memo !== "string" || p.memo.length > 200) return null;
    return p as DirectInvoicePayload;
  } catch {
    return null;
  }
}

/** Mirrors BallastRepaymentAdapter.invoiceKey(merchant, invoiceId) = keccak256(abi.encode(merchant, invoiceId)). */
export function invoiceKeyOf(merchant: Address, invoiceId: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [merchant, invoiceId]));
}
