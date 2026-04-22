/**
 * Shared TypeScript types for VALR exchange interaction.
 */

export interface ExchangeOrder {
  exchangeOrderId: string;
  customerOrderId: string;
  pair: string;
  side: 'BUY' | 'SELL';
  price: string;
  quantity: string;
  filledQuantity: string;
  status: string;
  type: string;
  postOnly: boolean;
  reduceOnly: boolean;
  createdAt: string;
}

export interface PairConstraints {
  pair: string;
  tickSize: number;          // minimum price increment
  stepSize: number;          // minimum quantity increment
  baseDecimalPlaces: number; // precision for quantity
  quoteDecimalPlaces: number;// precision for price
  minBaseAmount: number;     // minimum order quantity
  maxBaseAmount: number;     // maximum order quantity
  minQuoteAmount: number;    // minimum notional value
}

export interface Balance {
  currency: string;
  available: string;
  reserved: string;
  total: string;
}

export interface Position {
  pair: string;
  side: 'BUY' | 'SELL' | 'NONE';
  quantity: string;
  entryPrice: string;
  averageEntryPrice: string;
  unrealisedPnl: string;
  liquidationPrice: string;
  leverage: string;
  marginUsed: string;
}

export interface MarginInfo {
  totalMargin: string;
  usedMargin: string;
  freeMargin: string;
  marginRatio: string;  // percentage, e.g. "25.5"
}

export interface ValrApiError extends Error {
  statusCode: number;
  path: string;
  body?: unknown;
}

export class InsufficientBalanceError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientBalanceError';
  }
}

export class RateLimitError extends Error {
  statusCode = 429;
  retryAfter: number;
  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfterMs;
  }
}

export class ValrApiErrorClass extends Error {
  statusCode: number;
  path: string;
  body: unknown;

  constructor(statusCode: number, message: string, path: string, body?: unknown) {
    super(message);
    this.name = 'ValrApiError';
    this.statusCode = statusCode;
    this.path = path;
    this.body = body;
  }
}
