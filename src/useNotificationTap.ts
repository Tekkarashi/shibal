import * as Notifications from 'expo-notifications';

/** The last notification the user tapped, so the app can open its item. */
export function useNotificationTap(): Notifications.NotificationResponse | null | undefined {
  return Notifications.useLastNotificationResponse();
}
