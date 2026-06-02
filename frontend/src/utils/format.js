export function formatRest(seconds) {
  if (seconds == null) return '';
  if (seconds < 60) return `${seconds}s`;
  const mins = seconds / 60;
  if (Number.isInteger(mins)) return `${mins}m`;
  return `${mins.toFixed(2).replace(/\.?0+$/, '')}m`;
}

export function parseIntOrNull(value) {
  if (value === '' || value == null) return null;
  const n = parseInt(value);
  return Number.isFinite(n) ? n : null;
}
