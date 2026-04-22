/**
 * Fetches pair metadata (tick size, qty precision, min/max amounts) from VALR.
 * Also provides a static fallback for known pairs.
 */
import type { PairConstraints } from './types.js';

// Static fallbacks for known pairs (avoids API call in dry-run mode)
const STATIC_CONSTRAINTS: Record<string, PairConstraints> = {
  SOLUSDTPERP: {
    pair: 'SOLUSDTPERP',
    tickSize: 0.01,
    stepSize: 0.01,
    baseDecimalPlaces: 2,
    quoteDecimalPlaces: 2,
    minBaseAmount: 0.01,
    maxBaseAmount: 1_000_000,
    minQuoteAmount: 1,
  },
  ETHUSDTPERP: {
    pair: 'ETHUSDTPERP',
    tickSize: 0.01,
    stepSize: 0.0001,
    baseDecimalPlaces: 4,
    quoteDecimalPlaces: 2,
    minBaseAmount: 0.0001,
    maxBaseAmount: 1_000_000,
    minQuoteAmount: 1,
  },
  BTCUSDTPERP: {
    pair: 'BTCUSDTPERP',
    tickSize: 0.01,
    stepSize: 0.00001,
    baseDecimalPlaces: 5,
    quoteDecimalPlaces: 2,
    minBaseAmount: 0.00001,
    maxBaseAmount: 1_000_000,
    minQuoteAmount: 1,
  },
};

export function getStaticConstraints(pair: string): PairConstraints {
  const upper = pair.toUpperCase();
  const found = STATIC_CONSTRAINTS[upper];
  if (!found) {
    throw new Error(`No static constraints known for pair ${pair}. Add to STATIC_CONSTRAINTS or fetch from API.`);
  }
  return { ...found };
}

export async function fetchPairConstraints(pair: string, apiKey: string, apiSecret: string, subaccountId: string): Promise<PairConstraints> {
  // Try to fetch from VALR /v1/public/{pair}/instrument
  const https = await import('node:https');
  const url = `https://api.valr.com/v1/public/${encodeURIComponent(pair)}/instrument`;

  return new Promise((resolve, reject) => {
    https.default.get(url, { timeout: 10_000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(Buffer.from(c)));
      res.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString();
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            const data = JSON.parse(text) as any;
            resolve({
              pair: data.pair || pair,
              tickSize: Number(data.tickSize ?? data.priceIncrement ?? 0.01),
              stepSize: Number(data.stepSize ?? data.quantityIncrement ?? 0.01),
              baseDecimalPlaces: countDecimals(data.quantityIncrement ?? data.stepSize ?? '0.01'),
              quoteDecimalPlaces: countDecimals(data.priceIncrement ?? data.tickSize ?? '0.01'),
              minBaseAmount: Number(data.minBaseAmount ?? data.minQuantity ?? 0.01),
              maxBaseAmount: Number(data.maxBaseAmount ?? data.maxQuantity ?? 1_000_000),
              minQuoteAmount: Number(data.minQuoteAmount ?? data.minNotional ?? 1),
            });
            return;
          }
        } catch { /* fall through to static */ }
        // Fallback
        try { resolve(getStaticConstraints(pair)); }
        catch (e) { reject(e); }
      });
    }).on('error', () => {
      try { resolve(getStaticConstraints(pair)); }
      catch (e) { reject(e); }
    });
  });
}

function countDecimals(value: string | number): number {
  const str = String(value);
  const dot = str.indexOf('.');
  if (dot === -1) return 0;
  return str.length - dot - 1;
}
