/**
 * VALR WebSocket Price Client — public trade feed
 *
 * Subscribes to MARK_PRICE_UPDATE, AGGREGATED_ORDERBOOK_UPDATE, MARKET_SUMMARY_UPDATE.
 * Endpoint: wss://api.valr.com/ws/trade  (public, no auth required)
 *
 * Protocol (verified against VALR WebSocket docs):
 *   → { "type": "SUBSCRIBE", "subscriptions": [
 *        { "event": "MARK_PRICE_UPDATE", "pairs": ["SOLUSDTPERP"] },
 *        ...
 *      ] }
 *   ← { "type": "MARK_PRICE_UPDATE", "data": { currencyPairSymbol, markPrice } }
 */
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { logger } from '../app/logger.js';

const WS_URL = 'wss://api.valr.com/ws/trade';

export interface PriceUpdate {
  pair: string;
  markPrice: string;
  lastPrice: string;
  timestamp: number;
}

export class WsPriceClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private pair: string;
  private currentMarkPrice: string | null = null;
  private lastUpdateTime = 0;
  private staleTimeoutMs: number;
  private reconnectDelayMs = 1000;
  private maxReconnectDelayMs = 30000;
  private pingTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(pair: string, staleTimeoutMs = 30_000) {
    super();
    this.pair = pair;
    this.staleTimeoutMs = staleTimeoutMs;
  }

  connect(): void {
    if (this.stopped) return;
    if (this.ws?.readyState === WebSocket.OPEN) return;

    logger.info('ws-price connecting', { url: WS_URL, pair: this.pair });
    const ws = new WebSocket(WS_URL);
    this.ws = ws;

    ws.on('open', () => {
      logger.info('ws-price connected', { pair: this.pair });
      this.reconnectDelayMs = 1000;
      const subMsg = {
        type: 'SUBSCRIBE',
        subscriptions: [
          { event: 'MARK_PRICE_UPDATE', pairs: [this.pair] },
          { event: 'MARKET_SUMMARY_UPDATE', pairs: [this.pair] },
        ],
      };
      ws.send(JSON.stringify(subMsg));
      this.startPing();
    });

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleMessage(msg);
      } catch (err) {
        logger.warn('ws-price parse error', { raw: data.toString().slice(0, 200) });
      }
    });

    ws.on('error', (err) => {
      logger.error('ws-price error', { error: String(err) });
    });

    ws.on('close', (code) => {
      logger.warn('ws-price closed', { code, pair: this.pair });
      this.stopPing();
      this.ws = null;
      if (!this.stopped) this.scheduleReconnect();
    });
  }

  private handleMessage(msg: any): void {
    const type = msg.type;
    const data = msg.data || msg;
    const pair = data?.currencyPairSymbol || data?.currencyPair || data?.pair;
    if (!pair || pair !== this.pair) return;

    let markPrice: string | null = null;
    let lastPrice: string | null = null;

    if (type === 'MARK_PRICE_UPDATE') {
      markPrice = String(data.markPrice || '');
      lastPrice = markPrice;
    } else if (type === 'MARKET_SUMMARY_UPDATE') {
      lastPrice = String(data.lastTradedPrice || '');
      markPrice = String(data.markPrice || data.lastTradedPrice || '');
    }

    if (markPrice && markPrice !== '' && markPrice !== '0') {
      this.currentMarkPrice = markPrice;
      this.lastUpdateTime = Date.now();
      this.emit('update', {
        pair,
        markPrice,
        lastPrice: lastPrice || markPrice,
        timestamp: this.lastUpdateTime,
      } as PriceUpdate);
    }
  }

  getCurrentMarkPrice(): string | null {
    return this.currentMarkPrice;
  }

  isStale(): boolean {
    if (!this.currentMarkPrice) return true;
    return Date.now() - this.lastUpdateTime > this.staleTimeoutMs;
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.ping();
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
    logger.info('ws-price scheduling reconnect', { delayMs: delay });
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
