import React, { useMemo, useRef, useState } from 'react';

const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 420;
const PLOT_LEFT = 14;
const PLOT_RIGHT = 874;
const PRICE_TOP = 30;
const PRICE_BOTTOM = 298;
const VOLUME_TOP = 326;
const VOLUME_BOTTOM = 382;
const TIME_LABEL_Y = 407;
const MAX_VISIBLE_CANDLES = 96;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function formatPrice(value, range = 0) {
  const magnitude = Math.abs(value);
  let digits = 2;

  if (magnitude < 0.01) digits = 6;
  else if (magnitude < 1) digits = 4;
  else if (range > 0 && range < 1) digits = 3;

  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatVolume(value) {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return Math.round(value).toLocaleString();
}

function formatPercentChange(open, close) {
  if (open === 0) return '—';
  const change = ((close - open) / open) * 100;
  return `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
}

function toDate(value) {
  const numericValue = typeof value === 'number' && value < 1e11 ? value * 1000 : value;
  const date = new Date(numericValue);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTime(value, detailed = false) {
  const date = toDate(value);
  if (!date) return String(value ?? '');

  if (detailed) {
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function normalizeCandle(candle, index) {
  const open = Number(candle?.open);
  const high = Number(candle?.high);
  const low = Number(candle?.low);
  const close = Number(candle?.close);

  if (![open, high, low, close].every(Number.isFinite)) return null;

  return {
    time: candle.time ?? index,
    open,
    high: Math.max(high, open, close, low),
    low: Math.min(low, open, close, high),
    close,
    volume: Math.max(0, Number(candle.volume) || 0),
  };
}

export default function PriceChart({
  candles = [],
  colorUp = '#2dd4a7',
  colorDown = '#ff6079',
  isRunning = false,
}) {
  const svgRef = useRef(null);
  const [hover, setHover] = useState(null);

  const chart = useMemo(() => {
    const visibleCandles = candles
      .map(normalizeCandle)
      .filter(Boolean)
      .slice(-MAX_VISIBLE_CANDLES);

    if (!visibleCandles.length) return null;

    const rawLow = Math.min(...visibleCandles.map((candle) => candle.low));
    const rawHigh = Math.max(...visibleCandles.map((candle) => candle.high));
    const baseSpan = rawHigh - rawLow || Math.max(Math.abs(rawHigh) * 0.01, 1);
    const priceMin = rawLow - baseSpan * 0.08;
    const priceMax = rawHigh + baseSpan * 0.08;
    const priceRange = priceMax - priceMin;
    const maxVolume = Math.max(...visibleCandles.map((candle) => candle.volume), 1);
    const step = (PLOT_RIGHT - PLOT_LEFT) / visibleCandles.length;
    const bodyWidth = clamp(step * 0.58, 2, 9);
    const yForPrice = (price) =>
      PRICE_TOP + ((priceMax - price) / priceRange) * (PRICE_BOTTOM - PRICE_TOP);

    const priceTicks = Array.from({ length: 5 }, (_, index) => {
      const ratio = index / 4;
      return {
        y: PRICE_TOP + ratio * (PRICE_BOTTOM - PRICE_TOP),
        value: priceMax - ratio * priceRange,
      };
    });

    const timeTickCount = Math.min(5, visibleCandles.length);
    const timeTickIndexes = [...new Set(
      Array.from({ length: timeTickCount }, (_, index) =>
        Math.round((index / Math.max(timeTickCount - 1, 1)) * (visibleCandles.length - 1)),
      ),
    )];

    return {
      candles: visibleCandles,
      priceMin,
      priceMax,
      priceRange,
      maxVolume,
      step,
      bodyWidth,
      yForPrice,
      priceTicks,
      timeTickIndexes,
    };
  }, [candles]);

  const updateHoverFromPointer = (event) => {
    if (!chart || !svgRef.current) return;
    const bounds = svgRef.current.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * VIEW_WIDTH;
    const y = ((event.clientY - bounds.top) / bounds.height) * VIEW_HEIGHT;

    if (x < PLOT_LEFT || x > PLOT_RIGHT || y < PRICE_TOP || y > VOLUME_BOTTOM) {
      setHover(null);
      return;
    }

    const index = clamp(
      Math.round((x - PLOT_LEFT) / chart.step - 0.5),
      0,
      chart.candles.length - 1,
    );
    setHover({ index, y: clamp(y, PRICE_TOP, VOLUME_BOTTOM) });
  };

  const focusLatestCandle = () => {
    if (!chart) return;
    const index = chart.candles.length - 1;
    setHover({ index, y: chart.yForPrice(chart.candles[index].close) });
  };

  const handleKeyDown = (event) => {
    if (!chart || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();

    let index = hover?.index ?? chart.candles.length - 1;
    if (event.key === 'ArrowLeft') index -= 1;
    if (event.key === 'ArrowRight') index += 1;
    if (event.key === 'Home') index = 0;
    if (event.key === 'End') index = chart.candles.length - 1;
    index = clamp(index, 0, chart.candles.length - 1);
    setHover({ index, y: chart.yForPrice(chart.candles[index].close) });
  };

  if (!chart) {
    return (
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        width="100%"
        height="100%"
        role="img"
        aria-label="Price chart with no market data"
        style={{ display: 'block', minHeight: 260, fontFamily: 'Inter, system-ui, sans-serif' }}
      >
        <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} fill="transparent" />
        <g transform={`translate(${VIEW_WIDTH / 2} ${VIEW_HEIGHT / 2 - 12})`}>
          <path
            d="M-24 12 -12 -4 0 4 18 -20 32 -8"
            fill="none"
            stroke="rgba(148, 163, 184, 0.42)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="-24" cy="12" r="3" fill="rgba(148, 163, 184, 0.55)" />
          <circle cx="18" cy="-20" r="3" fill="rgba(148, 163, 184, 0.55)" />
          <text
            x="0"
            y="44"
            textAnchor="middle"
            fill="#a8b1c1"
            fontSize="17"
            fontWeight="600"
          >
            Waiting for market data
          </text>
          <text x="0" y="66" textAnchor="middle" fill="#687386" fontSize="14">
            Candles will appear when the simulation starts
          </text>
        </g>
      </svg>
    );
  }

  const hoveredCandle = hover ? chart.candles[hover.index] : null;
  const hoveredX = hover ? PLOT_LEFT + (hover.index + 0.5) * chart.step : 0;
  const latestCandle = chart.candles[chart.candles.length - 1];
  const latestY = chart.yForPrice(latestCandle.close);
  const latestColor = latestCandle.close >= latestCandle.open ? colorUp : colorDown;
  const tooltipWidth = 220;
  const tooltipHeight = 104;
  const tooltipX = hover
    ? hoveredX > (PLOT_LEFT + PLOT_RIGHT) / 2
      ? hoveredX - tooltipWidth - 14
      : hoveredX + 14
    : 0;
  const tooltipY = hover
    ? clamp(hover.y - tooltipHeight / 2, PRICE_TOP + 6, VOLUME_BOTTOM - tooltipHeight - 6)
    : 0;
  const hoverColor = hoveredCandle && hoveredCandle.close >= hoveredCandle.open
    ? colorUp
    : colorDown;
  const ariaLabel = `Interactive candlestick chart with ${chart.candles.length} candles. Latest price ${formatPrice(
    latestCandle.close,
    chart.priceRange,
  )}. Use left and right arrow keys to inspect candles.`;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      width="100%"
      height="100%"
      role="img"
      tabIndex="0"
      aria-label={ariaLabel}
      onPointerMove={updateHoverFromPointer}
      onPointerLeave={() => setHover(null)}
      onFocus={focusLatestCandle}
      onBlur={() => setHover(null)}
      onKeyDown={handleKeyDown}
      style={{
        display: 'block',
        minHeight: 260,
        fontFamily: 'Inter, system-ui, sans-serif',
        outline: 'none',
        touchAction: 'none',
      }}
    >
      <title>Paper trading candlestick chart</title>
      <desc>
        Price candles, trading volume, time labels, and an interactive crosshair. Use arrow keys to
        inspect historical candles.
      </desc>

      <g aria-hidden="true">
        <circle cx="20" cy="13" r="3.5" fill={isRunning ? colorUp : '#7f8999'}>
          {isRunning && (
            <animate attributeName="opacity" values="1;0.35;1" dur="1.8s" repeatCount="indefinite" />
          )}
        </circle>
        <text x="29" y="16.5" fill={isRunning ? '#a9b8b4' : '#808a9b'} fontSize="13" fontWeight="700">
          {isRunning ? 'LIVE SIMULATION' : 'SIMULATION PAUSED'}
        </text>

        {chart.priceTicks.map((tick) => (
          <g key={tick.y}>
            <line
              x1={PLOT_LEFT}
              x2={PLOT_RIGHT}
              y1={tick.y}
              y2={tick.y}
              stroke="rgba(148, 163, 184, 0.13)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            <text x={PLOT_RIGHT + 11} y={tick.y + 3.5} fill="#748094" fontSize="13">
              {formatPrice(tick.value, chart.priceRange)}
            </text>
          </g>
        ))}

        <line
          x1={PLOT_LEFT}
          x2={PLOT_RIGHT}
          y1={VOLUME_BOTTOM}
          y2={VOLUME_BOTTOM}
          stroke="rgba(148, 163, 184, 0.12)"
          vectorEffect="non-scaling-stroke"
        />
        <text x={PLOT_LEFT} y={VOLUME_TOP - 8} fill="#677286" fontSize="12" fontWeight="700">
          VOLUME
        </text>

        {chart.candles.map((candle, index) => {
          const x = PLOT_LEFT + (index + 0.5) * chart.step;
          const color = candle.close >= candle.open ? colorUp : colorDown;
          const volumeHeight = (candle.volume / chart.maxVolume) * (VOLUME_BOTTOM - VOLUME_TOP);
          const openY = chart.yForPrice(candle.open);
          const closeY = chart.yForPrice(candle.close);
          const bodyY = Math.min(openY, closeY);
          const bodyHeight = Math.max(Math.abs(openY - closeY), 1.6);

          return (
            <g key={`${candle.time}-${index}`}>
              <rect
                x={x - chart.bodyWidth / 2}
                y={VOLUME_BOTTOM - volumeHeight}
                width={chart.bodyWidth}
                height={Math.max(volumeHeight, 1)}
                rx="1"
                fill={color}
                opacity="0.24"
              />
              <line
                x1={x}
                x2={x}
                y1={chart.yForPrice(candle.high)}
                y2={chart.yForPrice(candle.low)}
                stroke={color}
                strokeWidth="1.2"
                vectorEffect="non-scaling-stroke"
              />
              <rect
                x={x - chart.bodyWidth / 2}
                y={bodyY}
                width={chart.bodyWidth}
                height={bodyHeight}
                rx="1"
                fill={color}
              />
            </g>
          );
        })}

        {chart.timeTickIndexes.map((index) => {
          const x = PLOT_LEFT + (index + 0.5) * chart.step;
          const anchor = index === 0 ? 'start' : index === chart.candles.length - 1 ? 'end' : 'middle';
          return (
            <g key={`time-${index}`}>
              <line
                x1={x}
                x2={x}
                y1={VOLUME_BOTTOM + 3}
                y2={VOLUME_BOTTOM + 7}
                stroke="rgba(148, 163, 184, 0.24)"
              />
              <text x={x} y={TIME_LABEL_Y} textAnchor={anchor} fill="#687488" fontSize="13">
                {formatTime(chart.candles[index].time)}
              </text>
            </g>
          );
        })}

        <line
          x1={PLOT_LEFT}
          x2={PLOT_RIGHT}
          y1={latestY}
          y2={latestY}
          stroke={latestColor}
          strokeWidth="1"
          strokeDasharray="3 4"
          opacity="0.55"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={`M${PLOT_RIGHT + 4} ${latestY} L${PLOT_RIGHT + 10} ${latestY - 7} H${VIEW_WIDTH - 4} V${latestY + 7} H${PLOT_RIGHT + 10} Z`}
          fill={latestColor}
        />
        <text
          x={PLOT_RIGHT + 13}
          y={latestY + 3.5}
          fill="#07110f"
          fontSize="13"
          fontWeight="800"
        >
          {formatPrice(latestCandle.close, chart.priceRange)}
        </text>
      </g>

      <rect
        x={PLOT_LEFT}
        y={PRICE_TOP}
        width={PLOT_RIGHT - PLOT_LEFT}
        height={VOLUME_BOTTOM - PRICE_TOP}
        fill="transparent"
      />

      {hoveredCandle && (
        <g aria-hidden="true" pointerEvents="none">
          <rect
            x={hoveredX - chart.step / 2}
            y={PRICE_TOP}
            width={chart.step}
            height={VOLUME_BOTTOM - PRICE_TOP}
            fill="rgba(148, 163, 184, 0.045)"
          />
          <line
            x1={hoveredX}
            x2={hoveredX}
            y1={PRICE_TOP}
            y2={VOLUME_BOTTOM}
            stroke="rgba(184, 197, 217, 0.5)"
            strokeWidth="1"
            strokeDasharray="3 4"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={PLOT_LEFT}
            x2={PLOT_RIGHT}
            y1={hover.y}
            y2={hover.y}
            stroke="rgba(184, 197, 217, 0.42)"
            strokeWidth="1"
            strokeDasharray="3 4"
            vectorEffect="non-scaling-stroke"
          />
          <circle cx={hoveredX} cy={hover.y} r="3" fill={hoverColor} stroke="#111827" strokeWidth="1.5" />

          <g transform={`translate(${tooltipX} ${tooltipY})`}>
            <rect
              width={tooltipWidth}
              height={tooltipHeight}
              rx="9"
              fill="#101722"
              stroke="rgba(173, 188, 211, 0.24)"
              strokeWidth="1"
            />
            <rect width="3" height={tooltipHeight} rx="1.5" fill={hoverColor} />
            <text x="14" y="20" fill="#aab5c6" fontSize="13" fontWeight="650">
              {formatTime(hoveredCandle.time, true)}
            </text>
            <text x="14" y="45" fill="#6f7c90" fontSize="13">OPEN</text>
            <text x="53" y="45" fill="#e2e8f0" fontSize="13" fontWeight="600">
              {formatPrice(hoveredCandle.open, chart.priceRange)}
            </text>
            <text x="119" y="45" fill="#6f7c90" fontSize="13">HIGH</text>
            <text x="155" y="45" fill="#e2e8f0" fontSize="13" fontWeight="600">
              {formatPrice(hoveredCandle.high, chart.priceRange)}
            </text>
            <text x="14" y="67" fill="#6f7c90" fontSize="13">LOW</text>
            <text x="53" y="67" fill="#e2e8f0" fontSize="13" fontWeight="600">
              {formatPrice(hoveredCandle.low, chart.priceRange)}
            </text>
            <text x="119" y="67" fill="#6f7c90" fontSize="13">CLOSE</text>
            <text x="155" y="67" fill={hoverColor} fontSize="13" fontWeight="700">
              {formatPrice(hoveredCandle.close, chart.priceRange)}
            </text>
            <text x="14" y="90" fill="#6f7c90" fontSize="13">VOLUME</text>
            <text x="61" y="90" fill="#e2e8f0" fontSize="13" fontWeight="600">
              {formatVolume(hoveredCandle.volume)}
            </text>
            <text x="119" y="90" fill="#6f7c90" fontSize="13">CHANGE</text>
            <text x="164" y="90" fill={hoverColor} fontSize="13" fontWeight="700">
              {formatPercentChange(hoveredCandle.open, hoveredCandle.close)}
            </text>
          </g>
        </g>
      )}
    </svg>
  );
}
