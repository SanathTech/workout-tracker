export function CloseIcon({ size = 14 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" />
      <line x1="6" y1="18" x2="18" y2="6" strokeLinecap="round" />
    </svg>
  );
}

export function ChevronIcon({ open = false, size = 14 }) {
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2"
      className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
    >
      <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
