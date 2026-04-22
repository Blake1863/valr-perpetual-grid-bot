/**
 * PURE: Reconcile desired orders vs exchange reality.
 */
import type { DesiredOrder } from './plan.js';
import type { ExchangeOrder } from '../exchange/types.js';

export interface ReconcilePlan {
  toPlace: DesiredOrder[];
  toCancel: ExchangeOrder[];
  unchanged: number;
}

export function reconcile(
  desired: DesiredOrder[],
  exchangeOpenOrders: ExchangeOrder[],
  runId: string,
): ReconcilePlan {
  const plan: ReconcilePlan = { toPlace: [], toCancel: [], unchanged: 0 };

  const desiredMap = new Map<string, DesiredOrder>();
  for (const d of desired) {
    desiredMap.set(d.customerOrderId, d);
  }

  const matchedDesired = new Set<string>();

  for (const ex of exchangeOpenOrders) {
    // No customer ID — stale orphan, cancel
    if (!ex.customerOrderId) {
      plan.toCancel.push(ex);
      continue;
    }
    // Wrong run — stale, cancel
    if (!ex.customerOrderId.includes(runId)) {
      plan.toCancel.push(ex);
      continue;
    }

    const desired = desiredMap.get(ex.customerOrderId);
    if (!desired) {
      plan.toCancel.push(ex);
      continue;
    }

    const priceMatches = ex.price === desired.priceStr;
    const sideMatches = ex.side === desired.side;

    if (!priceMatches || !sideMatches) {
      plan.toCancel.push(ex);
      // Will be re-placed below
    } else {
      matchedDesired.add(ex.customerOrderId);
      plan.unchanged++;
    }
  }

  for (const d of desired) {
    if (!matchedDesired.has(d.customerOrderId)) {
      plan.toPlace.push(d);
    }
  }

  return plan;
}
