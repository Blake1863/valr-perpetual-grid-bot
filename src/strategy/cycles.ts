/**
 * PURE: Compute realised profit when entry+exit pair completes a cycle.
 */
import { type D } from '../decimal.js';

export interface Cycle {
  cycleId: string;
  runId: string;
  entryLevel: number;
  exitLevel: number;
  entrySide: 'BUY' | 'SELL';
  entryPrice: D;
  exitPrice: D;
  quantity: D;
  realisedProfit: D;
  completedAt: number;
}

export function computeCycle(
  entrySide: 'BUY' | 'SELL',
  entryPrice: D,
  exitPrice: D,
  quantity: D,
  runId: string,
  completedAt: number = Date.now(),
): Cycle {
  const cycleId = `cycle-${runId}-${completedAt}`;
  const realisedProfit: D = entrySide === 'BUY'
    ? exitPrice.minus(entryPrice).mul(quantity)
    : entryPrice.minus(exitPrice).mul(quantity);

  return { cycleId, runId, entryLevel: -1, exitLevel: -1, entrySide, entryPrice, exitPrice, quantity, realisedProfit, completedAt };
}
