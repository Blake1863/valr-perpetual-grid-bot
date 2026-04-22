/**
 * Print current bot state snapshot from state file.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Decimal from '../decimal.js';

const configPath = process.argv[2];
if (!configPath) {
  console.error('Usage: node dist/scripts/status.js <config.json>');
  process.exit(1);
}

const config = JSON.parse(readFileSync(configPath, 'utf-8')) as { pair: string };
const pair = config.pair.toLowerCase();
const dataPath = resolve(`./logs/${pair}-state.json`);

if (!existsSync(dataPath)) {
  console.log('No state file found. Bot has not run yet.');
  process.exit(0);
}

const data = JSON.parse(readFileSync(dataPath, 'utf-8')) as {
  orders: Array<{ state: string; side: string; price: string; quantity: string; created_at: string }>;
  cycles: Array<{ realised_profit: string }>;
  metrics: Record<string, string>;
};

const active = data.orders.filter(o => o.state === 'active');
const totalPnl = data.cycles.reduce((a, c) => a.plus(new Decimal(c.realised_profit || '0')), new Decimal(0));

console.log(`\n=== STATUS FOR ${config.pair} ===`);
console.log(`Bot started     : ${data.metrics['bot_started_at'] ?? 'unknown'}`);
console.log(`Last reconcile  : ${data.metrics['last_reconcile_ts'] ?? 'never'}`);
console.log(`Supervisor state: ${data.metrics['last_supervisor_state'] ?? 'unknown'}`);
console.log(`Active orders   : ${active.length}`);
console.log(`Total cycles    : ${data.cycles.length}`);
console.log(`Total PnL       : ${totalPnl.toFixed(4)} USDT`);
