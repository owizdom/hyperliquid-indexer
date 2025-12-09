import axios, { AxiosInstance } from 'axios';

export interface HyperliquidMarket {
  name: string;
  szDecimals: number;
  isDelisted?: boolean;
  maxLeverage?: number;
  marginTableId?: number;
}

export interface HyperliquidMeta {
  universe: HyperliquidMarket[];
}

export interface HyperliquidPriceData {
  coin: string;
  px: string;
  sz: string;
  time: number;
  side: 'A' | 'B'; // A = ask, B = bid
  hash?: string;
}

export interface HyperliquidCandle {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  vol: string;
}

export interface HyperliquidOrderBook {
  levels: [string, string][]; // [price, size]
}

export class HyperliquidClient {
  private apiClient: AxiosInstance;
  private alchemyEndpoint: string;

  constructor(apiUrl: string, alchemyEndpoint: string) {
    this.apiClient = axios.create({
      baseURL: apiUrl,
      timeout: 30000,
    });
    this.alchemyEndpoint = alchemyEndpoint;
  }

  // Get all available markets
  async getMeta(): Promise<HyperliquidMeta> {
    try {
      const response = await this.apiClient.post('/info', {
        type: 'meta',
      });
      return response.data;
    } catch (error: any) {
      console.error('Error fetching meta:', error.response?.data || error.message);
      // Return empty meta on error
      return { universe: [] };
    }
  }

  // Get all market data - fetch from recent trades per symbol
  async getAllMktData(): Promise<HyperliquidPriceData[]> {
    try {
      const meta = await this.getMeta();
      const allData: HyperliquidPriceData[] = [];
      
      // Get recent trades for active markets (not delisted)
      const activeMarkets = meta.universe.filter(m => !m.isDelisted).slice(0, 50); // Limit to 50 to avoid too many requests
      
      for (const market of activeMarkets) {
        try {
          // Get the most recent trade for price data
          const trades = await this.getRecentTrades(market.name, 1);
          if (trades.length > 0) {
            allData.push(trades[0]);
          }
          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 50));
        } catch {
          // Skip if we can't get data for this market
          continue;
        }
      }
      return allData;
    } catch (error: any) {
      console.error('Error fetching market data:', error.response?.data || error.message);
      return [];
    }
  }

  // Get order book for a symbol
  async getOrderBook(symbol: string): Promise<{ bids: HyperliquidOrderBook; asks: HyperliquidOrderBook }> {
    const response = await this.apiClient.post('/info', {
      type: 'l2Book',
      coin: symbol,
    });
    return response.data;
  }

  // Get recent trades for a symbol
  async getRecentTrades(symbol: string, limit: number = 100): Promise<HyperliquidPriceData[]> {
    const response = await this.apiClient.post('/info', {
      type: 'recentTrades',
      coin: symbol,
      n: limit,
    });
    return response.data;
  }

  // Get candles for a symbol
  async getCandles(symbol: string, interval: string = '1h', startTime?: number, endTime?: number): Promise<HyperliquidCandle[]> {
    const response = await this.apiClient.post('/info', {
      type: 'candleSnapshot',
      req: {
        coin: symbol,
        interval,
        startTime,
        endTime,
      },
    });
    return response.data;
  }

  // Get blockchain data using Alchemy
  async getBlock(blockNumber: number | 'latest'): Promise<any> {
    const response = await axios.post(this.alchemyEndpoint, {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getBlockByNumber',
      params: [typeof blockNumber === 'number' ? `0x${blockNumber.toString(16)}` : 'latest', true],
    });
    return response.data.result;
  }

  async getBlockNumber(): Promise<number> {
    const response = await axios.post(this.alchemyEndpoint, {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_blockNumber',
      params: [],
    });
    return parseInt(response.data.result, 16);
  }

  async getTransaction(txHash: string): Promise<any> {
    const response = await axios.post(this.alchemyEndpoint, {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getTransactionByHash',
      params: [txHash],
    });
    return response.data.result;
  }

  async getTransactionReceipt(txHash: string): Promise<any> {
    const response = await axios.post(this.alchemyEndpoint, {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getTransactionReceipt',
      params: [txHash],
    });
    return response.data.result;
  }

  async getBlockTransactionCount(blockNumber: number | 'latest'): Promise<number> {
    const response = await axios.post(this.alchemyEndpoint, {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getBlockTransactionCountByNumber',
      params: [typeof blockNumber === 'number' ? `0x${blockNumber.toString(16)}` : 'latest'],
    });
    return parseInt(response.data.result, 16);
  }
}

