import { describe, expect, it } from '@jest/globals';
import { Decimal } from '../src/decimal.js';
import { computeQuantityPerLevel } from '../src/strategy/sizing.js';
import type { PairConstraints } from '../src/exchange/types.js';
import type { BotConfig } from '../src/config/schema.js';

const C: PairConstraints = {
  pair: 'SOLUSDTPERP',
  tickSize: 0.01, stepSize: 0.01,
  baseDecimalPlaces: 2, quoteDecimalPlaces: 2,
  minBaseAmount: 0.01, maxBaseAmount: 1_000_000, minQuoteAmount: 1,
};

const BASE_CONFIG = {
  pair: 'SOLUSDTPERP', subaccountId: '123',
  gridCount: 10, lowerBound: '80', upperBound: '100', stopLossPercent: 3,
  gridMode: 'geometric' as const, leverage: 10,
  capitalAllocationPercent: 100, reservePercent: 10, dynamicSizing: true,
  onRangeExit: 'halt' as const, stopLossReference: 'avg_entry' as const,
  marginRatioAlertPercent: 80, liquidationProximityPercent: 10,
  consecutiveFailuresThreshold: 20, consecutiveFailuresWindowSecs: 60,
  cooldownAfterStopSecs: 300, postOnly: true, allowMargin: false,
  triggerType: 'MARK_PRICE' as const, referencePriceSource: 'mark_price' as const,
  reconcileIntervalSecs: 10, staleDataTimeoutMs: 30000, maxPlacementsPerSec: 5,
  dryRun: false, alertChannel: 'both' as const,
} satisfies BotConfig;

describe('computeQuantityPerLevel', () => {
  it('basic calculation', () => {
    // free=100, alloc=100%, reserve=10% → usable=90
    // notional = 90*10 = 900, per order = 900/10 = 90, qty = 90/90 = 1
    const qty = computeQuantityPerLevel(new Decimal('100'), BASE_CONFIG, new Decimal('90'), C);
    expect(qty.toString()).toBe('1');
  });

  it('respects capitalAllocationPercent', () => {
    const cfg = { ...BASE_CONFIG, capitalAllocationPercent: 50, reservePercent: 0 };
    // usable = 100*50% = 50, notional=500, per order=50, qty=50/90≈0.55
    const qty = computeQuantityPerLevel(new Decimal('100'), cfg, new Decimal('90'), C);
    expect(qty.gt(0)).toBe(true);
    expect(Number(qty.toString())).toBeLessThanOrEqual(0.55);
  });

  it('respects reservePercent', () => {
    const qty10 = computeQuantityPerLevel(new Decimal('100'), { ...BASE_CONFIG, reservePercent: 10 }, new Decimal('90'), C);
    const qty20 = computeQuantityPerLevel(new Decimal('100'), { ...BASE_CONFIG, reservePercent: 20 }, new Decimal('90'), C);
    expect(qty10.gte(qty20)).toBe(true);
  });

  it('floors to baseDecimalPlaces', () => {
    const qty = computeQuantityPerLevel(new Decimal('100'), BASE_CONFIG, new Decimal('91'), C);
    // Result should have at most 2 decimal places
    expect(qty.toFixed(2)).toBe(qty.toString());
  });

  it('throws when qty below minimum', () => {
    const smallConfig = { ...BASE_CONFIG, gridCount: 10000 };
    expect(() => computeQuantityPerLevel(new Decimal('1'), smallConfig, new Decimal('90'), C)).toThrow(/below minimum/);
  });
});
