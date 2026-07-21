# BluSimulator

A polished crypto paper-trading simulator built with React, Webpack, and Node.js. Fresh sessions use public Coinbase spot prices as their starting point and then follow a deterministic synthetic path. No wallet, exchange account, API key, or real funds are involved.

## Trading modes

- **Manual:** market and limit paper orders with fees, slippage, buying-power checks, positions, and P&L.
- **Momentum:** follows directional price strength and exits when momentum reverses.
- **Mean reversion:** accumulates below the recent moving average and reduces exposure after recovery.
- **Smart DCA:** builds a capped position on deterministic simulated-time intervals.
- **Custom Script:** runs user-defined buy and sell rules through a constrained expression language—never `eval` or arbitrary JavaScript.

Custom scripts use one `BUY WHEN` rule and one `SELL WHEN` rule. They can combine `price`, `position`, `sma(n)`, `ema(n)`, `momentum(n)`, `change(n)`, and `rsi(n)` with arithmetic, comparisons, and `AND`/`OR`:

```text
BUY WHEN momentum(18) > 0.20 AND rsi(14) < 75
SELL WHEN momentum(12) < -0.10 OR rsi(14) > 82
```

Automations run only while the simulation clock is playing. Every strategy has a configurable maximum portfolio allocation, evaluation cadence, cooldown, cash guard, independent inventory tracking, execution count, signal rationale, and estimated P&L. Automated fills use the same accounting engine as manual trades.

The portfolio header visualizes total equity as available cash, invested value, and cash reserved by open buy orders. It also separates realized, unrealized, and algorithm-attributed performance and displays each supported coin balance (BTC, ETH, SOL, AVAX, and LINK) with its current USD value.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

The Node API requests `https://api.coinbase.com/v2/prices/:currency_pair/spot` for each supported asset. Results are validated and cached for 60 seconds. If Coinbase is slow or unavailable, BluSimulator starts from its built-in fallback quotes instead.

On corporate networks that install a private root certificate, recent Node versions can use the operating system certificate store:

```powershell
$env:NODE_OPTIONS='--use-system-ca'
npm.cmd run dev
```

## Production

```bash
npm run build
npm start
```

The production server runs at `http://localhost:3001` by default.

## Server architecture

```text
server/
  index.js                 # process startup and graceful shutdown
  app.js                   # Express application composition
  container.js             # dependency wiring
  config/                  # environment and asset definitions
  controllers/             # HTTP request handlers
  middleware/              # request IDs, 404s, and errors
  routes/                  # API route composition
  services/                # Coinbase integration and bootstrap policy

src/
  App.jsx
  index.jsx
  components/
  hooks/
  lib/
  styles.css

test/
  algorithmic-trading.test.js
  coinbase-price-service.test.js
  market-bootstrap-service.test.js
  server-api.test.js
  simulation.test.js
```

The external price provider is isolated behind `CoinbasePriceService`; `MarketBootstrapService` applies caching results and per-asset fallbacks before data reaches the client.

Optional environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | Node server port |
| `COINBASE_API_URL` | `https://api.coinbase.com` | Coinbase API base URL |
| `COINBASE_TIMEOUT_MS` | `4500` | Per-request timeout |
| `COINBASE_CACHE_TTL_MS` | `60000` | Server-side price cache lifetime |

## Checks

```bash
npm test
npm run build
```
