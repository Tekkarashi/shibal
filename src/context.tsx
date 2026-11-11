import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { getHealth } from './notifications';
import { useStore, type Store } from './useStore';

interface AppValue {
  store: Store;
  /** Ticks every minute and whenever the app comes back to the front. */
  now: Date;
  needsSetup: boolean;
  checkHealth: () => Promise<void>;
}

const AppContext = createContext<AppValue | null>(null);

export function useApp(): AppValue {
  const v = useContext(AppContext);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const store = useStore();
  const [now, setNow] = useState(() => new Date());
  const [needsSetup, setNeedsSetup] = useState(false);

  const checkHealth = useCallback(async () => {
    try {
      const h = await getHealth();
      setNeedsSetup(!h.notifications || !h.exactAlarms);
    } catch {
      setNeedsSetup(false);
    }
  }, []);

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 60_000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(new Date());
    });
    return () => {
      clearInterval(tick);
      sub.remove();
    };
  }, []);

  const value = useMemo(() => ({ store, now, needsSetup, checkHealth }), [store, now, needsSetup, checkHealth]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
