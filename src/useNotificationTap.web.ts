import type * as Notifications from 'expo-notifications';

/** Web preview only: there are no notification taps in a browser. */
export function useNotificationTap(): Notifications.NotificationResponse | null | undefined {
  return null;
}
