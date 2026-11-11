import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_SETTINGS, type Item, type Settings } from './types';

const ITEMS_KEY = 'deadlinebank:items:v1';
const SETTINGS_KEY = 'deadlinebank:settings:v1';

function isItem(x: unknown): x is Item {
  if (!x || typeof x !== 'object') return false;
  const i = x as Record<string, unknown>;
  return (
    typeof i.id === 'string' &&
    typeof i.title === 'string' &&
    (i.url === null || typeof i.url === 'string') &&
    typeof i.notes === 'string' &&
    (i.deadline === null || (typeof i.deadline === 'string' && !Number.isNaN(Date.parse(i.deadline)))) &&
    (i.status === 'open' || i.status === 'applied' || i.status === 'skipped') &&
    typeof i.createdAt === 'string' &&
    typeof i.updatedAt === 'string'
  );
}

export async function loadItems(): Promise<Item[]> {
  try {
    const raw = await AsyncStorage.getItem(ITEMS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isItem).map((i) => ({ ...i, source: i.source ?? 'manual' }));
  } catch {
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
