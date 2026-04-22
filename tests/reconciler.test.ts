import { describe, expect, it } from '@jest/globals';
import { Decimal } from '../src/decimal.js';
import { buildLevels } from '../src/strategy/grid.js';
import { planDesiredOrders } from '../src/strategy/plan.js';
import { reconcile } from '../src/strategy/reconciler.js';
import type { PairConstraints } from '../src/exchange/types.js';
import type { ExchangeOrder } from '../src/exchange/types.js';

const C: PairConstraints = {
  pair: 'SOLUSDTPERP',
  tickSize: 0.01, stepSize: 0.01,
  baseDecimalPlaces: 2, quoteDecimalPlaces: 2,
  minBaseAmount: 0.01, maxBaseAmount: 1_000_000, minQuoteAmount: 1,
};
const RUN = 'testrun';

function makeExOrder(desired: ReturnType<typeof planDesiredOrders>[0], override?: Partial<ExchangeOrder>): ExchangeOrder {
  return {
    exchangeOrderId: `ex-${desired.customerOrderId}`,
    customerOrderId: desired.customerOrderId,
    pair: 'SOLUSDTPERP',
    side: desired.side,
    price: desired.priceStr,
    quantity: desired.quantityStr,
    filledQuantity: '0',
    status: 'ACTIVE',
    type: 'LIMIT',
    postOnly: true,
    reduceOnly: false,
    createdAt: new Date().toISOString(),
    ...override,
  };
}

describe('reconcile', () => {
  const levels = buildLevels(new Decimal('80'), new Decimal('100'), 2, 'arithmetic', C);
  // L0=80, L1=86.67, L2=93.33, L3=100 (approx — arithmetic with step=(100-80)/3)

  it('perfect match → nothing to do', () => {
    const desired = planDesiredOrders(levels, new Decimal('90'), new Decimal('1'), RUN, C);
    const exchange = desired.map(d => makeExOrder(d));
    const plan = reconcile(desired, exchange, RUN);
    expect(plan.toPlace).toHaveLength(0);
    expect(plan.toCancel).toHaveLength(0);
    expect(plan.unchanged).toBe(desired.length);
  });

  it('missing orders → plans placement', () => {
    const desired = planDesiredOrders(levels, new Decimal('90'), new Decimal('1'), RUN, C);
    const exchange: ExchangeOrder[] = [];
    const plan = reconcile(desired, exchange, RUN);
    expect(plan.toPlace).toHaveLength(desired.length);
    expect(plan.toCancel).toHaveLength(0);
  });

  it('extra exchange order → plans cancellation', () => {
    const desired = planDesiredOrders(levels, new Decimal('90'), new Decimal('1'), RUN, C);
    const extra: ExchangeOrder = {
      exchangeOrderId: 'extra', customerOrderId: `gridv4-B0-${RUN}`,
      pair: 'SOLUSDTPERP', side: 'BUY', price: '75.00', quantity: '1.00',
      filledQuantity: '0', status: 'ACTIVE', type: 'LIMIT',
      postOnly: true, reduceOnly: false, createdAt: new Date().toISOString(),
    };
    const exchange = [...desired.map(d => makeExOrder(d)), extra];
    const plan = reconcile(desired, exchange, RUN);
    expect(plan.toCancel).toHaveLength(1);
    expect(plan.toCancel[0].customerOrderId).toBe(`gridv4-B0-${RUN}`);
  });

  it('stale orders from old run → cancel all, place all fresh', () => {
    const desired = planDesiredOrders(levels, new Decimal('90'), new Decimal('1'), RUN, C);
    // Exchange has same-shaped orders but with old runId
    const oldRun = planDesiredOrders(levels, new Decimal('90'), new Decimal('1'), 'oldrun', C);
    const exchange = oldRun.map(d => makeExOrder(d));
    const plan = reconcile(desired, exchange, RUN);
    expect(plan.toCancel).toHaveLength(oldRun.length);
    expect(plan.toPlace).toHaveLength(desired.length);
  });

  it('price mismatch → cancel stale, place fresh', () => {
    const desired = planDesiredOrders(levels, new Decimal('90'), new Decimal('1'), RUN, C);
    const exchange = desired.map(d => makeExOrder(d, { price: '999.99' } as Partial<ExchangeOrder>));
    const plan = reconcile(desired, exchange, RUN);
    expect(plan.toCancel).toHaveLength(desired.length);
    expect(plan.toPlace).toHaveLength(desired.length);
    expect(plan.unchanged).toBe(0);
  });
});
