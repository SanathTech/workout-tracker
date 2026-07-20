export function formatRest(seconds) {
  if (seconds == null) return '';
  if (seconds < 60) return `${seconds}s`;
  const mins = seconds / 60;
  if (Number.isInteger(mins)) return `${mins}m`;
  return `${mins.toFixed(2).replace(/\.?0+$/, '')}m`;
}

// Rest as a range where `low` is the minimum. Falls back to a single value when
// there's no higher bound (or it isn't above the minimum).
export function formatRestRange(low, high) {
  if (low == null && high == null) return '';
  if (low == null) return formatRest(high);
  if (high == null || high <= low) return formatRest(low);
  return `${formatRest(low)}–${formatRest(high)}`;
}

// Warm-up ramp-up sets, shown as a chip. Returns null when there are none.
export function formatWarmup(low, high) {
  if (low == null && high == null) return null;
  const lo = low ?? high;
  const hi = high ?? low;
  return lo === hi ? `${lo} warm-up` : `${lo}–${hi} warm-up`;
}

export function parseIntOrNull(value) {
  if (value === '' || value == null) return null;
  const n = parseInt(value);
  return Number.isFinite(n) ? n : null;
}
