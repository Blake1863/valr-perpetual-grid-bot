// Smoke test: connect to both WS endpoints, subscribe, print events for ~15s
import { WsPriceClient } from '../dist/exchange/wsPriceClient.js';
import { WsAccountClient } from '../dist/exchange/wsAccountClient.js';
import { execSync } from 'node:child_process';

function secret(k) { return execSync(`python3 /home/admin/.openclaw/secrets/secrets.py get ${k}`, {encoding:'utf8'}).trim(); }
const KEY = secret('valr_grid_bot_1_api_key');
const SEC = secret('valr_grid_bot_1_api_secret');
const SUB = '1432690254033137664';

console.log('=== PRICE WS (public) ===');
const price = new WsPriceClient('SOLUSDTPERP', 30000);
let priceCount = 0;
price.on('update', (u) => {
  priceCount++;
  if (priceCount <= 3) console.log('  price:', JSON.stringify(u));
});
price.connect();

console.log('=== ACCOUNT WS (authenticated) ===');
const acct = new WsAccountClient(KEY, SEC, SUB, 'SOLUSDTPERP');
let acctCount = 0;
acct.on('raw', (m) => {
  acctCount++;
  if (acctCount <= 5) console.log('  acct raw:', JSON.stringify(m).slice(0, 300));
});
acct.on('fill', (f) => console.log('  FILL:', JSON.stringify(f).slice(0, 200)));
acct.on('order_update', (o) => console.log('  ORDER:', JSON.stringify(o).slice(0, 200)));
acct.on('balance', (b) => console.log('  BAL:', JSON.stringify(b).slice(0, 200)));
acct.connect();

setTimeout(() => {
  console.log('');
  console.log(`=== RESULTS after 15s ===`);
  console.log(`  price updates: ${priceCount}  (stale=${price.isStale()})  currentMark=${price.getCurrentMarkPrice()}`);
  console.log(`  account messages: ${acctCount}`);
  price.disconnect();
  acct.disconnect();
  setTimeout(() => process.exit(0), 500);
}, 15000);
