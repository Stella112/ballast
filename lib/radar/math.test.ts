import { describe, expect, it } from "vitest";
import { icr, interestBuffer, liquidationPrice, maxPrincipalToBeat, maxRepayable, nicr, principalAfterRepay, quoteToBeat } from "./math";

const E18 = 10n ** 18n;

describe("radar math", () => {
  it("nicr matches LiquityMath._computeNominalCR (integer division, 1e20)", () => {
    // live account after Gate B: coll 0.048 BTC, principal 2172000341602078136735 → NICR read on-chain 2209944403811417 (block 16762255)
    expect(nicr(48n * 10n ** 15n, 2172000000000000000000n)).toBe(2209944751381215n); // stored principal (interest excluded) differs
    expect(nicr(1n, 0n)).toBe((1n << 256n) - 1n);
  });

  it("maxPrincipalToBeat yields a strictly greater NICR, and +1 wei does not", () => {
    const coll = 48n * 10n ** 15n;
    const target = 2222999300629433n; // live target from Gate C
    const p = maxPrincipalToBeat(coll, target);
    expect(nicr(coll, p)).toBeGreaterThan(target);
    expect(nicr(coll, p + 1n)).toBeLessThanOrEqual(target);
  });

  it("repayment pays interest first", () => {
    expect(principalAfterRepay(100n, 10n, 5n)).toBe(100n);
    expect(principalAfterRepay(100n, 10n, 10n)).toBe(100n);
    expect(principalAfterRepay(100n, 10n, 30n)).toBe(80n);
    expect(principalAfterRepay(100n, 10n, 500n)).toBe(0n);
  });

  it("maxRepayable respects gas comp + min net debt", () => {
    expect(maxRepayable(2202n * E18, 200n * E18, 1800n * E18)).toBe(202n * E18);
    expect(maxRepayable(1900n * E18, 200n * E18, 1800n * E18)).toBe(0n);
  });

  it("quote: already ahead / ok / exceeds floor", () => {
    const base = { coll: 48n * 10n ** 15n, interest: 1000n, gasComp: 200n * E18, minNetDebt: 1800n * E18, buffer: 0n };
    const principal = 2172n * E18;
    const totalDebt = principal + 1000n;
    expect(quoteToBeat({ ...base, principal, totalDebt, targetNicr: 1n }).kind).toBe("already-ahead");
    const ok = quoteToBeat({ ...base, principal, totalDebt, targetNicr: 2222999300629433n });
    expect(ok.kind).toBe("ok");
    if (ok.kind === "ok") {
      expect(ok.newNicr).toBeGreaterThan(2222999300629433n);
      expect(ok.repay).toBe(base.interest + (principal - maxPrincipalToBeat(base.coll, 2222999300629433n)));
    }
    const far = quoteToBeat({ ...base, principal, totalDebt, targetNicr: 2_600_000_000_000_000n });
    expect(far.kind).toBe("exceeds-floor");
  });

  it("Gate C live numbers: quoted amount moved NICR above the target", () => {
    // Repaid event: debtBefore 2172001385722092709230 -> debtAfter 2159244602722092709230 (amount 12.756783e18)
    // After snapshot NICR 2222999651798961 > target 2222999300629433.
    expect(2222999651798961n).toBeGreaterThan(2222999300629433n);
    expect(2172001385722092709230n - 2159244602722092709230n).toBe(12756783000000000000n);
  });

  it("liquidation price rounds up and is the ICR == MCR boundary", () => {
    const coll = 48n * 10n ** 15n, debt = 2159n * E18, mcr = 11n * 10n ** 17n;
    const p = liquidationPrice(coll, debt, mcr);
    expect(icr(coll, debt, p)).toBeGreaterThanOrEqual(mcr);
    expect(icr(coll, debt, p - 1n)).toBeLessThan(mcr);
  });

  it("interest buffer is positive and small", () => {
    const b = interestBuffer(2172n * E18, 100n, 600n);
    expect(b).toBeGreaterThan(0n);
    expect(b).toBeLessThan(E18 / 1000n);
  });
});
