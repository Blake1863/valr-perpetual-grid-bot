import { describe, expect, it } from '@jest/globals';
import { Decimal } from '../src/decimal.js';
import { computeCycle } from '../src/strategy/cycles.js';

describe('computeCycle', () => {
  it('long profit: exit > entry', () => {
    const c = computeCycle('BUY', new Decimal('80'), new Decimal('90'), new Decimal('2'), 'run1', 1000);
    expect(c.realisedProfit.toString()).toBe('20'); // (90-80)*2
  });

  it('long loss: exit < entry', () => {
    const c = computeCycle('BUY', new Decimal('90'), new Decimal('80'), new Decimal('1'), 'run1', 1000);
    expect(c.realisedProfit.toString()).toBe('-10');
  });

  it('short profit: exit < entry', () => {
    const c = computeCycle('SELL', new Decimal('90'), new Decimal('80'), new Decimal('2'), 'run1', 1000);
    expect(c.realisedProfit.toString()).toBe('20'); // (90-80)*2
  });

  it('short loss: exit > entry', () => {
    const c = computeCycle('SELL', new Decimal('80'), new Decimal('90'), new Decimal('1'), 'run1', 1000);
    expect(c.realisedProfit.toString()).toBe('-10');
  });

  it('cycleId contains runId', () => {
    const c = computeCycle('BUY', new Decimal('80'), new Decimal('90'), new Decimal('1'), 'myRun42', 1000);
    expect(c.cycleId).toContain('myRun42');
  });

  it('completedAt defaults to now', () => {
    const before = Date.now();
    const c = computeCycle('BUY', new Decimal('80'), new Decimal('90'), new Decimal('1'), 'run');
    const after = Date.now();
    expect(c.completedAt).toBeGreaterThanOrEqual(before);
    expect(c.completedAt).toBeLessThanOrEqual(after);
  });
});
