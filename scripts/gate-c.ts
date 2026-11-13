// Gate C helper: fresh quote to pass the next trove, prints amount rounded UP to 1e-6 MUSD.
import { formatUnits } from "viem";
import { cfg } from "../lib/config";
import { takeSnapshot } from "../lib/radar/snapshot";
async function main() {
const s = await takeSnapshot(cfg.ballast.BallastAccount!, [1]);
const t = s.me!.targets[0];
if (!t.quote || t.quote.kind !== "ok") { console.error("no reachable quote", t); process.exit(1); }
const unit = 10n ** 12n;
const up = ((t.quote.repay + unit - 1n) / unit) * unit;
console.error(`block ${s.blockNumber} rank ${s.me!.rawPosFromTail} target ${t.target} targetNICR ${t.targetNicr} quote ${t.quote.repay} -> ${up}`);
console.log(formatUnits(up, 18));
}
main().catch((e) => { console.error(e); process.exit(1); });
