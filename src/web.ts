import express, { Request, Response } from 'express';
import expressWs from 'express-ws';
import { WebSocket } from 'ws';
import { HyperliquidSDKClient } from './hyperliquid-sdk-client.js';
import { HypurrscanClient } from './hypurrscan-client.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const wsInstance = expressWs(app);
const PORT = process.env.PORT || 3000;

// Get the app with WebSocket support
const wsApp = wsInstance.app;

// Store WebSocket connections for broadcasting
const wsClients: Set<WebSocket> = new Set<WebSocket>();

// Middleware
app.use(express.json());
app.use(express.static(join(__dirname, '../public')));

// Initialize API clients (no database)
const sdkClient = new HyperliquidSDKClient();
const hypurrscanClient = new HypurrscanClient();

// Track latest data for WebSocket updates (in-memory cache only)
let latestBlockHeight = 0;
let latestBlockData: any = null;
let latestTransactions: any[] = [];
let latestValidators: any[] = [];
let latestVaults: any[] = [];
let latestTransfers: any[] = [];
let lastBroadcastBlockNumber = 0;
let lastBroadcastTxHash = '';

// Cumulative stats tracking
let totalBlocksSeen = 0;
let totalTransactionsSeen = 0;
let uniqueUsersSet = new Set<string>();
let seenBlockNumbers = new Set<number>();
let seenTransactionHashes = new Set<string>();

// Function to broadcast updates to all connected clients
function broadcastUpdate(type: string, data: any) {
  const message = JSON.stringify({ type, data, timestamp: Date.now() });
  wsClients.forEach((ws) => {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(message);
    }
  });
}

// Helper functions to fetch data directly from APIs
async function getLatestBlockFromAPI(): Promise<any> {
  try {
    // Get recent transactions from Hypurrscan to find the latest block number
    const transactions = await hypurrscanClient.getAllRecentTxs();
    
    if (transactions && transactions.length > 0) {
      // Find the highest block number from recent transactions
      let maxBlock = 0;
      const now = Math.floor(Date.now() / 1000);
      
      for (const tx of transactions) {
        if (tx.block && tx.block > maxBlock) {
          const txTime = Math.floor(tx.time / 1000);
          const txAge = now - txTime;
          // Only consider transactions from last hour
          if (txAge < 3600 && txAge >= 0) {
            maxBlock = tx.block;
          }
        }
      }
      
      if (maxBlock > 0) {
        // Try to get block details for the highest block found
        try {
          const blockDetails = await Promise.race([
            sdkClient.getBlockDetails(maxBlock),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
          ]) as any;
          
          if (blockDetails && blockDetails.height) {
            latestBlockHeight = blockDetails.height;
            return {
              blockNumber: blockDetails.height,
              blockHash: blockDetails.hash,
              timestamp: blockDetails.blockTime,
              txCount: blockDetails.numTxs,
              proposer: blockDetails.proposer,
            };
          }
        } catch (error) {
          // If we can't get block details, still use the block number from transactions
          if (maxBlock > latestBlockHeight) {
            latestBlockHeight = maxBlock;
          }
        }
        
        // Fallback: return block info from transaction data
        const latestTx = transactions.find(tx => tx.block === maxBlock);
        if (latestTx) {
          latestBlockHeight = maxBlock;
          return {
            blockNumber: maxBlock,
            blockHash: '0x' + '0'.repeat(64), // Placeholder - we don't have hash from tx
            timestamp: Math.floor(latestTx.time / 1000),
            txCount: transactions.filter(tx => tx.block === maxBlock).length,
            proposer: '',
          };
        }
      }
    }
    
    // If no recent transactions, try checking forward from last known block
    if (latestBlockHeight > 0) {
      const now = Math.floor(Date.now() / 1000);
      for (let i = 0; i <= 10; i++) {
        const testBlock = latestBlockHeight + i;
        try {
          const blockDetails = await Promise.race([
            sdkClient.getBlockDetails(testBlock),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500))
          ]) as any;
          
          if (blockDetails && blockDetails.height && blockDetails.blockTime) {
            const blockAge = now - blockDetails.blockTime;
            if (blockAge < 3600 && blockAge >= -3600) {
              latestBlockHeight = blockDetails.height;
              return {
                blockNumber: blockDetails.height,
                blockHash: blockDetails.hash,
                timestamp: blockDetails.blockTime,
                txCount: blockDetails.numTxs,
                proposer: blockDetails.proposer,
              };
            }
          }
        } catch (error) {
          // Continue checking
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

async function getRecentBlocksFromAPI(limit: number): Promise<any[]> {
  try {
    // Get recent transactions to extract block numbers
    const transactions = await Promise.race([
      hypurrscanClient.getAllRecentTxs(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))
    ]) as any[];
    
    if (!transactions || transactions.length === 0) {
      return [];
    }
    
    // Group transactions by block number
    const blockMap = new Map<number, any[]>();
    const now = Math.floor(Date.now() / 1000);
    
    for (const tx of transactions) {
      if (tx.block && tx.time) {
        const txTime = Math.floor(tx.time / 1000);
        const txAge = now - txTime;
        // Only include transactions from last hour
        if (txAge < 3600 && txAge >= 0) {
          if (!blockMap.has(tx.block)) {
            blockMap.set(tx.block, []);
          }
          blockMap.get(tx.block)!.push(tx);
        }
      }
    }
    
    if (blockMap.size === 0) {
      return [];
    }
    
    // Get unique block numbers and sort them
    const blockNumbers = Array.from(blockMap.keys()).sort((a, b) => b - a).slice(0, limit);
    
    const blocks: any[] = [];
    
    // For each block, try to get full details, or construct from transactions
    for (const blockNum of blockNumbers) {
      try {
        const blockDetails = await Promise.race([
          sdkClient.getBlockDetails(blockNum),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500))
        ]) as any;
        
        if (blockDetails && blockDetails.height) {
          blocks.push({
            blockNumber: blockDetails.height,
            blockHash: blockDetails.hash,
            timestamp: blockDetails.blockTime,
            txCount: blockDetails.numTxs,
            proposer: blockDetails.proposer,
          });
        } else {
          // Fallback: construct from transaction data
          const blockTxs = blockMap.get(blockNum) || [];
          if (blockTxs.length > 0) {
            const latestTx = blockTxs[0];
            blocks.push({
              blockNumber: blockNum,
              blockHash: '0x' + '0'.repeat(64), // Placeholder
              timestamp: Math.floor(latestTx.time / 1000),
              txCount: blockTxs.length,
              proposer: '',
            });
          }
        }
      } catch (error) {
        // Fallback: construct from transaction data
        const blockTxs = blockMap.get(blockNum) || [];
        if (blockTxs.length > 0) {
          const latestTx = blockTxs[0];
          blocks.push({
            blockNumber: blockNum,
            blockHash: '0x' + '0'.repeat(64), // Placeholder
            timestamp: Math.floor(latestTx.time / 1000),
            txCount: blockTxs.length,
            proposer: '',
          });
        }
      }
      
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    // Update latest block height
    if (blocks.length > 0 && blocks[0].blockNumber > latestBlockHeight) {
      latestBlockHeight = blocks[0].blockNumber;
    }
    
    return blocks.sort((a, b) => b.blockNumber - a.blockNumber);
  } catch (error) {
    return [];
  }
}

async function getRecentTransactionsFromAPI(limit: number): Promise<any[]> {
  try {
    const transactions = await hypurrscanClient.getAllRecentTxs();
    return transactions
      .slice(0, limit)
      .map((tx: any) => ({
        hash: tx.hash,
        blockNumber: tx.block,
        timestamp: Math.floor(tx.time / 1000),
        user: tx.user,
        actionType: tx.action?.type || 'unknown',
        error: tx.error,
      }))
      .sort((a: any, b: any) => b.timestamp - a.timestamp);
  } catch (error) {
    return [];
  }
}

function formatValidators(validators: any[]): any[] {
  if (!validators || !Array.isArray(validators)) {
    return [];
  }
  const now = Math.floor(Date.now() / 1000);
  return validators.map((v: any) => {
    if (!v) return null;
    let uptime = 0;
    if (v.stats && Array.isArray(v.stats)) {
      const dayStats = v.stats.find((s: any) => s[0] === 'day');
      if (dayStats && dayStats[1]?.uptimeFraction) {
        uptime = parseFloat(dayStats[1].uptimeFraction) * 100;
      }
    }
    const stake = v.stake ? parseFloat(String(v.stake)) : 0;
    return {
      address: v.validator || v.address || '',
      votingPower: stake / 1e18,
      status: v.isJailed ? 'jailed' : (v.isActive ? 'active' : 'inactive'),
      uptime: uptime,
      timestamp: now,
    };
  }).filter(v => v !== null);
}

function formatVaults(vaults: any[]): any[] {
  if (!vaults || !Array.isArray(vaults)) {
    return [];
  }
  const now = Math.floor(Date.now() / 1000);
  return vaults.map((v: any) => {
    if (!v) return null;
    return {
      address: v.vaultAddress || v.address || '',
      name: v.name || '',
      equity: parseFloat(v.equity || '0'),
      totalDeposits: parseFloat(v.totalDeposits || '0'),
      totalWithdrawals: parseFloat(v.totalWithdrawals || '0'),
      timestamp: now,
    };
  }).filter(v => v !== null);
}

function formatTransfers(transfers: any[]): any[] {
  return transfers.map((t: any) => {
    const action = t.action;
    const token = action.token || '';
    const amount = parseFloat(action.amount || action.wei || '0');
    const finalAmount = action.wei ? amount / 1e18 : amount;
    return {
      hash: t.hash,
      blockNumber: t.block || 0,
      timestamp: Math.floor(t.time / 1000),
      from: t.user || '',
      to: action.destination || '',
      token: token,
      amount: finalAmount,
    };
  }).sort((a: any, b: any) => b.timestamp - a.timestamp);
}

// API Routes

// Health check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Statistics - calculated from real-time API data (cumulative)
app.get('/api/stats', async (req: Request, res: Response) => {
  try {
    res.json({
      blocks: totalBlocksSeen,
      transactions: totalTransactionsSeen,
      uniqueUsers: uniqueUsersSet.size,
      latestBlockNumber: latestBlockData?.blockNumber || 0,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get statistics', message: error?.message });
  }
});

// Blocks - fetch directly from API
app.get('/api/blocks', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const blocks = await getRecentBlocksFromAPI(limit);
    res.json(blocks);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get blocks', message: error?.message });
  }
});

// Latest block - fetch directly from API
app.get('/api/blocks/latest', async (req: Request, res: Response) => {
  try {
    const block = await getLatestBlockFromAPI();
    if (!block) {
      return res.status(404).json({ error: 'No blocks found' });
    }
    res.json(block);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get latest block', message: error?.message });
  }
});

// Transactions - fetch directly from Hypurrscan API
app.get('/api/transactions', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const transactions = await getRecentTransactionsFromAPI(limit);
    res.json(transactions);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get transactions', message: error?.message });
  }
});

// Transaction by hash - fetch directly from API
app.get('/api/transactions/:hash', async (req: Request, res: Response) => {
  try {
    const hash = req.params.hash;
    const transaction = await sdkClient.getTransactionDetails(hash);
    
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    
    res.json(transaction);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get transaction', message: error?.message });
  }
});

// Validators - fetch directly from API
app.get('/api/validators', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const validators = await Promise.race([
      sdkClient.getValidatorSummaries(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
    ]) as any[];
    
    if (!validators || validators.length === 0) {
      return res.json([]);
    }
    
    const formatted = formatValidators(validators).slice(0, limit);
    res.json(formatted);
  } catch (error: any) {
    console.error('Error getting validators:', error?.message || error);
    res.json([]); // Return empty array instead of error
  }
});

// Vaults - fetch directly from API
app.get('/api/vaults', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const vaults = await Promise.race([
      sdkClient.getVaultSummaries(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
    ]) as any[];
    
    if (!vaults || vaults.length === 0) {
      return res.json([]);
    }
    
    const formatted = formatVaults(vaults).slice(0, limit);
    res.json(formatted);
  } catch (error: any) {
    console.error('Error getting vaults:', error?.message || error);
    res.json([]); // Return empty array instead of error
  }
});

// Transfers - fetch directly from Hypurrscan API
app.get('/api/transfers', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const transfers = await hypurrscanClient.getTransfers();
    const formatted = formatTransfers(transfers).slice(0, limit);
    res.json(formatted);
  } catch (error: any) {
    console.error('Error getting transfers:', error);
    res.status(500).json({ error: 'Failed to get transfers', message: error?.message });
  }
});

// WebSocket endpoint for real-time updates
wsApp.ws('/ws', (ws: WebSocket, req: any) => {
  wsClients.add(ws);
  console.log('WebSocket client connected. Total clients:', wsClients.size);

  // Send initial state
  ws.send(JSON.stringify({
    type: 'connected',
    data: { message: 'Connected to Hyperliquid Real-Time API' },
    timestamp: Date.now(),
  }));

  ws.on('close', () => {
    wsClients.delete(ws);
    console.log('WebSocket client disconnected. Total clients:', wsClients.size);
  });

  ws.on('error', (error: Error) => {
    console.error('WebSocket error:', error);
    wsClients.delete(ws);
  });
});

// Manual refresh - fetch fresh data from APIs
app.post('/api/refresh', async (req: Request, res: Response) => {
  try {
    latestBlockHeight = 0;
    latestBlockData = null;
    latestTransactions = [];
    latestValidators = [];
    latestVaults = [];
    latestTransfers = [];
    res.json({ success: true, message: 'Cache cleared, will fetch fresh data' });
  } catch (error) {
    res.status(500).json({ error: 'Refresh failed', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Monitor API and broadcast updates - check every 1000ms (1 second) for near real-time updates
// Using 1 second interval to avoid timeout issues while still being fast
setInterval(async () => {
  try {
    // Fetch latest block from API (with timeout handling)
    try {
      const latestBlock = await Promise.race([
        getLatestBlockFromAPI(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))
      ]) as any;
      
      if (latestBlock && latestBlock.blockNumber > lastBroadcastBlockNumber) {
        lastBroadcastBlockNumber = latestBlock.blockNumber;
        latestBlockData = latestBlock;
        broadcastUpdate('newBlocks', [latestBlock]);
      }
    } catch (error) {
      // Timeout or error - skip this cycle
    }
    
    // Fetch latest transactions from API (with timeout handling)
    try {
      const transactions = await Promise.race([
        getRecentTransactionsFromAPI(50),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))
      ]) as any[];
      
      if (transactions.length > 0) {
        const newestTx = transactions[0];
        if (!lastBroadcastTxHash || newestTx.hash !== lastBroadcastTxHash) {
          lastBroadcastTxHash = newestTx.hash;
          latestTransactions = transactions;
          broadcastUpdate('newTransactions', transactions.slice(0, 20));
        }
      }
    } catch (error) {
      // Timeout or error - skip this cycle
    }
    
    // Fetch validators from API (less frequently to respect rate limits)
    if (Math.random() < 0.1) {
      try {
        const validators = await Promise.race([
          sdkClient.getValidatorSummaries(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))
        ]) as any[];
        if (validators && validators.length > 0) {
          latestValidators = formatValidators(validators);
          broadcastUpdate('newValidators', latestValidators);
        }
      } catch (error) {
        // Silently fail
      }
    }
    
    // Fetch vaults from API (less frequently to respect rate limits)
    if (Math.random() < 0.1) {
      try {
        const vaults = await Promise.race([
          sdkClient.getVaultSummaries(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))
        ]) as any[];
        if (vaults && vaults.length > 0) {
          latestVaults = formatVaults(vaults);
          broadcastUpdate('newVaults', latestVaults);
        }
      } catch (error) {
        // Silently fail
      }
    }
    
    // Fetch transfers from API (with timeout handling)
    try {
      const transfers = await Promise.race([
        hypurrscanClient.getTransfers(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))
      ]) as any[];
      if (transfers && transfers.length > 0) {
        latestTransfers = formatTransfers(transfers);
        broadcastUpdate('newTransfers', latestTransfers.slice(0, 20));
      }
    } catch (error) {
      // Silently fail
    }
    
    // Broadcast stats (use cached data if available)
    const transactions = latestTransactions.length > 0 ? latestTransactions : [];
    const uniqueUsers = new Set(transactions.map((tx: any) => tx.user)).size;
    broadcastUpdate('stats', {
      blocks: latestBlockData ? 1 : 0,
      transactions: transactions.length,
      uniqueUsers: uniqueUsers,
      latestBlockNumber: latestBlockData?.blockNumber || 0,
    });
  } catch (error: any) {
    // Silently handle errors - don't spam console
  }
}, 1000); // Check every 1 second for near real-time updates (faster than timeout)

// Start server
wsApp.listen(PORT, () => {
  console.log(`🌐 Hyperliquid Real-Time API Proxy running on http://localhost:${PORT}`);
  console.log('Fetching data directly from APIs (no database storage)');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  process.exit(0);
});
