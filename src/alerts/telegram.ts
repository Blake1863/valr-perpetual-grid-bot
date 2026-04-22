/**
 * Telegram alert sender via OpenClaw gateway.
 */
import https from 'node:https';
import { logger } from '../app/logger.js';

export interface TelegramAlert {
  chatId: string;
  text: string;
}

export class TelegramAlertSender {
  private gatewayUrl: string | null;
  private chatId: string | null;

  constructor(gatewayUrl?: string, chatId?: string) {
    this.gatewayUrl = gatewayUrl || null;
    this.chatId = chatId || null;
  }

  async send(text: string): Promise<void> {
    if (!this.gatewayUrl || !this.chatId) {
      // Silently skip if not configured
      return;
    }

    const payload: TelegramAlert = {
      chatId: this.chatId,
      text,
    };

    const data = JSON.stringify(payload);
    const url = new URL(this.gatewayUrl);

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname + url.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
          },
          timeout: 10_000,
        },
        (res) => {
          res.on('data', () => {}); // consume response
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve();
            } else {
              reject(new Error(`Telegram alert failed: ${res.statusCode}`));
            }
          });
        },
      );

      req.on('error', (err) => {
        logger.warn('Telegram alert error', { error: String(err) });
        resolve(); // Don't fail the whole bot on alert failure
      });

      req.on('timeout', () => {
        req.destroy();
        logger.warn('Telegram alert timeout');
        resolve();
      });

      req.write(data);
      req.end();
    });
  }
}
