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

/** BTC price after a drop given in basis points (1000 = 10%), rounded down. */
export function droppedPrice(price: bigint, dropBps: bigint): bigint {
  if (dropBps < 0n || dropBps > 10_000n) throw new Error("dropBps out of range");
  return (price * (10_000n - dropBps)) / 10_000n;
}

/**
 * ICR is linear in price (coll * price / debt), so an ICR read at `price` can be re-expressed at
 * `newPrice` without re-reading coll/debt. Integer rounding can differ from a fresh
 * getCurrentICR(newPrice) by at most a few wei — only relevant exactly at a threshold.
 */
export function scaleIcr(icrAtPrice: bigint, price: bigint, newPrice: bigint): bigint {
  if (price === 0n) return 0n;
  return (icrAtPrice * newPrice) / price;
}

export type Quote =
  | { kind: "already-ahead"; repay: 0n }
  | { kind: "ok"; repay: bigint; newPrincipal: bigint; newNicr: bigint; buffer: bigint; newTotalDebt: bigint; newIcr?: bigint }
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
  price?: bigint; // if given, the post-repayment ICR at this price is included
}): Quote {
  const { coll, principal, interest, totalDebt, targetNicr, gasComp, minNetDebt, buffer, price } = args;
  if (nicr(coll, principal) > targetNicr) return { kind: "already-ahead", repay: 0n };
  const pTarget = maxPrincipalToBeat(coll, targetNicr);
  const repay = interest + (principal - pTarget) + buffer;
  const cap = maxRepayable(totalDebt, gasComp, minNetDebt);
  if (repay > cap) return { kind: "exceeds-floor", repay, maxRepayable: cap };
  const newPrincipal = principalAfterRepay(principal, interest, repay);
  // Repayment reduces total debt one-for-one (interest first, then principal).
  const newTotalDebt = totalDebt - repay;
  const newIcr = price === undefined ? undefined : icr(coll, newTotalDebt, price);
  return { kind: "ok", repay, newPrincipal, newNicr: nicr(coll, newPrincipal), buffer, newTotalDebt, newIcr };
}

/**
 * Redemption eligibility at a hypothetical price. `list` is tail-first (index 0 is redeemed first),
 * each row's `icr` read at `price`; `pos` is our index in `list`. NICR order does not depend on price,
 * but which troves redemption skips (ICR < MCR) does. Does not model liquidations that a lower price
 * would trigger for other troves (they would leave the list), so ranks are an estimate.
 */
export function eligibilityAtPrice(args: {
  list: { icr: bigint; debt: bigint }[];
  pos: number;
  myIcrAtNewPrice: bigint;
  mcr: bigint;
  price: bigint;
  newPrice: bigint;
}): { eligibleRank?: number; eligibleCount: number; debtAheadEligible: bigint; liquidatableCount: number } {
  const { list, pos, myIcrAtNewPrice, mcr, price, newPrice } = args;
  let eligibleCount = 0;
  let liquidatableCount = 0;
  let ahead = 0;
  let debtAheadEligible = 0n;
  list.forEach((r, i) => {
    const x = i === pos ? myIcrAtNewPrice : scaleIcr(r.icr, price, newPrice);
    if (x >= mcr) {
      eligibleCount++;
      if (i < pos) { ahead++; debtAheadEligible += r.debt; }
    } else liquidatableCount++;
  });
  const eligibleRank = pos >= 0 && myIcrAtNewPrice >= mcr ? ahead + 1 : undefined;
  return { eligibleRank, eligibleCount, debtAheadEligible, liquidatableCount };
}
