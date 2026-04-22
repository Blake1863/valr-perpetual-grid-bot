/**
 * Main application orchestrator and lifecycle manager.
 */
import { loadConfig } from '../config/loader.js';
import { logger } from './logger.js';
import { ValrRestClient } from '../exchange/restClient.js';
import { WsPriceClient } from '../exchange/wsPriceClient.js';
import { WsAccountClient } from '../exchange/wsAccountClient.js';
import { getStaticConstraints } from '../exchange/pairMetadata.js';
import { buildLevels } from '../strategy/grid.js';
import { planDesiredOrders } from '../strategy/plan.js';
import { reconcile } from '../strategy/reconciler.js';
import { computeQuantityPerLevel } from '../strategy/sizing.js';
import { StateStore } from '../state/store.js';
import { Supervisor } from './supervisor.js';
import { TelegramAlertSender } from '../alerts/telegram.js';
import Decimal, { type D } from '../decimal.js';
import dotenv from 'dotenv';

dotenv.config();

async function main(): Promise<void> {
  const configPath = process.argv[2];
  if (!configPath) {
    console.error('Usage: node dist/app/main.js <config.json>');
    process.exit(1);
  }

  const config = loadConfig(configPath);
  logger.info('Bot starting', { pair: config.pair, gridCount: config.gridCount, dryRun: config.dryRun });

  const apiKey = process.env.VALR_API_KEY;
  const apiSecret = process.env.VALR_API_SECRET;

  if (!config.dryRun && (!apiKey || !apiSecret)) {
    logger.error('VALR_API_KEY and VALR_API_SECRET must be set in .env');
    process.exit(1);
  }

  const key = apiKey ?? 'dry-run-key';
  const secret = apiSecret ?? 'dry-run-secret';

  const restClient = new ValrRestClient(key, secret, config.subaccountId);
  const priceClient = new WsPriceClient(config.pair, config.staleDataTimeoutMs);
  const accountClient = new WsAccountClient(key, secret, config.subaccountId, config.pair);
  const alertSender = new TelegramAlertSender(config.telegramGatewayUrl, config.telegramChatId);
  const store = new StateStore(config.pair);
  const supervisor = new Supervisor(config, alertSender);
  const runId = Date.now().toString();

  const cleanup = async (): Promise<void> => {
    logger.info('Shutting down...');
    if (!config.dryRun) {
      try { await restClient.cancelAllOrders(config.pair); } catch { /* best-effort */ }
    }
    priceClient.disconnect();
    accountClient.disconnect();
    store.close();
    process.exit(0);
  };

  process.on('SIGINT', () => { void cleanup(); });
  process.on('SIGTERM', () => { void cleanup(); });

  const constraints = getStaticConstraints(config.pair);

  if (!config.dryRun) {
    try { await restClient.cancelAllOrders(config.pair); } catch { /* none to cancel */ }
    try {
      const currentLev = await restClient.getLeverage(config.pair);
      if (currentLev !== config.leverage) {
        await restClient.setLeverage(config.pair, config.leverage);
        logger.info('Leverage set', { leverage: config.leverage });
      }
    } catch (e) { logger.warn('Could not verify leverage', { error: String(e) }); }
  }

  let referencePrice: D;
  if (config.referencePrice) {
    referencePrice = new Decimal(config.referencePrice);
  } else if (config.dryRun) {
    referencePrice = new Decimal(config.lowerBound).plus(new Decimal(config.upperBound)).div(2);
  } else {
    const summary = await restClient.getMarketSummary(config.pair);
    referencePrice = new Decimal(summary.markPrice);
  }

  const lowerBound = new Decimal(config.lowerBound);
  const upperBound = new Decimal(config.upperBound);
  const levels = buildLevels(lowerBound, upperBound, config.gridCount, config.gridMode, constraints);
  logger.info('Grid built', { levels: levels.length });

  let quantityPerLevel: D;
  if (!config.dynamicSizing && config.quantityPerLevel) {
    quantityPerLevel = new Decimal(config.quantityPerLevel);
  } else if (config.dryRun) {
    quantityPerLevel = new Decimal('1');
  } else {
    const balances = await restClient.getBalances();
    const usdtBal = balances.find(b => b.currency === 'USDT');
    if (!usdtBal) throw new Error('USDT balance not found');
    quantityPerLevel = computeQuantityPerLevel(new Decimal(usdtBal.available), config, referencePrice, constraints);
  }

  logger.info('Quantity per level', { qty: quantityPerLevel.toString() });

  if (!config.dryRun) {
    priceClient.connect();
    accountClient.connect();
  }

  await alertSender.send(
    `🚀 ${config.pair} started | Range: ${config.lowerBound}–${config.upperBound} | ` +
    `Grid: ${config.gridCount} (${config.gridMode}) | ${config.leverage}x | SL: ${config.stopLossPercent}%`,
  ).catch(() => { /* fire-and-forget */ });

  store.setMetric('bot_started_at', new Date().toISOString());
  store.setMetric('last_supervisor_state', supervisor.getState());

  const reconcileTick = async (): Promise<void> => {
    if (supervisor.isHalted()) return;

    let currentPrice: D;
    if (config.dryRun) {
      currentPrice = referencePrice;
    } else {
      const mp = priceClient.getCurrentMarkPrice();
      if (!mp || priceClient.isStale()) { logger.warn('Stale price, skipping'); return; }
      currentPrice = new Decimal(mp);
    }

    if (supervisor.checkRangeExit(currentPrice, lowerBound, upperBound)) return;

    const desired = planDesiredOrders(levels, currentPrice, quantityPerLevel, runId, constraints);
    let exchangeOrders: Awaited<ReturnType<typeof restClient.getOpenOrders>> = [];

    if (!config.dryRun) {
      try { exchangeOrders = await restClient.getOpenOrders(config.pair); }
      catch (e) { supervisor.recordFailure(String(e)); return; }
    }

    const plan = reconcile(desired, exchangeOrders, runId);

    if (config.dryRun) {
      console.log(`\n=== DRY-RUN GRID FOR ${config.pair} ===`);
      console.log(`Reference price : ${currentPrice.toString()}`);
      console.log(`Range           : ${config.lowerBound} – ${config.upperBound}  (${config.gridMode})`);
      console.log(`\nAll ${levels.length} levels (${config.gridCount} inner + 2 boundaries):`);
      for (const l of levels) {
        const isBoundary = l.index === 0 || l.index === levels.length - 1;
        const tag = isBoundary ? 'BOUNDARY' : l.price.lt(currentPrice) ? 'BUY     ' : l.price.gt(currentPrice) ? 'SELL    ' : 'AT-PRICE';
        console.log(`  L${String(l.index).padStart(2, '0')}: ${l.priceStr.padStart(12)}  ${tag}`);
      }
      console.log(`\nDesired orders (${desired.length}):`);
      for (const o of desired) {
        console.log(`  ${o.side.padEnd(4)} qty=${o.quantityStr.padStart(8)} @ ${o.priceStr.padStart(12)}  (L${o.levelIndex})`);
      }
      console.log(`\nReconcile summary: place=${plan.toPlace.length}  cancel=${plan.toCancel.length}  unchanged=${plan.unchanged}`);
      return;
    }

    for (const o of plan.toCancel) {
      try { await restClient.cancelOrder(o.exchangeOrderId, config.pair); store.updateOrderAsCancelled(o.customerOrderId); }
      catch (e) { supervisor.recordFailure(String(e)); }
    }

    for (const o of plan.toPlace) {
      try {
        store.insertOrder(o, runId);
        store.updateOrderAsPending(o.customerOrderId);
        const result = await restClient.placeLimitOrder(
          config.pair, o.side, o.priceStr, o.quantityStr,
          o.customerOrderId, config.postOnly, false, 'GTC');
        store.updateOrderAsActive(result.orderId, o.customerOrderId);
        supervisor.clearFailures();
      } catch (e) {
        logger.error('Placement failed', { id: o.customerOrderId, error: String(e) });
        supervisor.recordFailure(String(e));
      }
    }

    store.setMetric('last_reconcile_ts', new Date().toISOString());
    store.setMetric('current_active_orders', desired.length.toString());
    store.setMetric('last_supervisor_state', supervisor.getState());
  };

  setInterval(() => { void reconcileTick(); }, config.reconcileIntervalSecs * 1000);
  await reconcileTick();

  if (!config.dryRun) {
    setInterval(async () => {
      try {
        supervisor.checkCooldown();
        const [positions, marginInfo] = await Promise.all([
          restClient.getOpenPositions(),
          restClient.getMarginInfo(),
        ]);
        const position = positions.find(p => p.pair === config.pair) ?? null;
        const mp = priceClient.getCurrentMarkPrice();
        if (mp) {
          const cp = new Decimal(mp);
          supervisor.checkStopLoss(cp, position);
          supervisor.checkMarginRatio(marginInfo);
          supervisor.checkLiquidationProximity(cp, position);
        }
        store.setMetric('last_supervisor_state', supervisor.getState());
      } catch (e) { logger.error('Supervisor error', { error: String(e) }); }
    }, 10_000);

    setInterval(() => store.pruneOldRecords(), 3_600_000);
    logger.info('Bot running');
  }
}

process.on('unhandledRejection', (r) => { console.error('Unhandled rejection:', r); process.exit(1); });
main().catch(e => { console.error('Fatal:', e); process.exit(1); });
