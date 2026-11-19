/**
 * Which reminders should exist with Android right now, and how to get from what is scheduled
 * to that. Pure functions, so they are tested without a phone (test/reminderPlan.test.ts).
 */
import { buildDigests, buildLadder, shorten } from './logic';
import type { Item, Settings } from './types';

/** Android stops an app that holds more than 500 alarms, so stay well under that. */
export const MAX_SCHEDULED = 400;

export type Delivery = 'alarmClock' | 'bestEffort';

export interface Job {
  /** Changes whenever anything the phone would show or do changes, so a stale copy is never kept. */
  id: string;
  at: Date;
  title: string;
  body: string;
  delivery: Delivery;
  itemId?: string;
}

export interface PlanOptions {
  /** Whether Android currently lets the app set exact alarms. Alarms set without it stay inexact, so a change re-sets them. */
  exact: boolean;
}

/** Short, stable fingerprint of a string (djb2). Not for security, only to notice changes. */
export function fingerprint(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function jobId(kind: 'r' | 'd', owner: string, at: Date, title: string, body: string, delivery: Delivery, exact: boolean): string {
  return `${kind}:${owner}:${fingerprint(`${at.getTime()}|${title}|${body}|${delivery}|${exact ? 'x' : 'i'}`)}`;
}

/** Every reminder and morning summary that should be scheduled, soonest first, capped at MAX_SCHEDULED. */
export function planJobs(items: Item[], settings: Settings, now: Date, opts: PlanOptions): Job[] {
  const jobs = new Map<string, Job>();
  for (const item of items) {
    if (item.status !== 'open' || !item.deadline) continue;
    const deadline = new Date(item.deadline);
    if (!Number.isFinite(deadline.getTime())) continue;
    const title = shorten(item.title, 60);
    const body = item.url ? `Tap to open. ${shorten(item.url, 80)}` : 'Tap to open Shibal.';
    for (const rung of buildLadder(deadline, now)) {
      const t = `${rung.label}: ${title}`;
      const delivery: Delivery = rung.critical && settings.strict ? 'alarmClock' : 'bestEffort';
      const id = jobId('r', item.id, rung.at, t, body, delivery, opts.exact);
      jobs.set(id, { id, at: rung.at, title: t, body, delivery, itemId: item.id });
    }
  }
  if (settings.digest) {
    for (const d of buildDigests(items, now)) {
      const id = jobId('d', d.key, d.at, d.title, d.body, 'bestEffort', opts.exact);
      jobs.set(id, { id, at: d.at, title: d.title, body: d.body, delivery: 'bestEffort' });
    }
  }
  return [...jobs.values()].sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, MAX_SCHEDULED);
}

export interface SyncPlan {
  /** Scheduled with Android but no longer wanted. */
  cancel: string[];
  /** To hand to Android: the missing ones, or every wanted one when re-arming. */
  schedule: Job[];
}

/**
 * Turns what is scheduled into what should be. Nothing wanted is ever cancelled first, so a
 * sync cut short (the app closed half way) leaves the reminders that were already there.
 *
 * `rearm` hands every wanted reminder to Android again even when it looks scheduled. Android
 * drops an app's alarms when the app is force-stopped (some phones do this when it is swiped
 * away), while the saved list still shows them, so the app re-arms each time it opens.
 */
export function diffPlan(scheduledIds: string[], jobs: Job[], opts: { rearm: boolean; keep?: (id: string) => boolean }): SyncPlan {
  const wanted = new Set(jobs.map((j) => j.id));
  const present = new Set(scheduledIds);
  return {
    cancel: scheduledIds.filter((id) => !wanted.has(id) && !(opts.keep?.(id) ?? false)),
    schedule: opts.rearm ? jobs : jobs.filter((j) => !present.has(j.id)),
  };
}
