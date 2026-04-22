/**
 * PURE: Compute quantity per level based on available capital and constraints.
 */
import Decimal, { type D } from '../decimal.js';
import type { BotConfig } from '../config/schema.js';
import type { PairConstraints } from '../exchange/types.js';

export function computeQuantityPerLevel(
  freeMargin: D,
  config: BotConfig,
  referencePrice: D,
  constraints: PairConstraints,
): D {
  const usable = freeMargin
    .mul(config.capitalAllocationPercent).div(100)
    .mul(new Decimal(100).minus(config.reservePercent)).div(100);

  const totalNotional = usable.mul(config.leverage);
  const perOrderNotional = totalNotional.div(config.gridCount);
  let qty: D = perOrderNotional.div(referencePrice);

  const factor = new Decimal(10).pow(constraints.baseDecimalPlaces);
  qty = qty.mul(factor).floor().div(factor);

  const minQty = new Decimal(constraints.minBaseAmount);
  if (qty.lt(minQty)) {
    throw new Error(
      `Computed qty ${qty} below minimum ${minQty}. Reduce gridCount or increase capital.`,
    );
  }
  return qty;
}
