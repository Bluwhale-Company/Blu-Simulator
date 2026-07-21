'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MarketBootstrapService } = require('../server/services/marketBootstrapService');

const ASSETS = [
  { symbol: 'BTC', pair: 'BTC-USD', name: 'Bitcoin', fallbackPrice: 68000, color: '#f5b74f' },
  { symbol: 'ETH', pair: 'ETH-USD', name: 'Ethereum', fallbackPrice: 3600, color: '#8b9cff' },
];

test('bootstrap service combines Coinbase prices with per-asset fallback prices', async () => {
  const service = new MarketBootstrapService({
    assets: ASSETS,
    priceService: {
      async getSpotPrices() {
        return {
          prices: { BTC: 71234.56 },
          unavailableSymbols: ['ETH'],
          fetchedAt: '2026-07-20T16:00:00.000Z',
          cached: false,
        };
      },
    },
  });

  const result = await service.getBootstrap();
  assert.equal(result.source, 'mixed');
  assert.equal(result.provider, 'Coinbase Spot');
  assert.deepEqual(
    result.assets.map(({ symbol, basePrice, priceSource }) => ({ symbol, basePrice, priceSource })),
    [
      { symbol: 'BTC', basePrice: 71234.56, priceSource: 'coinbase' },
      { symbol: 'ETH', basePrice: 3600, priceSource: 'fallback' },
    ],
  );
});

test('bootstrap service returns a complete fallback response after provider failure', async () => {
  const service = new MarketBootstrapService({
    assets: ASSETS,
    priceService: {
      async getSpotPrices() {
        throw new Error('provider unavailable');
      },
    },
  });

  const result = await service.getBootstrap();
  assert.equal(result.source, 'fallback');
  assert.equal(result.provider, null);
  assert.deepEqual(result.assets.map((asset) => asset.basePrice), [68000, 3600]);
});
