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

// A workout `date` is a calendar day ('2026-08-01'), not an instant. `new Date()` reads
// a date-only string as UTC midnight, which renders as the previous day anywhere west of
// Greenwich — so build it from the parts and let it be local midnight instead.
export function parseDay(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  return new Date(value);
}

// `undefined` locale means "use the device's" — the app was pinned to en-US.
export function formatDay(value, options) {
  return parseDay(value).toLocaleDateString(undefined, options);
}

export function parseIntOrNull(value) {
  if (value === '' || value == null) return null;
  const n = parseInt(value);
  return Number.isFinite(n) ? n : null;
}
