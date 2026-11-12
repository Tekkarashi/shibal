import { Directory, File, Paths } from 'expo-file-system';

/** Shared images live here, inside the app's own storage, so they survive the sender deleting them. */
const folder = () => new Directory(Paths.document, 'attachments');

function extensionFor(name?: string | null, mime?: string | null): string {
  const fromName = name?.match(/\.(jpe?g|png|webp|gif|heic|heif)$/i)?.[1];
  const fromMime = mime?.match(/^image\/(jpe?g|png|webp|gif|heic|heif)/i)?.[1];
  return (fromName ?? fromMime ?? 'jpg').toLowerCase().replace('jpeg', 'jpg');
}

/** Copies a shared image into the app. Resolves to its new uri, or null if it could not be read. */
export async function keepSharedImage(src: string, mime?: string | null, name?: string | null): Promise<string | null> {
  try {
    const dir = folder();
    if (!dir.exists) dir.create({ intermediates: true });
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const dest = new File(dir, `${id}.${extensionFor(name, mime)}`);
    await new File(src).copy(dest);
    return dest.uri;
  } catch {
    return null;
  }
}

/**
 * Deletes stored images no item points at any more. Run once at launch, so an
 * image deleted with its item can still come back through Undo in that session.
 */
export function cleanupAttachments(keep: (string | null | undefined)[]): void {
  try {
    const dir = folder();
    if (!dir.exists) return;
    const used = new Set(keep.filter(Boolean));
    for (const entry of dir.list()) {
      if (entry instanceof File && !used.has(entry.uri)) entry.delete();
    }
  } catch {
    // A failed cleanup only leaves a stray image behind; never worth bothering the user.
  }
}
