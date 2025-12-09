import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

export interface MarketData {
  id?: number;
  symbol: string;
  price: number;
  volume24h: number;
  change24h: number;
  timestamp: number;
}

export interface Trade {
  id?: number;
  symbol: string;
  price: number;
  size: number;
  side: 'buy' | 'sell';
  timestamp: number;
  txHash?: string;
}

export interface OrderBook {
  id?: number;
  symbol: string;
  bids: string; // JSON stringified
  asks: string; // JSON stringified
  timestamp: number;
}

export interface BlockData {
  id?: number;
  blockNumber: number;
  blockHash: string;
  timestamp: number;
  txCount: number;
  proposer: string;
  data: string; // JSON stringified
}

export interface HyperliquidTransaction {
  id?: number;
  hash: string;
  blockNumber: number;
  blockHash: string;
  timestamp: number;
  user: string;
  actionType: string;
  actionData: string; // JSON stringified
  error: string | null;
  data: string; // JSON stringified full transaction
}

export interface Validator {
  id?: number;
  address: string;
  votingPower: number;
  status: string;
  uptime: number;
  timestamp: number;
  data: string; // JSON stringified
}

export interface Vault {
  id?: number;
  address: string;
  name: string;
  equity: number;
  totalDeposits: number;
  totalWithdrawals: number;
  timestamp: number;
  data: string; // JSON stringified
}

export interface Transfer {
  id?: number;
  hash: string;
  blockNumber: number;
  timestamp: number;
  from: string;
  to: string;
  token: string;
  amount: number;
  data: string; // JSON stringified
}

interface DatabaseData {
  markets: MarketData[];
  trades: Trade[];
  orderbooks: OrderBook[];
  blocks: BlockData[];
  hyperliquidTransactions: HyperliquidTransaction[];
  validators: Validator[];
  vaults: Vault[];
  transfers: Transfer[];
  nextId: {
    markets: number;
    trades: number;
    orderbooks: number;
    blocks: number;
    hyperliquidTransactions: number;
    validators: number;
    vaults: number;
    transfers: number;
  };
}

export class HyperliquidDatabase {
  private dbPath: string;
  private dataDir: string;
  private data: DatabaseData;

  constructor(dbPath: string) {
    // Ensure directory exists
    this.dataDir = dirname(dbPath);
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }

    this.dbPath = dbPath;
    this.data = this.loadData();
  }

  private loadData(): DatabaseData {
    const defaultData: DatabaseData = {
      markets: [],
      trades: [],
      orderbooks: [],
      blocks: [],
      hyperliquidTransactions: [],
      validators: [],
      vaults: [],
      transfers: [],
      nextId: {
        markets: 1,
        trades: 1,
        orderbooks: 1,
        blocks: 1,
        hyperliquidTransactions: 1,
        validators: 1,
        vaults: 1,
        transfers: 1,
      },
    };

    if (existsSync(this.dbPath)) {
      try {
        const content = readFileSync(this.dbPath, 'utf-8');
        const loaded = JSON.parse(content);
        // Ensure all required fields exist (for backward compatibility)
        return {
          markets: loaded.markets || [],
          trades: loaded.trades || [],
          orderbooks: loaded.orderbooks || [],
          blocks: loaded.blocks || [],
          hyperliquidTransactions: loaded.hyperliquidTransactions || [],
          nextId: {
            markets: loaded.nextId?.markets || 1,
            trades: loaded.nextId?.trades || 1,
            orderbooks: loaded.nextId?.orderbooks || 1,
            blocks: loaded.nextId?.blocks || 1,
            hyperliquidTransactions: loaded.nextId?.hyperliquidTransactions || 1,
            validators: loaded.nextId?.validators || 1,
            vaults: loaded.nextId?.vaults || 1,
            transfers: loaded.nextId?.transfers || 1,
          },
          validators: loaded.validators || [],
          vaults: loaded.vaults || [],
          transfers: loaded.transfers || [],
        };
      } catch (error) {
        console.error('Error loading database, initializing new:', error);
      }
    }

    return defaultData;
  }

  private saveData() {
    try {
      writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (error) {
      console.error('Error saving database:', error);
    }
  }

  // Market data methods
  insertMarketData(data: MarketData) {
    // Remove existing entries with same symbol (keep only latest per symbol)
    this.data.markets = this.data.markets.filter(
      (m) => m.symbol !== data.symbol
    );

    const newData: MarketData = {
      ...data,
      id: this.data.nextId.markets++,
    };
    this.data.markets.push(newData);
    this.saveData();
  }

  getLatestMarketData(symbol?: string): MarketData[] {
    if (symbol) {
      const filtered = this.data.markets
        .filter((m) => m.symbol === symbol)
        .sort((a, b) => b.timestamp - a.timestamp);
      return filtered.length > 0 ? [filtered[0]] : [];
    } else {
      // Get latest for each symbol
      const symbolMap = new Map<string, MarketData>();
      for (const market of this.data.markets) {
        const existing = symbolMap.get(market.symbol);
        if (!existing || market.timestamp > existing.timestamp) {
          symbolMap.set(market.symbol, market);
        }
      }
      // Sort by timestamp descending (newest first)
      return Array.from(symbolMap.values()).sort((a, b) => b.timestamp - a.timestamp);
    }
  }

  getMarketHistory(symbol: string, limit: number = 100): MarketData[] {
    return this.data.markets
      .filter((m) => m.symbol === symbol)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  // Trade methods
  insertTrade(trade: Trade) {
    // Check if trade already exists
    const exists = this.data.trades.some(
      (t) =>
        t.symbol === trade.symbol &&
        t.timestamp === trade.timestamp &&
        t.txHash === trade.txHash
    );

    if (!exists) {
      const newTrade: Trade = {
        ...trade,
        id: this.data.nextId.trades++,
      };
      this.data.trades.push(newTrade);
      this.saveData();
    }
  }

  getRecentTrades(symbol?: string, limit: number = 100): Trade[] {
    let trades = this.data.trades;
    if (symbol) {
      trades = trades.filter((t) => t.symbol === symbol);
    }
    return trades.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }

  // Order book methods
  insertOrderBook(orderBook: OrderBook) {
    // Remove existing entry with same symbol and timestamp
    this.data.orderbooks = this.data.orderbooks.filter(
      (ob) => !(ob.symbol === orderBook.symbol && ob.timestamp === orderBook.timestamp)
    );

    const newOrderBook: OrderBook = {
      ...orderBook,
      id: this.data.nextId.orderbooks++,
    };
    this.data.orderbooks.push(newOrderBook);
    this.saveData();
  }

  getLatestOrderBook(symbol: string): OrderBook | null {
    const filtered = this.data.orderbooks
      .filter((ob) => ob.symbol === symbol)
      .sort((a, b) => b.timestamp - a.timestamp);
    return filtered.length > 0 ? filtered[0] : null;
  }

  // Block methods
  insertBlock(block: BlockData) {
    // Remove existing block with same number
    this.data.blocks = this.data.blocks.filter((b) => b.blockNumber !== block.blockNumber);

    const newBlock: BlockData = {
      ...block,
      id: this.data.nextId.blocks++,
    };
    this.data.blocks.push(newBlock);
    this.saveData();
  }

  getLatestBlock(): BlockData | null {
    if (this.data.blocks.length === 0) return null;
    const now = Math.floor(Date.now() / 1000);
    const oneHourAgo = now - (60 * 60); // 1 hour ago - more lenient for real-time
    
    // Only consider recent blocks when finding the latest
    const recentBlocks = this.data.blocks.filter(block => 
      block.timestamp >= oneHourAgo && block.timestamp <= now + 3600
    );
    
    // If no recent blocks, return the most recent one anyway (fallback)
    if (recentBlocks.length === 0) {
      return this.data.blocks.reduce((latest, block) =>
        block.blockNumber > latest.blockNumber ? block : latest
      );
    }
    
    return recentBlocks.reduce((latest, block) =>
      block.blockNumber > latest.blockNumber ? block : latest
    );
  }

  getBlocks(limit: number = 100): BlockData[] {
    const now = Math.floor(Date.now() / 1000); // Current time in seconds
    const oneHourAgo = now - (60 * 60); // 1 hour ago in seconds - more lenient for real-time
    
    // Filter out very old blocks but be lenient for recent ones
    const recentBlocks = this.data.blocks.filter(block => {
      // Block timestamps are in seconds
      // Allow blocks from last hour to 1 hour in future (for clock skew)
      return block.timestamp >= oneHourAgo && block.timestamp <= now + 3600;
    });
    
    // If no recent blocks, return the most recent ones anyway (fallback)
    if (recentBlocks.length === 0 && this.data.blocks.length > 0) {
      return this.data.blocks
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit);
    }
    
    return recentBlocks
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  // Transaction methods - using Hyperliquid SDK format
  getTransactions(limit: number = 100): any[] {
    const transactions: any[] = [];
    
    // Get more blocks to ensure we have enough transactions
    const blocks = this.getBlocks(Math.max(limit, 500));
    
    for (const block of blocks) {
      try {
        const blockData = JSON.parse(block.data);
        
        // Hyperliquid SDK format: transactions are in blockData.txs array
        const txList = blockData.txs || blockData.transactions || [];
        
        // Process each transaction
        for (let i = 0; i < txList.length; i++) {
          const tx = txList[i];
          
          if (tx && typeof tx === 'object') {
            // Hyperliquid transaction format from SDK
            transactions.push({
              hash: tx.hash,
              blockNumber: block.blockNumber,
              blockHash: block.blockHash,
              blockTimestamp: block.timestamp,
              transactionIndex: i,
              // Hyperliquid specific fields
              user: tx.user, // User address
              action: tx.action, // Action type and details
              time: tx.time, // Transaction timestamp
              error: tx.error, // Error if any
              // Map to standard format for display
              from: tx.user,
              to: tx.action?.to || null,
              value: tx.action?.value || '0x0',
              gas: tx.action?.gas || null,
              gasPrice: tx.action?.gasPrice || null,
              nonce: tx.action?.nonce || null,
              input: tx.action?.input || null,
            });
          }
        }
      } catch (error) {
        // Skip blocks with invalid JSON
        console.error('Error parsing block data:', error);
        continue;
      }
    }
    
    // Sort by block number (descending) and transaction index
    return transactions.sort((a, b) => {
      if (b.blockNumber !== a.blockNumber) {
        return b.blockNumber - a.blockNumber;
      }
      const aIndex = a.transactionIndex || 0;
      const bIndex = b.transactionIndex || 0;
      return bIndex - aIndex;
    }).slice(0, limit);
  }

  getTransactionByHash(txHash: string): HyperliquidTransaction | null {
    const tx = this.data.hyperliquidTransactions.find(t => t.hash === txHash);
    return tx || null;
  }

  // Hyperliquid transaction methods
  insertHyperliquidTransaction(tx: HyperliquidTransaction) {
    // Remove existing transaction with same hash
    this.data.hyperliquidTransactions = this.data.hyperliquidTransactions.filter(
      t => t.hash !== tx.hash
    );

    const newTx: HyperliquidTransaction = {
      ...tx,
      id: this.data.nextId.hyperliquidTransactions++,
    };
    this.data.hyperliquidTransactions.push(newTx);
    this.saveData();
  }

  getHyperliquidTransactions(limit: number = 100): HyperliquidTransaction[] {
    if (!this.data.hyperliquidTransactions || !Array.isArray(this.data.hyperliquidTransactions)) {
      return [];
    }
    const now = Math.floor(Date.now() / 1000); // Current time in seconds
    const oneHourAgo = now - (60 * 60); // 1 hour ago - more lenient for real-time
    
    // Filter out very old transactions but be lenient for recent ones
    const recentTransactions = this.data.hyperliquidTransactions.filter(tx => {
      // Transaction timestamps are in seconds
      // Allow transactions from last hour to 1 hour in future (for clock skew)
      return tx.timestamp >= oneHourAgo && tx.timestamp <= now + 3600;
    });
    
    // If no recent transactions, return the most recent ones anyway (fallback)
    if (recentTransactions.length === 0 && this.data.hyperliquidTransactions.length > 0) {
      return this.data.hyperliquidTransactions
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit);
    }
    
    // Sort by timestamp (descending) - newest first
    const sorted = recentTransactions.sort((a, b) => b.timestamp - a.timestamp);
    
    return sorted.slice(0, limit);
  }

  getTransactionsByUser(user: string, limit: number = 100): HyperliquidTransaction[] {
    if (!this.data.hyperliquidTransactions || !Array.isArray(this.data.hyperliquidTransactions)) {
      return [];
    }
    return this.data.hyperliquidTransactions
      .filter(tx => tx.user.toLowerCase() === user.toLowerCase())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  getTransactionsByActionType(actionType: string, limit: number = 100): HyperliquidTransaction[] {
    if (!this.data.hyperliquidTransactions || !Array.isArray(this.data.hyperliquidTransactions)) {
      return [];
    }
    return this.data.hyperliquidTransactions
      .filter(tx => tx.actionType === actionType)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  // Clean up old data (older than 1 hour)
  cleanupOldData() {
    const now = Math.floor(Date.now() / 1000);
    const oneHourAgo = now - (60 * 60);
    
    const blocksBefore = this.data.blocks.length;
    const transactionsBefore = this.data.hyperliquidTransactions.length;
    
    // Remove old blocks
    this.data.blocks = this.data.blocks.filter(block => 
      block.timestamp >= oneHourAgo && block.timestamp <= now + 3600
    );
    
    // Remove old transactions
    this.data.hyperliquidTransactions = this.data.hyperliquidTransactions.filter(tx =>
      tx.timestamp >= oneHourAgo && tx.timestamp <= now + 3600
    );
    
    const blocksRemoved = blocksBefore - this.data.blocks.length;
    const transactionsRemoved = transactionsBefore - this.data.hyperliquidTransactions.length;
    
    if (blocksRemoved > 0 || transactionsRemoved > 0) {
      this.saveData();
      console.log(`Cleaned up ${blocksRemoved} old blocks and ${transactionsRemoved} old transactions`);
    }
    
    return { blocksRemoved, transactionsRemoved };
  }

  // Clear all data - use with caution!
  clearAllData() {
    const blocksCount = this.data.blocks.length;
    const transactionsCount = this.data.hyperliquidTransactions.length;
    const tradesCount = this.data.trades.length;
    const marketsCount = this.data.markets.length;
    
    this.data.blocks = [];
    this.data.hyperliquidTransactions = [];
    this.data.trades = [];
    this.data.markets = [];
    this.data.orderbooks = [];
    
    // Reset IDs
    this.data.nextId = {
      markets: 1,
      trades: 1,
      orderbooks: 1,
      blocks: 1,
      hyperliquidTransactions: 1,
      validators: 1,
      vaults: 1,
      transfers: 1,
    };
    
    this.saveData();
    
    return {
      blocksRemoved: blocksCount,
      transactionsRemoved: transactionsCount,
      tradesRemoved: tradesCount,
      marketsRemoved: marketsCount,
    };
  }

  // Clear only old data (older than specified hours, default 1 hour)
  clearOldData(hoursOld: number = 1) {
    const now = Math.floor(Date.now() / 1000);
    const cutoffTime = now - (hoursOld * 60 * 60);
    
    const blocksBefore = this.data.blocks.length;
    const transactionsBefore = this.data.hyperliquidTransactions.length;
    const tradesBefore = this.data.trades.length;
    const marketsBefore = this.data.markets.length;
    
    // Remove old blocks
    this.data.blocks = this.data.blocks.filter(block => block.timestamp >= cutoffTime);
    
    // Remove old transactions
    this.data.hyperliquidTransactions = this.data.hyperliquidTransactions.filter(tx => tx.timestamp >= cutoffTime);
    
    // Remove old trades
    this.data.trades = this.data.trades.filter(trade => trade.timestamp >= cutoffTime);
    
    // Remove old markets (keep only recent)
    this.data.markets = this.data.markets.filter(market => market.timestamp >= cutoffTime);
    
    const blocksRemoved = blocksBefore - this.data.blocks.length;
    const transactionsRemoved = transactionsBefore - this.data.hyperliquidTransactions.length;
    const tradesRemoved = tradesBefore - this.data.trades.length;
    const marketsRemoved = marketsBefore - this.data.markets.length;
    
    this.saveData();
    
    return {
      blocksRemoved,
      transactionsRemoved,
      tradesRemoved,
      marketsRemoved,
    };
  }

  // Statistics
  getStats() {
    const uniqueSymbols = new Set(this.data.markets.map((m) => m.symbol));
    const latestBlock = this.getLatestBlock();
    const uniqueUsers = new Set(this.data.hyperliquidTransactions.map(tx => tx.user));
    const actionTypes = new Set(this.data.hyperliquidTransactions.map(tx => tx.actionType));

    return {
      markets: uniqueSymbols.size,
      trades: this.data.trades.length,
      blocks: this.data.blocks.length,
      transactions: this.data.hyperliquidTransactions.length,
      uniqueUsers: uniqueUsers.size,
      actionTypes: Array.from(actionTypes),
      latestBlockNumber: latestBlock?.blockNumber || 0,
    };
  }

  close() {
    // JSON file storage doesn't need explicit closing
    this.saveData();
  }
}
