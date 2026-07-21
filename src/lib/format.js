export function formatCurrency(value, options = {}) {
  const safeValue = Number.isFinite(Number(value)) ? Number(value) : 0;
  const magnitude = Math.abs(safeValue);
  const maximumFractionDigits = options.maximumFractionDigits
    ?? (magnitude > 1000 ? 2 : magnitude >= 1 ? 2 : 4);

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: options.minimumFractionDigits ?? Math.min(2, maximumFractionDigits),
    maximumFractionDigits,
    notation: options.compact ? 'compact' : 'standard',
  }).format(safeValue);
}

export function formatPrice(value) {
  const numeric = Number(value) || 0;
  return formatCurrency(numeric, {
    minimumFractionDigits: numeric < 100 ? 3 : 2,
    maximumFractionDigits: numeric < 100 ? 3 : 2,
  });
}

export function formatPercent(value, includeSign = true) {
  const numeric = Number(value) || 0;
  return `${includeSign && numeric >= 0 ? '+' : ''}${numeric.toFixed(2)}%`;
}

export function formatQuantity(value, maxDigits = 6) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDigits,
  }).format(Number(value) || 0);
}

export function formatSimTime(timestamp) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));
}

export function formatClock(timestamp) {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}
