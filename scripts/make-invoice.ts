// Creates a merchant-signed invoice link with the controller key in .env.local (off-chain signature, no tx).
// Usage: pnpm tsx scripts/make-invoice.ts <amountMUSD> [memo] [hours] [baseUrl]
import fs from "node:fs";
import { parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { cfg } from "../lib/config";
import { encodeInvoice, invoiceDomain, invoiceIdOf, invoiceTypes, randomSalt } from "../lib/invoices/invoice";

async function main() {
  const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  const acct = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY as `0x${string}`);
  const [amountStr = "10", memo = "Ballast demo invoice", hours = "48", base = "http://localhost:3000"] = process.argv.slice(2);
  const amount = parseUnits(amountStr, 18);
  const salt = randomSalt();
  const invoiceId = invoiceIdOf(memo, salt);
  const expiry = BigInt(Math.floor(Date.now() / 1000) + Number(hours) * 3600);
  const tokenId = BigInt(cfg.ballast.tokenId!);
  const sig = await acct.signTypedData({ domain: invoiceDomain, types: invoiceTypes, primaryType: "Invoice", message: { tokenId, invoiceId, amount, expiry } });
  const link = `${base}/pay/${encodeInvoice({ v: 1, tokenId: tokenId.toString(), amount: amount.toString(), expiry: expiry.toString(), memo, salt, sig })}`;
  console.error(`invoiceId ${invoiceId} amount ${amount} expiry ${expiry}`);
  console.log(link);
}
main().catch((e) => { console.error(e); process.exit(1); });
