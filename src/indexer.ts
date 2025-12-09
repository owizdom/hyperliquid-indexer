import { BlockData, HyperliquidTransaction, Validator, Vault, Transfer } from './database.js';
import { FastHyperliquidDatabase } from './database-fast.js';
import { HyperliquidSDKClient } from './hyperliquid-sdk-client.js';
import { HypurrscanClient } from './hypurrscan-client.js';
import dotenv from 'dotenv';

dotenv.config();

export class HyperliquidIndexer {
  private db: FastHyperliquidDatabase;
  private sdkClient: HyperliquidSDKClient;
  private hypurrscanClient: HypurrscanClient;
  private isRunning: boolean = false;
  private intervalId?: ReturnType<typeof setInterval>;
  private latestIndexedBlock: number = 0;

  constructor() {
    const dbPath = process.env.DATABASE_PATH || './data/hyperliquid.json';
    this.db = new FastHyperliquidDatabase(dbPath);
    this.sdkClient = new HyperliquidSDKClient();
    this.hypurrscanClient = new HypurrscanClient();
    
    // Always start fresh - don't use stored blocks, always fetch real-time from API
    this.latestIndexedBlock = 0;
  }

  async start(intervalMs: number = 10000) {
    if (this.isRunning) {
      console.log('Indexer is already running');
      return;
    }

    this.isRunning = true;
    console.log('Starting Hyperliquid L1 Blockchain Indexer...');

    // Initial index
    await this.index();

    // Set up periodic indexing
    this.intervalId = setInterval(async () => {
      try {
        await this.index();
      } catch (error) {
        console.error('Error during indexing:', error);
      }
    }, intervalMs);

    console.log(`Indexer running. Updating every ${intervalMs / 1000} seconds.`);
  }

  stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    console.log('Indexer stopped');
  }

  async index() {
    try {
      // Clean up old data periodically (10% chance each run to avoid overhead)
      if (Math.random() < 0.1) {
        this.db.clearOldData(1); // Clear data older than 1 hour
      }

      // Index transactions from Hypurrscan API (fast, real-time source)
      await this.indexHypurrscanTransactions();

      // Index Hyperliquid L1 blocks and transactions (most important)
      await this.indexHyperliquidBlocks();

      // Index market data
      await this.indexMarkets();

      // Index recent trades
      await this.indexRecentTrades();

      // Index validators
      await this.indexValidators();

      // Index vaults
      await this.indexVaults();

      // Index transfers
      await this.indexTransfers();
    } catch (error: any) {
      console.error('Indexing error:', error?.message || error);
      console.error('Stack:', error?.stack);
      // Don't throw - continue indexing even if one part fails
    }
  }

  /**
   * Index transactions from Hypurrscan API
   * This provides fast, real-time transaction data
   */
  private async indexHypurrscanTransactions() {
    try {
      const transactions = await this.hypurrscanClient.getAllRecentTxs();
      
      if (transactions.length === 0) {
        return;
      }

      console.log(`Fetched ${transactions.length} transactions from Hypurrscan API`);

      let indexedTxs = 0;
      const processedBlocks = new Set<number>();

      // First, check which blocks we already have
      const existingBlocks = new Map<number, string>();
      const allBlocks = this.db.getBlocks(10000); // Get all blocks
      for (const block of allBlocks) {
        existingBlocks.set(block.blockNumber, block.blockHash);
      }

      for (const hypTx of transactions) {
        try {
          // Get block hash if we already have this block
          const blockHash = existingBlocks.get(hypTx.block) || '';

          // Convert Hypurrscan transaction format to our format
          const hyperliquidTx: HyperliquidTransaction = {
            hash: hypTx.hash,
            blockNumber: hypTx.block,
            blockHash: blockHash, // Use existing hash if available
            timestamp: hypTx.time,
            user: hypTx.user,
            actionType: hypTx.action?.type || 'unknown',
            actionData: JSON.stringify(hypTx.action || {}),
            error: hypTx.error,
            data: JSON.stringify(hypTx),
          };

          // Insert transaction (database handles duplicates automatically)
          this.db.insertHyperliquidTransaction(hyperliquidTx);
          indexedTxs++;

          // Track blocks we need to fetch (only if we don't have them)
          if (hypTx.block > 0 && !existingBlocks.has(hypTx.block)) {
            processedBlocks.add(hypTx.block);
          }

          // Minimal delay for millisecond-level updates
          await new Promise(resolve => setTimeout(resolve, 5));
        } catch (error) {
          // Continue with next transaction
          continue;
        }
      }

      // Fetch block details for blocks we haven't indexed yet
      for (const blockNum of processedBlocks) {
        try {
          // Fetch block details from SDK
          const blockDetails = await this.sdkClient.getBlockDetails(blockNum);
          
          if (blockDetails) {
            const blockData: BlockData = {
              blockNumber: blockDetails.height,
              blockHash: blockDetails.hash,
              timestamp: blockDetails.blockTime,
              txCount: blockDetails.numTxs,
              proposer: blockDetails.proposer,
              data: JSON.stringify(blockDetails),
            };

            // Insert block (database handles duplicates automatically)
            this.db.insertBlock(blockData);

            // Update latest indexed block
            if (blockDetails.height > this.latestIndexedBlock) {
              this.latestIndexedBlock = blockDetails.height;
            }

            // Update block hash in transactions for this block
            // Access raw data to update all transactions, not just recent ones
            const rawData = this.db.rawData;
            if (rawData?.hyperliquidTransactions) {
              const txsForBlock = rawData.hyperliquidTransactions.filter(
                (tx: HyperliquidTransaction) => tx.blockNumber === blockNum && (!tx.blockHash || tx.blockHash === '')
              );
              for (const tx of txsForBlock) {
                tx.blockHash = blockDetails.hash;
                // Re-insert to update (this will save the data)
                this.db.insertHyperliquidTransaction(tx);
              }
            }
          }

          // Small delay between block fetches
          await new Promise(resolve => setTimeout(resolve, 50));
        } catch (error) {
          // Continue with next block
          continue;
        }
      }

      if (indexedTxs > 0) {
        console.log(`Indexed ${indexedTxs} new transactions from Hypurrscan, processed ${processedBlocks.size} blocks`);
      }
    } catch (error) {
      console.error('Error indexing Hypurrscan transactions:', error);
    }
  }

  private async indexHyperliquidBlocks() {
    try {
      // Always fetch the latest block height from API (real-time)
      const latestBlockHeight = await this.getLatestBlockHeight();
      
      if (latestBlockHeight === 0) {
        console.log('Could not determine latest block height');
        return;
      }

      // Get the latest block we've indexed
      const latestStored = this.db.getLatestBlock();
      const startBlock = latestStored && latestStored.blockNumber > 0 
        ? latestStored.blockNumber + 1 
        : Math.max(1, latestBlockHeight - 10);
      
      const endBlock = latestBlockHeight;

      if (startBlock > endBlock) {
        // No new blocks to index
        return;
      }

      // Limit to max 10 blocks per cycle
      const actualEndBlock = Math.min(endBlock, startBlock + 9);

      let indexedBlocks = 0;
      let indexedTransactions = 0;

      // Index blocks one at a time with minimal delay for real-time updates
      for (let blockNum = startBlock; blockNum <= actualEndBlock; blockNum++) {
        const result = await this.indexSingleHyperliquidBlock(blockNum);
        
        if (result) {
          indexedBlocks++;
          indexedTransactions += result.txCount;
          if (result.blockNumber > this.latestIndexedBlock) {
            this.latestIndexedBlock = result.blockNumber;
          }
        }
        
        // Minimal delay for millisecond-level updates
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      if (indexedBlocks > 0) {
        console.log(`Indexed ${indexedBlocks} blocks with ${indexedTransactions} transactions (blocks ${startBlock}-${actualEndBlock}, latest: ${latestBlockHeight})`);
      }
    } catch (error: any) {
      console.error('Error indexing blocks:', error?.message || error);
    }
  }

  private async indexSingleHyperliquidBlock(blockHeight: number): Promise<{ blockNumber: number; txCount: number } | null> {
    try {
      const blockDetails = await this.sdkClient.getBlockDetails(blockHeight);
      
      if (!blockDetails) {
        return null;
      }

      // Only index blocks from the last 2 hours to avoid archived block errors
      // But be more lenient to catch recent blocks
      const now = Math.floor(Date.now() / 1000); // Current time in seconds
      const blockAge = now - blockDetails.blockTime; // Age in seconds
      const twoHoursInSeconds = 2 * 60 * 60; // 2 hours
      
      // Allow blocks from last 2 hours (recent) to avoid archived block API limits
      // Also allow slightly future blocks (clock skew)
      if (blockAge > twoHoursInSeconds || blockAge < -3600) {
        return null;
      }

      // Store block data
      const blockData: BlockData = {
        blockNumber: blockDetails.height,
        blockHash: blockDetails.hash,
        timestamp: blockDetails.blockTime,
        txCount: blockDetails.numTxs,
        proposer: blockDetails.proposer,
        data: JSON.stringify(blockDetails),
      };

      this.db.insertBlock(blockData);

      // Index all transactions in the block
      for (const tx of blockDetails.txs) {
        const hyperliquidTx: HyperliquidTransaction = {
          hash: tx.hash,
          blockNumber: blockDetails.height,
          blockHash: blockDetails.hash,
          timestamp: tx.time,
          user: tx.user,
          actionType: tx.action?.type || 'unknown',
          actionData: JSON.stringify(tx.action || {}),
          error: tx.error,
          data: JSON.stringify(tx),
        };

        this.db.insertHyperliquidTransaction(hyperliquidTx);
      }

      return { blockNumber: blockDetails.height, txCount: blockDetails.numTxs };
    } catch (error) {
      return null;
    }
  }

  private async getLatestBlockHeight(): Promise<number> {
    try {
      // Start from the latest block we've queried/indexed (from database)
      const latestStored = this.db.getLatestBlock();
      let startFrom = 0;
      
      // Use stored block as starting point if it exists and is recent
      if (latestStored) {
        const now = Math.floor(Date.now() / 1000);
        let blockTimestamp = latestStored.timestamp;
        if (blockTimestamp > 1e12) {
          blockTimestamp = Math.floor(blockTimestamp / 1000);
        }
        const blockAge = now - blockTimestamp;
        // Use stored block if it's less than 2 hours old (recent)
        if (blockAge < (2 * 3600) && blockAge >= 0 && latestStored.blockNumber > 822800000) {
          startFrom = latestStored.blockNumber;
        }
      }
      
      // If no recent stored block, start from a safe default
      if (startFrom === 0) {
        startFrom = 822890000; // Safe default for current Hyperliquid blocks
      }
      
      // Check forward from the latest queried block to find the actual latest block
      // Only check recent blocks (within last 2 hours) to avoid archived block errors
      let currentLatest = startFrom;
      const now = Math.floor(Date.now() / 1000);
      
      // Check up to 30 blocks ahead to find the latest
      for (let i = 1; i <= 30; i++) {
        const testBlock = startFrom + i;
        try {
          const result = await this.sdkClient.getBlockDetails(testBlock);
          if (result) {
            // Verify block is recent (within last 2 hours)
            const blockAge = now - result.blockTime;
            if (blockAge < (2 * 3600) && blockAge >= -3600) {
              currentLatest = testBlock;
            } else {
              // Block is too old, we've found the latest
              break;
            }
          } else {
            // Block doesn't exist yet, we've found the latest
            break;
          }
        } catch (error: any) {
          // If it's an archived block error, we've gone too far
          if (error?.message?.includes('archived') || error?.response?.data?.includes('archived')) {
            break;
          }
          // Other error, stop checking
          break;
        }
        
        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      return currentLatest;
    } catch (error) {
      // Fallback: use stored block or safe default
      const latestStored = this.db.getLatestBlock();
      if (latestStored && latestStored.blockNumber > 822800000) {
        return latestStored.blockNumber;
      }
      return 822890000; // Safe fallback
    }
  }

  private async indexMarkets() {
    try {
      const mids = await this.sdkClient.getAllMids();
      let meta;
      try {
        meta = await this.sdkClient.getMeta();
      } catch (error: any) {
        console.error('Error fetching meta for markets:', error?.message || error);
        return;
      }
      
      if (!meta || !meta.universe || meta.universe.length === 0) {
        return;
      }
      
      let indexedCount = 0;
      
      for (const market of meta.universe) {
        if (market.isDelisted) {
          continue;
        }

        const price = mids && mids[market.name] ? parseFloat(String(mids[market.name])) : 0;

        const marketData = {
          symbol: market.name,
          price: isNaN(price) ? 0 : price,
          volume24h: 0,
          change24h: 0,
          timestamp: Date.now(),
        };

        this.db.insertMarketData(marketData);
        indexedCount++;
      }
      
      if (indexedCount > 0) {
        console.log(`Indexed ${indexedCount} markets`);
      }
    } catch (error: any) {
      console.error('Error indexing markets:', error?.message || error);
    }
  }

  private async indexRecentTrades() {
    try {
      let meta;
      try {
        meta = await this.sdkClient.getMeta();
      } catch (error: any) {
        console.error('Error fetching meta for trades:', error?.message || error);
        return;
      }
      
      if (!meta || !meta.universe || meta.universe.length === 0) {
        return;
      }
      
      const activeMarkets = meta.universe.filter((m: any) => !m.isDelisted).slice(0, 20);
      let totalTradesIndexed = 0;
      
      for (const market of activeMarkets) {
        try {
          const trades = await this.sdkClient.getRecentTrades(market.name);
          
          if (!trades || !Array.isArray(trades)) {
            continue;
          }
          
          for (const trade of trades) {
            if (!trade || !trade.px || !trade.sz) {
              continue;
            }
            
            const tradeData = {
              symbol: trade.coin || market.name,
              price: parseFloat(trade.px),
              size: parseFloat(trade.sz),
              side: (trade.side === 'B') ? 'buy' : 'sell' as 'buy' | 'sell',
              timestamp: trade.time || Date.now(),
              txHash: trade.hash || '',
            };

            this.db.insertTrade(tradeData);
            totalTradesIndexed++;
          }
          
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error: any) {
          continue;
        }
      }
      
      if (totalTradesIndexed > 0) {
        console.log(`Indexed ${totalTradesIndexed} trades`);
      }
    } catch (error: any) {
      console.error('Error indexing trades:', error?.message || error);
    }
  }

  private async indexValidators() {
    try {
      const validators = await this.sdkClient.getValidatorSummaries();
      
      if (!validators || !Array.isArray(validators) || validators.length === 0) {
        return;
      }

      let indexedCount = 0;
      const now = Math.floor(Date.now() / 1000);

      for (const validator of validators) {
        if (!validator || !validator.validator) {
          continue;
        }

        // Extract uptime from stats (day stats)
        let uptime = 0;
        if (validator.stats && Array.isArray(validator.stats)) {
          const dayStats = validator.stats.find((s: any) => s[0] === 'day');
          if (dayStats && dayStats[1]?.uptimeFraction) {
            uptime = parseFloat(dayStats[1].uptimeFraction) * 100;
          }
        }

        // Calculate voting power from stake (stake is in wei, convert to readable)
        const stake = validator.stake ? parseFloat(String(validator.stake)) : 0;
        const votingPower = stake / 1e18; // Convert from wei

        const validatorData = {
          address: validator.validator,
          votingPower: votingPower,
          status: validator.isJailed ? 'jailed' : (validator.isActive ? 'active' : 'inactive'),
          uptime: uptime,
          timestamp: now,
          data: JSON.stringify(validator),
        };

        this.db.insertValidator(validatorData);
        indexedCount++;
      }

      if (indexedCount > 0) {
        console.log(`Indexed ${indexedCount} validators`);
      }
    } catch (error: any) {
      console.error('Error indexing validators:', error?.message || error);
    }
  }

  private async indexVaults() {
    try {
      const vaults = await this.sdkClient.getVaultSummaries();
      
      if (!vaults || !Array.isArray(vaults) || vaults.length === 0) {
        // Vaults may be empty (only shows vaults less than 2 hours old)
        return;
      }

      let indexedCount = 0;
      const now = Math.floor(Date.now() / 1000);

      for (const vault of vaults) {
        if (!vault || !vault.vaultAddress) {
          continue;
        }

        // Map vault data from API response
        const vaultData = {
          address: vault.vaultAddress,
          name: vault.name || '',
          equity: parseFloat(vault.equity || '0'),
          totalDeposits: parseFloat(vault.totalDeposits || '0'),
          totalWithdrawals: parseFloat(vault.totalWithdrawals || '0'),
          timestamp: now,
          data: JSON.stringify(vault),
        };

        this.db.insertVault(vaultData);
        indexedCount++;
      }

      if (indexedCount > 0) {
        console.log(`Indexed ${indexedCount} vaults`);
      }
    } catch (error: any) {
      console.error('Error indexing vaults:', error?.message || error);
    }
  }

  private async indexTransfers() {
    try {
      const transfers = await this.hypurrscanClient.getTransfers();
      
      if (transfers.length === 0) {
        return;
      }

      let indexedCount = 0;

      for (const transfer of transfers) {
        if (!transfer || !transfer.hash || !transfer.action) {
          continue;
        }

        const action = transfer.action;
        const token = action.token || '';
        const amount = parseFloat(action.amount || action.wei || '0');
        
        // Convert wei to token amount if needed
        const finalAmount = action.wei ? amount / 1e18 : amount;

        const transferData = {
          hash: transfer.hash,
          blockNumber: transfer.block || 0,
          timestamp: Math.floor(transfer.time / 1000), // Convert ms to seconds
          from: transfer.user || '',
          to: action.destination || '',
          token: token,
          amount: finalAmount,
          data: JSON.stringify(transfer),
        };

        this.db.insertTransfer(transferData);
        indexedCount++;
      }

      if (indexedCount > 0) {
        console.log(`Indexed ${indexedCount} transfers`);
      }
    } catch (error: any) {
      // Silently fail
    }
  }

  getDatabase(): FastHyperliquidDatabase {
    return this.db;
  }

  getSDKClient(): HyperliquidSDKClient {
    return this.sdkClient;
  }

  close() {
    this.stop();
    this.db.close();
  }
}

// CLI entry point - removed, use cli.ts or index.ts instead
