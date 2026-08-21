import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

import { track, setRoute } from '../util/telemetry';

// Screens, in order, with how long each one held his attention.
//
// The dwell time is the point. A list of visited routes says almost nothing; the same
// list with durations says which screens are destinations and which are corridors. A
// screen entered and left inside a couple of seconds usually means the thing he wanted
// was not on it — and that pattern, repeated, is the layout brief.
//
// Route ids are generalised (/session/16 → /session/:id) so visits aggregate instead of
// scattering into one bucket per workout.
function generalise(pathname) {
  return pathname
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .slice(0, 200);
}

export default function useRouteTracking() {
  const location = useLocation();
  const previous = useRef(null);

  useEffect(() => {
    const route = generalise(location.pathname);
    const now = Date.now();
    const prior = previous.current;

    // A re-run that lands on the same route is not a navigation. StrictMode double-
    // invokes effects in development and would otherwise write a leave/enter pair with a
    // 3ms dwell into every session — noise that looks exactly like the "opened it and
    // bounced straight out" signal this data exists to find.
    if (prior && prior.route === route) return;

    if (prior) {
      track('nav', 'leave', { from: prior.route, dwell_ms: now - prior.at });
    }
    setRoute(route);
    track('nav', 'enter', prior ? { from: prior.route } : { first: true });
    previous.current = { route, at: now };
  }, [location.pathname]);

  // The last screen never fires a 'leave' from the effect above, because closing the app
  // does not change the route. Without this, every session ends with one screen whose
  // dwell time is missing — and it is the screen he was on when he stopped, which is
  // exactly the one worth knowing about.
  useEffect(() => {
    const onHide = () => {
      const prior = previous.current;
      if (prior && document.visibilityState === 'hidden') {
        track('nav', 'leave', { from: prior.route, dwell_ms: Date.now() - prior.at, closing: true });
        previous.current = { ...prior, at: Date.now() };
      }
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);
}
