import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { chatTextFromZip, looksLikeZip } from './zip';

export type PickResult = { raw: string } | { cancelled: true } | { error: string };

/** Lets the user pick a WhatsApp "Export chat" text file and reads it. */
export async function pickWhatsAppExport(): Promise<PickResult> {
  try {
    const res = await DocumentPicker.getDocumentAsync({
      type: ['text/plain', 'text/*', 'application/zip', 'application/x-zip-compressed'],
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets?.[0]) return { cancelled: true };
    const asset = res.assets[0];
    // The browser preview hands back a File object; on the phone it is a file URI.
    const bytes = asset.file ? new Uint8Array(await asset.file.arrayBuffer()) : await new File(asset.uri).bytes();
    if (looksLikeZip(bytes)) {
      const raw = chatTextFromZip(bytes);
      return raw ? { raw } : { error: 'That zip has no WhatsApp chat in it. Export the chat again and pick the file it makes.' };
    }
    return { raw: new TextDecoder().decode(bytes) };
  } catch {
    return { error: 'Could not read that file. In WhatsApp use Export chat → Without media, then pick the file it makes.' };
  }
}
