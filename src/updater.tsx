import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { File } from 'expo-file-system';
import { canSelfUpdate, downloadUpdate, findUpdate, installedSigning, installedVersion, openInstaller, type UpdateInfo } from './updates';

export type UpdatePhase = 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'ready' | 'error';

interface UpdaterValue {
  phase: UpdatePhase;
  info: UpdateInfo | null;
  /** 0 to 1 while downloading. */
  progress: number;
  error: string | null;
  current: string;
  /** The Home banner was closed for this version. */
  dismissed: boolean;
  /**
   * The update is signed with Shibal's private key but this copy has the public debug key, so
   * Android won't install it over this one: it needs back up, uninstall, install, restore.
   */
  needsReinstall: boolean;
  check: () => Promise<void>;
  /** Downloads if needed, then opens Android's installer. */
  install: () => Promise<void>;
  dismiss: () => void;
}

const KEY = 'shibal:updates:v1';
const EVERY = 6 * 60 * 60 * 1000; // automatic checks at most every 6 hours

const UpdaterContext = createContext<UpdaterValue | null>(null);

export function useUpdater(): UpdaterValue {
  const v = useContext(UpdaterContext);
  if (!v) throw new Error('useUpdater outside UpdaterProvider');
  return v;
}

export function UpdaterProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<UpdatePhase>('idle');
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const apk = useRef<{ version: string; file: File } | null>(null);
  const busy = useRef(false);
  const saved = useRef<{ lastCheck: number; dismissed: string | null }>({ lastCheck: 0, dismissed: null });

  const persist = useCallback(() => {
    AsyncStorage.setItem(KEY, JSON.stringify(saved.current)).catch(() => undefined);
  }, []);

  const check = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setPhase('checking');
    setError(null);
    try {
      const found = await findUpdate();
      saved.current.lastCheck = Date.now();
      persist();
      setInfo(found);
      setPhase(found ? (apk.current?.version === found.version ? 'ready' : 'available') : 'latest');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach GitHub.');
      setPhase('error');
    } finally {
      busy.current = false;
    }
  }, [persist]);

  const install = useCallback(async () => {
    if (!info || busy.current) return;
    busy.current = true;
    setError(null);
    try {
      if (apk.current?.version !== info.version || !apk.current.file.exists) {
        setPhase('downloading');
        setProgress(0);
        const file = await downloadUpdate(info, setProgress);
        apk.current = { version: info.version, file };
      }
      setPhase('ready');
      await openInstaller(apk.current.file);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The download did not finish.');
      setPhase('error');
    } finally {
      busy.current = false;
    }
  }, [info]);

  const dismiss = useCallback(() => {
    if (!info) return;
    saved.current.dismissed = info.version;
    setDismissedVersion(info.version);
    persist();
  }, [info, persist]);

  // Quietly look for a new release at launch and when the app comes back, at most every 6 hours.
  useEffect(() => {
    if (!canSelfUpdate) return;
    let alive = true;
    const maybeCheck = () => {
      if (alive && Date.now() - saved.current.lastCheck > EVERY) check();
    };
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (raw) {
          const s = JSON.parse(raw) as Partial<typeof saved.current>;
          saved.current = { lastCheck: Number(s.lastCheck) || 0, dismissed: typeof s.dismissed === 'string' ? s.dismissed : null };
          setDismissedVersion(saved.current.dismissed);
        }
      })
      .catch(() => undefined)
      .finally(() => setTimeout(maybeCheck, 3000));
    const sub = AppState.addEventListener('change', (st) => st === 'active' && maybeCheck());
    return () => {
      alive = false;
      sub.remove();
    };
  }, [check]);

  const value = useMemo<UpdaterValue>(
    () => ({
      phase,
      info,
      progress,
      error,
      current: installedVersion(),
      dismissed: !!info && dismissedVersion === info.version,
      needsReinstall: !!info && info.newSigningKey && installedSigning() === 'debug',
      check,
      install,
      dismiss,
    }),
    [phase, info, progress, error, dismissedVersion, check, install, dismiss],
  );

  return <UpdaterContext.Provider value={value}>{children}</UpdaterContext.Provider>;
}
