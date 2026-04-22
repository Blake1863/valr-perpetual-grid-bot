/**
 * Cancel all orders and wipe state database.
 */
import { unlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../config/loader.js';
import { ValrRestClient } from '../exchange/restClient.js';
import dotenv from 'dotenv';

dotenv.config();

const configPath = process.argv[2];
if (!configPath) {
  console.error('Usage: node dist/scripts/reset-state.js <config.json>');
  process.exit(1);
}

const config = loadConfig(configPath);
const dataPath = resolve(`./logs/${config.pair.toLowerCase()}-state.json`);

if (!config.dryRun) {
  const apiKey = process.env.VALR_API_KEY;
  const apiSecret = process.env.VALR_API_SECRET;
  if (apiKey && apiSecret) {
    const client = new ValrRestClient(apiKey, apiSecret, config.subaccountId);
    console.log('Canceling all exchange orders...');
    client.cancelAllOrders(config.pair)
      .then(() => console.log('Orders canceled.'))
      .catch(e => console.warn('Cancel failed:', e));
  }
}

if (existsSync(dataPath)) {
  unlinkSync(dataPath);
  console.log('State file deleted.');
} else {
  console.log('No state file found.');
}
console.log('Reset complete.');
