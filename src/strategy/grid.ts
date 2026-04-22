/**
 * PURE: Build grid levels within a price range.
 * No side effects, fully deterministic.
 */
import Decimal, { type D } from '../decimal.js';
import type { PairConstraints } from '../exchange/types.js';

export interface Level {
  index: number;
  price: D;
  priceStr: string;
}

export function buildLevels(
  lowerBound: D,
  upperBound: D,
  gridCount: number,
  mode: 'geometric' | 'arithmetic',
  constraints: PairConstraints,
): Level[] {
  if (lowerBound.gte(upperBound)) {
    throw new Error(`lowerBound (${lowerBound}) must be less than upperBound (${upperBound})`);
  }
  if (gridCount < 2) {
    throw new Error('gridCount must be >= 2');
  }

  const numIntervals = gridCount + 1;
  const tickSize = new Decimal(constraints.tickSize);
  const decimalPlaces = constraints.quoteDecimalPlaces;
  const factor = new Decimal(10).pow(decimalPlaces);

  const rawLevels: Level[] = [];

  for (let i = 0; i <= gridCount + 1; i++) {
    let rawPrice: D;

    if (mode === 'geometric') {
      const ratio = upperBound.div(lowerBound).pow(new Decimal(1).div(numIntervals));
      rawPrice = lowerBound.mul(ratio.pow(i));
    } else {
      const step = upperBound.minus(lowerBound).div(numIntervals);
      rawPrice = lowerBound.plus(step.mul(i));
    }

    const tickRounded = rawPrice.div(tickSize).round().mul(tickSize);
    const rounded = tickRounded.mul(factor).round().div(factor);

    rawLevels.push({ index: i, price: rounded, priceStr: rounded.toFixed(decimalPlaces) });
  }

  // Deduplicate on priceStr
  const seen = new Set<string>();
  const deduped: Level[] = [];
  for (const lvl of rawLevels) {
    if (!seen.has(lvl.priceStr)) {
      seen.add(lvl.priceStr);
      deduped.push(lvl);
    }
  }

  // Re-index
  return deduped.map((lvl, i) => ({ ...lvl, index: i }));
}
