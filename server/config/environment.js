const path = require('path');

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const config = Object.freeze({
  environment: process.env.NODE_ENV || 'development',
  host: process.env.SERVER_HOST || '0.0.0.0',
  port: positiveInteger(process.env.PORT, 3001),
  distPath: path.resolve(__dirname, '..', '..', 'dist'),
  coinbase: Object.freeze({
    baseUrl: (process.env.COINBASE_API_URL || 'https://api.coinbase.com').replace(/\/$/, ''),
    quoteCurrency: 'USD',
    timeoutMs: positiveInteger(process.env.COINBASE_TIMEOUT_MS, 4500),
    cacheTtlMs: positiveInteger(process.env.COINBASE_CACHE_TTL_MS, 60000),
  }),
});

module.exports = config;
