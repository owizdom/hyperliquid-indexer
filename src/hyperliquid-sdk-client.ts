import { InfoClient, HttpTransport } from '@nktkas/hyperliquid';
import { blockDetails, txDetails, recentTrades, allMids, meta, allPerpMetas, exchangeStatus, validatorSummaries, vaultSummaries } from '@nktkas/hyperliquid/api/info';
import type { BlockDetailsResponse, TxDetailsResponse, RecentTradesResponse, AllMidsResponse, MetaResponse } from '@nktkas/hyperliquid/api/info';
import axios from 'axios';

const HYPERLIQUID_INFO_API = 'https://api.hyperliquid.xyz/info';

export class HyperliquidSDKClient {
  private transport: HttpTransport;
  private config: { transport: HttpTransport };

  constructor() {
    this.transport = new HttpTransport();
    this.config = { transport: this.transport };
  }

  // Direct API call to Hyperliquid Info endpoint
  // Rate limit: 1000 requests/minute/IP with endpoint weights
  private async callInfoAPI(type: string, params?: any): Promise<any> {
    try {
      const response = await axios.post(HYPERLIQUID_INFO_API, {
        type,
        ...params,
      }, {
        timeout: 5000, // 5 seconds - fast but reliable for real-time updates
      });
      return response.data;
    } catch (error: any) {
      if (error?.response?.status === 429) {
        throw new Error('Rate limited');
      }
      // Handle 404 or other errors gracefully
      if (error?.response?.status === 404) {
        console.warn(`API endpoint ${type} returned 404 - may not be available`);
        return null;
      }
      // Don't throw on timeout - return null for graceful handling
      if (error?.code === 'ECONNABORTED') {
        return null;
      }
      throw error;
    }
  }

  // Get block details from Hyperliquid L1
  async getBlockDetails(height: number): Promise<BlockDetailsResponse['blockDetails'] | null> {
    try {
      const response = await blockDetails(this.config, { height });
      return response.blockDetails;
    } catch (error: any) {
      // Suppress 429 rate limit errors and archived block errors (they're expected)
      if (error?.response?.status === 429) {
        return null;
      }
      // Suppress archived block errors (more than 100 archived blocks queried)
      if (error?.message?.includes('archived') || 
          error?.response?.data?.includes('archived') ||
          error?.response?.statusText?.includes('archived')) {
        return null;
      }
      // Only log other errors (not rate limit or archived)
      if (error?.response?.status !== 429) {
        // Don't log archived block errors - they're expected when checking old blocks
        const errorMsg = error?.message || error?.response?.data || String(error);
        if (!errorMsg.includes('archived')) {
          console.error(`Error fetching block ${height}:`, errorMsg);
        }
      }
      return null;
    }
  }

  // Get transaction details
  async getTransactionDetails(hash: string): Promise<TxDetailsResponse['tx'] | null> {
    try {
      const response = await txDetails(this.config, { hash });
      return response.tx;
    } catch (error) {
      console.error(`Error fetching transaction ${hash}:`, error);
      return null;
    }
  }

  // Get recent trades for a coin - using direct API
  async getRecentTrades(coin: string): Promise<RecentTradesResponse> {
    try {
      const result = await this.callInfoAPI('recentTrades', { coin });
      return result || [];
    } catch (error: any) {
      if (error?.message === 'Rate limited') {
        return [];
      }
      console.error(`Error fetching recent trades for ${coin}:`, error?.message || error);
      return [];
    }
  }

  // Get all market mid prices - using direct API
  async getAllMids(): Promise<AllMidsResponse> {
    try {
      const result = await this.callInfoAPI('allMids');
      return result || {};
    } catch (error: any) {
      if (error?.message === 'Rate limited') {
        return {};
      }
      console.error('Error fetching all mids:', error?.message || error);
      return {};
    }
  }

  // Get meta information - using direct API
  async getMeta(): Promise<MetaResponse> {
    try {
      const result = await this.callInfoAPI('meta');
      if (!result) {
        throw new Error('Meta response is empty');
      }
      return result;
    } catch (error: any) {
      if (error?.message === 'Rate limited') {
        throw new Error('Rate limited');
      }
      console.error('Error fetching meta:', error?.message || error);
      throw error;
    }
  }

  // Get exchange status
  async getExchangeStatus() {
    try {
      return await exchangeStatus(this.config);
    } catch (error) {
      console.error('Error fetching exchange status:', error);
      return null;
    }
  }

  // Get all perp metas
  async getAllPerpMetas() {
    try {
      return await allPerpMetas(this.config);
    } catch (error) {
      console.error('Error fetching perp metas:', error);
      return [];
    }
  }

  // Get validator summaries
  async getValidatorSummaries() {
    try {
      const result = await this.callInfoAPI('validatorSummaries');
      return result || [];
    } catch (error: any) {
      if (error?.message === 'Rate limited') {
        return [];
      }
      console.error('Error fetching validator summaries:', error?.message || error);
      return [];
    }
  }

  // Get vault summaries
  async getVaultSummaries() {
    try {
      const result = await this.callInfoAPI('vaultSummaries');
      return result || [];
    } catch (error: any) {
      if (error?.message === 'Rate limited') {
        return [];
      }
      console.error('Error fetching vault summaries:', error?.message || error);
      return [];
    }
  }
}
