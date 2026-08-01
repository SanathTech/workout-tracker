import { useEffect, useState } from 'react';
import { SW_UPDATE_EVENT, applyUpdate } from '../sw-update';

// Applying an update reloads the page, so this asks rather than acts — mid-set, an
// unannounced remount would look exactly like the app losing your work.
export default function UpdatePrompt() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const onUpdate = () => setReady(true);
    window.addEventListener(SW_UPDATE_EVENT, onUpdate);
    return () => window.removeEventListener(SW_UPDATE_EVENT, onUpdate);
  }, []);

  if (!ready) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-50 px-4 pt-[calc(env(safe-area-inset-top)+0.5rem)] pointer-events-none">
      <div className="max-w-2xl mx-auto rounded-lg border border-neutral-700 bg-neutral-900 text-white shadow-lg flex items-center gap-3 px-3 py-2 pointer-events-auto">
        <span className="text-sm flex-1">A new version is ready.</span>
        <button
          type="button"
          onClick={applyUpdate}
          className="text-sm font-medium px-3 py-1 rounded bg-white/15 hover:bg-white/25 transition-colors"
        >
          Reload
        </button>
        <button
          type="button"
          onClick={() => setReady(false)}
          className="text-sm px-2 py-1 opacity-70 hover:opacity-100"
        >
          Later
        </button>
      </div>
    </div>
  );
}
