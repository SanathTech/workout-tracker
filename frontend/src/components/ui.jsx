import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ChevronIcon, CloseIcon } from './icons';

// The page primitives (2026-09-08 redesign, PR 1). Every screen is built from these so
// rhythm, width and hairlines can't drift screen by screen again.
//   Page     — one column, one vertical rhythm (24px between sections; `dense` = 16px, Today only).
//   Section  — hairline on top, 11px label, optional right-hand action.
//   Sheet    — the one bottom sheet: backdrop, Escape, tap-outside, safe-area padding.
//   Tile     — one reading in a raised box: label, number, one-line sub. Today's four and
//              Health's last-night row are the same tile, so a number reads the same on both.
// Width lives in Layout (max-w-2xl), not here: it's a phone app that happens to run on desktop.

// `dense` is Today's rhythm (16px): the one screen that's operated more than read.
export function Page({ dense = false, className = '', children }) {
  return <div className={`${dense ? 'space-y-4' : 'space-y-6'} ${className}`}>{children}</div>;
}

export function Section({ label, action, className = '', children }) {
  return (
    <section className={`border-t border-neutral-800 pt-4 ${className}`}>
      {(label || action) && (
        <div className="flex items-baseline justify-between gap-3 mb-2">
          {label && <h2 className="section-label">{label}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

// `to` makes it a link (Today's tiles land on Health); without it it's a plain box.
export function Tile({ label, value, sub, subClass = 'text-neutral-400', srLabel, to }) {
  const cls = 'block rounded-lg bg-neutral-900 px-2.5 py-2 min-w-0';
  const body = (
    <>
      <p className="text-[11px] uppercase tracking-wide text-neutral-400 truncate">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-neutral-200 leading-tight mt-0.5">{value}</p>
      <p className={`text-[11px] tabular-nums truncate ${subClass}`}>{sub || '\u00a0'}</p>
    </>
  );
  return to ? (
    <Link to={to} className={`${cls} hover:bg-neutral-800 transition-colors`} aria-label={srLabel}>{body}</Link>
  ) : (
    <div className={cls} aria-label={srLabel}>{body}</div>
  );
}

// Disclosure toggle used by every collapsible row — one glyph app-wide.
export function Disclosure({ open, label, onClick, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className={`inline-flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-200 min-h-11 md:min-h-0 ${className}`}
    >
      {label}
      <ChevronIcon open={open} />
    </button>
  );
}

// closeOnEscape=false lets a sheet with its own inner navigation (the exercise picker's
// create form) decide what Escape means.
export function Sheet({ title, onClose, label, tall = false, closeOnEscape = true, style, children, header }) {
  useEffect(() => {
    if (!closeOnEscape) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, closeOnEscape]);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 animate-[fadeIn_120ms_ease-out]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={label || title}
    >
      <div
        style={style}
        className={`w-full md:max-w-md flex flex-col bg-neutral-950 border-t md:border border-neutral-800 rounded-t-xl md:rounded-xl shadow-xl animate-[slideUp_180ms_ease-out] md:animate-[fadeIn_120ms_ease-out] ${
          tall ? 'h-[85vh] h-[85dvh] md:h-auto md:max-h-[80vh]' : 'max-h-[85vh] max-h-[85dvh]'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {header}
        {title && (
          <div className="flex items-center justify-between pl-4 pr-2 h-12 border-b border-neutral-800 shrink-0 gap-2">
            <h2 className="font-semibold text-neutral-200 truncate">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-11 h-11 flex items-center justify-center rounded text-neutral-400 hover:text-neutral-200 shrink-0"
            >
              <CloseIcon />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
