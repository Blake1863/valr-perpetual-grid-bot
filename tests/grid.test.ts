import { describe, expect, it } from '@jest/globals';
import { Decimal } from '../src/decimal.js';
import { buildLevels } from '../src/strategy/grid.js';
import type { PairConstraints } from '../src/exchange/types.js';

const SOL_CONSTRAINTS: PairConstraints = {
  pair: 'SOLUSDTPERP',
  tickSize: 0.01, stepSize: 0.01,
  baseDecimalPlaces: 2, quoteDecimalPlaces: 2,
  minBaseAmount: 0.01, maxBaseAmount: 1_000_000, minQuoteAmount: 1,
};

describe('buildLevels – geometric', () => {
  it('produces N+2 levels', () => {
    const levels = buildLevels(new Decimal('80'), new Decimal('100'), 3, 'geometric', SOL_CONSTRAINTS);
    expect(levels).toHaveLength(5);
  });

  it('boundaries are exactly L and U', () => {
    const levels = buildLevels(new Decimal('80'), new Decimal('100'), 5, 'geometric', SOL_CONSTRAINTS);
    expect(levels[0].priceStr).toBe('80.00');
    expect(levels[levels.length - 1].priceStr).toBe('100.00');
  });

  it('levels are strictly ascending', () => {
    const levels = buildLevels(new Decimal('82'), new Decimal('92'), 30, 'geometric', SOL_CONSTRAINTS);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i].price.gte(levels[i - 1].price)).toBe(true);
    }
  });

  it('indices match position in array', () => {
    const levels = buildLevels(new Decimal('80'), new Decimal('100'), 5, 'geometric', SOL_CONSTRAINTS);
    levels.forEach((l, i) => expect(l.index).toBe(i));
  });
});

describe('buildLevels – arithmetic', () => {
  it('produces N+2 levels', () => {
    const levels = buildLevels(new Decimal('80'), new Decimal('100'), 3, 'arithmetic', SOL_CONSTRAINTS);
    expect(levels).toHaveLength(5);
  });

  it('inner levels have equal spacing', () => {
    // (100-80)/(3+1) = 5 step
    const levels = buildLevels(new Decimal('80'), new Decimal('100'), 3, 'arithmetic', SOL_CONSTRAINTS);
    expect(levels[1].priceStr).toBe('85.00');
    expect(levels[2].priceStr).toBe('90.00');
    expect(levels[3].priceStr).toBe('95.00');
  });

  it('boundaries are exactly L and U', () => {
    const levels = buildLevels(new Decimal('80'), new Decimal('100'), 3, 'arithmetic', SOL_CONSTRAINTS);
    expect(levels[0].priceStr).toBe('80.00');
    expect(levels[4].priceStr).toBe('100.00');
  });
});

describe('buildLevels – validation', () => {
  it('throws when lower >= upper', () => {
    expect(() => buildLevels(new Decimal('100'), new Decimal('80'), 3, 'arithmetic', SOL_CONSTRAINTS)).toThrow();
  });

  it('throws when gridCount < 2', () => {
    expect(() => buildLevels(new Decimal('80'), new Decimal('100'), 1, 'arithmetic', SOL_CONSTRAINTS)).toThrow();
  });
});
