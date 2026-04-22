/**
 * VALR Account WebSocket — authenticated, auto-subscribed to all account events
 *
 * Endpoint: wss://api.valr.com/ws/account
 * Auth: HMAC-SHA512 over `${timestamp}GET/ws/account` sent as HTTP headers on the
 *       upgrade request (same scheme as REST). Subaccount via X-VALR-SUB-ACCOUNT-ID.
 *
 * Once connected you are automatically subscribed — no explicit SUBSCRIBE message.
 * Events of interest (documented VALR event types):
 *   - NEW_ACCOUNT_TRADE       — a fill against your account (includes price, qty, side)
 *   - OPEN_ORDERS_UPDATE      — full snapshot of your open orders
 *   - ORDER_STATUS_UPDATE     — a single order changed status (PLACED/FILLED/CANCELLED/...)
 *   - NEW_ACCOUNT_HISTORY_RECORD — generic ledger event (fills, funding, etc.)
 *   - BALANCE_UPDATE          — spot/margin wallet delta
 *
 * Emits:
 *   'fill'          → { orderId, pair, side, price, quantity, ... }
 *   'order_update'  → raw order event (status change)
 *   'balance'       → raw balance event
 *   'raw'           → every message, for debugging
 */
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { createHmac } from 'node:crypto';
import { logger } from '../app/logger.js';

const WS_URL = 'wss://api.valr.com/ws/account';
const PATH = '/ws/account';

function signHeaders(apiKey: string, apiSecret: string, subaccountId: string) {
  // VALR signature for WebSocket /ws/account mirrors the REST scheme:
  //   sign = HMAC-SHA512( apiSecret, timestamp + "GET" + path + body + subaccountId )
  // When a subaccount header is sent, its id MUST be included in the signed
  // payload (appended after the empty body). Otherwise VALR returns close code
  // 1007 "Request has an invalid signature". Verified live 2026-04-22.
  const timestamp = Date.now().toString();
  const hmac = createHmac('sha512', apiSecret);
  hmac.update(timestamp);
  hmac.update('GET');
  hmac.update(PATH);
  hmac.update('');
  if (subaccountId) hmac.update(subaccountId);
  const signature = hmac.digest('hex');
  const headers: Record<string, string> = {
    'X-VALR-API-KEY': apiKey,
    'X-VALR-SIGNATURE': signature,
    'X-VALR-TIMESTAMP': timestamp,
  };
  if (subaccountId) headers['X-VALR-SUB-ACCOUNT-ID'] = subaccountId;
  return headers;
}

export class WsAccountClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private apiSecret: string;
  private subaccountId: string;
  private pair: string;
  private reconnectDelayMs = 1000;
  private maxReconnectDelayMs = 30000;
  private pingTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(apiKey: string, apiSecret: string, subaccountId: string, pair: string) {
    super();
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.subaccountId = subaccountId;
    this.pair = pair;
  }

  connect(): void {
    if (this.stopped) return;
    if (this.ws?.readyState === WebSocket.OPEN) return;

    const headers = signHeaders(this.apiKey, this.apiSecret, this.subaccountId);
    logger.info('ws-account connecting', { url: WS_URL, subaccount: this.subaccountId });

    const ws = new WebSocket(WS_URL, { headers });
    this.ws = ws;

    ws.on('open', () => {
      logger.info('ws-account connected (auto-subscribed to all account events)');
      this.reconnectDelayMs = 1000;
      this.startPing();
    });

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.emit('raw', msg);
        this.handleMessage(msg);
      } catch (err) {
        logger.warn('ws-account parse error', { raw: data.toString().slice(0, 200) });
      }
    });

    ws.on('error', (err) => {
      logger.error('ws-account error', { error: String(err) });
    });

    ws.on('close', (code, reason) => {
      logger.warn('ws-account closed', { code, reason: reason?.toString() });
      this.stopPing();
      this.ws = null;
      if (!this.stopped) this.scheduleReconnect();
    });
  }

  private handleMessage(msg: any): void {
    const type: string | undefined = msg.type;
    const data = msg.data ?? msg;
    if (!type) return;

    // Filter to our pair where possible (accountHistory and fills include pair)
    const pairField = data?.currencyPair || data?.currencyPairSymbol || data?.pair;
    const isOurPair = !pairField || pairField === this.pair;

    switch (type) {
      case 'AUTHENTICATED':
      case 'SUBSCRIBED':
      case 'PONG':
        // control frames — ignore
        break;

      case 'NEW_ACCOUNT_TRADE':
      case 'ACCOUNT_TRADE':
      case 'TRADE':
        if (isOurPair) this.emit('fill', data);
        break;

      case 'ORDER_STATUS_UPDATE':
      case 'ORDER_PROCESSED':
      case 'ORDER_FAILED':
      case 'CANCEL_ORDER_STATUS':
        if (isOurPair) this.emit('order_update', { type, data });
        break;

      case 'OPEN_ORDERS_UPDATE':
        this.emit('open_orders', data);
        break;

      case 'BALANCE_UPDATE':
      case 'NEW_ACCOUNT_HISTORY_RECORD':
        this.emit('balance', { type, data });
        break;

      default:
        logger.debug('ws-account unhandled event', { type });
    }
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 20_000);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    const delay = this.reconnectDelayMs;
    logger.info('ws-account scheduling reconnect', { delayMs: delay });
    setTimeout(() => {
      this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, this.maxReconnectDelayMs);
      this.connect();
    }, delay);
  }

  disconnect(): void {
    this.stopped = true;
    this.stopPing();
    this.ws?.close();
    this.ws = null;
  }
}
