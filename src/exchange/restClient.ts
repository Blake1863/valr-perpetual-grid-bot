/**
 * VALR REST API client with HMAC-SHA512 authentication.
 *
 * Critical implementation notes (learned from v3 bugs):
 * - Subaccount ID goes in header X-VALR-SUB-ACCOUNT-ID AND in signature message
 * - placeLimitOrder passes through postOnly, reduceOnly, timeInForce — do NOT drop them
 * - Market close uses `baseAmount` field, not `quantity`
 * - Cancel needs body `{ "pair": "..." }`, not `{ "currencyPair": "..." }`
 * - Leverage PUT body must be string: `{ "leverageMultiple": "10" }`
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import https from 'node:https';
import {
  ExchangeOrder,
  Balance,
  Position,
  ValrApiErrorClass,
  InsufficientBalanceError,
  RateLimitError,
} from './types.js';
import type { BotConfig } from '../config/schema.js';

const VALR_BASE = 'https://api.valr.com';

function hmacSign(secret: string, message: string): string {
  return createHmac('sha512', secret).update(message).digest('hex');
}

async function request(
  method: string,
  path: string,
  apiKey: string,
  apiSecret: string,
  subaccountId: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(path, VALR_BASE);
  const timestamp = Date.now().toString();
  const bodyStr = body ? JSON.stringify(body) : '';

  // Signature message: method + path + body + subaccountId
  // Note: subaccountId is appended to the message for signing
  const messageToSign = `${method}${path}${bodyStr}${subaccountId}`;
  const signature = hmacSign(apiSecret, messageToSign);

  return new Promise((resolve, reject) => {
    const req = https.request(
      url.toString(),
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-VALR-API-KEY': apiKey,
          'X-VALR-REQUEST-SIGNATURE': signature,
          'X-VALR-REQUEST-TIMESTAMP': timestamp,
          'X-VALR-SUB-ACCOUNT-ID': subaccountId,
        },
        timeout: 15_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          const bodyText = Buffer.concat(chunks).toString();
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(bodyText ? JSON.parse(bodyText) : null);
            return;
          }

          let parsed: unknown = null;
          try { parsed = JSON.parse(bodyText); } catch { /* ignore */ }

          if (res.statusCode === 400) {
            const errMsg = (parsed as any)?.message || bodyText;
            if (errMsg.toLowerCase().includes('insufficient')) {
              reject(new InsufficientBalanceError(`Insufficient balance: ${errMsg}`));
              return;
            }
          }

          if (res.statusCode === 429) {
            const retryAfter = parseInt(res.headers['retry-after'] || '5', 10) * 1000;
            reject(new RateLimitError('Rate limited', retryAfter || 5000));
            return;
          }

          const errMsg = (parsed as any)?.message || bodyText || `HTTP ${res.statusCode}`;
          reject(new ValrApiErrorClass(res.statusCode || 500, errMsg, path, parsed));
        });
      },
    );

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

export class ValrRestClient {
  private apiKey: string;
  private apiSecret: string;
  private subaccountId: string;

  constructor(apiKey: string, apiSecret: string, subaccountId: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.subaccountId = subaccountId;
  }

  async getBalances(): Promise<Balance[]> {
    const data = await request(
      'GET', '/v1/account/balances',
      this.apiKey, this.apiSecret, this.subaccountId,
    ) as any[];
    return data.map((b) => ({
      currency: b.currency as string,
      available: b.available as string,
      reserved: b.reserved as string,
      total: b.total as string,
    }));
  }

  async getOpenOrders(pair: string): Promise<ExchangeOrder[]> {
    const data = await request(
      'GET', `/v1/orders/open?pair=${encodeURIComponent(pair)}`,
      this.apiKey, this.apiSecret, this.subaccountId,
    ) as any[];
    return data
      .filter((o) => o.pair === pair)
      .map((o) => ({
        exchangeOrderId: o.orderId as string,
        customerOrderId: (o.customerOrderId as string) || '',
        pair: o.pair as string,
        side: (o.side as 'BUY' | 'SELL'),
        price: o.price as string,
        quantity: o.quantity as string,
        filledQuantity: (o.filledQuantity as string) || '0',
        status: o.status as string,
        type: o.type as string,
        postOnly: (o.postOnly as boolean) ?? false,
        reduceOnly: (o.reduceOnly as boolean) ?? false,
        createdAt: o.createdAt as string,
      }));
  }

  async placeLimitOrder(
    pair: string,
    side: 'BUY' | 'SELL',
    price: string,
    quantity: string,
    customerOrderId: string,
    postOnly: boolean = true,
    reduceOnly: boolean = false,
    timeInForce: string = 'GTC',
  ): Promise<{ orderId: string }> {
    const body = {
      pair,
      side,
      price,
      quantity,
      customerOrderId,
      postOnly,
      reduceOnly,
      timeInForce,
    };
    return request(
      'POST', '/v2/orders/limit',
      this.apiKey, this.apiSecret, this.subaccountId,
      body,
    ) as Promise<{ orderId: string }>;
  }

  async cancelOrder(orderId: string, pair: string): Promise<void> {
    await request(
      'DELETE', `/v1/orders/${orderId}`,
      this.apiKey, this.apiSecret, this.subaccountId,
      { pair },
    );
  }

  async cancelAllOrders(pair: string): Promise<void> {
    await request(
      'POST', '/v1/orders/batch-cancel',
      this.apiKey, this.apiSecret, this.subaccountId,
      { pair },
    );
  }

  async marketClose(pair: string, baseAmount: string): Promise<void> {
    // Market-close position with reduceOnly
    const body = {
      pair,
      side: 'SELL', // will be adjusted by exchange for reduceOnly
      baseAmount,
      reduceOnly: true,
    };
    await request(
      'POST', '/v1/orders/market',
      this.apiKey, this.apiSecret, this.subaccountId,
      body,
    );
  }

  async getOpenPositions(): Promise<Position[]> {
    const data = await request(
      'GET', '/v1/positions/open',
      this.apiKey, this.apiSecret, this.subaccountId,
    ) as any[];
    return (data || []).map((p) => ({
      pair: p.pair as string,
      side: (p.side as 'BUY' | 'SELL' | 'NONE') || 'NONE',
      quantity: (p.quantity as string) || '0',
      entryPrice: (p.entryPrice as string) || '0',
      averageEntryPrice: (p.averageEntryPrice as string) || '0',
      unrealisedPnl: (p.unrealisedPnl as string) || '0',
      liquidationPrice: (p.liquidationPrice as string) || '0',
      leverage: (p.leverage as string) || '1',
      marginUsed: (p.marginUsed as string) || '0',
    }));
  }

  async getLeverage(pair: string): Promise<number> {
    const data = await request(
      'GET', `/v1/margin/leverage/${encodeURIComponent(pair)}`,
      this.apiKey, this.apiSecret, this.subaccountId,
    ) as any;
    return Number(data.leverageMultiple ?? data.leverage);
  }

  async setLeverage(pair: string, leverageMultiple: number): Promise<void> {
    await request(
      'PUT', `/v1/margin/leverage/${encodeURIComponent(pair)}`,
      this.apiKey, this.apiSecret, this.subaccountId,
      { leverageMultiple: leverageMultiple.toString() },
    );
  }

  async getMarketSummary(pair: string): Promise<{
    lastPrice: string;
    markPrice: string;
    highPrice24h: string;
    lowPrice24h: string;
  }> {
    const data = await request(
      'GET', `/v1/public/${encodeURIComponent(pair)}/marketsummary`,
      this.apiKey, this.apiSecret, this.subaccountId, // subaccountId for signing consistency
    ) as any;
    return {
      lastPrice: (data.lastPrice as string) || '0',
      markPrice: (data.markPrice as string) || data.lastPrice || '0',
      highPrice24h: (data.highPrice24h as string) || '0',
      lowPrice24h: (data.lowPrice24h as string) || '0',
    };
  }

  async getMarginInfo(): Promise<{
    totalMargin: string;
    usedMargin: string;
    freeMargin: string;
    marginRatio: string;
  }> {
    const data = await request(
      'GET', '/v1/account/margin/futures',
      this.apiKey, this.apiSecret, this.subaccountId,
    ) as any;
    return {
      totalMargin: (data.totalMargin as string) || (data.total as string) || '0',
      usedMargin: (data.usedMargin as string) || (data.used as string) || '0',
      freeMargin: (data.freeMargin as string) || (data.available as string) || '0',
      marginRatio: (data.marginRatio as string) || '0',
    };
  }
}
