import axios from 'axios';

const HYPURRSCAN_API_BASE = 'https://api.hypurrscan.io';

export interface HypurrscanTransaction {
  time: number;
  user: string;
  action: {
    type: string;
    [key: string]: any;
  };
  block: number;
  hash: string;
  error: string | null;
}

export class HypurrscanClient {
  private baseUrl: string;

  constructor(baseUrl: string = HYPURRSCAN_API_BASE) {
    this.baseUrl = baseUrl;
  }

  /**
   * Get recent transactions from Hypurrscan API
   */
  async getSomeTxs(): Promise<HypurrscanTransaction[]> {
    try {
      const response = await axios.get<HypurrscanTransaction[]>(`${this.baseUrl}/someTxs`, {
        timeout: 5000, // 5 seconds - fast but reliable
      });
      return response.data || [];
    } catch (error: any) {
      if (error?.response?.status === 429) {
        // Rate limited, return empty array
        return [];
      }
      // Don't log timeout errors - they're expected for real-time updates
      if (!error?.code || error.code !== 'ECONNABORTED') {
        console.error('Error fetching someTxs from Hypurrscan:', error.message || error);
      }
      return [];
    }
  }

  /**
   * Get more transactions from Hypurrscan API
   */
  async getSomeMoreTxs(): Promise<HypurrscanTransaction[]> {
    try {
      const response = await axios.get<HypurrscanTransaction[]>(`${this.baseUrl}/someMoreTxs`, {
        timeout: 5000, // 5 seconds - fast but reliable
      });
      return response.data || [];
    } catch (error: any) {
      if (error?.response?.status === 429) {
        // Rate limited, return empty array
        return [];
      }
      // Don't log timeout errors - they're expected for real-time updates
      if (!error?.code || error.code !== 'ECONNABORTED') {
        console.error('Error fetching someMoreTxs from Hypurrscan:', error.message || error);
      }
      return [];
    }
  }

  /**
   * Get all recent transactions (combines both endpoints)
   */
  async getAllRecentTxs(): Promise<HypurrscanTransaction[]> {
    try {
      const [someTxs, someMoreTxs] = await Promise.all([
        this.getSomeTxs(),
        this.getSomeMoreTxs(),
      ]);

      // Combine and deduplicate by hash
      const txMap = new Map<string, HypurrscanTransaction>();
      
      for (const tx of someTxs) {
        if (tx.hash) {
          txMap.set(tx.hash, tx);
        }
      }
      
      for (const tx of someMoreTxs) {
        if (tx.hash && !txMap.has(tx.hash)) {
          txMap.set(tx.hash, tx);
        }
      }

      return Array.from(txMap.values());
    } catch (error) {
      console.error('Error fetching all recent transactions from Hypurrscan:', error);
      return [];
    }
  }

  /**
   * Get recent transfers from Hypurrscan API
   */
  async getTransfers(): Promise<HypurrscanTransaction[]> {
    try {
      const response = await axios.get<HypurrscanTransaction[]>(`${this.baseUrl}/transfers`, {
        timeout: 5000, // 5 seconds - fast but reliable
      });
      // Filter for sendAsset and SystemSpotSendAction types
      return (response.data || []).filter(tx => 
        tx.action?.type === 'sendAsset' || tx.action?.type === 'SystemSpotSendAction'
      );
    } catch (error: any) {
      if (error?.response?.status === 429) {
        return [];
      }
      // Don't log timeout errors - they're expected for real-time updates
      if (!error?.code || error.code !== 'ECONNABORTED') {
        console.error('Error fetching transfers from Hypurrscan:', error.message || error);
      }
      return [];
    }
  }
}

