# Hyperliquid Indexer

A comprehensive indexer for Hyperliquid blockchain data with both CLI and web interfaces. This tool indexes market data, trades, order books, and blockchain information from Hyperliquid using your Alchemy endpoint.

## Features

- 📊 **Market Data Indexing**: Real-time indexing of all Hyperliquid markets
- 💱 **Trade History**: Index and query recent trades
- 📈 **Order Books**: Snapshot and store order book data
- ⛓️ **Blockchain Data**: Index blocks and transactions via Alchemy
- 🖥️ **CLI Interface**: Command-line tool for querying indexed data
- 🌐 **Web Interface**: Beautiful web dashboard for visualizing data
- 💾 **JSON Storage**: Efficient local file-based storage of all indexed data

## Prerequisites

- Node.js 18+ and npm
- Alchemy Hyperliquid endpoint (provided)

## Installation

1. Navigate to the project directory:
```bash
cd hyperliquid-indexer
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

Edit `.env` and ensure your Alchemy endpoint is configured:
```
ALCHEMY_ENDPOINT=https://hyperliquid-mainnet.g.alchemy.com/v2/AFjoSzKjqv6Eq53OsF2xe
```

## Usage

### CLI Mode

#### Start the indexer:
```bash
npm run cli start
```

Or with custom interval (in milliseconds):
```bash
npm run cli start -- --interval 5000
```

#### View statistics:
```bash
npm run cli stats
```

#### List all markets:
```bash
npm run cli markets
```

#### Filter markets by symbol:
```bash
npm run cli markets -- --symbol BTC
```

#### View recent trades:
```bash
npm run cli trades
```

#### View trades for a specific symbol:
```bash
npm run cli trades -- --symbol BTC --limit 50
```

#### Run a single indexing cycle:
```bash
npm run cli index
```

### Web Mode

Start the web server:
```bash
npm run web
```

Then open your browser to `http://localhost:3000`

The web interface provides:
- Real-time statistics dashboard
- Market data visualization
- Recent trades display
- Auto-refresh every 10 seconds

### Programmatic Usage

You can also use the indexer programmatically:

```typescript
import { HyperliquidIndexer } from './src/indexer.js';

const indexer = new HyperliquidIndexer();
await indexer.start(10000); // Start with 10s interval

// Later...
indexer.stop();
indexer.close();
```

## API Endpoints (Web Mode)

When running in web mode, the following API endpoints are available:

- `GET /api/health` - Health check
- `GET /api/stats` - Get indexing statistics
- `GET /api/markets` - Get all markets (optional `?symbol=BTC`)
- `GET /api/markets/:symbol/history` - Get market history
- `GET /api/trades` - Get recent trades (optional `?symbol=BTC&limit=100`)
- `GET /api/orderbook/:symbol` - Get order book for a symbol
- `GET /api/blocks` - Get indexed blocks (optional `?limit=100`)
- `GET /api/blocks/latest` - Get latest indexed block
- `POST /api/index` - Trigger manual indexing

## Project Structure

```
hyperliquid-indexer/
├── src/
│   ├── database.ts          # SQLite database layer
│   ├── hyperliquid-client.ts # Hyperliquid API client
│   ├── indexer.ts           # Core indexing logic
│   ├── cli.ts               # CLI interface
│   ├── web.ts               # Web server
│   └── index.ts             # Main entry point
├── public/
│   └── index.html           # Web dashboard
├── data/                    # Database storage (created automatically)
├── package.json
├── tsconfig.json
└── README.md
```

## Configuration

Environment variables (in `.env`):

- `ALCHEMY_ENDPOINT` - Your Alchemy Hyperliquid endpoint (required)
- `HYPERLIQUID_API_URL` - Hyperliquid API URL (default: https://api.hyperliquid.xyz)
- `DATABASE_PATH` - Path to JSON database file (default: ./data/hyperliquid.json)
- `PORT` - Web server port (default: 3000)
- `INDEX_INTERVAL_MS` - Indexing interval in milliseconds (default: 10000)

## Development

Build the project:
```bash
npm run build
```

Run in development mode with auto-reload:
```bash
npm run dev
```

## Data Storage

All indexed data is stored in a JSON file. The database includes:

- **markets**: Market price and volume data
- **trades**: Individual trade records
- **orderbooks**: Order book snapshots
- **blocks**: Blockchain block data

The database is automatically created on first run.

## Notes

- The indexer runs continuously when started, updating data at the specified interval
- Market data is indexed from Hyperliquid's public API
- Blockchain data is fetched via your Alchemy endpoint
- The web interface auto-refreshes every 10 seconds
- All timestamps are stored in milliseconds

## License

MIT

