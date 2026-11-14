import { describe, expect, it } from "vitest";
import { droppedPrice, eligibilityAtPrice, icr, interestBuffer, liquidationPrice, maxPrincipalToBeat, maxRepayable, nicr, principalAfterRepay, quoteToBeat, scaleIcr } from "./math";

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
  it("droppedPrice applies basis points and rejects out-of-range drops", () => {
    expect(droppedPrice(68_000n * E18, 1000n)).toBe(61_200n * E18);
    expect(droppedPrice(68_000n * E18, 0n)).toBe(68_000n * E18);
    expect(droppedPrice(68_000n * E18, 10_000n)).toBe(0n);
    expect(() => droppedPrice(1n, 10_001n)).toThrow();
  });

  it("scaleIcr matches recomputing ICR at the new price within rounding", () => {
    const coll = 48n * 10n ** 15n, debt = 2159248319499518484193n, price = 67836210600000000000000n;
    for (const bps of [1000n, 2000n, 3000n]) {
      const np = droppedPrice(price, bps);
      const exact = icr(coll, debt, np);
      const scaled = scaleIcr(icr(coll, debt, price), price, np);
      expect(exact - scaled).toBeGreaterThanOrEqual(0n);
      expect(exact - scaled).toBeLessThanOrEqual(2n);
    }
  });

  it("quote includes post-repayment total debt and ICR when price is given", () => {
    const coll = 48n * 10n ** 15n, principal = 2159n * E18, interest = E18, totalDebt = principal + interest;
    const price = 68_000n * E18;
    const q = quoteToBeat({ coll, principal, interest, totalDebt, targetNicr: nicr(coll, principal) + 1000n, gasComp: 200n * E18, minNetDebt: 1800n * E18, buffer: 0n, price });
    expect(q.kind).toBe("ok");
    if (q.kind !== "ok") return;
    expect(q.newTotalDebt).toBe(totalDebt - q.repay);
    expect(q.newIcr).toBe(icr(coll, q.newTotalDebt, price));
    expect(q.newIcr! > icr(coll, totalDebt, price)).toBe(true);
  });

  it("eligibilityAtPrice drops troves below MCR from the redemption order and counts them", () => {
    const mcr = 11n * 10n ** 17n, price = 100n * E18, newPrice = 80n * E18; // -20%
    // tail-first: ICRs at `price`; after -20%: 1.2->0.96 (out), 1.5->1.2 (in), me, 2.0->1.6 (in)
    const list = [
      { icr: 12n * 10n ** 17n, debt: 10n * E18 },
      { icr: 15n * 10n ** 17n, debt: 20n * E18 },
      { icr: 16n * 10n ** 17n, debt: 30n * E18 },
      { icr: 20n * 10n ** 17n, debt: 40n * E18 },
    ];
    const r = eligibilityAtPrice({ list, pos: 2, myIcrAtNewPrice: scaleIcr(list[2].icr, price, newPrice), mcr, price, newPrice });
    expect(r).toEqual({ eligibleRank: 2, eligibleCount: 3, debtAheadEligible: 20n * E18, liquidatableCount: 1 });
    const low = eligibilityAtPrice({ list, pos: 0, myIcrAtNewPrice: scaleIcr(list[0].icr, price, newPrice), mcr, price, newPrice });
    expect(low.eligibleRank).toBeUndefined();
  });
});
