class MarketBootstrapService {
  constructor(options) {
    if (!options?.priceService) throw new TypeError('priceService is required.');
    if (!Array.isArray(options.assets) || options.assets.length === 0) {
      throw new TypeError('At least one market asset is required.');
    }

    this.priceService = options.priceService;
    this.assets = options.assets;
    this.quoteCurrency = options.quoteCurrency || 'USD';
  }

  async getBootstrap(options = {}) {
    try {
      const result = await this.priceService.getSpotPrices(this.assets, options);
      const unavailable = new Set(result.unavailableSymbols);
      const source = unavailable.size === 0
        ? 'coinbase'
        : unavailable.size === this.assets.length ? 'fallback' : 'mixed';

      return this.buildResponse({
        prices: result.prices,
        unavailable,
        source,
        fetchedAt: result.fetchedAt,
        cached: result.cached,
      });
    } catch (_error) {
      return this.buildResponse({
        prices: {},
        unavailable: new Set(this.assets.map((asset) => asset.symbol)),
        source: 'fallback',
        fetchedAt: new Date().toISOString(),
        cached: false,
      });
    }
  }

  buildResponse({ prices, unavailable, source, fetchedAt, cached }) {
    return {
      market: 'NEXA-SIM',
      currency: this.quoteCurrency,
      source,
      provider: source === 'fallback' ? null : 'Coinbase Spot',
      fetchedAt,
      cached,
      delayed: false,
      assets: this.assets.map((asset) => {
        const usesFallback = unavailable.has(asset.symbol) || !Number.isFinite(prices[asset.symbol]);
        return {
          symbol: asset.symbol,
          pair: asset.pair,
          name: asset.name,
          basePrice: usesFallback ? asset.fallbackPrice : prices[asset.symbol],
          color: asset.color,
          priceSource: usesFallback ? 'fallback' : 'coinbase',
        };
      }),
    };
  }
}

module.exports = { MarketBootstrapService };
