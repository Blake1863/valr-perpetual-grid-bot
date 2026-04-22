/**
 * Quick REST smoke test — verifies the fixed client against live VALR.
 * Reads credentials from MAIN_API_KEY / MAIN_API_SECRET environment variables
 * (or VALR_API_KEY / VALR_API_SECRET), and the subaccount id from VALR_SUBACCOUNT_ID.
 *
 * Runs only read-only calls — never places orders.
 */
import { ValrRestClient } from '../exchange/restClient.js';

async function main() {
  const key = process.env.VALR_API_KEY || process.env.MAIN_API_KEY;
  const secret = process.env.VALR_API_SECRET || process.env.MAIN_API_SECRET;
  const sub = process.env.VALR_SUBACCOUNT_ID || '';
  if (!key || !secret) {
    console.error('Missing API key/secret env. Set MAIN_API_KEY + MAIN_API_SECRET.');
    process.exit(1);
  }

  const client = new ValrRestClient(key, secret, sub);

  console.log(`Subaccount: ${sub || '(primary)'}`);

  console.log('\n=== getBalances() ===');
  const balances = await client.getBalances();
  console.log(`  ${balances.length} currencies`);
  balances
    .filter(b => Number(b.total) > 0)
    .slice(0, 8)
    .forEach(b => console.log(`    ${b.currency.padEnd(10)} total=${b.total} avail=${b.available}`));

  console.log('\n=== getOpenOrders(SOLUSDTPERP) ===');
  const openOrders = await client.getOpenOrders('SOLUSDTPERP');
  console.log(`  ${openOrders.length} open orders for SOLUSDTPERP`);
  openOrders.slice(0, 3).forEach(o => console.log(`    ${o.side} ${o.quantity}@${o.price} status=${o.status}`));

  console.log('\n=== getOpenPositions() ===');
  const positions = await client.getOpenPositions();
  console.log(`  ${positions.length} open positions`);
  positions.forEach(p => console.log(`    ${p.pair} ${p.side} qty=${p.quantity} entry=${p.averageEntryPrice}`));

  console.log('\n=== getMarginInfo() ===');
  const mi = await client.getMarginInfo();
  console.log(`  reference=${mi.referenceCurrency}  leverage=${mi.leverageMultiple}x`);
  console.log(`  collateralised=${mi.collateralisedBalancesInReference}  available=${mi.availableInReference}`);
  console.log(`  initialReq=${mi.initialRequiredInReference}  unrealisedPnl=${mi.totalUnrealisedFuturesPnlInReference}`);
  console.log(`  IMF=${mi.initialMarginFraction}  MMF=${mi.maintenanceMarginFraction}`);

  if (process.env.VALR_TEST_LEVERAGE_PAIR) {
    console.log(`\n=== getLeverage(${process.env.VALR_TEST_LEVERAGE_PAIR}) ===`);
    const lev = await client.getLeverage(process.env.VALR_TEST_LEVERAGE_PAIR);
    console.log(`  leverage=${lev}x`);
  }

  console.log('\n=== getMarketSummary(SOLUSDTPERP) ===');
  const ms = await client.getMarketSummary('SOLUSDTPERP');
  console.log(`  last=${ms.lastPrice}  mark=${ms.markPrice}  24h=[${ms.lowPrice24h}, ${ms.highPrice24h}]`);

  console.log('\nAll checks passed ✅');
}

main().catch(e => { console.error('SMOKE FAILED:', e); process.exit(1); });
