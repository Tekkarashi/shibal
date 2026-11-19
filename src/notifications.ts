import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { diffPlan, planJobs, type Job } from './reminderPlan';
import type { Item, Settings } from './types';

export const CHANNEL_ID = 'deadlines';
const TEST_ID = 'test';
const PLAN_KEY = 'deadlinebank:plan:v1';

/** A native call that never answers must not freeze every later sync behind it. */
const CALL_TIMEOUT_MS = 15_000;

function withTimeout<T>(p: Promise<T>, what: string, ms = CALL_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// Registered as soon as this module loads, so a reminder that fires while Shibal is open is
// always shown, even in the moment between launch and the first screen.
try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
} catch {
  // No notifications on this platform (web preview).
}

let channelReady: Promise<void> | null = null;

/** Creates the reminders channel once per run. Android ignores changes to importance after the first time. */
function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  if (!channelReady) {
    channelReady = Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Deadline reminders',
      description: 'Reminders before your saved applications close',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 200, 250],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      enableVibrate: true,
      showBadge: false,
    }).then(
      () => undefined,
      (e) => {
        channelReady = null; // try again next time
        throw e;
      },
    );
  }
  return channelReady;
}

export async function setupNotifications(): Promise<void> {
  await ensureChannel();
}

export interface Health {
  notifications: boolean;
  exactAlarms: boolean;
  /** False when the "Deadline reminders" channel itself is switched off in Android's settings. */
  channel: boolean;
}

async function canScheduleExact(): Promise<boolean> {
  try {
    return (await Notifications.getExactAlarmPermissionsAsync()).granted;
  } catch {
    return true; // older Android versions have no such permission
  }
}

async function channelOn(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const ch = await Notifications.getNotificationChannelAsync(CHANNEL_ID);
    // Not created yet means it will be created on, at full importance.
    return !ch || ch.importance !== Notifications.AndroidImportance.NONE;
  } catch {
    return true;
  }
}

export async function getHealth(): Promise<Health> {
  const [n, exactAlarms, channel] = await Promise.all([Notifications.getPermissionsAsync(), canScheduleExact(), channelOn()]);
  return { notifications: n.granted, exactAlarms, channel };
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

/** What the last sync did, kept so Settings can show it. */
export interface PlanRecord {
  at: string;
  /** Reminders Shibal wants to exist. */
  planned: number;
  /** Of those, how many Android refused. */
  failed: number;
  next: { at: string; title: string } | null;
  error: string | null;
}

export async function lastPlan(): Promise<PlanRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(PLAN_KEY);
    return raw ? (JSON.parse(raw) as PlanRecord) : null;
  } catch {
    return null;
  }
}

async function scheduleJob(job: Job): Promise<void> {
  await withTimeout(
    Notifications.scheduleNotificationAsync({
      identifier: job.id,
      content: {
        title: job.title,
        body: job.body,
        data: job.itemId ? { itemId: job.itemId } : {},
        priority: Notifications.AndroidNotificationPriority.MAX,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: job.at,
        channelId: CHANNEL_ID,
        delivery: job.delivery,
      },
    }),
    `schedule ${job.id}`,
  );
}

export interface SyncOptions {
  /** Hand every wanted reminder to Android again, not only the missing ones (see diffPlan). */
  rearm?: boolean;
  now?: Date;
}

let chain: Promise<unknown> = Promise.resolve();

/**
 * Brings Android's scheduled reminders in line with the saved items. Reminders are scheduled
 * even while notifications are not allowed: Android holds them, and they appear as soon as the
 * permission is given, without needing the app to be opened again.
 * Calls are queued so two quick edits never interleave, and one failed reminder never stops the rest.
 */
export function rescheduleAll(items: Item[], settings: Settings, opts: SyncOptions = {}): Promise<PlanRecord> {
  const run = async (): Promise<PlanRecord> => {
    const now = opts.now ?? new Date();
    let error: string | null = null;
    const note = (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      error ??= msg;
      console.warn('[reminders]', msg);
    };

    await ensureChannel().catch(note);
    const exact = await canScheduleExact();
    const jobs = planJobs(items, settings, now, { exact });
    const scheduled = await withTimeout(Notifications.getAllScheduledNotificationsAsync(), 'list scheduled');
    const plan = diffPlan(
      scheduled.map((n) => n.identifier),
      jobs,
      { rearm: !!opts.rearm, keep: (id) => id === TEST_ID },
    );

    const cancelled = await Promise.allSettled(
      plan.cancel.map((id) => withTimeout(Notifications.cancelScheduledNotificationAsync(id), `cancel ${id}`)),
    );
    cancelled.forEach((r) => r.status === 'rejected' && note(r.reason));

    // Soonest first, so if the app is closed part way the next reminders are already in place.
    let failed = 0;
    for (const job of plan.schedule) {
      try {
        await scheduleJob(job);
      } catch (e) {
        failed++;
        note(e);
      }
    }

    const record: PlanRecord = {
      at: now.toISOString(),
      planned: jobs.length,
      failed,
      next: jobs[0] ? { at: jobs[0].at.toISOString(), title: jobs[0].title } : null,
      error,
    };
    AsyncStorage.setItem(PLAN_KEY, JSON.stringify(record)).catch(() => undefined);
    return record;
  };
  const next = chain.then(run, run);
  chain = next.catch(() => undefined);
  return next;
}

/** Schedules a throwaway reminder so the user can check delivery with the app closed. */
export async function scheduleTest(seconds: number, strict: boolean): Promise<void> {
  await ensureChannel();
  await Notifications.scheduleNotificationAsync({
    identifier: TEST_ID,
    content: {
      title: 'Test reminder',
      body: 'If you can read this with the app closed, reminders will reach you.',
      priority: Notifications.AndroidNotificationPriority.MAX,
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
  return (await Notifications.getAllScheduledNotificationsAsync()).filter((n) => n.identifier !== TEST_ID).length;
}

/** Opens Android's settings page for the reminders channel, where it can be switched back on. */
export const CHANNEL_SETTINGS = {
  action: 'android.settings.CHANNEL_NOTIFICATION_SETTINGS',
  extra: (pkg: string) => ({ 'android.provider.extra.APP_PACKAGE': pkg, 'android.provider.extra.CHANNEL_ID': CHANNEL_ID }),
};
