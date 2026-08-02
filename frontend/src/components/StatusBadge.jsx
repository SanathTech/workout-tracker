const STYLES = {
  in_progress: { label: 'in progress', className: 'text-amber-600 dark:text-amber-500' },
  skipped: { label: 'skipped', className: 'text-neutral-400 dark:text-neutral-400' },
};

export default function StatusBadge({ status, className = '' }) {
  const style = STYLES[status];
  if (!style) return null;
  return (
    <span className={`text-[10px] uppercase tracking-wide ${style.className} ${className}`}>
      {style.label}
    </span>
  );
}
