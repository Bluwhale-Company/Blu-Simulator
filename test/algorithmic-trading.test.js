'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAlgorithmOrder,
  evaluateAlgorithm,
  parseCustomScript,
  simpleMovingAverage,
} = require('../src/lib/algorithmicTrading');
const { executeMarketOrder } = require('../src/lib/simulation');

function candles(values) {
  return values.map((close, index) => ({
    time: index,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }));
}

test('moving average rejects invalid series and averages valid prices', () => {
  assert.equal(simpleMovingAverage([10, 20, 30]), 20);
  assert.equal(simpleMovingAverage([10, Number.NaN]), null);
  assert.equal(simpleMovingAverage([]), null);
});

test('momentum strategy emits buy and sell signals from the configured trend window', () => {
  const rising = Array.from({ length: 18 }, (_, index) => 100 + index * 0.03);
  const buy = evaluateAlgorithm({
    strategy: 'momentum', status: 'running', trackedQuantity: 0,
  }, candles(rising), 100);
  assert.equal(buy.action, 'buy');
  assert.equal(buy.shouldEvaluate, true);

  const falling = Array.from({ length: 18 }, (_, index) => 100 - index * 0.02);
  const sell = evaluateAlgorithm({
    strategy: 'momentum', status: 'running', trackedQuantity: 1,
  }, candles(falling), 200);
  assert.equal(sell.action, 'sell');
});

test('mean-reversion strategy buys a meaningful dip below its recent average', () => {
  const series = [...Array(25).fill(100), 99.5];
  const signal = evaluateAlgorithm({
    strategy: 'mean_reversion', status: 'running', trackedQuantity: 0,
  }, candles(series), 100);
  assert.equal(signal.action, 'buy');
  assert.match(signal.reason, /below its recent mean/);
});

test('DCA strategy respects its fixed execution interval', () => {
  const history = candles(Array(30).fill(100));
  const due = evaluateAlgorithm({
    strategy: 'dca', status: 'running', lastExecutionTick: 100,
  }, history, 460);
  const waiting = evaluateAlgorithm({
    strategy: 'dca', status: 'running', lastExecutionTick: 100,
  }, history, 459);
  assert.equal(due.action, 'buy');
  assert.equal(waiting.action, 'hold');
});

test('algorithm order sizing respects allocation, cash, and tracked inventory', () => {
  const buy = buildAlgorithmOrder({
    algorithm: { strategy: 'momentum', allocationPercent: 20, trackedQuantity: 0 },
    signal: { action: 'buy' },
    marketPrice: 100,
    equity: 10000,
    availableCash: 10000,
    availableQuantity: 0,
    feeRate: 0.001,
    slippageBps: 2,
  });
  assert.ok(buy.quantity > 7.9 && buy.quantity < 8);
  assert.ok(buy.estimatedNotional <= 800);

  const sell = buildAlgorithmOrder({
    algorithm: { strategy: 'mean_reversion', allocationPercent: 20, trackedQuantity: 4 },
    signal: { action: 'sell' },
    marketPrice: 100,
    equity: 10000,
    availableCash: 5000,
    availableQuantity: 3,
  });
  assert.equal(sell.quantity, 2);
});

test('an algorithm signal produces a real fill through the shared paper-accounting engine', () => {
  const history = candles(Array.from({ length: 18 }, (_, index) => 100 + index * 0.03));
  const algorithm = {
    id: 'algorithm-1',
    strategy: 'momentum',
    status: 'running',
    allocationPercent: 15,
    trackedQuantity: 0,
  };
  const signal = evaluateAlgorithm(algorithm, history, 100);
  const orderSpec = buildAlgorithmOrder({
    algorithm,
    signal,
    marketPrice: 100.51,
    equity: 10000,
    availableCash: 10000,
    availableQuantity: 0,
    feeRate: 0.0005,
    slippageBps: 2,
  });
  const fill = executeMarketOrder({
    id: 'algo-order-1',
    symbol: 'BTC',
    side: orderSpec.side,
    type: 'market',
    quantity: orderSpec.quantity,
  }, {
    cash: 10000,
    initialCash: 10000,
    positions: {},
    trades: [],
  }, 100.51, { feeRate: 0.0005, slippageBps: 2, timestamp: 100 });

  assert.equal(fill.success, true);
  assert.ok(fill.portfolio.positions.BTC.quantity > 0);
  assert.ok(fill.portfolio.cash < 10000);
  assert.equal(fill.portfolio.trades.length, 1);
});

test('custom strategy scripts compile safe indicator expressions and produce signals', () => {
  const script = [
    '# Buy a rising market while RSI is not overheated',
    'BUY WHEN momentum(18) > 0.20 AND rsi(14) < 101',
    'SELL WHEN momentum(12) < -0.10 OR rsi(14) > 95',
  ].join('\n');
  const compiled = parseCustomScript(script);
  assert.equal(compiled.valid, true);

  const rising = Array.from({ length: 30 }, (_, index) => 100 + index * 0.03);
  const signal = evaluateAlgorithm({
    strategy: 'custom',
    status: 'running',
    trackedQuantity: 0,
    customScript: script,
  }, candles(rising), 100);
  assert.equal(signal.action, 'buy');
  assert.match(signal.reason, /Custom BUY rule matched/);
});

test('custom strategy parser rejects arbitrary JavaScript and unknown globals', () => {
  const malicious = parseCustomScript([
    'BUY WHEN fetch("https://example.com")',
    'SELL WHEN window.location == 1',
  ].join('\n'));
  assert.equal(malicious.valid, false);
  assert.ok(malicious.errors.some((error) => /Unsupported token|Unknown indicator/.test(error)));

  const incomplete = parseCustomScript('BUY WHEN price > sma(20)');
  assert.equal(incomplete.valid, false);
  assert.ok(incomplete.errors.includes('A SELL WHEN rule is required.'));
});
