import { useCallback, useEffect, useRef, useState } from 'react';
import { itemsFromImport, type ImportedLink } from './logic';
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
    saveItems(nextItems).catch(() => undefined);
    saveSettings(nextSettings).catch(() => undefined);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      rescheduleAll(nextItems, nextSettings).catch(() => undefined);
    }, 350);
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

  const replan = useCallback(() => {
    rescheduleAll(latest.current.items, latest.current.settings).catch(() => undefined);
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
    (id: string, patch: Partial<Pick<Item, 'title' | 'url' | 'notes' | 'deadline'>>) => {
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

  return { items, settings, loaded, addItem, updateItem, setStatus, removeItem, restoreItem, importLinks, updateSettings, replan };
}

export type Store = ReturnType<typeof useStore>;
