import { strFromU8, unzipSync } from 'fflate';

/** True for the first bytes of a zip file ("PK\x03\x04"). */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * Newer WhatsApp versions export a chat as a .zip, even "Without media".
 * Returns the chat text inside it (`_chat.txt`, or the first .txt), or null.
 * Media files in the zip are skipped without being decompressed.
 */
export function chatTextFromZip(bytes: Uint8Array): string | null {
  if (!looksLikeZip(bytes)) return null;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => /\.txt$/i.test(f.name) && f.originalSize < 50 * 1024 * 1024 });
  } catch {
    return null;
  }
  const names = Object.keys(files);
  if (names.length === 0) return null;
  const pick =
    names.find((n) => /(^|\/)_chat\.txt$/i.test(n)) ??
    names.find((n) => /whatsapp/i.test(n)) ??
    names[0];
  return strFromU8(files[pick]);
}
