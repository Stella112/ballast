/**
 * SYNTHETIC hedge simulator — display only, never used for a transaction.
 * Models the proposed Morpho short: post `collateral` MUSD, borrow `size / entry` BTC, sell it for MUSD,
 * later buy the BTC back (plus interest accrued in BTC) and repay. All inputs are user assumptions;
 * no market with these parameters exists on Mezo testnet (see docs/VERIFICATION.md).
 */
export type HedgeInputs = {
  collateral: number; // MUSD posted as collateral
  size: number; // MUSD value of BTC borrowed at entry
  entry: number; // BTC price at open (MUSD)
  movePct: number; // BTC price change until close, e.g. -20
  aprPct: number; // assumed borrow APR on the BTC loan
  days: number; // holding period
  swapFeePct: number; // assumed cost per swap (fee + slippage)
  lltvPct: number; // assumed liquidation LTV of the market
};

export type HedgeResult = {
  btcBorrowed: number;
  btcOwed: number; // incl. interest at close
  exitPrice: number;
  liquidationPrice: number; // BTC price at which borrowed value exceeds LLTV x collateral
  liquidated: boolean;
  pnl: number; // MUSD, at exit price (or at the liquidation price if liquidated, before any penalty)
  interestCost: number; // MUSD at exit price
  swapCost: number; // MUSD
};

export function simulateHedge(x: HedgeInputs): HedgeResult {
  if (!(x.entry > 0) || !(x.size >= 0) || !(x.collateral >= 0) || !(x.days >= 0)) throw new Error("invalid inputs");
  const btcBorrowed = x.size / x.entry;
  const interest = (x.aprPct / 100) * (x.days / 365);
  const btcOwed = btcBorrowed * (1 + interest);
  const fee = x.swapFeePct / 100;
  const exitPrice = x.entry * (1 + x.movePct / 100);
  const liquidationPrice = btcOwed > 0 ? ((x.lltvPct / 100) * x.collateral) / btcOwed : Infinity;
  const liquidated = exitPrice >= liquidationPrice;
  const closeAt = liquidated ? liquidationPrice : exitPrice;
  const proceeds = x.size * (1 - fee);
  const buyback = btcOwed * closeAt * (1 + fee);
  return {
    btcBorrowed,
    btcOwed,
    exitPrice,
    liquidationPrice,
    liquidated,
    pnl: proceeds - buyback,
    interestCost: btcBorrowed * interest * closeAt,
    swapCost: x.size * fee + btcOwed * closeAt * fee,
  };
}
