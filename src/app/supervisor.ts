/**
 * Supervisor state machine for risk management.
 */
import Decimal, { type D } from '../decimal.js';
import { logger } from './logger.js';
import type { BotConfig } from '../config/schema.js';
import type { Position, MarginInfo } from '../exchange/types.js';
import type { TelegramAlertSender } from '../alerts/telegram.js';

export type SupervisorState = 'RUNNING' | 'PAUSED' | 'HALTED' | 'COOLDOWN';

interface FailureRecord { timestamp: number; error: string; }

export class Supervisor {
  private state: SupervisorState = 'RUNNING';
  private config: BotConfig;
  private alertSender: TelegramAlertSender;
  private failureWindow: FailureRecord[] = [];
  private lastRangeExitAlert = 0;
  private lastMarginAlert = 0;
  private lastLiquidationAlert = 0;
  private cooldownUntil = 0;

  constructor(config: BotConfig, alertSender: TelegramAlertSender) {
    this.config = config;
    this.alertSender = alertSender;
  }

  getState(): SupervisorState { return this.state; }
  isHalted(): boolean { return this.state === 'HALTED' || this.state === 'COOLDOWN'; }

  checkStopLoss(currentPrice: D, position: Position | null): boolean {
    if (this.config.stopLossReference === 'disabled' || !position || position.side === 'NONE') return false;
    const avgEntry = new Decimal(position.averageEntryPrice);
    const lossPercent = avgEntry.minus(currentPrice).div(avgEntry).abs().mul(100);
    const isLosing = (position.side === 'BUY' && currentPrice.lt(avgEntry))
      || (position.side === 'SELL' && currentPrice.gt(avgEntry));
    if (isLosing && lossPercent.gte(this.config.stopLossPercent)) {
      logger.error('Stop-loss triggered', { avgEntry: avgEntry.toString(), current: currentPrice.toString(), lossPercent: lossPercent.toFixed(2) });
      this._halt('stop_loss');
      return true;
    }
    return false;
  }

  checkRangeExit(currentPrice: D, lowerBound: D, upperBound: D): boolean {
    const inRange = currentPrice.gte(lowerBound) && currentPrice.lte(upperBound);
    if (!inRange) {
      if (this.state === 'RUNNING') {
        logger.warn('Price exited range', { current: currentPrice.toString(), lower: lowerBound.toString(), upper: upperBound.toString() });
        if (this.config.onRangeExit === 'halt') this.state = 'PAUSED';
        else this._halt('range_exit');
        const now = Date.now();
        if (now - this.lastRangeExitAlert > 60_000) {
          this.alertSender.send(`⚠️ Range exit: ${this.config.pair} price ${currentPrice} outside [${lowerBound}, ${upperBound}]`).catch(() => { /* ignore */ });
          this.lastRangeExitAlert = now;
        }
      }
      return true;
    }
    if (this.state === 'PAUSED') { logger.info('Back in range, resuming'); this.state = 'RUNNING'; }
    return false;
  }

  checkMarginRatio(marginInfo: MarginInfo): void {
    const used = new Decimal(marginInfo.usedMargin);
    const total = new Decimal(marginInfo.totalMargin);
    if (total.isZero()) return;
    const ratio = used.div(total).mul(100);
    if (ratio.gte(this.config.marginRatioAlertPercent)) {
      const now = Date.now();
      if (now - this.lastMarginAlert > 600_000) {
        logger.warn('High margin ratio', { ratio: ratio.toFixed(2) });
        this.alertSender.send(`⚠️ High margin: ${ratio.toFixed(2)}%`).catch(() => { /* ignore */ });
        this.lastMarginAlert = now;
      }
    }
  }

  checkLiquidationProximity(currentPrice: D, position: Position | null): void {
    if (!position || position.side === 'NONE' || position.liquidationPrice === '0') return;
    const liqPrice = new Decimal(position.liquidationPrice);
    const proximity = liqPrice.minus(currentPrice).abs().div(currentPrice).mul(100);
    if (proximity.lte(this.config.liquidationProximityPercent)) {
      const now = Date.now();
      if (now - this.lastLiquidationAlert > 300_000) {
        logger.error('Close to liquidation', { current: currentPrice.toString(), liq: liqPrice.toString(), proximity: proximity.toFixed(2) });
        this.alertSender.send(`🚨 Near liquidation! ${this.config.pair} liq: ${liqPrice} (${proximity.toFixed(2)}% away)`).catch(() => { /* ignore */ });
        this.lastLiquidationAlert = now;
      }
    }
  }

  recordFailure(error: string): void {
    const now = Date.now();
    this.failureWindow.push({ timestamp: now, error });
    const cutoff = now - this.config.consecutiveFailuresWindowSecs * 1000;
    this.failureWindow = this.failureWindow.filter(f => f.timestamp >= cutoff);
    if (this.failureWindow.length >= this.config.consecutiveFailuresThreshold) {
      logger.error('Circuit breaker', { failures: this.failureWindow.length });
      this._halt('circuit_breaker');
    }
  }

  clearFailures(): void { this.failureWindow = []; }

  checkCooldown(): void {
    if (this.state === 'HALTED' && Date.now() >= this.cooldownUntil) {
      logger.info('Cooldown expired, resuming'); this.state = 'RUNNING'; this.clearFailures();
    }
  }

  reset(): void { this.state = 'RUNNING'; this.clearFailures(); this.cooldownUntil = 0; }

  private _halt(reason: string): void {
    this.state = 'HALTED';
    this.cooldownUntil = Date.now() + this.config.cooldownAfterStopSecs * 1000;
    if (reason === 'stop_loss') this.alertSender.send(`🛑 STOP-LOSS for ${this.config.pair}`).catch(() => { /* ignore */ });
    else if (reason === 'circuit_breaker') this.alertSender.send(`🛑 CIRCUIT BREAKER for ${this.config.pair}`).catch(() => { /* ignore */ });
  }
}
