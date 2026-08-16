// A 30-day trend line, drawn by hand rather than by Recharts.
//
// Recharts is ~525kB and already lazy-loaded for the one route that needs a real chart.
// These are four rows at the top of the Trends tab: pulling the library in for them
// would block the numbers behind a bundle download on gym wifi, to draw a line 40px
// tall. Plain SVG costs nothing and renders on the first paint.
//
// Gaps are the reason this is not a one-line polyline: an untracked night arrives as a
// null, and a line drawn straight across it would invent data the watch never recorded.
// The series is split into runs of consecutive readings, each stroked separately.
export default function Sparkline({
  data,
  field,
  stroke = 'currentColor',
  width = 200,
  height = 24,
  className = '',
}) {
  const values = data.map((d) => {
    const v = d?.[field];
    return v == null || v === '' ? null : Number(v);
  });
  const present = values.filter((v) => v != null && Number.isFinite(v));
  if (present.length < 2) return <svg className={className} aria-hidden="true" />;

  const min = Math.min(...present);
  const max = Math.max(...present);
  // A flat series would divide by zero; centre it instead of collapsing it to the floor.
  const span = max - min || 1;
  const pad = 2;
  const x = (i) => (values.length === 1 ? 0 : (i / (values.length - 1)) * width);
  const y = (v) => pad + (1 - (v - min) / span) * (height - pad * 2);

  const segments = [];
  let current = [];
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) {
      if (current.length > 1) segments.push(current);
      current = [];
    } else {
      current.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    }
  });
  if (current.length > 1) segments.push(current);

  const lastIdx = values.findLastIndex((v) => v != null && Number.isFinite(v));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
    >
      {segments.map((points, i) => (
        <polyline
          key={i}
          points={points.join(' ')}
          fill="none"
          stroke={stroke}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {lastIdx >= 0 && (
        <circle cx={x(lastIdx)} cy={y(values[lastIdx])} r="2.5" fill={stroke} />
      )}
    </svg>
  );
}
