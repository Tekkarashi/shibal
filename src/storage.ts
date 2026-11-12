import AsyncStorage from '@react-native-async-storage/async-storage';
import { isValidItem } from './logic';
import { DEFAULT_SETTINGS, type Item, type Settings } from './types';

const ITEMS_KEY = 'deadlinebank:items:v1';
const SETTINGS_KEY = 'deadlinebank:settings:v1';


export async function loadItems(): Promise<Item[]> {
  try {
    const raw = await AsyncStorage.getItem(ITEMS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidItem).map((i) => ({ ...i, source: i.source ?? 'manual' }));
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
