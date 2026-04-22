/**
 * Zod schema for bot configuration validation.
 * All numeric fields that need precision are strings; convert to Decimal at use site.
 */
import { z } from 'zod';

export const BotConfigSchema = z.object({
  // === Required user inputs ===
  pair: z.string().regex(/[A-Z]+USDT?PERP$/),
  subaccountId: z.string(),
  gridCount: z.number().int().min(2).max(200),
  lowerBound: z.string(),
  upperBound: z.string(),
  stopLossPercent: z.number().min(0).max(50).default(3.0),

  // === Grid ===
  gridMode: z.enum(['geometric', 'arithmetic']).default('geometric'),
  referencePrice: z.string().optional(),

  // === Capital ===
  leverage: z.number().min(1).max(60).default(10),
  capitalAllocationPercent: z.number().min(1).max(100).default(100),
  reservePercent: z.number().min(0).max(50).default(10),
  dynamicSizing: z.boolean().default(true),
  quantityPerLevel: z.string().optional(),

  // === Risk ===
  onRangeExit: z.enum(['halt', 'close_and_reset']).default('halt'),
  stopLossReference: z.enum(['avg_entry', 'disabled']).default('avg_entry'),
  marginRatioAlertPercent: z.number().default(80),
  liquidationProximityPercent: z.number().default(10),
  consecutiveFailuresThreshold: z.number().default(20),
  consecutiveFailuresWindowSecs: z.number().default(60),
  cooldownAfterStopSecs: z.number().default(300),

  // === Execution ===
  postOnly: z.boolean().default(true),
  allowMargin: z.boolean().default(false),
  triggerType: z.enum(['MARK_PRICE', 'LAST_PRICE']).default('MARK_PRICE'),
  referencePriceSource: z.enum(['mark_price', 'last_price']).default('mark_price'),

  // === Tuning ===
  reconcileIntervalSecs: z.number().default(10),
  staleDataTimeoutMs: z.number().default(30000),
  maxPlacementsPerSec: z.number().default(5),
  dryRun: z.boolean().default(false),

  // === Alerts ===
  alertChannel: z.enum(['telegram', 'log', 'both', 'none']).default('both'),
  telegramGatewayUrl: z.string().optional(),
  telegramChatId: z.string().optional(),
});

export type BotConfig = z.infer<typeof BotConfigSchema>;
