import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

export type PickResult = { raw: string } | { cancelled: true } | { error: string };

/** Lets the user pick a WhatsApp "Export chat" text file and reads it. */
export async function pickWhatsAppExport(): Promise<PickResult> {
  try {
    const res = await DocumentPicker.getDocumentAsync({ type: ['text/plain', 'text/*'], copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return { cancelled: true };
    const asset = res.assets[0];
    // The browser preview hands back a File object; on the phone it is a file URI.
    const raw = asset.file ? await asset.file.text() : await new File(asset.uri).text();
    return { raw };
  } catch {
    return { error: 'Could not read that file. Export the chat “Without media” so WhatsApp makes a text file.' };
  }
}
