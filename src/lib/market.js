const { nextPrice, normalizeSeed, randomStep } = require('./simulation');

export const ASSETS = [
  {
    symbol: 'BTC',
    pair: 'BTC / USD',
    name: 'Bitcoin',
    basePrice: 68342.18,
    color: '#f5b74f',
    volatility: 0.0038,
    volumeBase: 19500000,
  },
  {
    symbol: 'ETH',
    pair: 'ETH / USD',
    name: 'Ethereum',
    basePrice: 3648.91,
    color: '#8b9cff',
    volatility: 0.0045,
    volumeBase: 12400000,
  },
  {
    symbol: 'SOL',
    pair: 'SOL / USD',
    name: 'Solana',
    basePrice: 172.64,
    color: '#75e6c4',
    volatility: 0.0062,
    volumeBase: 8100000,
  },
  {
    symbol: 'AVAX',
    pair: 'AVAX / USD',
    name: 'Avalanche',
    basePrice: 38.27,
    color: '#f47178',
    volatility: 0.0068,
    volumeBase: 4200000,
  },
  {
    symbol: 'LINK',
    pair: 'LINK / USD',
    name: 'Chainlink',
    basePrice: 17.82,
    color: '#5c8dff',
    volatility: 0.0056,
    volumeBase: 3700000,
  },
];

export const ASSET_BY_SYMBOL = Object.fromEntries(ASSETS.map((asset) => [asset.symbol, asset]));

export const SIMULATION_START = Date.parse('2026-07-20T13:30:00.000Z');
const HISTORY_LENGTH = 72;
const CANDLE_MS = 60_000;

function buildCandle(open, close, time, seed, volumeBase, volatility) {
  const highRandom = randomStep(seed);
  const lowRandom = randomStep(highRandom.seed);
  const volumeRandom = randomStep(lowRandom.seed);
  const wickScale = volatility * (0.18 + highRandom.value * 0.6);
  const high = Math.max(open, close) * (1 + wickScale);
  const low = Math.max(0.000001, Math.min(open, close) * (1 - volatility * (0.18 + lowRandom.value * 0.6)));

  return {
    candle: {
      time,
      open,
      high,
      low,
      close,
      volume: volumeBase * (0.45 + volumeRandom.value * 1.1),
    },
    seed: volumeRandom.seed,
  };
}

function createAssetMarket(asset, scenarioSeed, assetIndex, startingPrice) {
  const targetPrice = Number.isFinite(Number(startingPrice)) && Number(startingPrice) > 0
    ? Number(startingPrice)
    : asset.basePrice;
  const seededAsset = { ...asset, basePrice: targetPrice };
  let seed = normalizeSeed(`${scenarioSeed}-${asset.symbol}`);
  let price = targetPrice * (0.985 + assetIndex * 0.002);
  const candles = [];
  const historyStart = SIMULATION_START - HISTORY_LENGTH * CANDLE_MS;

  for (let index = 0; index < HISTORY_LENGTH; index += 1) {
    const wave = Math.sin((index + assetIndex * 5) / 11) * 0.00028;
    const next = nextPrice(price, seed, {
      volatility: asset.volatility * 0.55,
      drift: 0.00011 + wave,
      tickSize: targetPrice < 100 ? 0.001 : 0.01,
    });
    const built = buildCandle(
      price,
      next.price,
      historyStart + (index + 1) * CANDLE_MS,
      next.seed,
      asset.volumeBase,
      asset.volatility,
    );
    candles.push(built.candle);
    price = next.price;
    seed = built.seed;
  }

  // Scale the generated backstory so its final close is exactly the provider's
  // spot quote. From that point onward, the deterministic simulator takes over.
  const scale = targetPrice / price;
  const scaledCandles = candles.map((candle) => ({
    ...candle,
    open: candle.open * scale,
    high: candle.high * scale,
    low: candle.low * scale,
    close: candle.close * scale,
  }));
  const dayOpen = scaledCandles[0].open;

  return {
    ...seededAsset,
    price: targetPrice,
    previousPrice: scaledCandles[scaledCandles.length - 2]?.close || targetPrice,
    dayOpen,
    changePercent: ((targetPrice - dayOpen) / dayOpen) * 100,
    candles: scaledCandles,
    seed,
  };
}

export function createInitialMarket(scenarioSeed = 'blu-focus', startingPrices = {}) {
  return Object.fromEntries(
    ASSETS.map((asset, index) => [
      asset.symbol,
      createAssetMarket(asset, scenarioSeed, index, startingPrices[asset.symbol]),
    ]),
  );
}

export function advanceMarket(market, simulatedTime, tick, elapsedMs) {
  const elapsedMinutes = Math.max(elapsedMs / CANDLE_MS, 0.01);

  return Object.fromEntries(
    ASSETS.map((definition, assetIndex) => {
      const current = market[definition.symbol];
      const cycle = Math.sin((tick + assetIndex * 17) / 24) * 0.00014;
      const result = nextPrice(current.price, current.seed, {
        volatility: definition.volatility * Math.sqrt(elapsedMinutes),
        drift: cycle * elapsedMinutes,
        tickSize: definition.basePrice < 100 ? 0.001 : 0.01,
      });
      const built = buildCandle(
        current.price,
        result.price,
        simulatedTime,
        result.seed,
        definition.volumeBase * Math.max(elapsedMinutes, 0.18),
        definition.volatility * Math.sqrt(Math.max(elapsedMinutes, 0.15)),
      );
      const candles = [...current.candles, built.candle].slice(-96);

      return [
        definition.symbol,
        {
          ...current,
          previousPrice: current.price,
          price: result.price,
          changePercent: ((result.price - current.dayOpen) / current.dayOpen) * 100,
          candles,
          seed: built.seed,
        },
      ];
    }),
  );
}

export function marketPrices(market) {
  return Object.fromEntries(Object.entries(market).map(([symbol, asset]) => [symbol, asset.price]));
}
