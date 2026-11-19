import AsyncStorage from '@react-native-async-storage/async-storage';
import { isValidItem } from './logic';
import { DEFAULT_SETTINGS, type Item, type Settings } from './types';

const ITEMS_KEY = 'deadlinebank:items:v1';
const SETTINGS_KEY = 'deadlinebank:settings:v1';


async function readRaw(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    // One retry: a read can fail while the storage thread is still starting.
    return AsyncStorage.getItem(key);
  }
}

/**
 * Keeps an unreadable copy aside before the app starts over, so the next save never
 * overwrites the only copy of someone's list.
 */
async function quarantine(raw: string, why: string): Promise<void> {
  console.warn('[store] saved items could not be read:', why);
  try {
    await AsyncStorage.setItem(`${ITEMS_KEY}:unreadable:${Date.now()}`, raw);
  } catch {
    // Nothing more to do; the original stays until the next save.
  }
}

export async function loadItems(): Promise<Item[]> {
  let raw: string | null;
  try {
    raw = await readRaw(ITEMS_KEY);
  } catch (e) {
    console.warn('[store] could not open saved items', String(e));
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      await quarantine(raw, 'not a list');
      return [];
    }
    const valid = parsed.filter(isValidItem);
    if (valid.length < parsed.length) await quarantine(raw, `${parsed.length - valid.length} broken item(s) left out`);
    return valid.map((i) => ({ ...i, source: i.source ?? 'manual' }));
  } catch (e) {
    await quarantine(raw, String(e));
    return [];
  }
}

export async function saveItems(items: Item[]): Promise<void> {
  await AsyncStorage.setItem(ITEMS_KEY, JSON.stringify(items));
}

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      strict: typeof parsed.strict === 'boolean' ? parsed.strict : DEFAULT_SETTINGS.strict,
      digest: typeof parsed.digest === 'boolean' ? parsed.digest : DEFAULT_SETTINGS.digest,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
