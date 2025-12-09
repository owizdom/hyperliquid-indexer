# Hyperliquid Real-Time Indexer

A real-time blockchain indexer for Hyperliquid that fetches data directly from APIs without database storage. Provides both CLI and web interface for monitoring blocks, transactions, validators, vaults, and transfers.

## Features

- Real-time data fetching directly from Hyperliquid and Hypurrscan APIs
- No database storage - all data fetched fresh from APIs
- Web interface with terminal-like aesthetic
- CLI interface for command-line operations
- WebSocket support for real-time updates
- Progressive loading with millisecond-level updates
- Support for blocks, transactions, validators, vaults, and transfers

## Installation

```bash
npm install
```

## Configuration

Create a `.env` file in the root directory:

```env
PORT=3000
DATABASE_PATH=./data/hyperliquid.json
```

## Usage

### Web Interface

Start the web server:

```bash
npm run web
```

Then open `http://localhost:3000` in your browser.

### CLI Interface

Run CLI commands:

```bash
npm run cli -- <command>
```

Available commands:
- `start` - Start the indexer
- `status` - Show indexer status
- `cleanup --hours <number>` - Clean up old data
- `cleanup --all` - Clear all data

## API Endpoints

- `GET /api/health` - Health check
- `GET /api/stats` - Get statistics
- `GET /api/blocks` - Get recent blocks
- `GET /api/blocks/latest` - Get latest block
- `GET /api/transactions` - Get recent transactions
- `GET /api/transactions/:hash` - Get transaction by hash
- `GET /api/validators` - Get validators
- `GET /api/vaults` - Get vaults
- `GET /api/transfers` - Get transfers
- `POST /api/refresh` - Refresh cache
- `WebSocket /ws` - Real-time updates

## Architecture

- **Direct API Calls**: All data is fetched directly from Hyperliquid and Hypurrscan APIs
- **No Database**: No persistent storage - data is always fresh from APIs
- **In-Memory Cache**: Small in-memory cache for WebSocket updates (not persisted)
- **Real-Time Updates**: WebSocket broadcasts updates every 1 second

## Technologies

- TypeScript
- Node.js
- Express.js
- Express-WS (WebSocket support)
- Axios (HTTP client)
- Hyperliquid SDK (@nktkas/hyperliquid)

## API Sources

- **Hyperliquid API**: `https://api.hyperliquid.xyz/info`
- **Hypurrscan API**: `https://api.hypurrscan.io`

## Rate Limits

- Hyperliquid: 1000 requests/minute/IP
- Hypurrscan: Subject to their rate limits

## Development

Build the project:

```bash
npm run build
```

Run in development mode:

```bash
npm run dev
```

## License

MIT
