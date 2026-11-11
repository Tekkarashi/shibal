import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { buildDigests, buildLadder, shorten } from './logic';
import type { Item, Settings } from './types';

export const CHANNEL_ID = 'deadlines';
const TEST_ID = 'test';

/** Android stops an app that holds more than 500 alarms, so stay well under that. */
const MAX_SCHEDULED = 400;

export async function setupNotifications(): Promise<void> {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Deadline reminders',
      description: 'Reminders before your saved applications close',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 200, 250],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      enableVibrate: true,
      showBadge: false,
    });
  }
}

export interface Health {
  notifications: boolean;
  exactAlarms: boolean;
}

export async function getHealth(): Promise<Health> {
  const n = await Notifications.getPermissionsAsync();
  let exact = true;
  try {
    const e = await Notifications.getExactAlarmPermissionsAsync();
    exact = e.granted;
  } catch {
    exact = true; // older Android versions have no such permission
  }
  return { notifications: n.granted, exactAlarms: exact };
}

export async function askNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const next = await Notifications.requestPermissionsAsync();
  return next.granted;
}

export async function askExactAlarmPermission(): Promise<boolean> {
  try {
    const res = await Notifications.requestExactAlarmPermissionsAsync();
    return res.granted;
  } catch {
    return false;
  }
}

type Job = {
  id: string;
  at: Date;
  title: string;
  body: string;
  critical: boolean;
  itemId?: string;
};

function jobsFor(items: Item[], settings: Settings, now: Date): Job[] {
  const jobs: Job[] = [];
  for (const item of items) {
    if (item.status !== 'open' || !item.deadline) continue;
    const deadline = new Date(item.deadline);
    buildLadder(deadline, now).forEach((rung, idx) => {
      jobs.push({
        id: `r:${item.id}:${idx}`,
        at: rung.at,
        title: `${rung.label}: ${shorten(item.title, 60)}`,
        body: item.url ? `Tap to open. ${shorten(item.url, 80)}` : 'Tap to open Shibal.',
        critical: rung.critical,
        itemId: item.id,
      });
    });
  }
  if (settings.digest) {
    for (const d of buildDigests(items, now)) {
      jobs.push({ id: `d:${d.key}`, at: d.at, title: d.title, body: d.body, critical: false });
    }
  }
  return jobs.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, MAX_SCHEDULED);
}

let chain: Promise<unknown> = Promise.resolve();

/**
 * Cancels every reminder (except the test one) and schedules the full set again from the current items.
 * Calls are queued so two quick edits never interleave.
 */
export function rescheduleAll(items: Item[], settings: Settings, now = new Date()): Promise<number> {
  const run = async () => {
    const perm = await Notifications.getPermissionsAsync();
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      existing
        .filter((n) => n.identifier !== TEST_ID)
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
    );
    if (!perm.granted) return 0;
    const jobs = jobsFor(items, settings, now);
    for (const job of jobs) {
      await Notifications.scheduleNotificationAsync({
        identifier: job.id,
        content: { title: job.title, body: job.body, data: job.itemId ? { itemId: job.itemId } : {} },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: job.at,
          channelId: CHANNEL_ID,
          delivery: job.critical && settings.strict ? 'alarmClock' : 'bestEffort',
        },
      });
    }
    return jobs.length;
  };
  const next = chain.then(run, run) as Promise<number>;
  chain = next.catch(() => undefined);
  return next;
}

/** Schedules a throwaway reminder so the user can check delivery with the app closed. */
export async function scheduleTest(seconds: number, strict: boolean): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    identifier: TEST_ID,
    content: {
      title: 'Test reminder',
      body: 'If you can read this with the app closed, reminders will reach you.',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(Date.now() + seconds * 1000),
      channelId: CHANNEL_ID,
      delivery: strict ? 'alarmClock' : 'bestEffort',
    },
  });
}

export async function scheduledCount(): Promise<number> {
  return (await Notifications.getAllScheduledNotificationsAsync()).length;
}
