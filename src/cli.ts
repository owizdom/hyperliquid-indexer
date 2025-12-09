import { Command } from 'commander';
import chalk from 'chalk';
import { HyperliquidIndexer } from './indexer.js';
import { HyperliquidDatabase } from './database.js';
import dotenv from 'dotenv';

dotenv.config();

const program = new Command();

program
  .name('hyperliquid-indexer')
  .description('CLI tool for indexing Hyperliquid blockchain data')
  .version('1.0.0');

program
  .command('start')
  .description('Start the indexer')
  .option('-i, --interval <ms>', 'Indexing interval in milliseconds', '10000')
  .action(async (options: { interval?: string }) => {
    const indexer = new HyperliquidIndexer();
    const interval = parseInt(options.interval || '10000');

    console.log(chalk.blue(' Starting Hyperliquid Indexer...'));
    console.log(chalk.gray(`   Interval: ${interval / 1000}s`));

    await indexer.start(interval);

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log(chalk.yellow('\n  Shutting down...'));
      indexer.close();
      process.exit(0);
    });
  });

program
  .command('stats')
  .description('Show indexing statistics')
  .action(() => {
    const dbPath = process.env.DATABASE_PATH || './data/hyperliquid.json';
    const db = new HyperliquidDatabase(dbPath);
    const stats = db.getStats();

    console.log(chalk.blue('\nIndexing Statistics\n'));
    console.log(chalk.green(`   Markets indexed: ${stats.markets}`));
    console.log(chalk.green(`   Trades indexed: ${stats.trades.toLocaleString()}`));
    console.log(chalk.green(`   Blocks indexed: ${stats.blocks.toLocaleString()}`));
    console.log(chalk.green(`   Latest block: ${stats.latestBlockNumber}`));

    db.close();
  });

program
  .command('markets')
  .description('List all indexed markets')
  .option('-s, --symbol <symbol>', 'Filter by symbol')
  .action((options: { symbol?: string }) => {
    const dbPath = process.env.DATABASE_PATH || './data/hyperliquid.json';
    const db = new HyperliquidDatabase(dbPath);
    
    const markets = db.getLatestMarketData(options.symbol);

    console.log(chalk.blue('\n Indexed Markets\n'));
    
    if (markets.length === 0) {
      console.log(chalk.yellow('   No markets found'));
    } else {
      markets.forEach((market) => {
        const changeColor = market.change24h >= 0 ? chalk.green : chalk.red;
        const changeSign = market.change24h >= 0 ? '+' : '';
        
        console.log(chalk.white(`   ${market.symbol.padEnd(15)} `) +
          chalk.cyan(`$${market.price.toFixed(4).padStart(10)} `) +
          changeColor(`${changeSign}${market.change24h.toFixed(2)}% `) +
          chalk.gray(`Vol: $${market.volume24h.toLocaleString()}`));
      });
    }

    db.close();
  });

program
  .command('trades')
  .description('Show recent trades')
  .option('-s, --symbol <symbol>', 'Filter by symbol')
  .option('-l, --limit <number>', 'Number of trades to show', '20')
  .action((options: { symbol?: string; limit?: string }) => {
    const dbPath = process.env.DATABASE_PATH || './data/hyperliquid.json';
    const db = new HyperliquidDatabase(dbPath);
    
    const trades = db.getRecentTrades(options.symbol, parseInt(options.limit || '20'));

    console.log(chalk.blue(`\nRecent Trades${options.symbol ? ` (${options.symbol})` : ''}\n`));
    
    if (trades.length === 0) {
      console.log(chalk.yellow('   No trades found'));
    } else {
      trades.forEach((trade) => {
        const sideColor = trade.side === 'buy' ? chalk.green : chalk.red;
        const sideSymbol = trade.side === 'buy' ? '▲' : '▼';
        const time = new Date(trade.timestamp).toLocaleTimeString();
        
        console.log(
          chalk.white(`   ${time} `) +
          chalk.cyan(`${trade.symbol.padEnd(15)} `) +
          sideColor(`${sideSymbol} $${trade.price.toFixed(4).padStart(10)} `) +
          chalk.gray(`Size: ${trade.size.toFixed(4)}`)
        );
      });
    }

    db.close();
  });

program
  .command('index')
  .description('Run a single indexing cycle')
  .action(async () => {
    const indexer = new HyperliquidIndexer();
    
    console.log(chalk.blue(' Running indexing cycle...\n'));
    
    try {
      await indexer.index();
      console.log(chalk.green('\n Indexing complete'));
    } catch (error) {
      console.error(chalk.red('\n Indexing failed:'), error);
      process.exit(1);
    } finally {
      indexer.close();
    }
  });

program
  .command('cleanup')
  .description('Clear old data from database')
  .option('-h, --hours <number>', 'Clear data older than this many hours', '1')
  .option('--all', 'Clear ALL data (use with caution!)')
  .action((options: { hours?: string; all?: boolean }) => {
    const dbPath = process.env.DATABASE_PATH || './data/hyperliquid.json';
    const db = new HyperliquidDatabase(dbPath);
    
    if (options.all) {
      console.log(chalk.yellow('\nClearing ALL data from database...\n'));
      const result = db.clearAllData();
      console.log(chalk.green(`Cleared: ${result.blocksRemoved} blocks, ${result.transactionsRemoved} transactions, ${result.tradesRemoved} trades, ${result.marketsRemoved} markets`));
    } else {
      const hours = parseInt(options.hours || '1');
      console.log(chalk.blue(`\nClearing data older than ${hours} hour(s)...\n`));
      const result = db.clearOldData(hours);
      console.log(chalk.green(`Cleared: ${result.blocksRemoved} blocks, ${result.transactionsRemoved} transactions, ${result.tradesRemoved} trades, ${result.marketsRemoved} markets`));
    }
    
    db.close();
  });

program.parse();

