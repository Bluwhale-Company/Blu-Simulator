'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CoinbasePriceService, PriceProviderError } = require('../server/services/coinbasePriceService');

const ASSETS = [
  { symbol: 'BTC', pair: 'BTC-USD' },
  { symbol: 'ETH', pair: 'ETH-USD' },
];

function jsonResponse(amount, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return { data: { amount: String(amount), currency: 'USD' } };
    },
  };
}

test('Coinbase service requests each currency pair and parses numeric spot prices', async () => {
  const urls = [];
  const service = new CoinbasePriceService({
    baseUrl: 'https://api.coinbase.test',
    fetchImpl: async (url) => {
      urls.push(url);
      return jsonResponse(url.includes('BTC-USD') ? '70123.45' : '3712.18');
    },
    now: () => Date.parse('2026-07-20T16:00:00Z'),
  });

  const result = await service.getSpotPrices(ASSETS);
  assert.deepEqual(result.prices, { BTC: 70123.45, ETH: 3712.18 });
  assert.deepEqual(result.unavailableSymbols, []);
  assert.equal(result.provider, 'coinbase');
  assert.equal(urls.length, 2);
  assert.match(urls[0], /\/v2\/prices\/BTC-USD\/spot$/);
});

test('Coinbase service caches a completed batch for the configured TTL', async () => {
  let calls = 0;
  let now = 1000;
  const service = new CoinbasePriceService({
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse('100');
    },
    cacheTtlMs: 60000,
    now: () => now,
  });

  await service.getSpotPrices(ASSETS);
  const cached = await service.getSpotPrices(ASSETS);
  assert.equal(calls, 2);
  assert.equal(cached.cached, true);

  now += 60001;
  await service.getSpotPrices(ASSETS);
  assert.equal(calls, 4);
});

test('Coinbase service isolates a failed pair instead of rejecting the full batch', async () => {
  const service = new CoinbasePriceService({
    fetchImpl: async (url) => (
      url.includes('ETH-USD') ? jsonResponse('not-a-price') : jsonResponse('70000')
    ),
  });

  const result = await service.getSpotPrices(ASSETS);
  assert.deepEqual(result.prices, { BTC: 70000 });
  assert.deepEqual(result.unavailableSymbols, ['ETH']);
});

test('Coinbase service exposes provider failures as domain errors', async () => {
  const service = new CoinbasePriceService({
    fetchImpl: async () => jsonResponse('0', 503),
  });

  await assert.rejects(
    () => service.getSpotPrice(ASSETS[0]),
    (error) => error instanceof PriceProviderError && error.status === 503,
  );
});
