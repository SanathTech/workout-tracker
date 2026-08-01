import { registerSW } from 'virtual:pwa-register';

// A new service worker must never take over on its own: it would remount the page and
// drop whatever was typed inside the autosave debounce. But waiting for every client to
// close means an installed PWA can sit on stale code indefinitely — which is how a
// deployed fix reached the server and never reached the phone.
//
// So: install quietly, then offer the reload and let the choice be explicit.
export const SW_UPDATE_EVENT = 'wt:sw-update';

let applyUpdateFn = null;

export function initServiceWorker() {
  applyUpdateFn = registerSW({
    immediate: true,
    onNeedRefresh() {
      window.dispatchEvent(new CustomEvent(SW_UPDATE_EVENT));
    },
  });
}

// `true` tells the waiting worker to skip waiting and reloads once it's in control.
export function applyUpdate() {
  if (applyUpdateFn) applyUpdateFn(true);
  else window.location.reload();
}
