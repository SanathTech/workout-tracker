export function Skeleton({ className = '' }) {
  return (
    <div
      aria-hidden="true"
      className={`bg-neutral-800 animate-pulse rounded ${className}`}
    />
  );
}
