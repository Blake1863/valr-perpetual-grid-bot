/**
 * JSON-file state store (no native build deps).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import Decimal, { type D } from '../decimal.js';
import { logger } from '../app/logger.js';
import type { DesiredOrder } from '../strategy/plan.js';
import type { Cycle } from '../strategy/cycles.js';

interface OrderRecord {
  customer_order_id: string; run_id: string; level_index: number; side: string;
  price: string; quantity: string; exchange_order_id: string | null;
  state: 'desired' | 'pending' | 'active' | 'filled' | 'cancelled' | 'rejected';
  role: string; created_at: string; updated_at: string;
  filled_at: string | null; fill_price: string | null;
}
interface StoreData {
  orders: OrderRecord[];
  cycles: Array<{
    cycle_id: string; run_id: string; entry_level: number; exit_level: number;
    entry_side: string; entry_price: string; exit_price: string;
    quantity: string; realised_profit: string; completed_at: string;
  }>;
  metrics: Record<string, string>;
}

export class StateStore {
  private dataPath: string;
  private data: StoreData;

  constructor(pair: string) {
    const logsDir = resolve('./logs');
    if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
    this.dataPath = resolve(`./logs/${pair.toLowerCase()}-state.json`);
    try {
      this.data = existsSync(this.dataPath)
        ? (JSON.parse(readFileSync(this.dataPath, 'utf-8')) as StoreData)
        : { orders: [], cycles: [], metrics: {} };
    } catch { this.data = { orders: [], cycles: [], metrics: {} }; }
  }

  insertOrder(order: DesiredOrder, runId: string): void {
    const now = new Date().toISOString();
    const idx = this.data.orders.findIndex(o => o.customer_order_id === order.customerOrderId);
    const rec: OrderRecord = {
      customer_order_id: order.customerOrderId, run_id: runId,
      level_index: order.levelIndex, side: order.side,
      price: order.price.toString(), quantity: order.quantity.toString(),
      exchange_order_id: null, state: 'desired', role: 'entry',
      created_at: now, updated_at: now, filled_at: null, fill_price: null,
    };
    if (idx >= 0) this.data.orders[idx] = rec; else this.data.orders.push(rec);
    this._save();
  }

  updateOrderAsPending(id: string): void { this._upd(id, o => { o.state = 'pending'; }); }
  updateOrderAsActive(exId: string, id: string): void { this._upd(id, o => { o.state = 'active'; o.exchange_order_id = exId; }); }
  updateOrderAsFilled(id: string, fillPrice: string): void {
    this._upd(id, o => { o.state = 'filled'; o.filled_at = new Date().toISOString(); o.fill_price = fillPrice; });
  }
  updateOrderAsCancelled(id: string): void { this._upd(id, o => { o.state = 'cancelled'; }); }

  getActiveOrders(): { customerOrderId: string; levelIndex: number; side: string }[] {
    return this.data.orders.filter(o => o.state === 'active')
      .map(o => ({ customerOrderId: o.customer_order_id, levelIndex: o.level_index, side: o.side }));
  }

  insertCycle(cycle: Cycle): void {
    this.data.cycles.push({
      cycle_id: cycle.cycleId, run_id: cycle.runId,
      entry_level: cycle.entryLevel, exit_level: cycle.exitLevel,
      entry_side: cycle.entrySide,
      entry_price: cycle.entryPrice.toString(), exit_price: cycle.exitPrice.toString(),
      quantity: cycle.quantity.toString(), realised_profit: cycle.realisedProfit.toString(),
      completed_at: new Date(cycle.completedAt).toISOString(),
    });
    this._save();
  }

  getTotalRealisedPnl(): D {
    return this.data.cycles.reduce((a, c) => a.plus(new Decimal(c.realised_profit || '0')), new Decimal(0));
  }

  getTotalCycles(): number { return this.data.cycles.length; }

  setMetric(key: string, value: string): void { this.data.metrics[key] = value; this._save(); }
  getMetric(key: string): string | null { return this.data.metrics[key] ?? null; }
  incrementMetric(key: string, delta = 1): void {
    this.setMetric(key, (parseInt(this.getMetric(key) ?? '0', 10) + delta).toString());
  }

  pruneOldRecords(): void {
    const now = Date.now();
    const sevenDays = 7 * 86400_000;
    const thirtyDays = 30 * 86400_000;
    this.data.orders = this.data.orders.filter(o => {
      if (o.state === 'active') return true;
      const age = now - new Date(o.created_at).getTime();
      return o.state === 'filled' ? age < thirtyDays : age < sevenDays;
    });
    this._save();
  }

  close(): void { this._save(); }

  private _upd(id: string, fn: (o: OrderRecord) => void): void {
    const o = this.data.orders.find(x => x.customer_order_id === id);
    if (o) { fn(o); o.updated_at = new Date().toISOString(); this._save(); }
  }

  private _save(): void {
    try { writeFileSync(this.dataPath, JSON.stringify(this.data, null, 2)); }
    catch (e) { logger.error('State save failed', { error: String(e) }); }
  }
}
