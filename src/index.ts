import { HyperliquidIndexer } from './indexer.js';
import dotenv from 'dotenv';

dotenv.config();

// Main entry point - can be used for programmatic access
export { HyperliquidIndexer } from './indexer.js';
export { HyperliquidDatabase } from './database.js';
export { HyperliquidClient } from './hyperliquid-client.js';

// If run directly, start the indexer
// This will be executed when running: npm start or node dist/index.js
const indexer = new HyperliquidIndexer();
const interval = parseInt(process.env.INDEX_INTERVAL_MS || '10000');

console.log('Starting Hyperliquid Indexer...');
indexer.start(interval);

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  indexer.close();
  process.exit(0);
});

