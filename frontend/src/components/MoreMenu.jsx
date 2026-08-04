import { useEffect, useState } from 'react';

// The one pattern for rare and destructive actions, everywhere: a 44px ⋯ button opening
// a small menu; destructive items arm on first tap ("Delete — sure?") and fire on the
// second, so nothing irreversible is ever one stray tap away. Escape and the backdrop
// close it; arming resets whenever the menu closes.
export default function MoreMenu({ label, items }) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(null); // index of the item awaiting its second tap

  useEffect(() => { if (!open) setArmed(null); }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const visible = items.filter(Boolean);
  if (visible.length === 0) return null;

  const pick = (item, i) => {
    if (item.confirm && armed !== i) { setArmed(i); return; }
    setOpen(false);
    item.onSelect();
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-expanded={open}
        className="w-11 h-11 -mr-2 flex items-center justify-center rounded text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 top-11 z-30 w-48 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-lg py-1 text-sm">
            {visible.map((item, i) => (
              <button
                key={item.label}
                type="button"
                onClick={() => pick(item, i)}
                className={`w-full text-left px-3 h-11 ${
                  item.danger
                    ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40'
                    : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                }`}
              >
                {item.confirm && armed === i ? item.confirm : item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
