import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { makeBackup, readBackup } from './logic';
import type { Item } from './types';
import { installedVersion } from './updates';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Writes every item (and its attached picture) to a backup file and opens the share
 * sheet, so it can be kept outside the app: Google Drive, Files, or a WhatsApp chat
 * with yourself. Resolves to the number of items saved.
 */
export async function shareBackup(items: Item[]): Promise<number> {
  const images: Record<string, { ext: string; base64: string }> = {};
  for (const item of items) {
    if (!item.imageUri) continue;
    try {
      const f = new File(item.imageUri);
      if (!f.exists) continue;
      images[item.id] = { ext: (f.extension || '.jpg').replace('.', '').toLowerCase(), base64: await f.base64() };
    } catch {
      // A picture that can't be read is left out; the item itself is still backed up.
    }
  }
  const now = new Date();
  const backup = makeBackup(items, images, now, installedVersion());
  const dir = new Directory(Paths.cache, 'backups');
  if (dir.exists) dir.delete();
  dir.create({ intermediates: true });
  const file = new File(dir, `shibal-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`);
  await file.write(JSON.stringify(backup));
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Keep your Shibal backup somewhere safe' });
  return items.length;
}

export type PickedBackup = { items: Item[]; exportedAt: string } | { cancelled: true } | { error: string };

/** Lets the user pick a backup file, and puts its pictures back into the app's storage. */
export async function pickBackup(): Promise<PickedBackup> {
  let text: string;
  try {
    // Files from Drive or WhatsApp often arrive without a JSON type, so accept any file and check its contents.
    const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return { cancelled: true };
    const asset = res.assets[0];
    text = asset.file ? await asset.file.text() : await new File(asset.uri).text();
  } catch {
    return { error: 'Could not read that file.' };
  }

  let read: ReturnType<typeof readBackup>;
  try {
    read = readBackup(text);
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'That file is not a Shibal backup.' };
  }

  const dir = new Directory(Paths.document, 'attachments');
  const items = await Promise.all(
    read.items.map(async (item) => {
      const img = read.images[item.id];
      if (!img) return { ...item, imageUri: null };
      try {
        if (!dir.exists) dir.create({ intermediates: true });
        const f = new File(dir, `restored-${item.id}.${img.ext}`);
        await f.write(img.base64, { encoding: 'base64' });
        return { ...item, imageUri: f.uri };
      } catch {
        return { ...item, imageUri: null };
      }
    }),
  );
  return { items, exportedAt: read.exportedAt };
}
