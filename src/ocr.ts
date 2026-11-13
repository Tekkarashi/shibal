import { extractTextFromImage, isSupported } from 'expo-text-extractor';

/**
 * Reads the text on a flyer or screenshot with Google's on-device text recognition.
 * The image never leaves the phone. Returns null when nothing could be read: no
 * Play services, the model is still downloading, or the image has no text.
 */
export async function readImageText(uri: string, timeoutMs = 15000): Promise<string | null> {
  if (!isSupported) return null;
  // The module wants a plain path; attachments are stored as file:// URIs.
  const path = uri.startsWith('file://') ? decodeURI(uri.slice('file://'.length)) : uri;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const blocks = await Promise.race([
      extractTextFromImage(path),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out')), timeoutMs);
      }),
    ]);
    const text = blocks.join('\n').trim();
    return text || null;
  } catch (e) {
    console.warn('[ocr] could not read image', String(e));
    return null;
  } finally {
    clearTimeout(timer);
  }
}
