/**
 * Decimal.js wrapper providing a TypeScript-friendly interface.
 *
 * decimal.js v10 ships ESM (decimal.mjs) but its TypeScript type declarations
 * have an incompatibility with NodeNext module resolution where `Decimal` as a
 * value (constructor) and as a type (instance) get confused.
 *
 * We solve this by:
 * 1. Using createRequire to load the CJS build (no ESM resolution issues)
 * 2. Providing a hand-rolled `D` interface for type annotations
 */
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DecimalImpl: new (val: string | number | D) => D = (_require('decimal.js') as any);

export default DecimalImpl;
export const Decimal = DecimalImpl;

/** Instance type — use for all type annotations. */
export interface D {
  readonly d: number[];
  readonly e: number;
  readonly s: number;
  abs(): D;
  ceil(): D;
  floor(): D;
  round(): D;
  trunc(): D;
  plus(n: string | number | D): D;
  minus(n: string | number | D): D;
  mul(n: string | number | D): D;
  times(n: string | number | D): D;
  div(n: string | number | D): D;
  dividedBy(n: string | number | D): D;
  mod(n: string | number | D): D;
  pow(n: string | number | D): D;
  sqrt(): D;
  gt(n: string | number | D): boolean;
  gte(n: string | number | D): boolean;
  lt(n: string | number | D): boolean;
  lte(n: string | number | D): boolean;
  eq(n: string | number | D): boolean;
  isZero(): boolean;
  isNaN(): boolean;
  isFinite(): boolean;
  isInteger(): boolean;
  isPositive(): boolean;
  isNegative(): boolean;
  toFixed(dp?: number): string;
  toString(): string;
  toNumber(): number;
  valueOf(): string;
}
