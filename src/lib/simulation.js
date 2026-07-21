'use strict';

/**
 * Deterministic paper-trading primitives.
 *
 * The module deliberately has no timers, storage, network access, wallet APIs, or
 * calls to Math.random/Date.now.  Callers own the simulation clock and pass the
 * current seed and timestamp in, which makes every replay reproducible.
 *
 * Portfolio shape used by the execution helpers:
 * {
 *   cash: 100000,
 *   initialCash: 100000, // optional; inferred on the first trade
 *   positions: {
 *     BTCUSD: { quantity: 0.5, averagePrice: 50000 }
 *   },
 *   trades: [],          // optional history; copied and appended to
 *   realizedPnl: 0,      // optional, gross of fees
 *   feesPaid: 0          // optional
 * }
 */

const UINT32_RANGE = 0x100000000;
const SEED_INCREMENT = 0x6d2b79f5;
const DEFAULT_SEED = 0x1a2b3c4d;
const DEFAULT_TICK_SIZE = 0.01;
const MONEY_DECIMALS = 8;

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function round(value, decimals = MONEY_DECIMALS) {
  if (!isFiniteNumber(value)) return value;
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function roundToTick(value, tickSize) {
  return round(Math.round(value / tickSize) * tickSize, 12);
}

/** Convert numbers or strings to a repeatable unsigned 32-bit seed. */
function normalizeSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return Math.trunc(seed) >>> 0;
  }

  if (typeof seed === 'string') {
    // FNV-1a keeps named scenarios (for example, "bull-run") reproducible.
    let hash = 0x811c9dc5;
    for (let index = 0; index < seed.length; index += 1) {
      hash ^= seed.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  return DEFAULT_SEED;
}

/** Advance a seed without producing any hidden mutable state. */
function nextSeed(seed) {
  return (normalizeSeed(seed) + SEED_INCREMENT) >>> 0;
}

/**
 * Produce one uniform value in [0, 1) and the seed for the following draw.
 * This is the Mulberry32 mixer expressed as a pure state transition.
 */
function randomStep(seed) {
  const state = nextSeed(seed);
  let mixed = state;
  mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  const value = ((mixed ^ (mixed >>> 14)) >>> 0) / UINT32_RANGE;
  return { value, seed: state };
}

/**
 * Convenience RNG for consumers that want a familiar function interface.
 * Prefer randomStep/nextPrice when preserving explicit replay state matters.
 */
function createRng(seed = DEFAULT_SEED) {
  let state = normalizeSeed(seed);
  const rng = function seededRandom() {
    const result = randomStep(state);
    state = result.seed;
    return result.value;
  };
  rng.getSeed = () => state;
  return rng;
}

/**
 * Calculate a seeded geometric price step.
 *
 * @param {number} currentPrice positive current quote
 * @param {number|string} seed replay seed
 * @param {object} options
 * @param {number} [options.volatility=0.006] standard deviation per tick
 * @param {number} [options.drift=0] expected log return per tick
 * @param {number} [options.tickSize=0.01] quote increment
 * @param {number} [options.minPrice=tickSize] lower price bound
 * @param {number} [options.maxMove=0.2] maximum absolute log move per tick
 * @returns {{price:number,previousPrice:number,change:number,changePercent:number,seed:number,nextSeed:number}}
 */
function nextPrice(currentPrice, seed, options = {}) {
  if (!isFiniteNumber(currentPrice) || currentPrice <= 0) {
    throw new TypeError('currentPrice must be a finite number greater than zero');
  }

  const volatility = options.volatility === undefined ? 0.006 : options.volatility;
  const drift = options.drift === undefined ? 0 : options.drift;
  const tickSize = options.tickSize === undefined ? DEFAULT_TICK_SIZE : options.tickSize;
  const minPrice = options.minPrice === undefined ? tickSize : options.minPrice;
  const maxMove = options.maxMove === undefined ? 0.2 : options.maxMove;

  if (!isFiniteNumber(volatility) || volatility < 0) {
    throw new TypeError('volatility must be a finite number greater than or equal to zero');
  }
  if (!isFiniteNumber(drift)) {
    throw new TypeError('drift must be a finite number');
  }
  if (!isFiniteNumber(tickSize) || tickSize <= 0) {
    throw new TypeError('tickSize must be a finite number greater than zero');
  }
  if (!isFiniteNumber(minPrice) || minPrice <= 0) {
    throw new TypeError('minPrice must be a finite number greater than zero');
  }
  if (!isFiniteNumber(maxMove) || maxMove <= 0) {
    throw new TypeError('maxMove must be a finite number greater than zero');
  }

  // Box-Muller gives a stable normal shock from two explicit seed transitions.
  const first = randomStep(seed);
  const second = randomStep(first.seed);
  const u1 = Math.max(first.value, Number.EPSILON);
  const normalShock = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * second.value);
  const rawLogReturn = drift + volatility * normalShock;
  const logReturn = Math.max(-maxMove, Math.min(maxMove, rawLogReturn));
  const unroundedPrice = Math.max(minPrice, currentPrice * Math.exp(logReturn));
  const price = Math.max(minPrice, roundToTick(unroundedPrice, tickSize));
  const change = round(price - currentPrice, 12);
  const changePercent = round((change / currentPrice) * 100, 8);

  return {
    price,
    previousPrice: currentPrice,
    change,
    changePercent,
    seed: second.seed,
    nextSeed: second.seed,
  };
}

function priceForSymbol(marketPrices, symbol) {
  if (isFiniteNumber(marketPrices)) return marketPrices;
  if (!marketPrices || typeof marketPrices !== 'object') return undefined;
  const quote = marketPrices[symbol];
  if (isFiniteNumber(quote)) return quote;
  if (quote && isFiniteNumber(quote.price)) return quote.price;
  return undefined;
}

function positionForSymbol(portfolio, symbol) {
  const raw = portfolio && portfolio.positions && portfolio.positions[symbol];
  if (!raw) return { quantity: 0, averagePrice: 0 };
  return {
    ...raw,
    quantity: isFiniteNumber(raw.quantity) ? raw.quantity : 0,
    averagePrice: isFiniteNumber(raw.averagePrice) ? raw.averagePrice : 0,
  };
}

/**
 * Validate an order and, when portfolio/price context is supplied, its buying
 * power or inventory. Validation never throws for user-entered order data.
 *
 * @param {{symbol:string,side:'buy'|'sell',type:'market'|'limit',quantity:number,limitPrice?:number}} order
 * @param {{portfolio?:object,marketPrice?:number,marketPrices?:object,feeRate?:number}} context
 * @returns {{valid:boolean,isValid:boolean,errors:string[],fieldErrors:object}}
 */
function validateOrder(order, context = {}) {
  const errors = [];
  const fieldErrors = {};

  const addError = (field, message) => {
    errors.push(message);
    if (!fieldErrors[field]) fieldErrors[field] = [];
    fieldErrors[field].push(message);
  };

  if (!order || typeof order !== 'object' || Array.isArray(order)) {
    addError('order', 'Order must be an object.');
    return { valid: false, isValid: false, errors, fieldErrors };
  }

  const symbol = typeof order.symbol === 'string' ? order.symbol.trim() : '';
  const side = typeof order.side === 'string' ? order.side.toLowerCase() : '';
  const type = typeof order.type === 'string' ? order.type.toLowerCase() : '';

  if (!symbol) addError('symbol', 'Symbol is required.');
  if (side !== 'buy' && side !== 'sell') {
    addError('side', 'Side must be either "buy" or "sell".');
  }
  if (type !== 'market' && type !== 'limit') {
    addError('type', 'Order type must be either "market" or "limit".');
  }
  if (!isFiniteNumber(order.quantity) || order.quantity <= 0) {
    addError('quantity', 'Quantity must be a finite number greater than zero.');
  }
  if (type === 'limit' && (!isFiniteNumber(order.limitPrice) || order.limitPrice <= 0)) {
    addError('limitPrice', 'Limit price must be a finite number greater than zero.');
  }

  const feeRate = context.feeRate === undefined ? 0 : context.feeRate;
  if (!isFiniteNumber(feeRate) || feeRate < 0) {
    addError('feeRate', 'Fee rate must be a finite number greater than or equal to zero.');
  }

  let marketPrice = context.marketPrice;
  if (marketPrice === undefined && symbol) {
    marketPrice = priceForSymbol(context.marketPrices, symbol);
  }
  if (context.requireMarketPrice && (!isFiniteNumber(marketPrice) || marketPrice <= 0)) {
    addError('marketPrice', 'A finite market price greater than zero is required.');
  } else if (marketPrice !== undefined && (!isFiniteNumber(marketPrice) || marketPrice <= 0)) {
    addError('marketPrice', 'Market price must be a finite number greater than zero.');
  }

  const portfolio = context.portfolio;
  if (portfolio !== undefined) {
    if (!portfolio || typeof portfolio !== 'object') {
      addError('portfolio', 'Portfolio must be an object.');
    } else if (!isFiniteNumber(portfolio.cash) || portfolio.cash < 0) {
      addError('cash', 'Portfolio cash must be a finite number greater than or equal to zero.');
    } else if (errors.length === 0) {
      if (side === 'buy') {
        const estimatedPrice = type === 'limit' ? order.limitPrice : marketPrice;
        if (isFiniteNumber(estimatedPrice)) {
          const requiredCash = order.quantity * estimatedPrice * (1 + feeRate);
          if (requiredCash > portfolio.cash + Number.EPSILON) {
            addError('cash', 'Insufficient paper cash for this order.');
          }
        }
      } else if (side === 'sell') {
        const available = positionForSymbol(portfolio, symbol).quantity;
        if (order.quantity > available + Number.EPSILON) {
          addError('quantity', 'Insufficient simulated holdings for this order.');
        }
      }
    }
  }

  const valid = errors.length === 0;
  return { valid, isValid: valid, errors, fieldErrors };
}

function clonePortfolio(portfolio) {
  const positions = {};
  const sourcePositions = portfolio && portfolio.positions ? portfolio.positions : {};
  Object.keys(sourcePositions).forEach((symbol) => {
    positions[symbol] = { ...sourcePositions[symbol] };
  });
  return {
    ...portfolio,
    positions,
    trades: Array.isArray(portfolio && portfolio.trades) ? [...portfolio.trades] : [],
  };
}

function normalizedOrder(order) {
  return {
    ...order,
    symbol: order.symbol.trim(),
    side: order.side.toLowerCase(),
    type: order.type.toLowerCase(),
  };
}

function executeAtPrice(orderInput, portfolioInput, executionPrice, options = {}) {
  const feeRate = options.feeRate === undefined ? 0 : options.feeRate;
  const validation = validateOrder(orderInput, {
    portfolio: portfolioInput,
    marketPrice: executionPrice,
    feeRate,
    requireMarketPrice: true,
  });

  if (!validation.valid) {
    return {
      success: false,
      portfolio: portfolioInput,
      trade: null,
      order: orderInput,
      error: validation.errors[0],
      errors: validation.errors,
    };
  }

  const order = normalizedOrder(orderInput);
  const portfolio = clonePortfolio(portfolioInput);
  const existing = positionForSymbol(portfolio, order.symbol);
  const notional = round(order.quantity * executionPrice);
  const fee = round(notional * feeRate);
  const priorRealizedPnl = isFiniteNumber(portfolio.realizedPnl) ? portfolio.realizedPnl : 0;
  const priorFees = isFiniteNumber(portfolio.feesPaid) ? portfolio.feesPaid : 0;

  if (portfolio.initialCash === undefined) {
    portfolio.initialCash = portfolio.cash;
  }

  if (order.side === 'buy') {
    const totalCost = round(notional + fee);
    // The validation estimate is exact here, but retain a guard for rounding.
    if (totalCost > portfolio.cash + Number.EPSILON) {
      return {
        success: false,
        portfolio: portfolioInput,
        trade: null,
        order: orderInput,
        error: 'Insufficient paper cash for this order.',
        errors: ['Insufficient paper cash for this order.'],
      };
    }

    const newQuantity = round(existing.quantity + order.quantity, 12);
    const priorCostBasis = existing.quantity * existing.averagePrice;
    const averagePrice = newQuantity === 0
      ? 0
      : round((priorCostBasis + notional) / newQuantity, 12);

    portfolio.cash = round(portfolio.cash - totalCost);
    portfolio.positions[order.symbol] = {
      ...existing,
      quantity: newQuantity,
      averagePrice,
    };
    portfolio.realizedPnl = round(priorRealizedPnl);
  } else {
    const realized = (executionPrice - existing.averagePrice) * order.quantity;
    const newQuantity = round(existing.quantity - order.quantity, 12);
    portfolio.cash = round(portfolio.cash + notional - fee);
    portfolio.realizedPnl = round(priorRealizedPnl + realized);

    if (newQuantity <= Number.EPSILON) {
      delete portfolio.positions[order.symbol];
    } else {
      portfolio.positions[order.symbol] = {
        ...existing,
        quantity: newQuantity,
      };
    }
  }

  portfolio.feesPaid = round(priorFees + fee);
  const timestamp = options.timestamp === undefined
    ? (order.timestamp === undefined ? 0 : order.timestamp)
    : options.timestamp;
  const tradeId = options.tradeId || `trade-${String(timestamp)}-${order.symbol}-${order.side}-${portfolio.trades.length + 1}`;
  const trade = {
    id: tradeId,
    orderId: order.id === undefined ? null : order.id,
    symbol: order.symbol,
    side: order.side,
    type: order.type,
    quantity: order.quantity,
    price: round(executionPrice, 12),
    notional,
    fee,
    timestamp,
  };
  const filledOrder = {
    ...order,
    status: 'filled',
    filledQuantity: order.quantity,
    averageFillPrice: trade.price,
    filledAt: timestamp,
  };

  portfolio.trades.push(trade);

  return {
    success: true,
    portfolio,
    trade,
    order: filledOrder,
    error: null,
    errors: [],
  };
}

/**
 * Fill a market order against a caller-supplied quote.
 *
 * @param {object} order order described in validateOrder
 * @param {object} portfolio immutable input portfolio
 * @param {number} marketPrice current quote
 * @param {{feeRate?:number,slippageBps?:number,timestamp?:number|string,tradeId?:string}} options
 */
function executeMarketOrder(order, portfolio, marketPrice, options = {}) {
  const slippageBps = options.slippageBps === undefined ? 0 : options.slippageBps;
  if (!isFiniteNumber(slippageBps) || slippageBps < 0) {
    return {
      success: false,
      portfolio,
      trade: null,
      order,
      error: 'Slippage must be a finite number greater than or equal to zero.',
      errors: ['Slippage must be a finite number greater than or equal to zero.'],
    };
  }

  const type = order && typeof order.type === 'string' ? order.type.toLowerCase() : '';
  if (type !== 'market') {
    return {
      success: false,
      portfolio,
      trade: null,
      order,
      error: 'executeMarketOrder only accepts market orders.',
      errors: ['executeMarketOrder only accepts market orders.'],
    };
  }

  const side = order && typeof order.side === 'string' ? order.side.toLowerCase() : '';
  const slippageMultiplier = side === 'sell'
    ? 1 - slippageBps / 10000
    : 1 + slippageBps / 10000;
  const executionPrice = isFiniteNumber(marketPrice)
    ? round(marketPrice * slippageMultiplier, 12)
    : marketPrice;

  return executeAtPrice(order, portfolio, executionPrice, options);
}

function canLimitOrderFill(order, marketPrice) {
  if (!order || typeof order !== 'object' || !isFiniteNumber(marketPrice)) return false;
  const side = typeof order.side === 'string' ? order.side.toLowerCase() : '';
  if (side === 'buy') return marketPrice <= order.limitPrice;
  if (side === 'sell') return marketPrice >= order.limitPrice;
  return false;
}

/**
 * Match open limit orders in price-time input order against current quotes.
 * Crossed orders receive price improvement (the current quote) and fills never
 * occur at a price worse than their limit. The returned orders retain input order.
 *
 * @param {object[]} orders
 * @param {object} portfolio
 * @param {number|object} marketPrices number for one symbol, or symbol -> quote
 * @param {{feeRate?:number,timestamp?:number|string}} options
 * @returns {{portfolio:object,orders:object[],trades:object[],filledOrderIds:Array,rejectedOrderIds:Array}}
 */
function matchLimitOrders(orders, portfolio, marketPrices, options = {}) {
  if (!Array.isArray(orders)) {
    throw new TypeError('orders must be an array');
  }

  let nextPortfolio = portfolio;
  const nextOrders = orders.map((order) => ({ ...order }));
  const trades = [];
  const filledOrderIds = [];
  const rejectedOrderIds = [];

  // createdAt establishes time priority when provided. The original index is a
  // stable and deterministic tie breaker; results are still written in place.
  const priority = nextOrders
    .map((order, index) => ({ order, index }))
    .sort((left, right) => {
      const leftTime = isFiniteNumber(left.order.createdAt) ? left.order.createdAt : left.index;
      const rightTime = isFiniteNumber(right.order.createdAt) ? right.order.createdAt : right.index;
      return leftTime === rightTime ? left.index - right.index : leftTime - rightTime;
    });

  priority.forEach(({ order, index }) => {
    const status = order.status === undefined ? 'open' : String(order.status).toLowerCase();
    if (status !== 'open' && status !== 'pending') return;

    const type = typeof order.type === 'string' ? order.type.toLowerCase() : '';
    if (type !== 'limit') return;

    const marketPrice = priceForSymbol(marketPrices, order.symbol);
    const validation = validateOrder(order, {
      marketPrice,
      feeRate: options.feeRate,
      requireMarketPrice: true,
    });
    if (!validation.valid) {
      nextOrders[index] = {
        ...order,
        status: 'rejected',
        rejectionReason: validation.errors[0],
      };
      rejectedOrderIds.push(order.id === undefined ? index : order.id);
      return;
    }

    if (!canLimitOrderFill(order, marketPrice)) return;

    const execution = executeAtPrice(order, nextPortfolio, marketPrice, {
      ...options,
      tradeId: options.tradeIdPrefix
        ? `${options.tradeIdPrefix}-${trades.length + 1}`
        : undefined,
    });

    if (execution.success) {
      nextPortfolio = execution.portfolio;
      nextOrders[index] = execution.order;
      trades.push(execution.trade);
      filledOrderIds.push(order.id === undefined ? index : order.id);
    } else {
      nextOrders[index] = {
        ...order,
        status: 'rejected',
        rejectionReason: execution.error,
      };
      rejectedOrderIds.push(order.id === undefined ? index : order.id);
    }
  });

  return {
    portfolio: nextPortfolio,
    orders: nextOrders,
    trades,
    filledOrderIds,
    rejectedOrderIds,
  };
}

/**
 * Mark a portfolio to market. Missing quotes are reported and valued at zero so
 * stale data is never silently presented as a live valuation.
 */
function calculatePortfolioMetrics(portfolio, marketPrices = {}) {
  if (!portfolio || typeof portfolio !== 'object') {
    throw new TypeError('portfolio must be an object');
  }
  if (!isFiniteNumber(portfolio.cash)) {
    throw new TypeError('portfolio.cash must be a finite number');
  }

  const positions = [];
  const missingPrices = [];
  let marketValue = 0;
  let costBasis = 0;
  const sourcePositions = portfolio.positions || {};

  Object.keys(sourcePositions).sort().forEach((symbol) => {
    const position = positionForSymbol(portfolio, symbol);
    if (position.quantity === 0) return;

    const marketPrice = priceForSymbol(marketPrices, symbol);
    const hasPrice = isFiniteNumber(marketPrice) && marketPrice >= 0;
    if (!hasPrice) missingPrices.push(symbol);

    const positionValue = hasPrice ? position.quantity * marketPrice : 0;
    const positionCost = position.quantity * position.averagePrice;
    const unrealizedPnl = hasPrice ? positionValue - positionCost : null;

    marketValue += positionValue;
    costBasis += positionCost;
    positions.push({
      symbol,
      quantity: position.quantity,
      averagePrice: position.averagePrice,
      marketPrice: hasPrice ? marketPrice : null,
      marketValue: round(positionValue),
      costBasis: round(positionCost),
      unrealizedPnl: unrealizedPnl === null ? null : round(unrealizedPnl),
      unrealizedPnlPercent: unrealizedPnl === null || positionCost === 0
        ? null
        : round((unrealizedPnl / positionCost) * 100),
    });
  });

  marketValue = round(marketValue);
  costBasis = round(costBasis);
  const cash = round(portfolio.cash);
  const equity = round(cash + marketValue);
  const unrealizedPnl = missingPrices.length === 0 ? round(marketValue - costBasis) : null;
  const realizedPnl = round(isFiniteNumber(portfolio.realizedPnl) ? portfolio.realizedPnl : 0);
  const feesPaid = round(isFiniteNumber(portfolio.feesPaid) ? portfolio.feesPaid : 0);
  const initialCash = isFiniteNumber(portfolio.initialCash) ? portfolio.initialCash : null;
  const totalPnl = initialCash === null || missingPrices.length > 0
    ? null
    : round(equity - initialCash);
  const totalPnlPercent = totalPnl === null || initialCash === 0
    ? null
    : round((totalPnl / initialCash) * 100);

  return {
    cash,
    marketValue,
    holdingsValue: marketValue,
    equity,
    totalValue: equity,
    costBasis,
    unrealizedPnl,
    unrealizedPnlPercent: unrealizedPnl === null || costBasis === 0
      ? null
      : round((unrealizedPnl / costBasis) * 100),
    realizedPnl,
    netRealizedPnl: round(realizedPnl - feesPaid),
    feesPaid,
    initialCash,
    totalPnl,
    totalPnlPercent,
    returnPercent: totalPnlPercent,
    positions,
    missingPrices,
    isFullyPriced: missingPrices.length === 0,
  };
}

module.exports = {
  calculatePortfolioMetrics,
  canLimitOrderFill,
  createRng,
  executeMarketOrder,
  matchLimitOrders,
  nextPrice,
  nextSeed,
  normalizeSeed,
  randomStep,
  validateOrder,
};

