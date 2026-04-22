/**
 * WebSocket client for account event stream (fills, order updates) from VALR.
 * Emits 'fill' events when order fills are detected.
 */
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { createHmac } from 'node:crypto';
import { logger } from '../app/logger.js';

export class WsAccountClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private apiSecret: string;
  private subaccountId: string;

  constructor(apiKey: string, apiSecret: string, subaccountId: string) {
    super();
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.subaccountId = subaccountId;
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket('wss://ws.valr.com');

    ws.on('open', () => {
      logger.info('ws-account connected, authenticating');
      const timestamp = Date.now().toString();
      const signature = createHmac('sha512', this.apiSecret)
        .update(`GET/ws/auth${timestamp}${this.subaccountId}`)
        .digest('hex');

      ws.send(JSON.stringify({
        method: 'authenticate',
        params: {
          apiKey: this.apiKey,
          signature,
          timestamp,
          subAccountId: this.subaccountId,
        },
      }));

      // Subscribe to order and trade events
      ws.send(JSON.stringify({
        method: 'subscribe',
        params: ['account.orders', 'account.trades'],
      }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'account.trades' || msg.type === 'trade') {
          this.emit('fill', msg);
        } else if (msg.type === 'account.orders' || msg.type === 'order_update') {
          this.emit('order_update', msg);
        }
      } catch { /* ignore */ }
    });

    ws.on('close', () => {
      logger.warn('ws-account disconnected, reconnecting in 5s');
      this.ws = null;
      setTimeout(() => this.connect(), 5_000);
    });

    ws.on('error', (err) => {
      logger.error('ws-account error', { error: String(err) });
    });

    this.ws = ws;
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }
}
