import { describe, expect, it } from "vitest";
import { simulateHedge } from "./sim";

const base = { collateral: 1000, size: 500, entry: 68_000, movePct: 0, aprPct: 0, days: 30, swapFeePct: 0, lltvPct: 86 };

describe("synthetic hedge simulator", () => {
  it("no move, no costs: zero P/L", () => {
    expect(simulateHedge(base).pnl).toBeCloseTo(0, 9);
  });
  it("BTC -20%: short gains 20% of size before costs", () => {
    expect(simulateHedge({ ...base, movePct: -20 }).pnl).toBeCloseTo(100, 9);
  });
  it("BTC +20%: short loses 20% of size", () => {
    expect(simulateHedge({ ...base, movePct: 20 }).pnl).toBeCloseTo(-100, 9);
  });
  it("costs reduce P/L: interest accrues in BTC, fees on both swaps", () => {
    const r = simulateHedge({ ...base, aprPct: 10, swapFeePct: 0.3 });
    expect(r.pnl).toBeLessThan(0);
    expect(r.pnl).toBeCloseTo(-(r.interestCost + r.swapCost), 6);
  });
  it("liquidation price = LLTV x collateral / BTC owed; a big rally liquidates", () => {
    const r = simulateHedge(base);
    expect(r.liquidationPrice).toBeCloseTo((0.86 * 1000) / (500 / 68_000), 6);
    const up = simulateHedge({ ...base, movePct: 80 });
    expect(up.liquidated).toBe(true);
    expect(up.pnl).toBeLessThan(0);
  });
  it("rejects invalid inputs", () => {
    expect(() => simulateHedge({ ...base, entry: 0 })).toThrow();
  });
});
