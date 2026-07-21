'use strict';

const STRATEGY_PRESETS = Object.freeze({
  momentum: Object.freeze({
    id: 'momentum',
    name: 'Momentum',
    shortDescription: 'Follows strong directional moves',
    lookback: 18,
    entryThresholdPercent: 0.18,
    exitThresholdPercent: -0.12,
    evaluationIntervalTicks: 18,
    cooldownTicks: 100,
    trancheFraction: 0.4,
    exitFraction: 1,
  }),
  mean_reversion: Object.freeze({
    id: 'mean_reversion',
    name: 'Mean reversion',
    shortDescription: 'Buys dips below the recent average',
    lookback: 26,
    entryThresholdPercent: -0.28,
    exitThresholdPercent: 0.08,
    evaluationIntervalTicks: 22,
    cooldownTicks: 120,
    trancheFraction: 0.35,
    exitFraction: 0.5,
  }),
  dca: Object.freeze({
    id: 'dca',
    name: 'Smart DCA',
    shortDescription: 'Builds a position at fixed intervals',
    evaluationIntervalTicks: 20,
    intervalTicks: 360,
    cooldownTicks: 0,
    trancheFraction: 0.2,
    exitFraction: 0,
  }),
  custom: Object.freeze({
    id: 'custom',
    name: 'Custom script',
    shortDescription: 'Runs user-defined indicator rules',
    evaluationIntervalTicks: 18,
    cooldownTicks: 100,
    trancheFraction: 0.35,
    exitFraction: 1,
  }),
});

class ScriptSyntaxError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScriptSyntaxError';
  }
}

const CUSTOM_FUNCTIONS = new Set(['sma', 'ema', 'momentum', 'change', 'rsi']);
const CUSTOM_IDENTIFIERS = new Set(['price', 'position']);

function tokenizeExpression(source) {
  const expression = source
    .replace(/\bAND\b/gi, '&&')
    .replace(/\bOR\b/gi, '||');
  const tokens = [];
  let index = 0;

  while (index < expression.length) {
    const remaining = expression.slice(index);
    const whitespace = remaining.match(/^\s+/);
    if (whitespace) {
      index += whitespace[0].length;
      continue;
    }
    const number = remaining.match(/^(?:\d+\.?\d*|\.\d+)/);
    if (number) {
      tokens.push({ type: 'number', value: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    const identifier = remaining.match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (identifier) {
      tokens.push({ type: 'identifier', value: identifier[0].toLowerCase() });
      index += identifier[0].length;
      continue;
    }
    const operator = remaining.match(/^(?:>=|<=|==|!=|&&|\|\||[><+\-*/(),])/);
    if (operator) {
      tokens.push({
        type: ['(', ')', ','].includes(operator[0]) ? 'punctuation' : 'operator',
        value: operator[0],
      });
      index += operator[0].length;
      continue;
    }
    throw new ScriptSyntaxError(`Unsupported token near "${remaining.slice(0, 12)}".`);
  }

  if (tokens.length > 300) throw new ScriptSyntaxError('Rule is too complex.');
  return tokens;
}

function parseExpression(source) {
  const tokens = tokenizeExpression(source);
  let cursor = 0;
  const peek = () => tokens[cursor];
  const consume = (value) => {
    const token = tokens[cursor];
    if (!token || (value !== undefined && token.value !== value)) {
      throw new ScriptSyntaxError(value ? `Expected "${value}".` : 'Unexpected end of rule.');
    }
    cursor += 1;
    return token;
  };

  const parsePrimary = () => {
    const token = peek();
    if (!token) throw new ScriptSyntaxError('Rule ended unexpectedly.');
    if (token.type === 'number') {
      consume();
      return { type: 'literal', value: token.value };
    }
    if (token.value === '(') {
      consume('(');
      const expression = parseOr();
      consume(')');
      return expression;
    }
    if (token.type === 'identifier') {
      consume();
      if (peek()?.value === '(') {
        if (!CUSTOM_FUNCTIONS.has(token.value)) {
          throw new ScriptSyntaxError(`Unknown indicator "${token.value}".`);
        }
        consume('(');
        const argument = parseOr();
        consume(')');
        return { type: 'call', name: token.value, argument };
      }
      if (!CUSTOM_IDENTIFIERS.has(token.value)) {
        throw new ScriptSyntaxError(`Unknown value "${token.value}".`);
      }
      return { type: 'identifier', name: token.value };
    }
    throw new ScriptSyntaxError(`Unexpected token "${token.value}".`);
  };

  const parseUnary = () => {
    if (peek()?.value === '-') {
      consume('-');
      return { type: 'unary', operator: '-', value: parseUnary() };
    }
    return parsePrimary();
  };

  const parseBinary = (nextParser, operators) => () => {
    let left = nextParser();
    while (operators.includes(peek()?.value)) {
      const operator = consume().value;
      left = { type: 'binary', operator, left, right: nextParser() };
    }
    return left;
  };

  const parseMultiply = parseBinary(parseUnary, ['*', '/']);
  const parseAdd = parseBinary(parseMultiply, ['+', '-']);
  const parseComparison = parseBinary(parseAdd, ['>', '>=', '<', '<=', '==', '!=']);
  const parseAnd = parseBinary(parseComparison, ['&&']);
  const parseOr = parseBinary(parseAnd, ['||']);
  const ast = parseOr();
  if (cursor !== tokens.length) throw new ScriptSyntaxError(`Unexpected token "${peek().value}".`);
  return ast;
}

function parseCustomScript(script) {
  const errors = [];
  const rules = {};
  const expressions = {};
  if (typeof script !== 'string' || script.trim().length === 0) {
    return { valid: false, errors: ['Custom script cannot be empty.'], rules, expressions };
  }
  if (script.length > 2000) {
    return { valid: false, errors: ['Custom script must be shorter than 2,000 characters.'], rules, expressions };
  }

  const lines = script.split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) return;
    const match = line.match(/^(BUY|SELL)\s+WHEN\s+(.+)$/i);
    if (!match) {
      errors.push(`Line ${index + 1}: use BUY WHEN … or SELL WHEN …`);
      return;
    }
    const side = match[1].toLowerCase();
    if (rules[side]) {
      errors.push(`Line ${index + 1}: only one ${side.toUpperCase()} rule is allowed.`);
      return;
    }
    try {
      rules[side] = parseExpression(match[2]);
      expressions[side] = match[2].trim();
    } catch (error) {
      errors.push(`Line ${index + 1}: ${error.message}`);
    }
  });

  if (!rules.buy) errors.push('A BUY WHEN rule is required.');
  if (!rules.sell) errors.push('A SELL WHEN rule is required.');
  return { valid: errors.length === 0, errors, rules, expressions };
}

function indicatorValue(name, periodInput, context) {
  const closes = context.closes;
  const period = Math.min(96, Math.max(2, Math.round(Number(periodInput) || 0)));
  if (closes.length < period) return 0;
  const values = closes.slice(-period);

  if (name === 'sma') return simpleMovingAverage(values);
  if (name === 'ema') {
    const multiplier = 2 / (period + 1);
    return values.slice(1).reduce(
      (average, value) => value * multiplier + average * (1 - multiplier),
      values[0],
    );
  }
  if (name === 'momentum' || name === 'change') {
    return ((values[values.length - 1] - values[0]) / values[0]) * 100;
  }

  let gains = 0;
  let losses = 0;
  for (let index = 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }
  if (losses === 0) return gains === 0 ? 50 : 100;
  const relativeStrength = (gains / (values.length - 1)) / (losses / (values.length - 1));
  return 100 - 100 / (1 + relativeStrength);
}

function evaluateExpression(node, context) {
  if (node.type === 'literal') return node.value;
  if (node.type === 'identifier') {
    return node.name === 'price' ? context.price : context.position;
  }
  if (node.type === 'call') {
    return indicatorValue(node.name, evaluateExpression(node.argument, context), context);
  }
  if (node.type === 'unary') return -Number(evaluateExpression(node.value, context));

  const left = evaluateExpression(node.left, context);
  if (node.operator === '&&') return Boolean(left) && Boolean(evaluateExpression(node.right, context));
  if (node.operator === '||') return Boolean(left) || Boolean(evaluateExpression(node.right, context));
  const right = evaluateExpression(node.right, context);
  switch (node.operator) {
    case '+': return Number(left) + Number(right);
    case '-': return Number(left) - Number(right);
    case '*': return Number(left) * Number(right);
    case '/': return Number(right) === 0 ? 0 : Number(left) / Number(right);
    case '>': return left > right;
    case '>=': return left >= right;
    case '<': return left < right;
    case '<=': return left <= right;
    case '==': return left === right;
    case '!=': return left !== right;
    default: throw new ScriptSyntaxError(`Unknown operator "${node.operator}".`);
  }
}

function finiteClose(candle) {
  const close = Number(candle?.close);
  return Number.isFinite(close) && close > 0 ? close : null;
}

function simpleMovingAverage(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const valid = values.map(Number).filter(Number.isFinite);
  if (valid.length !== values.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function hold(reason, extra = {}) {
  return { action: 'hold', reason, strengthPercent: 0, shouldEvaluate: false, ...extra };
}

function evaluateAlgorithm(algorithm, candles, tick) {
  const preset = STRATEGY_PRESETS[algorithm?.strategy];
  if (!preset) return hold('Unknown strategy.');
  if (algorithm.status !== 'running') return hold('Strategy is paused.');
  if (!Array.isArray(candles) || candles.length < Math.max(3, preset.lookback || 3)) {
    return hold('Collecting enough market history.');
  }
  if (tick - (algorithm.lastEvaluatedTick ?? -Infinity) < preset.evaluationIntervalTicks) {
    return hold('Waiting for the next evaluation window.');
  }

  const latestPrice = finiteClose(candles[candles.length - 1]);
  if (!latestPrice) return hold('Latest market price is invalid.', { shouldEvaluate: true });

  if (preset.id === 'custom') {
    const compiled = parseCustomScript(algorithm.customScript);
    if (!compiled.valid) {
      return hold(`Script error: ${compiled.errors[0]}`, { shouldEvaluate: true });
    }
    const closes = candles.map(finiteClose).filter((value) => value != null);
    const context = {
      closes,
      price: latestPrice,
      position: Number(algorithm.trackedQuantity) || 0,
    };
    const buyMatches = Boolean(evaluateExpression(compiled.rules.buy, context));
    const sellMatches = Boolean(evaluateExpression(compiled.rules.sell, context));
    const hasInventory = context.position > 0;
    const action = hasInventory && sellMatches ? 'sell' : buyMatches ? 'buy' : 'hold';
    return {
      action,
      reason: action === 'buy'
        ? `Custom BUY rule matched: ${compiled.expressions.buy}`
        : action === 'sell'
          ? `Custom SELL rule matched: ${compiled.expressions.sell}`
          : 'Custom rules evaluated with no trade signal.',
      strengthPercent: 0,
      shouldEvaluate: true,
      referencePrice: latestPrice,
    };
  }

  if (preset.id === 'dca') {
    const lastExecution = algorithm.lastExecutionTick;
    const due = lastExecution == null || tick - lastExecution >= preset.intervalTicks;
    return {
      action: due ? 'buy' : 'hold',
      reason: due ? 'Scheduled accumulation interval reached.' : 'Waiting for the next DCA interval.',
      strengthPercent: 0,
      shouldEvaluate: true,
      referencePrice: latestPrice,
    };
  }

  const lookbackCandles = candles.slice(-preset.lookback);
  const closes = lookbackCandles.map(finiteClose);
  if (closes.some((value) => value == null)) {
    return hold('Recent market history contains invalid prices.', { shouldEvaluate: true });
  }

  if (preset.id === 'momentum') {
    const anchorPrice = closes[0];
    const momentumPercent = ((latestPrice - anchorPrice) / anchorPrice) * 100;
    const hasInventory = Number(algorithm.trackedQuantity) > 0;
    const action = momentumPercent >= preset.entryThresholdPercent
      ? 'buy'
      : hasInventory && momentumPercent <= preset.exitThresholdPercent ? 'sell' : 'hold';
    return {
      action,
      reason: action === 'buy'
        ? `Upward momentum reached ${momentumPercent.toFixed(2)}%.`
        : action === 'sell'
          ? `Momentum reversed to ${momentumPercent.toFixed(2)}%.`
          : `Momentum ${momentumPercent.toFixed(2)}% is inside the neutral zone.`,
      strengthPercent: momentumPercent,
      shouldEvaluate: true,
      referencePrice: anchorPrice,
    };
  }

  const average = simpleMovingAverage(closes);
  const deviationPercent = ((latestPrice - average) / average) * 100;
  const hasInventory = Number(algorithm.trackedQuantity) > 0;
  const action = deviationPercent <= preset.entryThresholdPercent
    ? 'buy'
    : hasInventory && deviationPercent >= preset.exitThresholdPercent ? 'sell' : 'hold';
  return {
    action,
    reason: action === 'buy'
      ? `Price is ${Math.abs(deviationPercent).toFixed(2)}% below its recent mean.`
      : action === 'sell'
        ? `Price recovered ${deviationPercent.toFixed(2)}% above its recent mean.`
        : `Mean deviation ${deviationPercent.toFixed(2)}% is inside the neutral zone.`,
    strengthPercent: deviationPercent,
    shouldEvaluate: true,
    referencePrice: average,
  };
}

function buildAlgorithmOrder(options) {
  const {
    algorithm,
    signal,
    marketPrice,
    equity,
    availableCash,
    availableQuantity,
    feeRate = 0,
    slippageBps = 0,
  } = options;
  const preset = STRATEGY_PRESETS[algorithm?.strategy];
  if (!preset || !signal || signal.action === 'hold') return null;
  if (![marketPrice, equity, availableCash, availableQuantity].every(Number.isFinite)) return null;

  if (signal.action === 'sell') {
    const tracked = Math.max(0, Number(algorithm.trackedQuantity) || 0);
    const quantity = Math.min(tracked * preset.exitFraction, Math.max(0, availableQuantity));
    if (quantity <= 1e-8) return null;
    return { side: 'sell', quantity, estimatedNotional: quantity * marketPrice };
  }

  const allocationPercent = Math.min(50, Math.max(1, Number(algorithm.allocationPercent) || 10));
  const maximumValue = Math.max(0, equity * (allocationPercent / 100));
  const trackedValue = Math.max(0, Number(algorithm.trackedQuantity) || 0) * marketPrice;
  const remainingCapacity = Math.max(0, maximumValue - trackedValue);
  const trancheBudget = maximumValue * preset.trancheFraction;
  const budget = Math.min(remainingCapacity, trancheBudget, Math.max(0, availableCash) * 0.98);
  const executionMultiplier = 1 + feeRate + slippageBps / 10000;
  const quantity = budget / (marketPrice * executionMultiplier);

  if (budget < 10 || !Number.isFinite(quantity) || quantity <= 1e-8) return null;
  return { side: 'buy', quantity, estimatedNotional: budget };
}

module.exports = {
  STRATEGY_PRESETS,
  buildAlgorithmOrder,
  evaluateAlgorithm,
  parseCustomScript,
  simpleMovingAverage,
};
