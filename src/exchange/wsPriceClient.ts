/**
 * WebSocket client for mark price / ticker updates from VALR.
 * Emits 'update' events with latest mark price.
 */
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { logger } from '../app/logger.js';

export class WsPriceClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private pair: string;
  private currentMarkPrice: string | null = null;
  private lastUpdateTime: number = 0;
  private staleTimeoutMs: number;

  constructor(pair: string, staleTimeoutMs: number = 30_000) {
    super();
    this.pair = pair;
    this.staleTimeoutMs = staleTimeoutMs;
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    // VALR public WebSocket: wss://ws.valr.com
    this.ws = new WebSocket('wss://ws.valr.com');

    this.ws.on('open', () => {
      logger.info('ws-price connected');
      // Subscribe to mark price stream
      this.ws?.send(JSON.stringify({
        method: 'subscribe',
        params: [`public.mark_price.${this.pair}`],
      }));
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.data?.markPrice !== undefined) {
          this.currentMarkPrice = msg.data.markPrice;
          this.lastUpdateTime = Date.now();
          this.emit('update', {
            markPrice: this.currentMarkPrice,
            timestamp: this.lastUpdateTime,
          });
        }
      } catch { /* ignore parse errors */ }
    });

    this.ws.on('close', () => {
      logger.warn('ws-price disconnected, reconnecting in 5s');
      this.ws = null;
      setTimeout(() => this.connect(), 5_000);
    });

    this.ws.on('error', (err) => {
      logger.error('ws-price error', { error: String(err) });
    });
  }

  getCurrentMarkPrice(): string | null {
    return this.currentMarkPrice;
  }

  isStale(): boolean {
    if (!this.currentMarkPrice) return true;
    return Date.now() - this.lastUpdateTime > this.staleTimeoutMs;
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }
}
