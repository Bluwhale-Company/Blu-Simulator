const defaultConfig = require('./config/environment');
const { MARKET_ASSETS } = require('./config/assets');
const { CoinbasePriceService } = require('./services/coinbasePriceService');
const { MarketBootstrapService } = require('./services/marketBootstrapService');

function createApplicationContainer(options = {}) {
  const config = options.config || defaultConfig;
  const assets = options.assets || MARKET_ASSETS;
  const coinbasePriceService = options.coinbasePriceService || new CoinbasePriceService({
    baseUrl: config.coinbase.baseUrl,
    quoteCurrency: config.coinbase.quoteCurrency,
    timeoutMs: config.coinbase.timeoutMs,
    cacheTtlMs: config.coinbase.cacheTtlMs,
  });
  const marketBootstrapService = options.marketBootstrapService || new MarketBootstrapService({
    assets,
    priceService: coinbasePriceService,
    quoteCurrency: config.coinbase.quoteCurrency,
  });

  return {
    config,
    assets,
    coinbasePriceService,
    marketBootstrapService,
  };
}

module.exports = { createApplicationContainer };
