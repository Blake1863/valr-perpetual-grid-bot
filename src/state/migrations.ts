/**
 * SQLite schema migrations for bot state.
 */
export const SCHEMA_VERSION = 1;

export const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS orders (
  customer_order_id TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL,
  level_index       INTEGER NOT NULL,
  side              TEXT NOT NULL CHECK(side IN ('BUY','SELL')),
  price             TEXT NOT NULL,
  quantity          TEXT NOT NULL,
  exchange_order_id TEXT,
  state             TEXT NOT NULL CHECK(state IN ('desired','pending','active','filled','cancelled','rejected')),
  role              TEXT NOT NULL DEFAULT 'entry',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  filled_at         TEXT,
  fill_price        TEXT
);

CREATE TABLE IF NOT EXISTS cycles (
  cycle_id          TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL,
  entry_level       INTEGER NOT NULL,
  exit_level        INTEGER NOT NULL,
  entry_side        TEXT NOT NULL,
  entry_price       TEXT NOT NULL,
  exit_price        TEXT NOT NULL,
  quantity          TEXT NOT NULL,
  realised_profit   TEXT NOT NULL,
  completed_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS metrics (
  key               TEXT PRIMARY KEY,
  value             TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_state ON orders(state, updated_at);
CREATE INDEX IF NOT EXISTS idx_cycles_run ON cycles(run_id, completed_at);
`;

export const PRUNE_ORDERS_SQL = `
DELETE FROM orders 
WHERE state IN ('cancelled','rejected') 
  AND datetime(created_at) < datetime('now', '-7 days');

DELETE FROM orders 
WHERE state = 'filled' 
  AND datetime(created_at) < datetime('now', '-30 days');
`;
