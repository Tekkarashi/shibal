import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffPlan, MAX_SCHEDULED, planJobs } from '../src/reminderPlan';
import type { Item, Settings } from '../src/types';

// Wednesday 11 Nov 2026, 1:14 PM local time.
const NOW = new Date(2026, 10, 11, 13, 14);
const ON: Settings = { strict: true, digest: true };
const X = { exact: true };

function item(partial: Partial<Item>): Item {
  return {
    id: partial.id ?? 'a',
    title: partial.title ?? 'Chevening',
    url: partial.url ?? 'https://chevening.org/apply',
    notes: '',
    deadline: 'deadline' in partial ? (partial.deadline ?? null) : new Date(2026, 10, 20, 23, 59).toISOString(),
    status: partial.status ?? 'open',
    source: 'manual',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

test('an open item with a deadline gets its reminders, soonest first, with the item to open', () => {
  const jobs = planJobs([item({})], { strict: true, digest: false }, NOW, X);
  assert.ok(jobs.length >= 10, `expected a full ladder, got ${jobs.length}`);
  for (let i = 1; i < jobs.length; i++) assert.ok(jobs[i - 1].at <= jobs[i].at);
  assert.ok(jobs.every((j) => j.itemId === 'a' && j.at > NOW));
  assert.equal(new Set(jobs.map((j) => j.id)).size, jobs.length, 'ids are unique');
  // Last-day reminders use alarm-clock delivery in strict mode, earlier ones do not.
  assert.equal(jobs[jobs.length - 1].delivery, 'alarmClock');
  assert.equal(jobs[0].delivery, 'bestEffort');
});

test('applied, skipped, undated and broken items get no reminders', () => {
  const items = [
    item({ id: 'applied', status: 'applied' }),
    item({ id: 'skipped', status: 'skipped' }),
    item({ id: 'undated', deadline: null }),
    item({ id: 'broken', deadline: 'not a date' }),
  ];
  assert.equal(planJobs(items, { strict: true, digest: false }, NOW, X).length, 0);
});

test('ids stay the same as time passes, so a re-plan later keeps what is already scheduled', () => {
  const a = planJobs([item({})], ON, NOW, X);
  const later = new Date(NOW.getTime() + 2 * 3_600_000); // same day, no reminder passed yet
  const b = planJobs([item({})], ON, later, X);
  assert.deepEqual(b.map((j) => j.id), a.map((j) => j.id));
});

test('ids change when what the phone would show or do changes', () => {
  const base = planJobs([item({})], ON, NOW, X).map((j) => j.id);
  const renamed = planJobs([item({ title: 'Chevening 2027' })], ON, NOW, X).map((j) => j.id);
  assert.ok(renamed.every((id) => !base.includes(id)));

  // Alarms set without exact-alarm permission stay inexact, so granting it must re-set them all.
  const inexact = planJobs([item({})], ON, NOW, { exact: false }).map((j) => j.id);
  assert.ok(inexact.every((id) => !base.includes(id)));

  // Turning strict delivery off changes only the last-day reminders.
  const relaxed = planJobs([item({})], { strict: false, digest: true }, NOW, X).map((j) => j.id);
  const kept = relaxed.filter((id) => base.includes(id));
  assert.ok(kept.length > 0 && kept.length < base.length);
});

test('morning summaries are planned only when turned on', () => {
  const withDigest = planJobs([item({})], ON, NOW, X);
  const without = planJobs([item({})], { strict: true, digest: false }, NOW, X);
  assert.ok(withDigest.some((j) => j.id.startsWith('d:')));
  assert.ok(!without.some((j) => j.id.startsWith('d:')));
});

test('the plan never exceeds what Android allows, and keeps the soonest', () => {
  const many = Array.from({ length: 60 }, (_, i) =>
    item({ id: `i${i}`, title: `Thing ${i}`, deadline: new Date(2026, 10, 15 + (i % 20), 23, 59).toISOString() }),
  );
  const jobs = planJobs(many, ON, NOW, X);
  assert.equal(jobs.length, MAX_SCHEDULED);
  const all = planJobs(many.slice(0, 1), ON, NOW, X);
  assert.ok(jobs[0].at.getTime() <= all[0].at.getTime());
});

test('a sync cancels only unwanted reminders and never touches the test one', () => {
  const jobs = planJobs([item({})], ON, NOW, X);
  const scheduled = ['test', 'r:a:0', 'r:gone:1', jobs[0].id, jobs[1].id];
  const plan = diffPlan(scheduled, jobs, { rearm: false, keep: (id) => id === 'test' });
  assert.deepEqual(plan.cancel.sort(), ['r:a:0', 'r:gone:1']);
  assert.deepEqual(plan.schedule.map((j) => j.id), jobs.slice(2).map((j) => j.id));
});

test('re-arming hands every wanted reminder to Android again, even ones it already lists', () => {
  const jobs = planJobs([item({})], ON, NOW, X);
  const plan = diffPlan(jobs.map((j) => j.id), jobs, { rearm: true });
  assert.equal(plan.cancel.length, 0);
  assert.equal(plan.schedule.length, jobs.length);
});

test('marking an item applied cancels all of its reminders', () => {
  const before = planJobs([item({})], ON, NOW, X);
  const after = planJobs([item({ status: 'applied' })], ON, NOW, X);
  const plan = diffPlan(before.map((j) => j.id), after, { rearm: false });
  assert.equal(plan.cancel.length, before.length);
  assert.equal(plan.schedule.length, 0);
});
