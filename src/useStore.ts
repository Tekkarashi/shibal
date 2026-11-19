import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { itemsFromImport, mergeItems, type ImportedLink } from './logic';
import { rescheduleAll } from './notifications';
import { loadItems, loadSettings, saveItems, saveSettings } from './storage';
import { DEFAULT_SETTINGS, type Draft, type Item, type Settings, type Status } from './types';

export function makeId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function useStore() {
  const [items, setItems] = useState<Item[]>([]);
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const latest = useRef({ items, settings });
  latest.current = { items, settings };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      const [i, s] = await Promise.all([loadItems(), loadSettings()]);
      setItems(i);
      setSettingsState(s);
      setLoaded(true);
    })();
  }, []);

  /** Saves to disk right away and re-plans reminders shortly after the last change. */
  const persist = useCallback((nextItems: Item[], nextSettings: Settings) => {
    saveItems(nextItems).catch((e) => console.warn('[store] could not save items', String(e)));
    saveSettings(nextSettings).catch((e) => console.warn('[store] could not save settings', String(e)));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      rescheduleAll(nextItems, nextSettings).catch((e) => console.warn('[reminders] sync failed', String(e)));
    }, 350);
  }, []);

  // A change made just before the app is closed still gets its reminders.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        rescheduleAll(latest.current.items, latest.current.settings).catch((e) => console.warn('[reminders] sync failed', String(e)));
      }
    });
    return () => sub.remove();
  }, []);

  const commit = useCallback(
    (nextItems: Item[], nextSettings: Settings = latest.current.settings) => {
      latest.current = { items: nextItems, settings: nextSettings };
      setItems(nextItems);
      setSettingsState(nextSettings);
      persist(nextItems, nextSettings);
    },
    [persist],
  );

  /** Hands every reminder to Android again (see diffPlan): on launch, on return to the app, after a permission change. */
  const replan = useCallback(() => {
    return rescheduleAll(latest.current.items, latest.current.settings, { rearm: true }).catch((e) => {
      console.warn('[reminders] sync failed', String(e));
      return null;
    });
  }, []);

  const addItem = useCallback(
    (draft: Draft): Item => {
      const now = new Date().toISOString();
      const item: Item = {
        id: makeId(),
        title: draft.title.trim() || 'Saved opportunity',
        url: draft.url,
        notes: draft.notes,
        deadline: draft.deadline,
        imageUri: draft.imageUri ?? null,
        status: 'open',
        source: draft.source,
        createdAt: now,
        updatedAt: now,
      };
      commit([item, ...latest.current.items]);
      return item;
    },
    [commit],
  );

  const updateItem = useCallback(
    (id: string, patch: Partial<Pick<Item, 'title' | 'url' | 'notes' | 'deadline' | 'imageUri'>>) => {
      const now = new Date().toISOString();
      commit(latest.current.items.map((i) => (i.id === id ? { ...i, ...patch, updatedAt: now } : i)));
    },
    [commit],
  );

  const setStatus = useCallback(
    (id: string, status: Status) => {
      const now = new Date().toISOString();
      commit(latest.current.items.map((i) => (i.id === id ? { ...i, status, updatedAt: now } : i)));
    },
    [commit],
  );

  const removeItem = useCallback(
    (id: string) => commit(latest.current.items.filter((i) => i.id !== id)),
    [commit],
  );

  /** Puts back an item exactly as it was, for Undo. */
  const restoreItem = useCallback(
    (item: Item) => {
      const rest = latest.current.items.filter((i) => i.id !== item.id);
      commit([item, ...rest]);
    },
    [commit],
  );

  /** Merges items from a backup: new ones are added, the more recent copy of each item wins. */
  const restoreItems = useCallback(
    (incoming: Item[]): { added: number; updated: number } => {
      const merged = mergeItems(latest.current.items, incoming);
      if (merged.added + merged.updated > 0) commit(merged.items);
      return { added: merged.added, updated: merged.updated };
    },
    [commit],
  );

  const importLinks = useCallback(
    (links: ImportedLink[]): { added: number; dated: number } => {
      const fresh = itemsFromImport(links, latest.current.items, new Date(), makeId);
      if (fresh.length > 0) commit([...fresh, ...latest.current.items]);
      return { added: fresh.length, dated: fresh.filter((i) => i.deadline).length };
    },
    [commit],
  );

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => commit(latest.current.items, { ...latest.current.settings, ...patch }),
    [commit],
  );

  return { items, settings, loaded, addItem, updateItem, setStatus, removeItem, restoreItem, restoreItems, importLinks, updateSettings, replan };
}

export type Store = ReturnType<typeof useStore>;
