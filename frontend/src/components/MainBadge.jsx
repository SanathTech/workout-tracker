export default function MainBadge({ className = '' }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 ${className}`}
      title="Main lift"
    >
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-2.5 h-2.5" aria-hidden="true">
        <path d="M10 1.5l2.47 5.01 5.53.8-4 3.9.94 5.49L10 14.1l-4.94 2.6.94-5.49-4-3.9 5.53-.8L10 1.5z" />
      </svg>
      Main
    </span>
  );
}
