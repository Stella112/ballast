// Creates a wallet-loan ("existing Mezo loan") invoice link, signed with viem exactly like /app/existing does.
// Merchant = PAYER_PRIVATE_KEY wallet (holds its own Mezo trove). Off-chain signatures only, no tx.
// Usage: pnpm tsx scripts/make-direct-invoice.ts <amountMUSD> <repayPct> [memo] [hours] [baseUrl]
import fs from "node:fs";
import { createPublicClient, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { cfg, mezoTestnet, RPC_URL } from "../lib/config";
import { BallastRepaymentAdapterAbi } from "../lib/abis";
import { encodeInvoice, invoiceIdOf, randomSalt } from "../lib/invoices/invoice";
import { directInvoiceDomain, directInvoiceTypes, mezoRepayTypes, mezoSignaturesDomain, type DirectInvoicePayload } from "../lib/invoices/direct";

async function main() {
  const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  const acct = privateKeyToAccount(env.PAYER_PRIVATE_KEY as `0x${string}`);
  const [amountStr = "10", pctStr = "20", memo = "Ballast existing-loan demo", hours = "48", base = "http://localhost:3000"] = process.argv.slice(2);
  const client = createPublicClient({ chain: mezoTestnet, transport: http(RPC_URL) });
  const amount = parseUnits(amountStr, 18);
  const repayAmount = (amount * BigInt(Math.round(Number(pctStr) * 100))) / 10_000n;
  const nonce = await client.readContract({ address: cfg.ballast.BallastRepaymentAdapter, abi: BallastRepaymentAdapterAbi, functionName: "mezoNonce", args: [acct.address] });
  const salt = randomSalt();
  const invoiceId = invoiceIdOf(memo, salt);
  const expiry = BigInt(Math.floor(Date.now() / 1000) + Number(hours) * 3600);
  const invoiceSig = await acct.signTypedData({ domain: directInvoiceDomain, types: directInvoiceTypes, primaryType: "DirectInvoice", message: { merchant: acct.address, invoiceId, amount, repayAmount, expiry } });
  const repaySig = repayAmount === 0n ? "0x" : await acct.signTypedData({ domain: mezoSignaturesDomain, types: mezoRepayTypes, primaryType: "RepayMUSD", message: { amount: repayAmount, borrower: acct.address, nonce, deadline: expiry } });
  const p: DirectInvoicePayload = { v: 2, merchant: acct.address, amount: amount.toString(), repayAmount: repayAmount.toString(), expiry: expiry.toString(), memo, salt, invoiceSig, repaySig: repaySig as `0x${string}`, mezoNonce: nonce.toString() };
  console.error(`merchant ${acct.address} invoiceId ${invoiceId} amount ${amount} repay ${repayAmount} expiry ${expiry} mezoNonce ${nonce}`);
  console.log(`${base}/pay/${encodeInvoice(p)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
