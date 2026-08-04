// Same chip as every other small fact in the app, tinted by state.
const STYLES = {
  in_progress: { label: 'in progress', className: '!bg-amber-100 !text-amber-800 dark:!bg-amber-500/15 dark:!text-amber-400' },
  skipped: { label: 'skipped', className: '' },
};

export default function StatusBadge({ status, className = '' }) {
  const style = STYLES[status];
  if (!style) return null;
  return (
    <span className={`tag align-middle ${style.className} ${className}`}>
      {style.label}
    </span>
  );
}
