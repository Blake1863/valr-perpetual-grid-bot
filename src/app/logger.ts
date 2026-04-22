/**
 * Pino logger with deduplication for repeated errors.
 */
import pino from 'pino';
import { randomUUID } from 'node:crypto';

const instanceId = randomUUID().slice(0, 8);

// Simple in-memory dedup: suppress identical log messages within a window
const recentMessages = new Map<string, number>();
const DEDUP_WINDOW_MS = 30_000;

function shouldLog(key: string): boolean {
  const now = Date.now();
  const last = recentMessages.get(key);
  if (last && now - last < DEDUP_WINDOW_MS) {
    return false;
  }
  recentMessages.set(key, now);
  // Prune old entries periodically
  if (recentMessages.size > 1000) {
    const cutoff = now - DEDUP_WINDOW_MS;
    for (const [k, t] of recentMessages) {
      if (t < cutoff) recentMessages.delete(k);
    }
  }
  return true;
}

const baseLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    bindings: () => ({ instanceId }),
  },
  transport: undefined, // JSON to stdout; can be piped to pino-pretty
});

function dedupKey(level: string, msg: string): string {
  return `${level}:${msg}`;
}

export const logger = {
  debug: (msg: string, obj?: Record<string, unknown>) => {
    if (shouldLog(dedupKey('debug', msg))) baseLogger.debug(obj || {}, msg);
  },
  info: (msg: string, obj?: Record<string, unknown>) => {
    baseLogger.info(obj || {}, msg);
  },
  warn: (msg: string, obj?: Record<string, unknown>) => {
    if (shouldLog(dedupKey('warn', msg))) baseLogger.warn(obj || {}, msg);
  },
  error: (msg: string, obj?: Record<string, unknown>) => {
    if (shouldLog(dedupKey('error', msg))) baseLogger.error(obj || {}, msg);
  },
  child: (bindings: Record<string, unknown>) => baseLogger.child(bindings),
};

export { baseLogger };
