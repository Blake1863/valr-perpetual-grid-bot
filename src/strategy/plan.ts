/**
 * PURE: Plan desired orders given current grid levels and market price.
 * Implements dynamic inventory bias: recomputed every tick.
 */
import Decimal, { type D } from '../decimal.js';
import type { Level } from './grid.js';
import type { PairConstraints } from '../exchange/types.js';

export interface DesiredOrder {
  levelIndex: number;
  side: 'BUY' | 'SELL';
  price: D;
  priceStr: string;
  quantity: D;
  quantityStr: string;
  customerOrderId: string;
}

export function planDesiredOrders(
  levels: Level[],
  currentPrice: D,
  quantityPerLevel: D,
  runId: string,
  constraints: PairConstraints,
): DesiredOrder[] {
  if (levels.length < 3) {
    throw new Error('At least 3 levels expected (2 boundaries + 1 inner)');
  }

  const decimalPlaces = constraints.baseDecimalPlaces;
  const factor = new Decimal(10).pow(decimalPlaces);
  const roundedQty = quantityPerLevel.mul(factor).round().div(factor);
  const qtyStr = roundedQty.toFixed(decimalPlaces);

  const desired: DesiredOrder[] = [];

  for (let i = 1; i < levels.length - 1; i++) {
    const level = levels[i];
    let side: 'BUY' | 'SELL' | null = null;

    if (level.price.lt(currentPrice)) {
      side = 'BUY';
    } else if (level.price.gt(currentPrice)) {
      side = 'SELL';
    }

    if (side !== null) {
      const orderId = `gridv4-${side[0]}${level.index}-${runId}`.slice(0, 50);
      desired.push({
        levelIndex: level.index,
        side,
        price: level.price,
        priceStr: level.priceStr,
        quantity: roundedQty,
        quantityStr: qtyStr,
        customerOrderId: orderId,
      });
    }
  }

  return desired;
}
