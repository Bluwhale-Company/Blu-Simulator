import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bot,
  BookOpen,
  Check,
  ChevronDown,
  Code2,
  Clock3,
  History,
  Info,
  ListOrdered,
  Pause,
  Power,
  Play,
  Radio,
  Repeat2,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  StepForward,
  Trash2,
  TrendingDown,
  TrendingUp,
  Waves,
  Zap,
  X,
} from 'lucide-react';
import PriceChart from './components/PriceChart';
import useTradingSimulator from './hooks/useTradingSimulator';
import { ASSETS } from './lib/market';
import { parseCustomScript } from './lib/algorithmicTrading';
import {
  formatClock,
  formatCurrency,
  formatPercent,
  formatPrice,
  formatQuantity,
  formatSimTime,
} from './lib/format';

const SPEEDS = [1, 5, 15, 60];
const STRATEGY_OPTIONS = [
  {
    id: 'momentum',
    name: 'Momentum',
    description: 'Follow strong moves',
    Icon: Zap,
  },
  {
    id: 'mean_reversion',
    name: 'Mean reversion',
    description: 'Buy statistical dips',
    Icon: Waves,
  },
  {
    id: 'dca',
    name: 'Smart DCA',
    description: 'Accumulate on schedule',
    Icon: Repeat2,
  },
  {
    id: 'custom',
    name: 'Custom script',
    description: 'Write your own rules',
    Icon: Code2,
  },
];

const CUSTOM_SCRIPT_TEMPLATES = {
  momentum: {
    label: 'Momentum',
    script: '# Trend with an RSI heat check\nBUY WHEN momentum(18) > 0.20 AND rsi(14) < 75\nSELL WHEN momentum(12) < -0.10 OR rsi(14) > 82',
  },
  crossover: {
    label: 'EMA crossover',
    script: '# Fast trend above the longer average\nBUY WHEN price > ema(12) AND ema(12) > sma(30)\nSELL WHEN price < ema(12)',
  },
  rsi: {
    label: 'RSI swing',
    script: '# Buy oversold and exit overbought\nBUY WHEN rsi(14) < 35\nSELL WHEN rsi(14) > 65',
  },
};

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32">
        <path d="M6 23.5 13.1 8l4.1 9.1L20.9 10 26 23.5h-4.2l-1.5-4.2-3.2 6.2-4-8.9-3 6.9Z" />
      </svg>
    </div>
  );
}

function AssetIcon({ symbol, color, size = 'normal' }) {
  return (
    <span
      className={`asset-icon asset-icon--${size}`}
      style={{ '--asset-color': color }}
      aria-hidden="true"
    >
      {symbol.slice(0, 1)}
    </span>
  );
}

function DirectionValue({ value, kind = 'percent', compact = false }) {
  const positive = Number(value) >= 0;
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  const label = kind === 'currency'
    ? formatCurrency(value, { compact })
    : formatPercent(value);

  return (
    <span className={`direction-value ${positive ? 'is-positive' : 'is-negative'}`}>
      <Icon size={13} strokeWidth={2.4} aria-hidden="true" />
      {label.replace(/^[-+]/, '')}
    </span>
  );
}

function Sparkline({ candles, positive, symbol }) {
  const points = useMemo(() => {
    const values = candles.slice(-22).map((candle) => candle.close);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    return values
      .map((value, index) => {
        const x = (index / Math.max(values.length - 1, 1)) * 70;
        const y = 25 - ((value - min) / span) * 20;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  }, [candles]);

  return (
    <svg className="sparkline" viewBox="0 0 70 30" aria-label={`${symbol} mini price chart`}>
      <defs>
        <linearGradient id={`spark-${symbol}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={positive ? '#25cba0' : '#ff647c'} stopOpacity="0.25" />
          <stop offset="100%" stopColor={positive ? '#25cba0' : '#ff647c'} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,30 ${points} 70,30`} fill={`url(#spark-${symbol})`} />
      <polyline
        points={points}
        fill="none"
        stroke={positive ? '#25cba0' : '#ff647c'}
        strokeWidth="1.7"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function Header({ session, metrics, onToggle, onSpeed, onStep, onReset }) {
  const isLoadingPrices = session.bootstrap?.status === 'loading';

  return (
    <header className="topbar">
      <div className="brand-lockup">
        <BrandMark />
        <div>
          <div className="brand-name">WynnSimulator</div>
          <div className="brand-subtitle">Trading simulator</div>
        </div>
        <span className="paper-badge"><ShieldCheck size={12} /> Paper only</span>
      </div>

      <div className="sim-clock" title="The market clock advances at the selected simulation speed">
        <span className={`status-dot ${isLoadingPrices ? 'is-loading' : session.running ? 'is-live' : 'is-paused'}`} />
        <div>
          <span className="sim-clock__eyebrow">
            {isLoadingPrices ? 'SYNCING COINBASE PRICES' : session.running ? 'SIMULATION RUNNING' : 'SIMULATION PAUSED'}
          </span>
          <strong>{isLoadingPrices ? 'Preparing live starting quotes…' : formatSimTime(session.simTime)}</strong>
        </div>
      </div>

      <div className="topbar-actions">
        <div className="account-peek">
          <span>Portfolio equity</span>
          <strong>{formatCurrency(metrics.equity)}</strong>
        </div>
        <div className="playback" aria-label="Simulation playback controls">
          <button
            className={`icon-button playback__toggle ${session.running ? 'is-running' : ''}`}
            type="button"
            onClick={onToggle}
            disabled={isLoadingPrices}
            aria-label={session.running ? 'Pause simulation' : 'Start simulation'}
            title="Play or pause (Space)"
          >
            {session.running ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
          </button>
          <div className="speed-switcher">
            {SPEEDS.map((speed) => (
              <button
                className={session.speed === speed ? 'is-active' : ''}
                type="button"
                key={speed}
                onClick={() => onSpeed(speed)}
                aria-pressed={session.speed === speed}
              >
                {speed}×
              </button>
            ))}
          </div>
          {!session.running && (
            <button className="icon-button step-button" type="button" onClick={onStep} title="Advance one simulated minute">
              <StepForward size={16} />
            </button>
          )}
        </div>
        <button className="icon-button reset-button" type="button" onClick={onReset} title="Reset session">
          <RotateCcw size={16} />
        </button>
      </div>
    </header>
  );
}

function PortfolioStrip({ metrics, buyingPower, reservedFunds, tradeCount, algorithms }) {
  const equity = Math.max(0, metrics.equity);
  const investedValue = Math.max(0, metrics.marketValue);
  const safePercent = (value) => equity > 0
    ? Math.min(100, Math.max(0, (value / equity) * 100))
    : 0;
  const investedPercent = safePercent(investedValue);
  const reservedPercent = safePercent(reservedFunds);
  const availablePercent = Math.max(0, 100 - investedPercent - reservedPercent);
  const reservedEnd = Math.min(100, investedPercent + reservedPercent);
  const activeAlgorithms = algorithms.filter((algorithm) => algorithm.status === 'running');
  const algorithmExecutions = algorithms.reduce((sum, algorithm) => sum + algorithm.executions, 0);
  const algorithmPnl = algorithms.reduce((sum, algorithm) => sum + algorithm.estimatedPnl, 0);

  return (
    <section className="portfolio-strip" aria-label="Portfolio summary">
      <div className="funds-card">
        <div className="funds-card__heading">
          <div>
            <span className="section-eyebrow">Paper funds</span>
            <h2>Portfolio balance</h2>
          </div>
          <span className="funds-health"><span /> Funds healthy</span>
        </div>
        <div className="funds-card__body">
          <div className="funds-total">
            <span>Total equity</span>
            <strong>{formatCurrency(metrics.equity)}</strong>
            <div className="funds-return">
              <DirectionValue value={metrics.totalPnlPercent || 0} />
              <span>{formatCurrency(metrics.totalPnl || 0)} all time</span>
            </div>
          </div>
          <div
            className="funds-ring"
            style={{
              background: `conic-gradient(#25cba0 0 ${investedPercent}%, #b99cff ${investedPercent}% ${reservedEnd}%, #6c8cff ${reservedEnd}% 100%)`,
            }}
            aria-label={`${investedPercent.toFixed(0)} percent invested`}
          >
            <div><strong>{investedPercent.toFixed(0)}%</strong><span>invested</span></div>
          </div>
          <div className="funds-breakdown">
            <div><span className="legend-dot is-available" /><span>Available</span><strong>{formatCurrency(buyingPower)}</strong><small>{availablePercent.toFixed(0)}%</small></div>
            <div><span className="legend-dot is-invested" /><span>Invested</span><strong>{formatCurrency(investedValue)}</strong><small>{investedPercent.toFixed(0)}%</small></div>
            <div><span className="legend-dot is-reserved" /><span>Reserved</span><strong>{formatCurrency(reservedFunds)}</strong><small>{reservedPercent.toFixed(0)}%</small></div>
          </div>
        </div>
        <div className="funds-allocation-bar" aria-hidden="true">
          <span className="is-invested" style={{ width: `${investedPercent}%` }} />
          <span className="is-reserved" style={{ width: `${reservedPercent}%` }} />
          <span className="is-available" style={{ width: `${availablePercent}%` }} />
        </div>
        <div className="coin-balances" aria-label="Coin balances">
          {ASSETS.map((asset) => {
            const position = metrics.positions.find((candidate) => candidate.symbol === asset.symbol);
            const quantity = position?.quantity || 0;
            return (
              <div className="coin-balance" key={asset.symbol}>
                <AssetIcon symbol={asset.symbol} color={asset.color} size="small" />
                <div><span>{asset.symbol}</span><strong>{formatQuantity(quantity, 6)}</strong></div>
                <small>{formatCurrency(position?.marketValue || 0)}</small>
              </div>
            );
          })}
        </div>
      </div>

      <div className="balance-insight-card">
        <div className="insight-card__heading">
          <span className={`metric-card__icon ${Number(metrics.totalPnl) >= 0 ? 'tone-green' : 'tone-red'}`}><BarChart3 size={17} /></span>
          <span>Performance</span>
          <DirectionValue value={metrics.totalPnlPercent || 0} />
        </div>
        <strong>{formatCurrency(metrics.totalPnl || 0)}</strong>
        <div className="insight-breakdown">
          <div><span>Unrealized</span><b className={Number(metrics.unrealizedPnl) >= 0 ? 'is-positive' : 'is-negative'}>{formatCurrency(metrics.unrealizedPnl || 0)}</b></div>
          <div><span>Realized</span><b>{formatCurrency(metrics.netRealizedPnl || 0)}</b></div>
          <div><span>Filled trades</span><b>{tradeCount}</b></div>
        </div>
      </div>

      <div className="balance-insight-card automation-insight">
        <div className="insight-card__heading">
          <span className="metric-card__icon tone-violet"><Bot size={17} /></span>
          <span>Automations</span>
          <span className={`automation-live ${activeAlgorithms.length ? 'is-running' : ''}`}><span /> {activeAlgorithms.length} live</span>
        </div>
        <strong>{formatCurrency(algorithmPnl)}</strong>
        <div className="insight-breakdown">
          <div><span>Deployed</span><b>{algorithms.length}</b></div>
          <div><span>Algo executions</span><b>{algorithmExecutions}</b></div>
          <div><span>Cash protection</span><b>Allocation caps</b></div>
        </div>
      </div>
    </section>
  );
}

function Watchlist({ market, selectedSymbol, onSelect, bootstrap }) {
  const [query, setQuery] = useState('');
  const filteredAssets = ASSETS.filter((asset) =>
    `${asset.name} ${asset.symbol}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <aside className="panel watchlist-panel">
      <div className="panel-header watchlist-header">
        <div>
          <span className="section-eyebrow">Markets</span>
          <h2>Watchlist</h2>
        </div>
        <span className="market-open"><span /> 24/7</span>
      </div>
      <label className="search-field">
        <Search size={15} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search assets"
          aria-label="Search assets"
        />
        <kbd>/</kbd>
      </label>
      <div className="watchlist-labels" aria-hidden="true">
        <span>Asset</span>
        <span>Chart</span>
        <span>Price / 24h</span>
      </div>
      <div className="asset-list">
        {filteredAssets.map((definition) => {
          const asset = market[definition.symbol];
          const positive = asset.changePercent >= 0;
          return (
            <button
              type="button"
              className={`asset-row ${selectedSymbol === definition.symbol ? 'is-selected' : ''}`}
              key={definition.symbol}
              onClick={() => onSelect(definition.symbol)}
            >
              <span className="asset-row__identity">
                <AssetIcon symbol={definition.symbol} color={definition.color} />
                <span>
                  <strong>{definition.symbol}</strong>
                  <small>{definition.name}</small>
                </span>
              </span>
              <Sparkline candles={asset.candles} positive={positive} symbol={definition.symbol} />
              <span className="asset-row__quote">
                <strong>{formatPrice(asset.price)}</strong>
                <small className={positive ? 'is-positive' : 'is-negative'}>
                  {positive ? '▲' : '▼'} {Math.abs(asset.changePercent).toFixed(2)}%
                </small>
              </span>
            </button>
          );
        })}
      </div>
      <div className="watchlist-footer">
        <Info size={14} />
        <span>
          {bootstrap?.status === 'loading'
            ? 'Syncing starting prices with Coinbase'
            : bootstrap?.source === 'coinbase'
              ? 'Coinbase-seeded open · simulated movement'
              : bootstrap?.source === 'mixed'
                ? 'Coinbase + fallback open · simulated movement'
                : 'Fallback open · simulated movement'}
        </span>
      </div>
    </aside>
  );
}

function MarketChart({ asset, isRunning, speed, bootstrap }) {
  const period = asset.candles.slice(-60);
  const high = Math.max(...period.map((candle) => candle.high));
  const low = Math.min(...period.map((candle) => candle.low));
  const volume = period.reduce((sum, candle) => sum + candle.volume, 0);
  const positive = asset.changePercent >= 0;

  return (
    <section className="panel chart-panel">
      <div className="chart-header">
        <div className="selected-asset">
          <AssetIcon symbol={asset.symbol} color={asset.color} size="large" />
          <div>
            <div className="selected-asset__name">
              <h2>{asset.name}</h2>
              <span>{asset.pair}</span>
              <ChevronDown size={14} />
            </div>
            <div className="selected-asset__meta">
              <span className="synthetic-dot" />
              {bootstrap?.status === 'loading'
                ? 'Syncing Coinbase starting price'
                : bootstrap?.source === 'coinbase'
                  ? 'Coinbase-seeded simulated market'
                  : bootstrap?.source === 'mixed'
                    ? 'Mixed-source simulated market'
                    : 'Fallback simulated market'}
            </div>
          </div>
        </div>
        <div className="live-quote">
          <strong>{formatPrice(asset.price)}</strong>
          <DirectionValue value={asset.changePercent} />
        </div>
        <div className="market-stats">
          <div><span>Session high</span><strong>{formatPrice(high)}</strong></div>
          <div><span>Session low</span><strong>{formatPrice(low)}</strong></div>
          <div><span>Sim volume</span><strong>{formatCurrency(volume, { compact: true })}</strong></div>
        </div>
      </div>
      <div className="chart-toolbar">
        <div className="timeframe-tabs" aria-label="Chart timeframe">
          {['1m', '5m', '15m', '1h', '4h'].map((timeframe) => (
            <button type="button" key={timeframe} className={timeframe === '1m' ? 'is-active' : ''}>
              {timeframe}
            </button>
          ))}
        </div>
        <div className="chart-status">
          <span className={bootstrap?.status === 'loading' ? 'is-loading' : isRunning ? 'is-live' : 'is-paused'}>
            {bootstrap?.status === 'loading'
              ? <><span className="sync-spinner" /> Syncing spot prices</>
              : isRunning
                ? <><span className="pulse-dot" /> Playing at {speed}×</>
                : <><Pause size={12} /> Paused</>}
          </span>
        </div>
      </div>
      <div className="chart-canvas">
        <PriceChart candles={asset.candles} colorUp="#25cba0" colorDown="#ff647c" isRunning={isRunning} />
      </div>
      <div className="chart-caption">
        <span><Clock3 size={13} /> Each candle represents a compressed market interval</span>
        <span className={positive ? 'is-positive' : 'is-negative'}>
          {positive ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
          Session {positive ? 'gain' : 'loss'} {Math.abs(asset.changePercent).toFixed(2)}%
        </span>
      </div>
    </section>
  );
}

function AlgorithmBuilder({ asset, algorithms, onDeploy, onToggle, onRemove }) {
  const [strategy, setStrategy] = useState('momentum');
  const [symbol, setSymbol] = useState(asset.symbol);
  const [allocationPercent, setAllocationPercent] = useState(15);
  const [customScript, setCustomScript] = useState(CUSTOM_SCRIPT_TEMPLATES.momentum.script);
  const [error, setError] = useState('');
  const scriptValidation = useMemo(
    () => parseCustomScript(customScript),
    [customScript],
  );

  useEffect(() => setSymbol(asset.symbol), [asset.symbol]);

  const deploy = () => {
    if (strategy === 'custom' && !scriptValidation.valid) {
      setError(scriptValidation.errors[0]);
      return;
    }
    const result = onDeploy({ strategy, symbol, allocationPercent, customScript });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError('');
  };

  return (
    <div className="algorithm-builder">
      <div className="algo-intro">
        <span><Radio size={14} /></span>
        <div><strong>Strategies react to simulated ticks</strong><p>Orders use the same paper cash, fees, and risk limits as manual trades.</p></div>
      </div>

      <div className="strategy-selector" aria-label="Algorithm strategy">
        {STRATEGY_OPTIONS.map(({ id, name, description, Icon }) => (
          <button
            type="button"
            key={id}
            className={strategy === id ? 'is-selected' : ''}
            onClick={() => { setStrategy(id); setError(''); }}
          >
            <span><Icon size={14} /></span>
            <strong>{name}</strong>
            <small>{description}</small>
          </button>
        ))}
      </div>

      {strategy === 'custom' && (
        <div className="custom-script-editor">
          <div className="script-editor__heading">
            <div><Code2 size={14} /><span>WynnSimulator Strategy Script</span></div>
            <span className={scriptValidation.valid ? 'is-valid' : 'is-invalid'}>
              <span /> {scriptValidation.valid ? 'Valid' : `${scriptValidation.errors.length} error${scriptValidation.errors.length === 1 ? '' : 's'}`}
            </span>
          </div>
          <div className="script-templates">
            {Object.values(CUSTOM_SCRIPT_TEMPLATES).map((template) => (
              <button type="button" key={template.label} onClick={() => { setCustomScript(template.script); setError(''); }}>
                {template.label}
              </button>
            ))}
          </div>
          <textarea
            value={customScript}
            onChange={(event) => { setCustomScript(event.target.value); setError(''); }}
            spellCheck="false"
            aria-label="Custom algorithm script"
          />
          <div className="script-help">
            <span>Values: <b>price</b>, <b>position</b></span>
            <span>Indicators: <b>sma(n)</b>, <b>ema(n)</b>, <b>momentum(n)</b>, <b>rsi(n)</b></span>
          </div>
          {!scriptValidation.valid && (
            <div className="script-error"><Info size={12} /> {scriptValidation.errors[0]}</div>
          )}
        </div>
      )}

      <div className="algo-config-grid">
        <label>
          <span>Market</span>
          <select value={symbol} onChange={(event) => setSymbol(event.target.value)}>
            {ASSETS.map((option) => <option key={option.symbol} value={option.symbol}>{option.symbol} / USD</option>)}
          </select>
        </label>
        <label>
          <span>Maximum allocation <b>{allocationPercent}%</b></span>
          <input
            type="range"
            min="5"
            max="40"
            step="5"
            value={allocationPercent}
            onChange={(event) => setAllocationPercent(Number(event.target.value))}
          />
          <span className="range-labels"><small>5%</small><small>40%</small></span>
        </label>
      </div>

      <div className="algo-safeguards">
        <span><ShieldCheck size={14} /></span>
        <div><strong>Risk controls on</strong><small>Allocation cap · signal cooldown · cash guard</small></div>
      </div>

      {error && <div className="inline-error" role="alert"><Info size={14} /> {error}</div>}
      <button className="deploy-algorithm" type="button" onClick={deploy}>
        <Bot size={16} /> Deploy {STRATEGY_OPTIONS.find((option) => option.id === strategy)?.name}
      </button>

      <div className="deployed-algorithms">
        <div className="deployed-heading">
          <span>Deployed strategies</span><b>{algorithms.length}/5</b>
        </div>
        {algorithms.length === 0 ? (
          <div className="algo-empty"><Bot size={17} /><span>No algorithms deployed yet</span></div>
        ) : algorithms.map((algorithm) => (
          <div className="algorithm-row" key={algorithm.id}>
            <div className="algorithm-row__top">
              <span className={`algorithm-status ${algorithm.status === 'running' ? 'is-running' : ''}`}><span /></span>
              <div><strong>{algorithm.strategyName}</strong><small>{algorithm.symbol} · {algorithm.allocationPercent}% cap</small></div>
              <span className={algorithm.estimatedPnl >= 0 ? 'is-positive' : 'is-negative'}>{formatCurrency(algorithm.estimatedPnl)}</span>
            </div>
            <p>{algorithm.lastReason}</p>
            <div className="algorithm-row__footer">
              <span>{algorithm.executions} execution{algorithm.executions === 1 ? '' : 's'}</span>
              <div>
                <button type="button" onClick={() => onToggle(algorithm.id)} title={algorithm.status === 'running' ? 'Pause strategy' : 'Resume strategy'}>
                  {algorithm.status === 'running' ? <Pause size={12} /> : <Power size={12} />}
                  {algorithm.status === 'running' ? 'Pause' : 'Resume'}
                </button>
                <button className="remove-algorithm" type="button" onClick={() => onRemove(algorithm.id)} title="Remove strategy; holdings stay in portfolio">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="paper-note">
        <ShieldCheck size={14} />
        <span>Automation is simulated and cannot access real funds.</span>
      </div>
    </div>
  );
}

function OrderTicket({
  asset,
  portfolio,
  buyingPower,
  feeRate,
  algorithms,
  onPlaceOrder,
  onDeployAlgorithm,
  onToggleAlgorithm,
  onRemoveAlgorithm,
}) {
  const [ticketMode, setTicketMode] = useState('manual');
  const [side, setSide] = useState('buy');
  const [type, setType] = useState('market');
  const [amountMode, setAmountMode] = useState('asset');
  const [amount, setAmount] = useState('');
  const [limitPrice, setLimitPrice] = useState(asset.price.toFixed(asset.price < 100 ? 3 : 2));
  const [error, setError] = useState('');

  useEffect(() => {
    setAmount('');
    setError('');
    setLimitPrice(asset.price.toFixed(asset.price < 100 ? 3 : 2));
  }, [asset.symbol]);

  useEffect(() => setError(''), [side, type, amountMode]);

  const referencePrice = type === 'limit' ? Number(limitPrice) || 0 : asset.price;
  const numericAmount = Number(amount) || 0;
  const quantity = amountMode === 'usd'
    ? numericAmount / Math.max(referencePrice, Number.EPSILON)
    : numericAmount;
  const notional = quantity * referencePrice;
  const fee = notional * feeRate;
  const estimatedTotal = side === 'buy' ? notional + fee : Math.max(0, notional - fee);
  const heldQuantity = portfolio.positions[asset.symbol]?.quantity || 0;

  const setPercentage = (percent) => {
    const nextQuantity = side === 'buy'
      ? (buyingPower * percent) / Math.max(referencePrice * (1 + feeRate + 0.0003), Number.EPSILON)
      : heldQuantity * percent;
    const value = amountMode === 'usd' ? nextQuantity * referencePrice : nextQuantity;
    setAmount(value > 0 ? value.toFixed(amountMode === 'usd' ? 2 : 6).replace(/\.?0+$/, '') : '');
    setError('');
  };

  const submit = (event) => {
    event.preventDefault();
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (type === 'limit' && (!Number.isFinite(referencePrice) || referencePrice <= 0)) {
      setError('Enter a valid limit price.');
      return;
    }
    const result = onPlaceOrder({ side, type, quantity, limitPrice: referencePrice });
    if (!result.ok) {
      setError(result.error || 'This paper order could not be placed.');
      return;
    }
    setAmount('');
    setError('');
  };

  return (
    <aside className="panel order-panel">
      <div className="order-panel__header">
        <div>
          <span className="section-eyebrow">Execution</span>
          <h2>{ticketMode === 'manual' ? 'Order ticket' : 'Algo studio'}</h2>
        </div>
        <span className="paper-chip"><Sparkles size={12} /> Paper</span>
      </div>

      <div className="execution-mode-switch" aria-label="Trading mode">
        <button type="button" className={ticketMode === 'manual' ? 'is-active' : ''} onClick={() => setTicketMode('manual')}>
          <ListOrdered size={13} /> Manual
        </button>
        <button type="button" className={ticketMode === 'algorithm' ? 'is-active' : ''} onClick={() => setTicketMode('algorithm')}>
          <Bot size={13} /> Automate
          {algorithms.filter((algorithm) => algorithm.status === 'running').length > 0 && (
            <span>{algorithms.filter((algorithm) => algorithm.status === 'running').length}</span>
          )}
        </button>
      </div>

      {ticketMode === 'manual' ? (
        <form onSubmit={submit}>
          <div className="side-switcher" aria-label="Order side">
            <button type="button" className={side === 'buy' ? 'is-buy' : ''} onClick={() => setSide('buy')}>Buy</button>
            <button type="button" className={side === 'sell' ? 'is-sell' : ''} onClick={() => setSide('sell')}>Sell</button>
          </div>

          <div className="order-type-row">
            <div className="order-type-tabs">
              <button type="button" className={type === 'market' ? 'is-active' : ''} onClick={() => setType('market')}>Market</button>
              <button type="button" className={type === 'limit' ? 'is-active' : ''} onClick={() => setType('limit')}>Limit</button>
            </div>
            <span>Fee {formatPercent(feeRate * 100, false)}</span>
          </div>

          <div className="ticket-balance">
            <span>{side === 'buy' ? 'Buying power' : `${asset.symbol} available`}</span>
            <strong>{side === 'buy' ? formatCurrency(buyingPower) : `${formatQuantity(heldQuantity)} ${asset.symbol}`}</strong>
          </div>

          {type === 'limit' && (
            <label className="ticket-field">
              <span>Limit price</span>
              <span className="ticket-input">
                <input
                  inputMode="decimal"
                  value={limitPrice}
                  onChange={(event) => setLimitPrice(event.target.value)}
                  aria-label="Limit price"
                />
                <b>USD</b>
              </span>
            </label>
          )}

          <label className="ticket-field">
            <span className="ticket-field__label">
              <span>Amount</span>
              <button
                type="button"
                className="unit-toggle"
                onClick={() => setAmountMode((current) => (current === 'asset' ? 'usd' : 'asset'))}
                title="Switch amount units"
              >
                {amountMode === 'asset' ? asset.symbol : 'USD'} <ChevronDown size={12} />
              </button>
            </span>
            <span className="ticket-input ticket-input--large">
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value.replace(/[^0-9.]/g, ''));
                  setError('');
                }}
                aria-label={`Amount in ${amountMode === 'asset' ? asset.symbol : 'USD'}`}
              />
              <b>{amountMode === 'asset' ? asset.symbol : 'USD'}</b>
            </span>
          </label>

          <div className="percentage-buttons" aria-label="Order size shortcuts">
            {[0.25, 0.5, 0.75, 1].map((percent) => (
              <button type="button" key={percent} onClick={() => setPercentage(percent)}>
                {percent === 1 ? 'Max' : `${percent * 100}%`}
              </button>
            ))}
          </div>

          <div className="order-summary">
            <div><span>Reference price</span><strong>{formatPrice(referencePrice)}</strong></div>
            <div><span>Estimated fee</span><strong>{formatCurrency(fee)}</strong></div>
            <div className="order-summary__total"><span>{side === 'buy' ? 'Estimated total' : 'Estimated proceeds'}</span><strong>{formatCurrency(estimatedTotal)}</strong></div>
          </div>

          {error && <div className="inline-error" role="alert"><Info size={14} /> {error}</div>}

          <button className={`place-order-button is-${side}`} type="submit">
            {side === 'buy' ? <ArrowUpRight size={17} /> : <ArrowDownRight size={17} />}
            {type === 'market' ? `${side === 'buy' ? 'Buy' : 'Sell'} ${asset.symbol}` : `Place ${side} limit`}
          </button>

          <div className="paper-note">
            <ShieldCheck size={14} />
            <span>Practice order only. No real funds or crypto are used.</span>
          </div>
        </form>
      ) : (
        <AlgorithmBuilder
          asset={asset}
          algorithms={algorithms}
          onDeploy={onDeployAlgorithm}
          onToggle={onToggleAlgorithm}
          onRemove={onRemoveAlgorithm}
        />
      )}
    </aside>
  );
}

function EmptyState({ type }) {
  const content = {
    positions: {
      Icon: BookOpen,
      title: 'Your practice portfolio is empty',
      text: 'Place a paper buy order to open your first simulated position.',
    },
    orders: {
      Icon: ListOrdered,
      title: 'No open limit orders',
      text: 'Limit orders will wait here until the simulated market reaches your price.',
    },
    history: {
      Icon: History,
      title: 'No trades yet',
      text: 'Filled paper orders will appear here with price, size, and fees.',
    },
    algorithms: {
      Icon: Bot,
      title: 'No algorithm executions yet',
      text: 'Deploy a strategy and keep the simulation running while it scans for signals.',
    },
  }[type];
  const Icon = content.Icon;

  return (
    <div className="empty-state">
      <span><Icon size={20} /></span>
      <div><strong>{content.title}</strong><p>{content.text}</p></div>
    </div>
  );
}

function ActivityPanel({ metrics, orders, trades, algorithmEvents, market, onCancel, onSelect }) {
  const [activeTab, setActiveTab] = useState('positions');
  const tabs = [
    { id: 'positions', label: 'Positions', count: metrics.positions.length },
    { id: 'orders', label: 'Open orders', count: orders.length },
    { id: 'history', label: 'Trade history', count: trades.length },
    { id: 'algorithms', label: 'Algo activity', count: algorithmEvents.length },
  ];

  return (
    <section className="panel activity-panel">
      <div className="activity-tabs" role="tablist" aria-label="Portfolio activity">
        {tabs.map((tab) => (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? 'is-active' : ''}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}<span>{tab.count}</span>
          </button>
        ))}
        <div className="activity-caption"><Clock3 size={13} /> Updates with simulated time</div>
      </div>

      <div className="table-wrap">
        {activeTab === 'positions' && (
          metrics.positions.length ? (
            <table>
              <thead><tr><th>Asset</th><th>Quantity</th><th>Avg. price</th><th>Market price</th><th>Market value</th><th>Unrealized P&L</th><th /></tr></thead>
              <tbody>
                {metrics.positions.map((position) => {
                  const asset = market[position.symbol];
                  return (
                    <tr key={position.symbol}>
                      <td><span className="table-asset"><AssetIcon symbol={position.symbol} color={asset.color} size="small" /><span><strong>{position.symbol}</strong><small>{asset.name}</small></span></span></td>
                      <td>{formatQuantity(position.quantity)}</td>
                      <td>{formatPrice(position.averagePrice)}</td>
                      <td>{formatPrice(position.marketPrice)}</td>
                      <td><strong>{formatCurrency(position.marketValue)}</strong></td>
                      <td><span className={position.unrealizedPnl >= 0 ? 'is-positive' : 'is-negative'}><strong>{formatCurrency(position.unrealizedPnl)}</strong><small>{formatPercent(position.unrealizedPnlPercent)}</small></span></td>
                      <td><button className="table-action" type="button" onClick={() => onSelect(position.symbol)}>Trade</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <EmptyState type="positions" />
        )}

        {activeTab === 'orders' && (
          orders.length ? (
            <table>
              <thead><tr><th>Asset</th><th>Side</th><th>Amount</th><th>Limit price</th><th>Market price</th><th>Placed</th><th /></tr></thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td><strong>{order.symbol} / USD</strong></td>
                    <td><span className={`side-badge is-${order.side}`}>{order.side}</span></td>
                    <td>{formatQuantity(order.quantity)} {order.symbol}</td>
                    <td>{formatPrice(order.limitPrice)}</td>
                    <td>{formatPrice(market[order.symbol].price)}</td>
                    <td>{formatClock(order.createdAt)}</td>
                    <td><button className="cancel-order" type="button" onClick={() => onCancel(order.id)}>Cancel</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <EmptyState type="orders" />
        )}

        {activeTab === 'history' && (
          trades.length ? (
            <table>
              <thead><tr><th>Time</th><th>Asset</th><th>Side</th><th>Order type</th><th>Amount</th><th>Fill price</th><th>Total</th><th>Fee</th></tr></thead>
              <tbody>
                {[...trades].reverse().map((trade) => (
                  <tr key={trade.id}>
                    <td>{formatClock(trade.timestamp)}</td>
                    <td><strong>{trade.symbol} / USD</strong></td>
                    <td><span className={`side-badge is-${trade.side}`}>{trade.side}</span></td>
                    <td className="capitalize">
                      {trade.automation ? <span className="trade-origin"><Bot size={11} /> {trade.strategyName}</span> : trade.type}
                    </td>
                    <td>{formatQuantity(trade.quantity)} {trade.symbol}</td>
                    <td>{formatPrice(trade.price)}</td>
                    <td><strong>{formatCurrency(trade.notional)}</strong></td>
                    <td>{formatCurrency(trade.fee)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <EmptyState type="history" />
        )}

        {activeTab === 'algorithms' && (
          algorithmEvents.length ? (
            <table>
              <thead><tr><th>Time</th><th>Strategy</th><th>Asset</th><th>Action</th><th>Amount</th><th>Fill price</th><th>Value</th><th>Signal rationale</th></tr></thead>
              <tbody>
                {algorithmEvents.map((event) => (
                  <tr key={event.id}>
                    <td>{formatClock(event.timestamp)}</td>
                    <td><span className="trade-origin"><Bot size={11} /> {event.strategyName}</span></td>
                    <td><strong>{event.symbol} / USD</strong></td>
                    <td><span className={`side-badge is-${event.side}`}>{event.side}</span></td>
                    <td>{formatQuantity(event.quantity)} {event.symbol}</td>
                    <td>{formatPrice(event.price)}</td>
                    <td><strong>{formatCurrency(event.notional)}</strong></td>
                    <td className="algo-reason-cell">{event.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <EmptyState type="algorithms" />
        )}
      </div>
    </section>
  );
}

function ResetModal({ onClose, onConfirm }) {
  const [balance, setBalance] = useState(100000);
  const [scenario, setScenario] = useState('focus');

  useEffect(() => {
    const onKeyDown = (event) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="reset-modal" role="dialog" aria-modal="true" aria-labelledby="reset-title">
        <button className="modal-close" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <span className="modal-icon"><RotateCcw size={20} /></span>
        <span className="section-eyebrow">Fresh start</span>
        <h2 id="reset-title">Reset your simulation</h2>
        <p>This clears the current paper portfolio, open orders, automations, and trade history. Choose how you want the next session to begin.</p>

        <fieldset>
          <legend>Starting paper balance</legend>
          <div className="choice-grid choice-grid--three">
            {[50000, 100000, 250000].map((value) => (
              <button type="button" className={balance === value ? 'is-selected' : ''} key={value} onClick={() => setBalance(value)}>
                {balance === value && <Check size={14} />}{formatCurrency(value, { maximumFractionDigits: 0 })}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>Market path</legend>
          <div className="scenario-grid">
            <button type="button" className={scenario === 'focus' ? 'is-selected' : ''} onClick={() => setScenario('focus')}>
              <span><Activity size={17} /></span><strong>Balanced</strong><small>Repeatable learning path</small>
            </button>
            <button type="button" className={scenario === 'rotation' ? 'is-selected' : ''} onClick={() => setScenario('rotation')}>
              <span><TrendingUp size={17} /></span><strong>Rotation</strong><small>Alternative price sequence</small>
            </button>
            <button type="button" className={scenario === 'random' ? 'is-selected' : ''} onClick={() => setScenario('random')}>
              <span><Sparkles size={17} /></span><strong>Surprise me</strong><small>A fresh random seed</small>
            </button>
          </div>
        </fieldset>

        <div className="modal-note"><Info size={14} /> Resetting only affects simulated data stored in this browser.</div>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Keep session</button>
          <button type="button" className="primary-button" onClick={() => onConfirm(balance, scenario)}>Start new session</button>
        </div>
      </div>
    </div>
  );
}

function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className={`toast toast--${toast.tone}`} role="status">
      <span><Check size={15} /></span>{toast.message}
    </div>
  );
}

export default function App() {
  const {
    session,
    metrics,
    buyingPower,
    reservedFunds,
    algorithms,
    toast,
    feeRate,
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
  } = useTradingSimulator();
  const [showReset, setShowReset] = useState(false);
  const selectedAsset = session.market[session.selectedSymbol];

  const confirmReset = (balance, scenario) => {
    resetSession(balance, scenario);
    setShowReset(false);
  };

  return (
    <div className="app-shell">
      <Header
        session={session}
        metrics={metrics}
        onToggle={toggleRunning}
        onSpeed={setSpeed}
        onStep={stepOnce}
        onReset={() => setShowReset(true)}
      />
      <main className="app-main">
        <PortfolioStrip
          metrics={metrics}
          buyingPower={buyingPower}
          reservedFunds={reservedFunds}
          tradeCount={session.portfolio.trades.length}
          algorithms={algorithms}
        />
        <div className="workspace-grid">
          <Watchlist
            market={session.market}
            selectedSymbol={session.selectedSymbol}
            onSelect={selectSymbol}
            bootstrap={session.bootstrap}
          />
          <MarketChart
            asset={selectedAsset}
            isRunning={session.running}
            speed={session.speed}
            bootstrap={session.bootstrap}
          />
          <OrderTicket
            asset={selectedAsset}
            portfolio={session.portfolio}
            buyingPower={buyingPower}
            feeRate={feeRate}
            algorithms={algorithms}
            onPlaceOrder={placeOrder}
            onDeployAlgorithm={deployAlgorithm}
            onToggleAlgorithm={toggleAlgorithm}
            onRemoveAlgorithm={removeAlgorithm}
          />
          <ActivityPanel
            metrics={metrics}
            orders={session.orders}
            trades={session.portfolio.trades}
            algorithmEvents={session.algorithmEvents}
            market={session.market}
            onCancel={cancelOrder}
            onSelect={selectSymbol}
          />
        </div>
      </main>
      {showReset && <ResetModal onClose={() => setShowReset(false)} onConfirm={confirmReset} />}
      <Toast toast={toast} />
    </div>
  );
}
