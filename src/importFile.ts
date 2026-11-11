import { Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

/** Lets the user pick a WhatsApp "Export chat" text file. Resolves to its text, or null. */
export async function pickWhatsAppExport(): Promise<string | null> {
  try {
    const res = await DocumentPicker.getDocumentAsync({ type: ['text/plain', 'text/*'], copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return null;
    return await new File(res.assets[0].uri).text();
  } catch {
    Alert.alert('Could not read that file', 'Export the chat "Without media" so WhatsApp gives you a plain text file.');
    return null;
  }
}
