import { useEffect, useState } from 'react';

const STATE = { hidden: false, listeners: new Set() };

function setHidden(value) {
  STATE.hidden = value;
  STATE.listeners.forEach((fn) => fn(value));
}

export function useHideMobileNav() {
  useEffect(() => {
    setHidden(true);
    return () => setHidden(false);
  }, []);
}

export function useMobileNavHidden() {
  const [v, setV] = useState(STATE.hidden);
  useEffect(() => {
    STATE.listeners.add(setV);
    return () => { STATE.listeners.delete(setV); };
  }, []);
  return v;
}
