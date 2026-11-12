/**
 * Browser preview only (`npm run web`). The phone app never loads this file.
 *
 * react-native-web's Alert does nothing, which leaves confirm dialogs
 * (delete, discard changes) unusable in the preview. Map them to the
 * browser's confirm box: OK runs the first non-cancel button.
 */
import { Alert, type AlertButton } from 'react-native';

Alert.alert = (title: string, message?: string, buttons?: AlertButton[]) => {
  const text = [title, message].filter(Boolean).join('\n\n');
  if (!buttons || buttons.length === 0) {
    window.alert(text);
    return;
  }
  const cancel = buttons.find((b) => b.style === 'cancel');
  const action = buttons.find((b) => b.style !== 'cancel');
  if (!action) {
    window.alert(text);
    cancel?.onPress?.();
    return;
  }
  if (window.confirm(`${text}\n\nOK: ${action.text ?? 'OK'}`)) action.onPress?.();
  else cancel?.onPress?.();
};

// Lets the preview open screens that a phone reaches through a share
// (e.g. the WhatsApp import), since a browser cannot receive shares.
import { navRef } from './nav';
(window as unknown as { shibalNav: typeof navRef }).shibalNav = navRef;
