# trading-bot-ml

Lightweight scaffold for a TradingView-driven trading bot. We'll use this repository to implement a specific TradingView strategy and connect it to exchanges.

Getting started

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file in the project root (example below) and add your credentials. Do NOT commit the `.env` file.

Example `.env`:

```
PORT=3000
EXCHANGE_API_KEY=
EXCHANGE_SECRET=
```

3. Build and run in development mode (auto-restart on change using ts-node-dev):

```bash
npm run dev
```

4. To produce a production build and run the compiled JS:

```bash
npm run build
npm start
```

Project layout

-- `src/index.ts` - entry point
-- `src/strategy.ts` - strategy handler (receives signals from TradingView)
-- `src/logger.ts` - small logger wrapper
-- `src/server.ts` - Express webhook server (receives TradingView alerts and forwards to strategy)
-- `src/stream.ts` - WebSocket streaming server (broadcasts signals and market data to clients)
-- `src/providers/` - pluggable data provider interfaces and implementations
- `src/tradingview-strategy.md` - place to paste/describe the TradingView Pine strategy and the alert format
- `docs/DATA_PROVIDERS.md` - guide for using and extending data providers

Data providers

This bot uses an abstracted data provider pattern to fetch market data from various sources without changing your strategy code. Built-in providers:

- **MockDataProvider**: simulated data, great for testing and development
- **CcxtDataProvider**: real exchange data (Binance, Kraken, Coinbase, etc.) via ccxt

See `docs/DATA_PROVIDERS.md` for how to add custom providers (e.g., APIs from other data vendors).

Set `DATA_PROVIDER` environment variable:

```env
# Use mock provider (default)
DATA_PROVIDER=mock

# Or use an exchange via ccxt
DATA_PROVIDER=ccxt
EXCHANGE_NAME=binance
EXCHANGE_API_KEY=your-key
EXCHANGE_SECRET=your-secret
```

Data streaming

This bot includes a WebSocket streaming server (`/stream`) that broadcasts:
- **Signals**: incoming TradingView alerts (with direction, symbol, price)
- **Ticks**: market data updates (symbol, price, volume)
- **Status**: connection status and bot state messages

### Testing the stream locally

1. Start the bot in dev mode:
```bash
npm run dev
```

2. In another terminal, connect a test client to the stream:
```bash
node test-stream-client.js
```
The client will connect to `ws://localhost:3000/stream` and print all messages.

3. Send a test webhook signal (from another terminal, or use curl):
```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "action":"buy",
    "symbol":"BTC/USDT",
    "price":56000,
    "time":"2025-12-01T12:00:00Z",
    "meta": { "indicator":"Machine Learning: Lorentzian Classification", "score":0.92 }
  }'
```

4. Check the test client terminal — you should see the signal broadcast in real-time.

### WebSocket message format

All messages follow this structure:
```json
{
  "type": "signal|tick|status",
  "timestamp": "ISO-8601 timestamp",
  "payload": { ... }
}
```

Examples:
- Signal: `{ "type": "signal", "timestamp": "...", "payload": { "action": "buy", "symbol": "BTC/USDT", "price": 56000, ... } }`
- Tick: `{ "type": "tick", "timestamp": "...", "payload": { "symbol": "BTC/USDT", "price": 56050, "volume": 1.5 } }`
- Status: `{ "type": "status", "timestamp": "...", "payload": { "message": "Connected to stream" } }`

Next steps

- Add webhook endpoint to receive TradingView alerts
- Implement order placement and risk management using `ccxt`
- Add tests for signal parsing and strategy logic

TradingView alerts

This project expects TradingView webhook alerts to POST JSON to `/webhook`.

Recommended JSON payload (you can set this in TradingView's alert message):

```json
{
	"action": "buy",
	"symbol": "BTC/USDT",
	"price": 56000,
	"time": "2025-12-01T12:00:00Z",
	"meta": { "strategy": "Machine Learning: Lorentzian Classification", "confidence": 0.92 }
}
```

If you want a simple shared secret, add `TRADINGVIEW_SECRET=your-secret` to `.env` and set the header `x-webhook-secret` with the same value in your webhook sender.

Indicator notes

You mentioned the TradingView indicator "Machine Learning: Lorentzian Classification" — when creating alerts from that indicator, ensure your alert message includes a JSON body following the schema above (especially the `action` field with `buy` or `sell`). If the indicator can output a direction or score, include it in `meta` so the bot can use it for sizing or filtering.
