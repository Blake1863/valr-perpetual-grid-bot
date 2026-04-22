/**
 * VALR REST API client with HMAC-SHA512 authentication.
 *
 * ALL endpoints here are verified against the official VALR docs:
 *   https://api-docs.rooibos.dev/llms-full.txt
 *   (local mirror: skills/valr-exchange/references/valr-llms-full.txt)
 *
 * RULE: Never guess endpoints. If a call is needed, grep the docs first.
 *
 * Critical implementation notes:
 * - Signature message: timestamp + VERB + path + body + subaccountId (HMAC-SHA512 hex)
 * - Request headers: X-VALR-API-KEY, X-VALR-SIGNATURE, X-VALR-TIMESTAMP, X-VALR-SUB-ACCOUNT-ID
 * - When subaccount header present, subaccountId MUST be in signature too (or -11252)
 * - placeLimitOrder passes through postOnly, reduceOnly, timeInForce — do NOT drop them
 * - Market orders use `baseAmount` or `quoteAmount`, plus explicit `side` (BUY/SELL)
 * - Cancel-single: DELETE /v2/orders/order  body { orderId|customerOrderId, pair }
 * - Cancel-all:    DELETE /v1/orders        (no body, returns array of cancelled ids)
 * - Cancel-by-pair: DELETE /v1/orders/{currencyPair}
 * - Leverage PUT body must be string: { leverageMultiple: "10" }
 * - Margin info:   GET /v1/margin/status  (NOT /v1/account/margin/futures — that's 404)
 * - Open orders:   GET /v1/orders/open    (no query; returns all pairs — filter client-side)
 *                  Response uses `currencyPair` + `remainingQuantity` (not pair + quantity)
 */
import { createHmac } from 'node:crypto';
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

  // VALR signature: HMAC-SHA512(secret, timestamp + VERB + path + body + subaccountId)
  // https://api-docs.rooibos.dev/guides/authentication
  const messageToSign = `${timestamp}${method.toUpperCase()}${path}${bodyStr}${subaccountId}`;
  const signature = hmacSign(apiSecret, messageToSign);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-VALR-API-KEY': apiKey,
    'X-VALR-SIGNATURE': signature,
    'X-VALR-TIMESTAMP': timestamp,
  };
  // Only send the subaccount header when actually impersonating a subaccount.
  // Empty string still gets signed in (matches docs), but sending an empty header
  // is safer to omit to avoid any server-side strictness.
  if (subaccountId) headers['X-VALR-SUB-ACCOUNT-ID'] = subaccountId;

  return new Promise((resolve, reject) => {
    const req = https.request(
      url.toString(),
      { method, headers, timeout: 15_000 },
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
    // GET /v1/orders/open takes NO query parameters — returns ALL open orders
    // across every pair. Filter client-side by currencyPair.
    // Response fields: currencyPair, remainingQuantity, originalQuantity (not pair/quantity)
    const data = await request(
      'GET', '/v1/orders/open',
      this.apiKey, this.apiSecret, this.subaccountId,
    ) as any[];
    return (data || [])
      .filter((o) => o.currencyPair === pair)
      .map((o) => ({
        exchangeOrderId: o.orderId as string,
        customerOrderId: (o.customerOrderId as string) || '',
        pair: o.currencyPair as string,
        // Side in the response is lowercase ("buy"/"sell") — normalise.
        side: (String(o.side).toUpperCase() as 'BUY' | 'SELL'),
        price: o.price as string,
        quantity: (o.originalQuantity as string) || '0',
        // filledQuantity = originalQuantity - remainingQuantity (server returns filledPercentage too).
        filledQuantity: (() => {
          const orig = Number(o.originalQuantity || 0);
          const rem = Number(o.remainingQuantity || 0);
          const filled = orig - rem;
          return filled >= 0 ? filled.toString() : '0';
        })(),
        status: o.status as string,
        type: o.type as string,
        postOnly: (o.type as string || '').toLowerCase().includes('post'),
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
    // Preferred single-cancel: DELETE /v2/orders/order with JSON body.
    // Body: { orderId | customerOrderId, pair } (not both ids).
    // https://api-docs.rooibos.dev/api-docs/deleteV2OrdersOrder.md
    await request(
      'DELETE', '/v2/orders/order',
      this.apiKey, this.apiSecret, this.subaccountId,
      { orderId, pair },
    );
  }

  async cancelAllOrders(pair?: string): Promise<void> {
    // If pair given, cancel for that pair only (DELETE /v1/orders/{currencyPair}).
    // Otherwise batch cancel everything (DELETE /v1/orders).
    // https://api-docs.rooibos.dev/api-docs/deleteV1OrdersCurrencyPair.md
    // https://api-docs.rooibos.dev/api-docs/deleteV1Orders.md
    const path = pair ? `/v1/orders/${encodeURIComponent(pair)}` : '/v1/orders';
    await request('DELETE', path, this.apiKey, this.apiSecret, this.subaccountId);
  }

  async marketClose(pair: string, side: 'BUY' | 'SELL', baseAmount: string): Promise<void> {
    // To close a position, send a market order on the OPPOSITE side with reduceOnly=true.
    // Caller must pass the closing side (not the position side).
    // https://api-docs.rooibos.dev/api-docs/postV1OrdersMarket.md
    const body = {
      pair,
      side,
      baseAmount,
      reduceOnly: true,
      timeInForce: 'IOC',
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
    marginFraction: string;
    initialMarginFraction: string;
    maintenanceMarginFraction: string;
    autoCloseMarginFraction: string;
    collateralisedBalancesInReference: string;
    availableInReference: string;
    initialRequiredInReference: string;
    totalUnrealisedFuturesPnlInReference: string;
    leverageMultiple: number;
    referenceCurrency: string;
  }> {
    // Correct endpoint per VALR docs is /v1/margin/status (or /v2/margin/status).
    // https://api-docs.rooibos.dev/api-docs/getV1MarginStatus.md
    const data = await request(
      'GET', '/v1/margin/status',
      this.apiKey, this.apiSecret, this.subaccountId,
    ) as any;
    return {
      marginFraction: (data.marginFraction as string) || '0',
      initialMarginFraction: (data.initialMarginFraction as string) || '0',
      maintenanceMarginFraction: (data.maintenanceMarginFraction as string) || '0',
      autoCloseMarginFraction: (data.autoCloseMarginFraction as string) || '0',
      collateralisedBalancesInReference: (data.collateralisedBalancesInReference as string) || '0',
      availableInReference: (data.availableInReference as string) || '0',
      initialRequiredInReference: (data.initialRequiredInReference as string) || '0',
      totalUnrealisedFuturesPnlInReference: (data.totalUnrealisedFuturesPnlInReference as string) || '0',
      leverageMultiple: Number(data.leverageMultiple || 0),
      referenceCurrency: (data.referenceCurrency as string) || 'USDC',
    };
  }
}
