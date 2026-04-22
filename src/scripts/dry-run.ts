/**
 * Dry-run: builds grid and prints what WOULD be placed — no API calls.
 */
import { loadConfig } from '../config/loader.js';
import { getStaticConstraints } from '../exchange/pairMetadata.js';
import { buildLevels } from '../strategy/grid.js';
import { planDesiredOrders } from '../strategy/plan.js';
import Decimal from '../decimal.js';

const configPath = process.argv[2];
if (!configPath) {
  console.error('Usage: node dist/scripts/dry-run.js <config.json>');
  process.exit(1);
}

const config = loadConfig(configPath);
const constraints = getStaticConstraints(config.pair);
const lower = new Decimal(config.lowerBound);
const upper = new Decimal(config.upperBound);
const refPrice = lower.plus(upper).div(2);
const levels = buildLevels(lower, upper, config.gridCount, config.gridMode, constraints);
const qty = new Decimal('1');
const desired = planDesiredOrders(levels, refPrice, qty, 'dryrun', constraints);

console.log(`\n=== DRY-RUN GRID FOR ${config.pair} ===`);
console.log(`Reference price : ${refPrice.toFixed(constraints.quoteDecimalPlaces)}`);
console.log(`Range           : ${config.lowerBound} – ${config.upperBound}  (${config.gridMode})`);
console.log(`Grid count      : ${config.gridCount} inner levels  (${levels.length} total with boundaries)`);
console.log(`\nAll levels:`);
for (const l of levels) {
  const isBoundary = l.index === 0 || l.index === levels.length - 1;
  const tag = isBoundary ? 'BOUNDARY' : l.price.lt(refPrice) ? 'BUY     ' : l.price.gt(refPrice) ? 'SELL    ' : 'AT-PRICE';
  console.log(`  L${String(l.index).padStart(2, '0')}: ${l.priceStr.padStart(12)}  ${tag}`);
}
console.log(`\nDesired orders (${desired.length}):`);
for (const o of desired) {
  console.log(`  ${o.side.padEnd(4)} qty=${o.quantityStr.padStart(6)} @ ${o.priceStr.padStart(12)}  id=${o.customerOrderId}`);
}
