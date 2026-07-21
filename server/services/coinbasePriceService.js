class PriceProviderError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'PriceProviderError';
    this.symbol = options.symbol;
    this.status = options.status;
  }
}

class CoinbasePriceService {
  constructor(options = {}) {
    this.fetch = options.fetchImpl || globalThis.fetch;
    this.baseUrl = (options.baseUrl || 'https://api.coinbase.com').replace(/\/$/, '');
    this.quoteCurrency = options.quoteCurrency || 'USD';
    this.timeoutMs = options.timeoutMs || 4500;
    this.cacheTtlMs = options.cacheTtlMs || 60000;
    this.now = options.now || Date.now;
    this.cache = null;

    if (typeof this.fetch !== 'function') {
      throw new TypeError('A Fetch API implementation is required.');
    }
  }

  async getSpotPrice(asset) {
    const pair = asset.pair || `${asset.symbol}-${this.quoteCurrency}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetch(
        `${this.baseUrl}/v2/prices/${encodeURIComponent(pair)}/spot`,
        {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new PriceProviderError(
          `Coinbase returned HTTP ${response.status} for ${pair}.`,
          { symbol: asset.symbol, status: response.status },
        );
      }

      const payload = await response.json();
      const amount = Number(payload?.data?.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new PriceProviderError(
          `Coinbase returned an invalid spot price for ${pair}.`,
          { symbol: asset.symbol },
        );
      }

      return amount;
    } catch (error) {
      if (error instanceof PriceProviderError) throw error;
      const reason = error?.name === 'AbortError' ? 'timed out' : 'failed';
      throw new PriceProviderError(
        `Coinbase spot request ${reason} for ${pair}.`,
        { symbol: asset.symbol, cause: error },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async getSpotPrices(assets, options = {}) {
    const now = this.now();
    if (!options.force && this.cache && now < this.cache.expiresAt) {
      return { ...this.cache.value, cached: true };
    }

    const results = await Promise.allSettled(
      assets.map((asset) => this.getSpotPrice(asset)),
    );
    const prices = {};
    const unavailableSymbols = [];

    results.forEach((result, index) => {
      const symbol = assets[index].symbol;
      if (result.status === 'fulfilled') prices[symbol] = result.value;
      else unavailableSymbols.push(symbol);
    });

    const value = {
      provider: 'coinbase',
      prices,
      unavailableSymbols,
      fetchedAt: new Date(now).toISOString(),
      cached: false,
    };
    this.cache = { value, expiresAt: now + this.cacheTtlMs };
    return value;
  }

  clearCache() {
    this.cache = null;
  }
}

module.exports = { CoinbasePriceService, PriceProviderError };
