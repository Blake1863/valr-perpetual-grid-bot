/**
 * PURE: Reconcile desired orders vs exchange reality.
 *
 * Match strategy: semantic identity = (level, side, price).
 * This tolerates customerOrderId suffix drift (e.g. the bot retried with
 * a `-1` suffix but the original order is actually still on the book).
 *
 * customerOrderId format: `gridv4-{S|B}{levelIndex}-{runId}[-{nonce}]`.
 */
import type { DesiredOrder } from './plan.js';
import type { ExchangeOrder } from '../exchange/types.js';

/**
 * Numerically compare two price strings — VALR strips trailing zeros ("84.6"
 * vs our "84.60"), so string equality is unreliable.
 */
function priceEquals(a: string, b: string): boolean {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return a === b;
  // 1e-9 is well below any realistic tick size.
  return Math.abs(na - nb) < 1e-9;
}

export interface ReconcilePlan {
  toPlace: DesiredOrder[];
  toCancel: ExchangeOrder[];
  unchanged: number;
}

/**
 * Parse `gridv4-{S|B}{level}-{runId}[-{nonce}]` into (side, level, runId).
 * Returns null if the id isn't one of ours.
 */
function parseGridOrderId(
  cid: string,
): { side: 'BUY' | 'SELL'; levelIndex: number; runId: string } | null {
  // Match: gridv4-<S|B><digits>-<runId>-<nonce>
  // runId: numeric Date.now() in production; tests use arbitrary strings.
  // nonce: base36 suffix appended per placement attempt.
  // Ids without a nonce are also accepted (legacy format).
  let m: RegExpExecArray | null;
  m = /^gridv4-([SB])(\d+)-(.+)-([0-9a-z]+)$/.exec(cid);
  if (!m) {
    // Fall back to the no-nonce format (legacy or foreign-but-prefixed ids).
    m = /^gridv4-([SB])(\d+)-(.+)$/.exec(cid);
  }
  if (!m) return null;
  return {
    side: m[1] === 'S' ? 'SELL' : 'BUY',
    levelIndex: parseInt(m[2], 10),
    runId: m[3],
  };
}

export function reconcile(
  desired: DesiredOrder[],
  exchangeOpenOrders: ExchangeOrder[],
  runId: string,
): ReconcilePlan {
  const plan: ReconcilePlan = { toPlace: [], toCancel: [], unchanged: 0 };

  // Index desired by (side, level) — the semantic key.
  const desiredByLevelSide = new Map<string, DesiredOrder>();
  for (const d of desired) {
    desiredByLevelSide.set(`${d.side}:${d.levelIndex}`, d);
  }

  const matchedKeys = new Set<string>();

  for (const ex of exchangeOpenOrders) {
    // No customer id — foreign order, cancel
    if (!ex.customerOrderId) {
      plan.toCancel.push(ex);
      continue;
    }
    const parsed = parseGridOrderId(ex.customerOrderId);
    // Not ours (different bot / different cid scheme) — leave it alone.
    // (Conservative choice: don't blindly cancel foreign orders on the same
    // pair. If you want to cancel, swap this `continue` for `plan.toCancel`.)
    if (!parsed) continue;
    // Old run — stale from a previous boot. Cancel.
    if (parsed.runId !== runId) {
      plan.toCancel.push(ex);
      continue;
    }

    const key = `${parsed.side}:${parsed.levelIndex}`;
    if (matchedKeys.has(key)) {
      // Duplicate for the same (level, side) — cancel the extra.
      plan.toCancel.push(ex);
      continue;
    }
    const d = desiredByLevelSide.get(key);
    if (!d) {
      // Price moved and this level no longer has a desired order. Cancel.
      plan.toCancel.push(ex);
      continue;
    }

    const priceMatches = priceEquals(ex.price, d.priceStr);
    const sideMatches = ex.side === d.side;
    if (!priceMatches || !sideMatches) {
      plan.toCancel.push(ex);
      // No matchedKeys.add — will be re-placed below
    } else {
      matchedKeys.add(key);
      plan.unchanged++;
    }
  }

  for (const d of desired) {
    const key = `${d.side}:${d.levelIndex}`;
    if (!matchedKeys.has(key)) {
      plan.toPlace.push(d);
    }
  }

  return plan;
}
