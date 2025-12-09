import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type { MarketData, Trade, OrderBook, BlockData, HyperliquidTransaction, Validator, Vault, Transfer } from './database.js';

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

export class FastHyperliquidDatabase {
  private dbPath: string;
  private dataDir: string;
  private data: DatabaseData;
  private saveTimer?: NodeJS.Timeout;
  private readonly SAVE_DELAY_MS = 100; // Batch writes every 100ms
  private isDirty = false;

  // In-memory indexes for fast lookups
  private blocksByNumber: Map<number, BlockData> = new Map();
  private transactionsByHash: Map<string, HyperliquidTransaction> = new Map();
  private marketsBySymbol: Map<string, MarketData> = new Map();
  private validatorsByAddress: Map<string, Validator> = new Map();
  private vaultsByAddress: Map<string, Vault> = new Map();
  private transfersByHash: Map<string, Transfer> = new Map();
  private recentBlocks: BlockData[] = [];
  private recentTransactions: HyperliquidTransaction[] = [];
  private recentValidators: Validator[] = [];
  private recentVaults: Vault[] = [];
  private recentTransfers: Transfer[] = [];

  constructor(dbPath: string) {
    this.dataDir = dirname(dbPath);
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }

    this.dbPath = dbPath;
    this.data = this.loadData();
    this.buildIndexes();
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
        console.log(`Loading database from ${this.dbPath}...`);
        const content = readFileSync(this.dbPath, 'utf-8');
        const loaded = JSON.parse(content);
        const result = {
          markets: loaded.markets || [],
          trades: loaded.trades || [],
          orderbooks: loaded.orderbooks || [],
          blocks: loaded.blocks || [],
          hyperliquidTransactions: loaded.hyperliquidTransactions || [],
          validators: loaded.validators || [],
          vaults: loaded.vaults || [],
          transfers: loaded.transfers || [],
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
        };
        console.log(`Loaded: ${result.blocks.length} blocks, ${result.hyperliquidTransactions.length} transactions, ${result.markets.length} markets, ${result.validators.length} validators, ${result.vaults.length} vaults, ${result.transfers.length} transfers`);
        return result;
      } catch (error: any) {
        console.error('Error loading database:', error?.message || error);
        console.error('Stack:', error?.stack);
      }
    }

    return defaultData;
  }

  private buildIndexes() {
    // Build fast lookup indexes
    this.blocksByNumber.clear();
    this.transactionsByHash.clear();
    this.marketsBySymbol.clear();
    this.validatorsByAddress.clear();
    this.vaultsByAddress.clear();
    this.transfersByHash.clear();

    for (const block of this.data.blocks) {
      this.blocksByNumber.set(block.blockNumber, block);
    }

    for (const tx of this.data.hyperliquidTransactions) {
      this.transactionsByHash.set(tx.hash, tx);
    }

    for (const market of this.data.markets) {
      this.marketsBySymbol.set(market.symbol, market);
    }

    for (const validator of this.data.validators) {
      this.validatorsByAddress.set(validator.address, validator);
    }

    for (const vault of this.data.vaults) {
      this.vaultsByAddress.set(vault.address, vault);
    }

    for (const transfer of this.data.transfers) {
      this.transfersByHash.set(transfer.hash, transfer);
    }

    // Build recent data caches (last hour)
    const now = Math.floor(Date.now() / 1000);
    const oneHourAgo = now - 3600;

    this.recentBlocks = this.data.blocks
      .filter(b => b.timestamp >= oneHourAgo && b.timestamp <= now + 3600)
      .sort((a, b) => b.timestamp - a.timestamp);

    this.recentTransactions = this.data.hyperliquidTransactions
      .filter(tx => tx.timestamp >= oneHourAgo && tx.timestamp <= now + 3600)
      .sort((a, b) => b.timestamp - a.timestamp);

    this.recentValidators = this.data.validators
      .filter(v => v.timestamp >= oneHourAgo && v.timestamp <= now + 3600)
      .sort((a, b) => b.timestamp - a.timestamp);

    this.recentVaults = this.data.vaults
      .filter(v => v.timestamp >= oneHourAgo && v.timestamp <= now + 3600)
      .sort((a, b) => b.timestamp - a.timestamp);

    this.recentTransfers = this.data.transfers
      .filter(t => t.timestamp >= oneHourAgo && t.timestamp <= now + 3600)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  private scheduleSave() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    this.isDirty = true;
    this.saveTimer = setTimeout(() => {
      this.flush();
    }, this.SAVE_DELAY_MS);
  }

  private flush() {
    if (!this.isDirty) return;

    try {
      writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), 'utf-8');
      this.isDirty = false;
    } catch (error) {
      console.error('Error saving database:', error);
    }
  }

  // Fast market methods
  insertMarketData(data: MarketData) {
    const existing = this.marketsBySymbol.get(data.symbol);
    if (existing) {
      const index = this.data.markets.findIndex(m => m.id === existing.id);
      if (index >= 0) {
        this.data.markets[index] = { ...data, id: existing.id };
        this.marketsBySymbol.set(data.symbol, this.data.markets[index]);
        this.scheduleSave();
        return;
      }
    }

    const newData: MarketData = {
      ...data,
      id: this.data.nextId.markets++,
    };
    this.data.markets.push(newData);
    this.marketsBySymbol.set(data.symbol, newData);
    this.scheduleSave();
  }

  getLatestMarketData(symbol?: string): MarketData[] {
    if (symbol) {
      const market = this.marketsBySymbol.get(symbol);
      return market ? [market] : [];
    }

    return Array.from(this.marketsBySymbol.values())
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  // Fast block methods
  insertBlock(block: BlockData) {
    const existing = this.blocksByNumber.get(block.blockNumber);
    if (existing) {
      // Update existing block
      const index = this.data.blocks.findIndex(b => b.id === existing.id);
      if (index >= 0) {
        this.data.blocks[index] = { ...block, id: existing.id };
        this.blocksByNumber.set(block.blockNumber, this.data.blocks[index]);
        this.updateRecentBlocks();
        this.scheduleSave();
        return;
      }
    }

    // Add new block
    const newBlock: BlockData = {
      ...block,
      id: this.data.nextId.blocks++,
    };
    this.data.blocks.push(newBlock);
    this.blocksByNumber.set(block.blockNumber, newBlock);
    this.updateRecentBlocks();
    this.scheduleSave();
    
    // Log for debugging
    if (this.data.blocks.length % 10 === 0) {
      console.log(`Total blocks in database: ${this.data.blocks.length}, Recent blocks: ${this.recentBlocks.length}`);
    }
  }

  private updateRecentBlocks() {
    const now = Math.floor(Date.now() / 1000);
    const twoHoursAgo = now - (2 * 3600); // 2 hours
    this.recentBlocks = this.data.blocks
      .filter(b => {
        let ts = b.timestamp;
        if (ts > 1e12) ts = Math.floor(ts / 1000); // Convert ms to seconds if needed
        return ts >= twoHoursAgo && ts <= now + 3600;
      })
      .sort((a, b) => {
        let aTs = a.timestamp;
        let bTs = b.timestamp;
        if (aTs > 1e12) aTs = Math.floor(aTs / 1000);
        if (bTs > 1e12) bTs = Math.floor(bTs / 1000);
        return bTs - aTs; // Newest first
      });
  }

  getLatestBlock(): BlockData | null {
    if (this.recentBlocks.length > 0) {
      return this.recentBlocks[0];
    }
    if (this.data.blocks.length === 0) return null;
    // Return the block with highest block number
    return this.data.blocks.reduce((latest, block) =>
      block.blockNumber > latest.blockNumber ? block : latest
    );
  }

  getBlocks(limit: number = 100): BlockData[] {
    // Return recent blocks if available, otherwise return all blocks sorted
    if (this.recentBlocks.length > 0) {
      return this.recentBlocks.slice(0, limit);
    }
    // Fallback to all blocks sorted by block number
    return this.data.blocks
      .sort((a, b) => b.blockNumber - a.blockNumber)
      .slice(0, limit);
  }

  // Fast transaction methods
  insertHyperliquidTransaction(tx: HyperliquidTransaction) {
    const existing = this.transactionsByHash.get(tx.hash);
    if (existing) {
      const index = this.data.hyperliquidTransactions.findIndex(t => t.id === existing.id);
      if (index >= 0) {
        this.data.hyperliquidTransactions[index] = { ...tx, id: existing.id };
        this.transactionsByHash.set(tx.hash, this.data.hyperliquidTransactions[index]);
        this.updateRecentTransactions();
        this.scheduleSave();
        return;
      }
    }

    const newTx: HyperliquidTransaction = {
      ...tx,
      id: this.data.nextId.hyperliquidTransactions++,
    };
    this.data.hyperliquidTransactions.push(newTx);
    this.transactionsByHash.set(tx.hash, newTx);
    this.updateRecentTransactions();
    this.scheduleSave();
  }

  private updateRecentTransactions() {
    const now = Math.floor(Date.now() / 1000);
    const oneHourAgo = now - 3600;
    this.recentTransactions = this.data.hyperliquidTransactions
      .filter(tx => tx.timestamp >= oneHourAgo && tx.timestamp <= now + 3600)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  getHyperliquidTransactions(limit: number = 100): HyperliquidTransaction[] {
    // Return recent transactions if available, otherwise return all sorted
    if (this.recentTransactions.length > 0) {
      return this.recentTransactions.slice(0, limit);
    }
    // Fallback to all transactions sorted by timestamp
    return this.data.hyperliquidTransactions
      .sort((a, b) => {
        let tsA = a.timestamp;
        let tsB = b.timestamp;
        if (tsA > 1e12) tsA = Math.floor(tsA / 1000);
        if (tsB > 1e12) tsB = Math.floor(tsB / 1000);
        return tsB - tsA;
      })
      .slice(0, limit);
  }

  // Fast trade methods
  insertTrade(trade: Trade) {
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
      this.scheduleSave();
    }
  }

  getRecentTrades(symbol?: string, limit: number = 100): Trade[] {
    let trades = this.data.trades;
    if (symbol) {
      trades = trades.filter((t) => t.symbol === symbol);
    }
    return trades.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }

  getMarketHistory(symbol: string, limit: number = 100): MarketData[] {
    return this.data.markets
      .filter((m) => m.symbol === symbol)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  getLatestOrderBook(symbol: string): OrderBook | null {
    const filtered = this.data.orderbooks
      .filter((ob) => ob.symbol === symbol)
      .sort((a, b) => b.timestamp - a.timestamp);
    return filtered.length > 0 ? filtered[0] : null;
  }

  getTransactionByHash(hash: string): HyperliquidTransaction | null {
    return this.transactionsByHash.get(hash) || null;
  }

  getTransactionsByUser(user: string, limit: number = 100): HyperliquidTransaction[] {
    return this.recentTransactions
      .filter(tx => tx.user.toLowerCase() === user.toLowerCase())
      .slice(0, limit);
  }

  getTransactionsByActionType(actionType: string, limit: number = 100): HyperliquidTransaction[] {
    return this.recentTransactions
      .filter(tx => tx.actionType === actionType)
      .slice(0, limit);
  }

  // Validator methods
  insertValidator(validator: Validator) {
    const existing = this.validatorsByAddress.get(validator.address);
    if (existing) {
      // Update existing
      Object.assign(existing, validator);
    } else {
      // Add new
      validator.id = this.data.nextId.validators++;
      this.data.validators.push(validator);
      this.validatorsByAddress.set(validator.address, validator);
    }

    // Update recent cache
    const now = Math.floor(Date.now() / 1000);
    const oneHourAgo = now - 3600;
    if (validator.timestamp >= oneHourAgo) {
      const idx = this.recentValidators.findIndex(v => v.address === validator.address);
      if (idx >= 0) {
        this.recentValidators[idx] = validator;
      } else {
        this.recentValidators.push(validator);
      }
      this.recentValidators.sort((a, b) => b.timestamp - a.timestamp);
    }

    this.scheduleSave();
  }

  getValidators(limit: number = 100): Validator[] {
    return this.recentValidators.slice(0, limit);
  }

  getValidatorByAddress(address: string): Validator | null {
    return this.validatorsByAddress.get(address) || null;
  }

  // Vault methods
  insertVault(vault: Vault) {
    const existing = this.vaultsByAddress.get(vault.address);
    if (existing) {
      // Update existing
      Object.assign(existing, vault);
    } else {
      // Add new
      vault.id = this.data.nextId.vaults++;
      this.data.vaults.push(vault);
      this.vaultsByAddress.set(vault.address, vault);
    }

    // Update recent cache
    const now = Math.floor(Date.now() / 1000);
    const oneHourAgo = now - 3600;
    if (vault.timestamp >= oneHourAgo) {
      const idx = this.recentVaults.findIndex(v => v.address === vault.address);
      if (idx >= 0) {
        this.recentVaults[idx] = vault;
      } else {
        this.recentVaults.push(vault);
      }
      this.recentVaults.sort((a, b) => b.timestamp - a.timestamp);
    }

    this.scheduleSave();
  }

  getVaults(limit: number = 100): Vault[] {
    return this.recentVaults.slice(0, limit);
  }

  getVaultByAddress(address: string): Vault | null {
    return this.vaultsByAddress.get(address) || null;
  }

  // Transfer methods
  insertTransfer(transfer: Transfer) {
    if (this.transfersByHash.has(transfer.hash)) {
      return; // Already exists
    }

    transfer.id = this.data.nextId.transfers++;
    this.data.transfers.push(transfer);
    this.transfersByHash.set(transfer.hash, transfer);

    // Update recent cache
    const now = Math.floor(Date.now() / 1000);
    const oneHourAgo = now - 3600;
    if (transfer.timestamp >= oneHourAgo) {
      this.recentTransfers.push(transfer);
      this.recentTransfers.sort((a, b) => b.timestamp - a.timestamp);
      // Keep only last 1000 transfers in cache
      if (this.recentTransfers.length > 1000) {
        this.recentTransfers = this.recentTransfers.slice(0, 1000);
      }
    }

    this.scheduleSave();
  }

  getTransfers(limit: number = 100): Transfer[] {
    return this.recentTransfers.slice(0, limit);
  }

  getTransferByHash(hash: string): Transfer | null {
    return this.transfersByHash.get(hash) || null;
  }

  // Stats
  getStats() {
    const now = Math.floor(Date.now() / 1000);
    const oneDayAgo = now - (24 * 3600);

    const recentBlocks = this.data.blocks.filter(b => {
      let ts = b.timestamp;
      if (ts > 1e12) ts = Math.floor(ts / 1000);
      return ts >= oneDayAgo && ts <= now + 3600;
    });
    const recentTxs = this.data.hyperliquidTransactions.filter(tx => {
      let ts = tx.timestamp;
      if (ts > 1e12) ts = Math.floor(ts / 1000);
      return ts >= oneDayAgo && ts <= now + 3600;
    });

    const uniqueUsers = new Set(recentTxs.map(tx => tx.user)).size;
    const actionTypes = Array.from(new Set(recentTxs.map(tx => tx.actionType)));

    const latestBlock = recentBlocks.length > 0
      ? recentBlocks.reduce((latest, block) =>
          block.blockNumber > latest.blockNumber ? block : latest
        )
      : null;

    return {
      markets: this.data.markets.length,
      trades: this.data.trades.length,
      blocks: recentBlocks.length,
      transactions: recentTxs.length,
      uniqueUsers,
      actionTypes,
      latestBlockNumber: latestBlock?.blockNumber || 0,
    };
  }

  // Cleanup methods
  clearOldData(hoursOld: number) {
    const cutoffTime = Math.floor(Date.now() / 1000) - (hoursOld * 3600);
    
    const blocksBefore = this.data.blocks.length;
    this.data.blocks = this.data.blocks.filter(block => block.timestamp >= cutoffTime);
    this.blocksByNumber.clear();
    for (const block of this.data.blocks) {
      this.blocksByNumber.set(block.blockNumber, block);
    }

    const txsBefore = this.data.hyperliquidTransactions.length;
    this.data.hyperliquidTransactions = this.data.hyperliquidTransactions.filter(
      tx => tx.timestamp >= cutoffTime
    );
    this.transactionsByHash.clear();
    for (const tx of this.data.hyperliquidTransactions) {
      this.transactionsByHash.set(tx.hash, tx);
    }

    this.data.validators = this.data.validators.filter(v => v.timestamp >= cutoffTime);
    this.validatorsByAddress.clear();
    for (const validator of this.data.validators) {
      this.validatorsByAddress.set(validator.address, validator);
    }

    this.data.vaults = this.data.vaults.filter(v => v.timestamp >= cutoffTime);
    this.vaultsByAddress.clear();
    for (const vault of this.data.vaults) {
      this.vaultsByAddress.set(vault.address, vault);
    }

    this.data.transfers = this.data.transfers.filter(t => t.timestamp >= cutoffTime);
    this.transfersByHash.clear();
    for (const transfer of this.data.transfers) {
      this.transfersByHash.set(transfer.hash, transfer);
    }

    this.buildIndexes();
    this.flush();

    return {
      blocksRemoved: blocksBefore - this.data.blocks.length,
      transactionsRemoved: txsBefore - this.data.hyperliquidTransactions.length,
    };
  }

  clearAllData() {
    this.data = {
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
    this.buildIndexes();
    this.flush();
    return {
      blocks: 0,
      transactions: 0,
      markets: 0,
      trades: 0,
    };
  }

  close() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.flush();
  }

  // Expose raw data for compatibility (read-only)
  get rawData() {
    return this.data;
  }
}

