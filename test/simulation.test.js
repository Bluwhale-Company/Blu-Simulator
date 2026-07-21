'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculatePortfolioMetrics,
  createRng,
  executeMarketOrder,
  matchLimitOrders,
  nextPrice,
  nextSeed,
  randomStep,
  validateOrder,
} = require('../src/lib/simulation');

function portfolio(cash = 10000) {
  return { cash, initialCash: cash, positions: {}, trades: [] };
}

test('seed helpers are repeatable and make explicit state transitions', () => {
  assert.equal(nextSeed(42), nextSeed(42));
  assert.deepEqual(randomStep('same scenario'), randomStep('same scenario'));

  const firstRng = createRng(1234);
  const secondRng = createRng(1234);
  const firstSequence = [firstRng(), firstRng(), firstRng()];
  const secondSequence = [secondRng(), secondRng(), secondRng()];

  assert.deepEqual(firstSequence, secondSequence);
  assert.ok(firstSequence.every((value) => value >= 0 && value < 1));
  assert.equal(firstRng.getSeed(), secondRng.getSeed());
});

test('nextPrice is deterministic, bounded, and does not mutate its options', () => {
  const options = Object.freeze({ volatility: 0.02, drift: 0.001, tickSize: 0.01 });
  const first = nextPrice(50000, 'demo-seed', options);
  const replay = nextPrice(50000, 'demo-seed', options);
  const following = nextPrice(first.price, first.nextSeed, options);

  assert.deepEqual(first, replay);
  assert.equal(first.price * 100, Math.round(first.price * 100));
  assert.ok(first.price > 0);
  assert.notEqual(following.nextSeed, first.nextSeed);
  assert.equal(options.volatility, 0.02);
});

test('nextPrice can make a clock tick without moving the quote', () => {
  const result = nextPrice(100, 7, { volatility: 0, drift: 0, tickSize: 0.01 });
  assert.equal(result.price, 100);
  assert.equal(result.change, 0);
  assert.notEqual(result.nextSeed, 7);
});

test('validateOrder reports field errors and resource constraints', () => {
  const malformed = validateOrder({
    symbol: '',
    side: 'hold',
    type: 'limit',
    quantity: -1,
    limitPrice: 0,
  });
  assert.equal(malformed.valid, false);
  assert.deepEqual(Object.keys(malformed.fieldErrors).sort(), [
    'limitPrice',
    'quantity',
    'side',
    'symbol',
  ]);

  const tooExpensive = validateOrder(
    { symbol: 'BTCUSD', side: 'buy', type: 'market', quantity: 2 },
    { portfolio: portfolio(100), marketPrice: 60, feeRate: 0 },
  );
  assert.equal(tooExpensive.valid, false);
  assert.match(tooExpensive.errors[0], /Insufficient paper cash/);

  const overSell = validateOrder(
    { symbol: 'ETHUSD', side: 'sell', type: 'market', quantity: 2 },
    {
      portfolio: {
        ...portfolio(),
        positions: { ETHUSD: { quantity: 1, averagePrice: 2000 } },
      },
      marketPrice: 2100,
    },
  );
  assert.equal(overSell.valid, false);
  assert.match(overSell.errors[0], /simulated holdings/);
});

test('market buys apply deterministic slippage and fees without mutating inputs', () => {
  const startingPortfolio = portfolio(1000);
  const order = Object.freeze({
    id: 'buy-1',
    symbol: 'BTCUSD',
    side: 'buy',
    type: 'market',
    quantity: 2,
  });

  const result = executeMarketOrder(order, startingPortfolio, 100, {
    slippageBps: 10,
    feeRate: 0.01,
    timestamp: 25,
  });

  assert.equal(result.success, true);
  assert.equal(result.trade.price, 100.1);
  assert.equal(result.trade.notional, 200.2);
  assert.equal(result.trade.fee, 2.002);
  assert.equal(result.portfolio.cash, 797.798);
  assert.deepEqual(result.portfolio.positions.BTCUSD, {
    quantity: 2,
    averagePrice: 100.1,
  });
  assert.equal(result.portfolio.trades.length, 1);
  assert.deepEqual(startingPortfolio, portfolio(1000));
  assert.equal(order.status, undefined);
});

test('market sells update cash, holdings, and realized profit', () => {
  const startingPortfolio = {
    cash: 500,
    initialCash: 1000,
    positions: { BTCUSD: { quantity: 2, averagePrice: 100 } },
    trades: [],
    realizedPnl: 0,
    feesPaid: 0,
  };

  const result = executeMarketOrder(
    { id: 'sell-1', symbol: 'BTCUSD', side: 'sell', type: 'market', quantity: 1.5 },
    startingPortfolio,
    120,
    { feeRate: 0.01, timestamp: 30 },
  );

  assert.equal(result.success, true);
  assert.equal(result.portfolio.cash, 678.2);
  assert.equal(result.portfolio.positions.BTCUSD.quantity, 0.5);
  assert.equal(result.portfolio.positions.BTCUSD.averagePrice, 100);
  assert.equal(result.portfolio.realizedPnl, 30);
  assert.equal(result.portfolio.feesPaid, 1.8);
  assert.equal(startingPortfolio.positions.BTCUSD.quantity, 2);
});

test('failed execution is explicit and leaves the portfolio reference unchanged', () => {
  const startingPortfolio = portfolio(50);
  const result = executeMarketOrder(
    { symbol: 'BTCUSD', side: 'buy', type: 'market', quantity: 1 },
    startingPortfolio,
    100,
  );

  assert.equal(result.success, false);
  assert.strictEqual(result.portfolio, startingPortfolio);
  assert.equal(result.trade, null);
});

test('limit matcher fills only crossed orders and preserves input order', () => {
  const startingPortfolio = {
    cash: 1000,
    initialCash: 1000,
    positions: { ETHUSD: { quantity: 2, averagePrice: 100 } },
    trades: [],
  };
  const orders = [
    {
      id: 'buy-open', symbol: 'BTCUSD', side: 'buy', type: 'limit',
      quantity: 1, limitPrice: 95, status: 'open', createdAt: 2,
    },
    {
      id: 'sell-fill', symbol: 'ETHUSD', side: 'sell', type: 'limit',
      quantity: 1, limitPrice: 105, status: 'open', createdAt: 1,
    },
    {
      id: 'buy-fill', symbol: 'BTCUSD', side: 'buy', type: 'limit',
      quantity: 2, limitPrice: 105, status: 'pending', createdAt: 3,
    },
  ];

  const result = matchLimitOrders(orders, startingPortfolio, {
    BTCUSD: 100,
    ETHUSD: { price: 110 },
  }, { timestamp: 99 });

  assert.deepEqual(result.filledOrderIds, ['sell-fill', 'buy-fill']);
  assert.equal(result.orders[0].status, 'open');
  assert.equal(result.orders[1].status, 'filled');
  assert.equal(result.orders[2].status, 'filled');
  assert.equal(result.trades[0].price, 110);
  assert.equal(result.trades[1].price, 100);
  assert.equal(result.portfolio.cash, 910);
  assert.equal(result.portfolio.positions.ETHUSD.quantity, 1);
  assert.equal(result.portfolio.positions.BTCUSD.quantity, 2);
  assert.equal(orders[1].status, 'open');
});

test('limit matcher gives earlier orders buying-power priority', () => {
  const orders = [
    {
      id: 'later', symbol: 'BTCUSD', side: 'buy', type: 'limit', quantity: 1,
      limitPrice: 100, status: 'open', createdAt: 20,
    },
    {
      id: 'earlier', symbol: 'BTCUSD', side: 'buy', type: 'limit', quantity: 1,
      limitPrice: 100, status: 'open', createdAt: 10,
    },
  ];

  const result = matchLimitOrders(orders, portfolio(100), { BTCUSD: 100 });
  assert.equal(result.orders[1].status, 'filled');
  assert.equal(result.orders[0].status, 'rejected');
  assert.deepEqual(result.filledOrderIds, ['earlier']);
  assert.deepEqual(result.rejectedOrderIds, ['later']);
});

test('portfolio metrics mark holdings to market and account for fees', () => {
  const metrics = calculatePortfolioMetrics({
    cash: 790,
    initialCash: 1000,
    positions: {
      BTCUSD: { quantity: 2, averagePrice: 100 },
      ETHUSD: { quantity: 1, averagePrice: 50 },
    },
    realizedPnl: 20,
    feesPaid: 5,
  }, {
    BTCUSD: 120,
    ETHUSD: { price: 60 },
  });

  assert.equal(metrics.marketValue, 300);
  assert.equal(metrics.costBasis, 250);
  assert.equal(metrics.equity, 1090);
  assert.equal(metrics.unrealizedPnl, 50);
  assert.equal(metrics.realizedPnl, 20);
  assert.equal(metrics.netRealizedPnl, 15);
  assert.equal(metrics.totalPnl, 90);
  assert.equal(metrics.totalPnlPercent, 9);
  assert.deepEqual(metrics.missingPrices, []);
});

test('portfolio metrics surface missing quotes instead of inventing a value', () => {
  const metrics = calculatePortfolioMetrics({
    cash: 900,
    initialCash: 1000,
    positions: { BTCUSD: { quantity: 1, averagePrice: 100 } },
  });

  assert.equal(metrics.isFullyPriced, false);
  assert.deepEqual(metrics.missingPrices, ['BTCUSD']);
  assert.equal(metrics.unrealizedPnl, null);
  assert.equal(metrics.totalPnl, null);
});

