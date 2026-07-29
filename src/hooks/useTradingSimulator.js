import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  calculatePortfolioMetrics,
  executeMarketOrder,
  matchLimitOrders,
  validateOrder,
} from '../lib/simulation';
import {
  advanceMarket,
  createInitialMarket,
  marketPrices,
  SIMULATION_START,
} from '../lib/market';
import {
  STRATEGY_PRESETS,
  buildAlgorithmOrder,
  evaluateAlgorithm,
  parseCustomScript,
} from '../lib/algorithmicTrading';

const STORAGE_KEY = 'wynn-paper-session-v3';
const FEE_RATE = 0.0005;
const SLIPPAGE_BPS = 2;
const FRAME_MS = 500;

function createSession(initialCash = 100000, scenarioSeed = 'wynn-focus', options = {}) {
  const bootstrap = options.bootstrap || {
    status: 'loading',
    source: null,
    provider: null,
    fetchedAt: null,
    error: null,
  };

  return {
    version: 3,
    scenarioSeed,
    startingBalance: initialCash,
    simTime: SIMULATION_START,
    tick: 0,
    speed: 15,
    running: bootstrap.status !== 'loading',
    selectedSymbol: 'BTC',
    market: createInitialMarket(scenarioSeed, options.startingPrices),
    bootstrap,
    portfolio: {
      cash: initialCash,
      initialCash,
      positions: {},
      trades: [],
      realizedPnl: 0,
      feesPaid: 0,
    },
    orders: [],
    algorithms: [],
    algorithmEvents: [],
    algorithmSequence: 0,
  };
}

function hydrateSession() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return createSession();
    const parsed = JSON.parse(stored);
    if (
      parsed?.version !== 3
      || !parsed.market?.BTC
      || !Number.isFinite(parsed.portfolio?.cash)
      || !Array.isArray(parsed.orders)
      || !Array.isArray(parsed.algorithms)
    ) {
      return createSession();
    }
    return parsed;
  } catch (_error) {
    return createSession();
  }
}

function runAlgorithms(session, market, portfolio, orders, tick, simTime) {
  if (!Array.isArray(session.algorithms) || session.algorithms.length === 0) {
    return {
      portfolio,
      algorithms: session.algorithms || [],
      algorithmEvents: session.algorithmEvents || [],
    };
  }

  const prices = marketPrices(market);
  const reservedCash = orders
    .filter((order) => order.side === 'buy')
    .reduce((sum, order) => sum + order.quantity * order.limitPrice * (1 + FEE_RATE), 0);
  let nextPortfolio = portfolio;
  let events = session.algorithmEvents || [];

  const algorithms = session.algorithms.map((sourceAlgorithm) => {
    let algorithm = { ...sourceAlgorithm };
    const asset = market[algorithm.symbol];
    if (!asset || algorithm.status !== 'running') return algorithm;

    const signal = evaluateAlgorithm(algorithm, asset.candles, tick);
    if (!signal.shouldEvaluate) return algorithm;
    algorithm = {
      ...algorithm,
      lastEvaluatedTick: tick,
      lastSignal: signal.action,
      lastReason: signal.reason,
      signalStrengthPercent: signal.strengthPercent,
    };

    if (signal.action === 'hold') return algorithm;
    const preset = STRATEGY_PRESETS[algorithm.strategy];
    if (tick - (algorithm.lastExecutionTick ?? -Infinity) < preset.cooldownTicks) {
      return { ...algorithm, lastReason: 'Signal detected; risk cooldown is still active.' };
    }

    const metrics = calculatePortfolioMetrics(nextPortfolio, prices);
    const reservedQuantity = orders
      .filter((order) => order.side === 'sell' && order.symbol === algorithm.symbol)
      .reduce((sum, order) => sum + order.quantity, 0);
    const portfolioQuantity = nextPortfolio.positions[algorithm.symbol]?.quantity || 0;
    const orderSpec = buildAlgorithmOrder({
      algorithm,
      signal,
      marketPrice: asset.price,
      equity: metrics.equity,
      availableCash: Math.max(0, nextPortfolio.cash - reservedCash),
      availableQuantity: Math.max(0, portfolioQuantity - reservedQuantity),
      feeRate: FEE_RATE,
      slippageBps: SLIPPAGE_BPS,
    });
    if (!orderSpec) {
      return { ...algorithm, lastReason: `${signal.reason} Allocation or available funds prevented a trade.` };
    }

    const order = {
      id: `algo-order-${algorithm.id}-${tick}-${algorithm.executions + 1}`,
      symbol: algorithm.symbol,
      side: orderSpec.side,
      type: 'market',
      quantity: orderSpec.quantity,
      status: 'open',
      createdAt: simTime,
      timestamp: simTime,
      automation: true,
      strategyId: algorithm.id,
    };
    const execution = executeMarketOrder(order, nextPortfolio, asset.price, {
      feeRate: FEE_RATE,
      slippageBps: SLIPPAGE_BPS,
      timestamp: simTime,
    });
    if (!execution.success) {
      return { ...algorithm, lastReason: execution.error || 'Automated order could not execute.' };
    }

    const automatedTrade = {
      ...execution.trade,
      automation: true,
      strategyId: algorithm.id,
      strategyName: preset.name,
      reason: signal.reason,
    };
    nextPortfolio = {
      ...execution.portfolio,
      trades: [...execution.portfolio.trades.slice(0, -1), automatedTrade],
    };
    const signedCapital = orderSpec.side === 'buy'
      ? automatedTrade.notional + automatedTrade.fee
      : -(automatedTrade.notional - automatedTrade.fee);
    const trackedQuantity = orderSpec.side === 'buy'
      ? (algorithm.trackedQuantity || 0) + automatedTrade.quantity
      : Math.max(0, (algorithm.trackedQuantity || 0) - automatedTrade.quantity);
    algorithm = {
      ...algorithm,
      trackedQuantity,
      capitalCommitted: (algorithm.capitalCommitted || 0) + signedCapital,
      feesPaid: (algorithm.feesPaid || 0) + automatedTrade.fee,
      executions: algorithm.executions + 1,
      lastExecutionTick: tick,
      lastAction: automatedTrade.side,
      lastPrice: automatedTrade.price,
      lastReason: signal.reason,
    };
    events = [{
      id: `algo-event-${algorithm.id}-${tick}-${algorithm.executions}`,
      algorithmId: algorithm.id,
      strategyName: preset.name,
      symbol: algorithm.symbol,
      side: automatedTrade.side,
      quantity: automatedTrade.quantity,
      price: automatedTrade.price,
      notional: automatedTrade.notional,
      reason: signal.reason,
      timestamp: simTime,
    }, ...events].slice(0, 100);
    return algorithm;
  });

  return { portfolio: nextPortfolio, algorithms, algorithmEvents: events };
}

function advanceSession(session, elapsedMs) {
  // Consume the same fixed market steps at every playback speed. Faster modes
  // batch more deterministic steps into one render, so changing speed cannot
  // alter the path or skip a limit-order crossing.
  const stepCount = Math.max(1, Math.round((elapsedMs * session.speed) / FRAME_MS));
  let nextSession = session;

  for (let index = 0; index < stepCount; index += 1) {
    const simTime = nextSession.simTime + FRAME_MS;
    const market = advanceMarket(
      nextSession.market,
      simTime,
      nextSession.tick + 1,
      FRAME_MS,
    );
    const matching = matchLimitOrders(
      nextSession.orders,
      nextSession.portfolio,
      marketPrices(market),
      {
        feeRate: FEE_RATE,
        timestamp: simTime,
        tradeIdPrefix: `fill-${nextSession.tick + 1}`,
      },
    );

    const openOrders = matching.orders.filter(
      (order) => order.status === 'open' || order.status === 'pending',
    );
    const automation = runAlgorithms(
      nextSession,
      market,
      matching.portfolio,
      openOrders,
      nextSession.tick + 1,
      simTime,
    );

    nextSession = {
      ...nextSession,
      simTime,
      tick: nextSession.tick + 1,
      market,
      portfolio: automation.portfolio,
      orders: openOrders,
      algorithms: automation.algorithms,
      algorithmEvents: automation.algorithmEvents,
    };
  }

  return nextSession;
}

export default function useTradingSimulator() {
  const [session, setSession] = useState(hydrateSession);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const notifiedTrade = useRef(session.portfolio.trades.at(-1)?.id || null);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const notify = useCallback((message, tone = 'success') => {
    window.clearTimeout(toastTimer.current);
    setToast({ id: `${Date.now()}-${message}`, message, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  useEffect(() => {
    if (session.bootstrap?.status !== 'loading') return undefined;
    const controller = new AbortController();

    async function loadStartingPrices() {
      try {
        const response = await fetch('/api/market/bootstrap', {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Market bootstrap returned ${response.status}.`);

        const payload = await response.json();
        if (!Array.isArray(payload.assets) || payload.assets.length === 0) {
          throw new Error('Market bootstrap did not include any assets.');
        }
        const startingPrices = Object.fromEntries(
          payload.assets
            .filter((asset) => Number.isFinite(Number(asset.basePrice)) && Number(asset.basePrice) > 0)
            .map((asset) => [asset.symbol, Number(asset.basePrice)]),
        );

        setSession((current) => {
          if (current.bootstrap?.status !== 'loading') return current;
          return {
            ...current,
            market: createInitialMarket(current.scenarioSeed, startingPrices),
            bootstrap: {
              status: 'ready',
              source: payload.source || 'fallback',
              provider: payload.provider || null,
              fetchedAt: payload.fetchedAt || null,
              error: null,
            },
            running: true,
          };
        });

        if (payload.source === 'coinbase') {
          notify('Coinbase spot prices loaded as the simulation starting point', 'info');
        } else if (payload.source === 'mixed') {
          notify('Started with Coinbase prices and fallback quotes for unavailable assets', 'info');
        } else {
          notify('Coinbase is unavailable; using safe fallback starting prices', 'info');
        }
      } catch (error) {
        if (error.name === 'AbortError') return;
        setSession((current) => ({
          ...current,
          bootstrap: {
            status: 'ready',
            source: 'fallback',
            provider: null,
            fetchedAt: null,
            error: 'Live starting prices were unavailable.',
          },
          running: true,
        }));
        notify('Coinbase is unavailable; using safe fallback starting prices', 'info');
      }
    }

    loadStartingPrices();
    return () => controller.abort();
  }, [notify, session.bootstrap?.status]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      } catch (_error) {
        // The simulator remains fully functional when storage is unavailable.
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [session]);

  useEffect(() => {
    if (!session.running) return undefined;
    const interval = window.setInterval(() => {
      setSession((current) => advanceSession(current, FRAME_MS));
    }, FRAME_MS);
    return () => window.clearInterval(interval);
  }, [session.running]);

  useEffect(() => {
    const latest = session.portfolio.trades.at(-1);
    if (!latest || latest.id === notifiedTrade.current) return;
    notifiedTrade.current = latest.id;
    const verb = latest.side === 'buy' ? 'Bought' : 'Sold';
    notify(
      `${latest.automation ? `${latest.strategyName} · ` : ''}${verb} ${latest.quantity.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${latest.symbol} at $${latest.price.toLocaleString(undefined, { maximumFractionDigits: 3 })}`,
    );
  }, [notify, session.portfolio.trades]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.code !== 'Space' || event.repeat) return;
      const tagName = event.target?.tagName?.toLowerCase();
      if (['input', 'textarea', 'select', 'button'].includes(tagName)) return;
      event.preventDefault();
      setSession((current) => (
        current.bootstrap?.status === 'loading'
          ? current
          : { ...current, running: !current.running }
      ));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const prices = useMemo(() => marketPrices(session.market), [session.market]);
  const metrics = useMemo(
    () => calculatePortfolioMetrics(session.portfolio, prices),
    [prices, session.portfolio],
  );

  const buyingPower = useMemo(() => {
    const reserved = session.orders
      .filter((order) => order.side === 'buy')
      .reduce((total, order) => total + order.quantity * order.limitPrice * (1 + FEE_RATE), 0);
    return Math.max(0, session.portfolio.cash - reserved);
  }, [session.orders, session.portfolio.cash]);

  const algorithms = useMemo(() => session.algorithms.map((algorithm) => {
    const marketPrice = session.market[algorithm.symbol]?.price || 0;
    const currentValue = (algorithm.trackedQuantity || 0) * marketPrice;
    return {
      ...algorithm,
      strategyName: STRATEGY_PRESETS[algorithm.strategy]?.name || algorithm.strategy,
      currentValue,
      estimatedPnl: currentValue - (algorithm.capitalCommitted || 0),
    };
  }), [session.algorithms, session.market]);

  const placeOrder = useCallback((orderInput) => {
    const current = sessionRef.current;
    const symbol = current.selectedSymbol;
    const marketPrice = current.market[symbol].price;
    const quantity = Number(orderInput.quantity);
    const type = orderInput.type === 'limit' ? 'limit' : 'market';
    const order = {
      id: `order-${current.tick}-${current.orders.length + current.portfolio.trades.length + 1}`,
      symbol,
      side: orderInput.side === 'sell' ? 'sell' : 'buy',
      type,
      quantity,
      limitPrice: type === 'limit' ? Number(orderInput.limitPrice) : undefined,
      status: 'open',
      createdAt: current.simTime,
      timestamp: current.simTime,
    };

    const reservedCash = current.orders
      .filter((candidate) => candidate.side === 'buy')
      .reduce((sum, candidate) => sum + candidate.quantity * candidate.limitPrice * (1 + FEE_RATE), 0);
    const reservedUnits = current.orders
      .filter((candidate) => candidate.side === 'sell' && candidate.symbol === symbol)
      .reduce((sum, candidate) => sum + candidate.quantity, 0);
    const availablePortfolio = {
      ...current.portfolio,
      cash: Math.max(0, current.portfolio.cash - reservedCash),
      positions: {
        ...current.portfolio.positions,
        [symbol]: {
          ...(current.portfolio.positions[symbol] || { averagePrice: 0 }),
          quantity: Math.max(
            0,
            (current.portfolio.positions[symbol]?.quantity || 0) - reservedUnits,
          ),
        },
      },
    };
    const validation = validateOrder(order, {
      portfolio: availablePortfolio,
      marketPrice,
      feeRate: FEE_RATE,
      requireMarketPrice: true,
    });

    if (!validation.valid) {
      return { ok: false, error: validation.errors[0] };
    }

    if (type === 'limit') {
      const nextSession = { ...current, orders: [order, ...current.orders] };
      sessionRef.current = nextSession;
      setSession(nextSession);
      notify(`${order.side === 'buy' ? 'Buy' : 'Sell'} limit order placed`, 'info');
      return { ok: true, queued: true };
    }

    const execution = executeMarketOrder(order, current.portfolio, marketPrice, {
      feeRate: FEE_RATE,
      slippageBps: SLIPPAGE_BPS,
      timestamp: current.simTime,
    });
    if (!execution.success) {
      return { ok: false, error: execution.error };
    }

    const nextSession = { ...current, portfolio: execution.portfolio };
    sessionRef.current = nextSession;
    setSession(nextSession);
    return { ok: true, queued: false };
  }, [notify]);

  const cancelOrder = useCallback((orderId) => {
    setSession((current) => ({
      ...current,
      orders: current.orders.filter((order) => order.id !== orderId),
    }));
    notify('Limit order cancelled', 'info');
  }, [notify]);

  const deployAlgorithm = useCallback((input) => {
    const current = sessionRef.current;
    const preset = STRATEGY_PRESETS[input.strategy];
    const allocationPercent = Number(input.allocationPercent);
    if (!preset) return { ok: false, error: 'Choose a valid strategy.' };
    if (!current.market[input.symbol]) return { ok: false, error: 'Choose a valid asset.' };
    if (!Number.isFinite(allocationPercent) || allocationPercent < 5 || allocationPercent > 40) {
      return { ok: false, error: 'Allocation must be between 5% and 40%.' };
    }
    if (input.strategy === 'custom') {
      const validation = parseCustomScript(input.customScript);
      if (!validation.valid) return { ok: false, error: validation.errors[0] };
    }
    if (current.algorithms.length >= 5) {
      return { ok: false, error: 'Pause or remove a strategy before deploying another.' };
    }
    if (current.algorithms.some((algorithm) => (
      algorithm.strategy === input.strategy && algorithm.symbol === input.symbol
    ))) {
      return { ok: false, error: 'That strategy is already deployed for this asset.' };
    }

    const sequence = current.algorithmSequence + 1;
    const algorithm = {
      id: `algorithm-${sequence}`,
      strategy: input.strategy,
      symbol: input.symbol,
      allocationPercent,
      status: 'running',
      trackedQuantity: 0,
      capitalCommitted: 0,
      feesPaid: 0,
      executions: 0,
      createdAt: current.simTime,
      lastEvaluatedTick: null,
      lastExecutionTick: null,
      lastSignal: 'scanning',
      lastReason: 'Scanning the simulated market for the first signal.',
      customScript: input.strategy === 'custom' ? input.customScript : undefined,
    };
    const nextSession = {
      ...current,
      algorithmSequence: sequence,
      algorithms: [algorithm, ...current.algorithms],
    };
    sessionRef.current = nextSession;
    setSession(nextSession);
    notify(`${preset.name} is now running on ${input.symbol}`, 'info');
    return { ok: true, algorithm };
  }, [notify]);

  const toggleAlgorithm = useCallback((algorithmId) => {
    const current = sessionRef.current;
    const target = current.algorithms.find((algorithm) => algorithm.id === algorithmId);
    if (!target) return;
    const nextStatus = target.status === 'running' ? 'paused' : 'running';
    const nextSession = {
      ...current,
      algorithms: current.algorithms.map((algorithm) => (
        algorithm.id === algorithmId ? { ...algorithm, status: nextStatus } : algorithm
      )),
    };
    sessionRef.current = nextSession;
    setSession(nextSession);
    notify(`${STRATEGY_PRESETS[target.strategy].name} ${nextStatus}`, 'info');
  }, [notify]);

  const removeAlgorithm = useCallback((algorithmId) => {
    const current = sessionRef.current;
    const target = current.algorithms.find((algorithm) => algorithm.id === algorithmId);
    if (!target) return;
    const nextSession = {
      ...current,
      algorithms: current.algorithms.filter((algorithm) => algorithm.id !== algorithmId),
    };
    sessionRef.current = nextSession;
    setSession(nextSession);
    notify('Automation removed; any existing position remains in the portfolio', 'info');
  }, [notify]);

  const resetSession = useCallback((initialCash = 100000, scenario = 'focus') => {
    const scenarioSeed = scenario === 'random'
      ? `wynn-${Date.now()}`
      : `wynn-${scenario}`;
    notifiedTrade.current = null;
    setSession(createSession(initialCash, scenarioSeed));
    notify('New session is syncing its starting prices', 'info');
  }, [notify]);

  const toggleRunning = useCallback(() => {
    setSession((current) => (
      current.bootstrap?.status === 'loading'
        ? current
        : { ...current, running: !current.running }
    ));
  }, []);

  const setSpeed = useCallback((speed) => {
    setSession((current) => ({ ...current, speed: Number(speed) }));
  }, []);

  const stepOnce = useCallback(() => {
    setSession((current) => (current.running ? current : advanceSession(current, 60_000 / current.speed)));
  }, []);

  const selectSymbol = useCallback((symbol) => {
    setSession((current) => ({ ...current, selectedSymbol: symbol }));
  }, []);

  return {
    session,
    metrics,
    buyingPower,
    reservedFunds: Math.max(0, session.portfolio.cash - buyingPower),
    algorithms,
    toast,
    feeRate: FEE_RATE,
    placeOrder,
    cancelOrder,
    deployAlgorithm,
    toggleAlgorithm,
    removeAlgorithm,
    resetSession,
    toggleRunning,
    setSpeed,
    stepOnce,
    selectSymbol,
  };
}
