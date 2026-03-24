# Data Providers

This project uses an abstracted data provider pattern, allowing you to easily plug in different price/market data sources.

## Architecture

```
IDataProvider (interface)
  ├── BaseDataProvider (abstract base)
  │   ├── MockDataProvider (simulated data, no API calls)
  │   └── CcxtDataProvider (real exchange data via ccxt)
  └── [Your custom providers here]

MarketDataService (wrapper with caching, convenience methods)
```

## Built-in providers

### MockDataProvider
- **Use for:** development, testing, demos
- **Features:** simulated price data with random variations
- **Setup:** `DATA_PROVIDER=mock` (default)
- **No API keys needed**

### CcxtDataProvider
- **Use for:** live exchange data (Binance, Kraken, Coinbase, etc.)
- **Features:** real OHLCV bars, tickers, market data via ccxt
- **Setup:**
  ```env
  DATA_PROVIDER=ccxt
  EXCHANGE_NAME=binance    # or kraken, coinbase, etc.
  EXCHANGE_API_KEY=your-key
  EXCHANGE_SECRET=your-secret
  ```
- **Requires:** exchange API keys (for private data; public data works without keys)

## Using the market data service

In your strategy or bot logic:

```typescript
import { MarketDataService } from './providers/market-data-service';
import { createDataProvider } from './providers';

// Create provider
const provider = createDataProvider('mock');
const marketDataService = new MarketDataService(provider);

// Fetch market data
const data = await marketDataService.getMarketData('BTC/USDT');
console.log(data.lastPrice); // e.g., 56000

// Fetch ticks
const tick = await marketDataService.getTick('ETH/USDT');
console.log(tick.price); // e.g., 2200

// Fetch historical candles
const candles = await marketDataService.getCandles('BTC/USDT', '1h', 50);
candles.forEach(c => console.log(`${c.timestamp}: O=${c.open} C=${c.close}`));

// (Optional) subscribe to realtime ticks
const unsubscribe = await marketDataService.subscribe('BTC/USDT', (tick) => {
  console.log(`New tick: ${tick.symbol} @ ${tick.price}`);
});

// When done
await marketDataService.close();
```

## Adding a custom provider

1. Create a new file in `src/providers/` (e.g., `coinbase-provider.ts`):

```typescript
import { BaseDataProvider, IDataProvider, Tick, Candle, MarketData, TimeFrame } from './types';
import logger from '../logger';

export class CoinbaseDataProvider extends BaseDataProvider implements IDataProvider {
  private apiKey: string;
  private apiSecret: string;

  constructor(apiKey: string, apiSecret: string) {
    super();
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  getName(): string {
    return 'CoinbaseDataProvider';
  }

  async getMarketData(symbol: string): Promise<MarketData> {
    // Implement Coinbase API call
    // Example: const response = await fetch(`https://api.coinbase.com/v2/prices/${symbol}/spot`);
    // Parse and return MarketData
    throw new Error('Not implemented');
  }

  async getTick(symbol: string): Promise<Tick> {
    // Similar to getMarketData
    throw new Error('Not implemented');
  }

  async getCandles(symbol: string, timeframe: TimeFrame, limit: number): Promise<Candle[]> {
    // Fetch OHLCV bars from Coinbase
    throw new Error('Not implemented');
  }

  async subscribeToTicks?(symbol: string, callback: (tick: Tick) => void): Promise<() => void> {
    // (Optional) Connect to WebSocket, push ticks to callback
    throw new Error('Not implemented');
  }
}
```

2. Update `src/providers/index.ts` to register your provider:

```typescript
export function createDataProvider(
  type: 'mock' | 'ccxt' | 'coinbase',  // Add your type here
  exchangeOrConfig?: string | { ... },
): IDataProvider {
  // ... existing cases ...
  if (type === 'coinbase') {
    const config = exchangeOrConfig as { apiKey: string; apiSecret: string };
    return new CoinbaseDataProvider(config.apiKey, config.apiSecret);
  }
  // ...
}
```

3. Use it in `src/index.ts` or your bot code:

```typescript
const provider = createDataProvider('coinbase', {
  apiKey: process.env.COINBASE_API_KEY,
  apiSecret: process.env.COINBASE_API_SECRET,
});
const marketDataService = new MarketDataService(provider);
```

## Data types

### Tick
A single price snapshot with bid/ask/volume.

```typescript
interface Tick {
  symbol: string;
  price: number;
  bid?: number;
  ask?: number;
  volume?: number;
  timestamp: number; // ms since epoch
}
```

### Candle (OHLCV)
A historical price bar (open, high, low, close, volume).

```typescript
interface Candle {
  symbol: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
```

### MarketData
Current market information including price, volume, and change.

```typescript
interface MarketData {
  symbol: string;
  lastPrice: number;
  bid?: number;
  ask?: number;
  volume24h?: number;
  change24h?: number; // percentage
  timestamp: number;
}
```

## Testing providers

Run the bot with different providers:

```bash
# Use mock provider (default)
npm run dev

# Use Binance exchange
DATA_PROVIDER=ccxt EXCHANGE_NAME=binance EXCHANGE_API_KEY=xxx EXCHANGE_SECRET=yyy npm run dev

# Use Kraken exchange
DATA_PROVIDER=ccxt EXCHANGE_NAME=kraken EXCHANGE_API_KEY=xxx EXCHANGE_SECRET=yyy npm run dev
```

Send a webhook signal and check the logs — the strategy will fetch current market data from the active provider and validate the signal.

### IBKR (Interactive Brokers)

We also provide an `ibkr` provider which talks to an IB Gateway / TWS REST endpoint. This provider uses a snapshot endpoint and a polling-based subscription fallback.

Setup example (environment-based):

```env
DATA_PROVIDER=ibkr
# Base URL of your IB Gateway REST API (for example http://localhost:5000)
IBKR_BASE_URL=http://localhost:5000
# Optional: poll interval in ms for subscribe fallback
IBKR_POLL_INTERVAL_MS=1000
# Optional: provide mapping of symbols to conids (JSON string) if you don't want to use conid:<id>
# e.g. SYMBOL_CONIDS='{ "BTC/USDT": 123456 }'
```

Important notes:
- Interactive Brokers uses contract identifiers (conids). To stream or request market data you typically need the conid for the symbol. See:
  https://www.interactivebrokers.com/campus/ibkr-api-page/web-api-trading/#forecastex-request-3-obtaining-event-contract-conids-30
- This provider expects either:
  - a symbol of the form `conid:12345`, or
  - a `symbolConids` mapping passed into the provider configuration (see `createDataProvider('ibkr', { baseUrl, symbolConids })`).
- The provider attempts to call `/iserver/marketdata/snapshot?conids=...` on the configured `IBKR_BASE_URL`. Endpoint paths may vary by Gateway version; adjust `ibkr-provider.ts` if your gateway exposes different paths.

Example programmatic creation:

```ts
import { createDataProvider } from '../src/providers';

const provider = createDataProvider('ibkr', {
  baseUrl: process.env.IBKR_BASE_URL!,
  symbolConids: { 'BTC/USDT': 123456 },
  apiKey: process.env.IBKR_API_KEY,
  pollIntervalMs: 1000,
});
```
