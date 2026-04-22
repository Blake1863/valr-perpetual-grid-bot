import { describe, expect, it } from '@jest/globals';
import { Decimal } from '../src/decimal.js';
import { buildLevels } from '../src/strategy/grid.js';
import { planDesiredOrders } from '../src/strategy/plan.js';
import type { PairConstraints } from '../src/exchange/types.js';

const C: PairConstraints = {
  pair: 'SOLUSDTPERP',
  tickSize: 0.01, stepSize: 0.01,
  baseDecimalPlaces: 2, quoteDecimalPlaces: 2,
  minBaseAmount: 0.01, maxBaseAmount: 1_000_000, minQuoteAmount: 1,
};

describe('planDesiredOrders – dynamic inventory bias', () => {
  const levels = buildLevels(new Decimal('80'), new Decimal('100'), 3, 'arithmetic', C);
  // levels: L0=80, L1=85, L2=90, L3=95, L4=100

  it('price below midpoint: more BUYs than SELLs', () => {
    const desired = planDesiredOrders(levels, new Decimal('87'), new Decimal('1'), 'run1', C);
    const buys = desired.filter(o => o.side === 'BUY');
    const sells = desired.filter(o => o.side === 'SELL');
    expect(buys.length).toBe(1);   // L1=85
    expect(sells.length).toBe(2);  // L2=90, L3=95
  });

  it('price above midpoint: more SELLs than BUYs', () => {
    const desired = planDesiredOrders(levels, new Decimal('93'), new Decimal('1'), 'run1', C);
    const buys = desired.filter(o => o.side === 'BUY');
    const sells = desired.filter(o => o.side === 'SELL');
    expect(buys.length).toBe(2);   // L1=85, L2=90
    expect(sells.length).toBe(1);  // L3=95
  });

  it('skips level at exact current price', () => {
    const desired = planDesiredOrders(levels, new Decimal('90'), new Decimal('1'), 'run1', C);
    // L2=90 exactly → skipped. Only L1(BUY) and L3(SELL)
    expect(desired).toHaveLength(2);
    expect(desired.find(o => o.priceStr === '90.00')).toBeUndefined();
  });

  it('total orders = N-1 when price is at a level, N otherwise', () => {
    const desired = planDesiredOrders(levels, new Decimal('87'), new Decimal('1'), 'run1', C);
    expect(desired).toHaveLength(3); // all 3 inner levels active
  });

  it('customerOrderId is unique across plan() calls', () => {
    // Every plan() call must produce FRESH customerOrderIds — VALR rejects
    // reuse even after failure. The reconciler matches by (level, side, price)
    // so stable ids aren't needed.
    const d1 = planDesiredOrders(levels, new Decimal('87'), new Decimal('1'), 'run1', C);
    const d2 = planDesiredOrders(levels, new Decimal('87'), new Decimal('1'), 'run1', C);
    const ids1 = new Set(d1.map(o => o.customerOrderId));
    const ids2 = new Set(d2.map(o => o.customerOrderId));
    const overlap = [...ids1].filter(id => ids2.has(id));
    expect(overlap).toEqual([]);
  });

  it('customerOrderId is unique within a single plan() call', () => {
    const desired = planDesiredOrders(levels, new Decimal('87'), new Decimal('1'), 'run1', C);
    const ids = desired.map(o => o.customerOrderId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('customerOrderId changes with different runId', () => {
    const d1 = planDesiredOrders(levels, new Decimal('87'), new Decimal('1'), 'run1', C);
    const d2 = planDesiredOrders(levels, new Decimal('87'), new Decimal('1'), 'run2', C);
    expect(d1[0].customerOrderId).not.toBe(d2[0].customerOrderId);
  });

  it('quantities are rounded to baseDecimalPlaces', () => {
    const desired = planDesiredOrders(levels, new Decimal('87'), new Decimal('1.23456'), 'run1', C);
    for (const o of desired) {
      expect(o.quantityStr).toMatch(/^\d+\.\d{2}$/);
    }
  });
});
