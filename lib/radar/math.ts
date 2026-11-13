/**
 * Redemption Radar math. Pure bigint; mirrors Mezo MUSD (mezo-org/musd@da7888a):
 *  - NICR = coll * 1e20 / principal            (LiquityMath._computeNominalCR, integer division)
 *  - ICR  = coll * price / totalDebt           (LiquityMath._computeCR, price 1e18)
 *  - SortedTroves: descending NICR; head = highest, tail = lowest. Redemption starts at tail
 *    and skips troves with ICR < MCR (TroveManager.redeemCollateral).
 *  - Repayment pays accrued interest first, then principal (InterestRateMath.calculateDebtAdjustment).
 *  - Repay floor: (totalDebt - gasComp) - repay >= minNetDebt (BorrowerOperations._adjustTrove).
 */
export const NICR_PRECISION = 10n ** 20n;
export const WAD = 10n ** 18n;
export const SECONDS_PER_YEAR = 31_536_000n;

export function nicr(coll: bigint, principal: bigint): bigint {
  if (principal === 0n) return (1n << 256n) - 1n;
  return (coll * NICR_PRECISION) / principal;
}

export function icr(coll: bigint, debt: bigint, price: bigint): bigint {
  if (debt === 0n) return (1n << 256n) - 1n;
  return (coll * price) / debt;
}

/** Largest principal p' such that nicr(coll, p') > target (strictly; ties are not "passing"). */
export function maxPrincipalToBeat(coll: bigint, targetNicr: bigint): bigint {
  return (coll * NICR_PRECISION) / (targetNicr + 1n);
}

/** Repayment that only lowers principal after interest is paid off. */
export function principalAfterRepay(principal: bigint, interest: bigint, repay: bigint): bigint {
  if (repay <= interest) return principal;
  const p = repay - interest;
  return p >= principal ? 0n : principal - p;
}

/** Interest accrued over `seconds` at `rateBps` simple-interest on principal (for a staleness buffer). */
export function interestBuffer(principal: bigint, rateBps: bigint, seconds: bigint): bigint {
  return (principal * rateBps * seconds) / (10_000n * SECONDS_PER_YEAR) + 1n;
}

/** Max repayment Mezo accepts without closing. */
export function maxRepayable(totalDebt: bigint, gasComp: bigint, minNetDebt: bigint): bigint {
  const floor = gasComp + minNetDebt;
  return totalDebt > floor ? totalDebt - floor : 0n;
}

/**
 * Lowest price at which the trove is NOT liquidatable (ICR >= MCR), rounded up.
 * Liquidation becomes possible strictly below this. Estimate only: debt keeps accruing interest.
 */
export function liquidationPrice(coll: bigint, totalDebt: bigint, mcr: bigint): bigint {
  if (coll === 0n) return 0n;
  return (mcr * totalDebt + coll - 1n) / coll;
}

export type Quote =
  | { kind: "already-ahead"; repay: 0n }
  | { kind: "ok"; repay: bigint; newPrincipal: bigint; newNicr: bigint; buffer: bigint }
  | { kind: "exceeds-floor"; repay: bigint; maxRepayable: bigint };

/** Repayment needed so our NICR strictly exceeds targetNicr. */
export function quoteToBeat(args: {
  coll: bigint;
  principal: bigint;
  interest: bigint; // accrued interest owed now (paid first)
  totalDebt: bigint;
  targetNicr: bigint;
  gasComp: bigint;
  minNetDebt: bigint;
  buffer: bigint; // extra to cover interest accruing before execution
}): Quote {
  const { coll, principal, interest, totalDebt, targetNicr, gasComp, minNetDebt, buffer } = args;
  if (nicr(coll, principal) > targetNicr) return { kind: "already-ahead", repay: 0n };
  const pTarget = maxPrincipalToBeat(coll, targetNicr);
  const repay = interest + (principal - pTarget) + buffer;
  const cap = maxRepayable(totalDebt, gasComp, minNetDebt);
  if (repay > cap) return { kind: "exceeds-floor", repay, maxRepayable: cap };
  const newPrincipal = principalAfterRepay(principal, interest, repay);
  return { kind: "ok", repay, newPrincipal, newNicr: nicr(coll, newPrincipal), buffer };
}
