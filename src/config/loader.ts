/**
 * Configuration loader: reads JSON, validates with Zod, substitutes env vars.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BotConfigSchema } from './schema.js';
import type { BotConfig } from './schema.js';

export function substituteEnvVars(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{(\w+)\}/g, (_m, varName) => process.env[varName] ?? `\${${varName}}`);
  }
  if (Array.isArray(obj)) return obj.map(substituteEnvVars);
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      result[k] = substituteEnvVars(v);
    }
    return result;
  }
  return obj;
}

export function loadConfig(configPath: string): BotConfig {
  const absolutePath = resolve(configPath);
  const raw = readFileSync(absolutePath, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  const substituted = substituteEnvVars(parsed);
  return BotConfigSchema.parse(substituted);
}

export type { BotConfig };
