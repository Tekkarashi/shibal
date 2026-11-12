import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bucketOf, groupItems, buildLadder, buildDigests, parseDeadline, parseWhatsAppExport,
  itemsFromImport, formatDeadline, timeLeft, extractUrls, normalizeUrl, titleFrom, draftFromShared,
  headline, countdown, nextUp,
} from '../src/logic';
import type { Item } from '../src/types';

// Wednesday 11 Nov 2026, 1:14 PM local time.
const NOW = new Date(2026, 10, 11, 13, 14);

function item(partial: Partial<Item> & { deadline?: string | null }): Item {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    title: partial.title ?? 'Thing',
    url: partial.url ?? null,
    notes: '',
    deadline: partial.deadline ?? null,
    status: partial.status ?? 'open',
    source: 'manual',
    createdAt: partial.createdAt ?? NOW.toISOString(),
    updatedAt: partial.updatedAt ?? NOW.toISOString(),
  };
}
const at = (y: number, mo: number, d: number, h = 23, mi = 59) => new Date(y, mo - 1, d, h, mi).toISOString();

/* ---------------- buckets ---------------- */

test('bucketOf covers every range', () => {
  assert.equal(bucketOf(item({ deadline: at(2026, 11, 11, 12, 0) }), NOW), 'overdue');
  assert.equal(bucketOf(item({ deadline: at(2026, 11, 11, 23, 59) }), NOW), 'today');
  assert.equal(bucketOf(item({ deadline: at(2026, 11, 12) }), NOW), 'soon');
  assert.equal(bucketOf(item({ deadline: at(2026, 11, 14) }), NOW), 'soon');
  assert.equal(bucketOf(item({ deadline: at(2026, 11, 15) }), NOW), 'week');
  assert.equal(bucketOf(item({ deadline: at(2026, 11, 18) }), NOW), 'week');
  assert.equal(bucketOf(item({ deadline: at(2026, 11, 19) }), NOW), 'later');
  assert.equal(bucketOf(item({ deadline: null }), NOW), 'nodeadline');
  assert.equal(bucketOf(item({ deadline: at(2026, 11, 20), status: 'applied' }), NOW), 'done');
});

test('groupItems orders sections and items', () => {
  const items = [
    item({ id: 'later', deadline: at(2026, 12, 25) }),
    item({ id: 'today', deadline: at(2026, 11, 11, 20, 0) }),
    item({ id: 'missedOld', deadline: at(2026, 11, 1) }),
    item({ id: 'missedNew', deadline: at(2026, 11, 10) }),
    item({ id: 'none' }),
    item({ id: 'done', status: 'skipped', deadline: at(2026, 11, 20) }),
    item({ id: 'soonB', deadline: at(2026, 11, 14) }),
    item({ id: 'soonA', deadline: at(2026, 11, 12) }),
  ];
  const sections = groupItems(items, NOW);
  assert.deepEqual(sections.map((s) => s.key), ['overdue', 'today', 'soon', 'later', 'nodeadline', 'done']);
  assert.deepEqual(sections[0].data.map((i) => i.id), ['missedNew', 'missedOld']);
  assert.deepEqual(sections[2].data.map((i) => i.id), ['soonA', 'soonB']);
});

/* ---------------- formatting ---------------- */

test('formatDeadline and timeLeft read naturally', () => {
  assert.equal(formatDeadline(at(2026, 11, 11, 17, 0), NOW), 'Today, 5:00 PM');
  assert.equal(formatDeadline(at(2026, 11, 12, 0, 5), NOW), 'Tomorrow, 12:05 AM');
  assert.equal(formatDeadline(at(2026, 11, 19, 9, 30), NOW), 'Thu 19 Nov, 9:30 AM');
  assert.equal(formatDeadline(at(2027, 1, 5, 12, 0), NOW), 'Tue 5 Jan 2027, 12:00 PM');
  assert.equal(timeLeft(at(2026, 11, 11, 13, 44), NOW), '30 min left');
  assert.equal(timeLeft(at(2026, 11, 11, 17, 14), NOW), '4 h left');
  assert.equal(timeLeft(at(2026, 11, 12, 9, 0), NOW), 'tomorrow');
  assert.equal(timeLeft(at(2026, 11, 20, 9, 0), NOW), 'in 9 days');
  assert.equal(timeLeft(at(2026, 11, 9, 9, 0), NOW), 'missed 2 days ago');
});

/* ---------------- reminder ladder ---------------- */

test('ladder for a deadline ten days out has all six rungs in order', () => {
  const deadline = new Date(2026, 10, 21, 17, 0);
  const rungs = buildLadder(deadline, NOW);
  assert.deepEqual(rungs.map((r) => r.label), [
    '1 week left', '3 days left', 'Due tomorrow', 'Due today', '3 hours left', '1 hour left',
  ]);
  for (let i = 1; i < rungs.length; i++) assert.ok(rungs[i].at > rungs[i - 1].at);
  assert.equal(rungs[0].at.getHours(), 9);
  assert.deepEqual(rungs.map((r) => r.critical), [false, false, false, true, true, true]);
  assert.ok(rungs.every((r) => r.at < deadline));
});

test('ladder drops rungs already in the past', () => {
  const deadline = new Date(2026, 10, 12, 17, 0); // tomorrow 5 PM
  const rungs = buildLadder(deadline, NOW);
  assert.deepEqual(rungs.map((r) => r.label), ['Due today', '3 hours left', '1 hour left']);
  assert.equal(rungs[0].at.getDate(), 12);
});

test('ladder merges rungs that collide and keeps strict delivery', () => {
  const deadline = new Date(2026, 10, 20, 11, 0); // 8 AM morning rung equals the 3-hours rung
  const rungs = buildLadder(deadline, NOW);
  const today = rungs.find((r) => r.label === 'Due today')!;
  assert.ok(today.critical);
  assert.equal(rungs.filter((r) => r.label === '3 hours left').length, 0);
});

test('ladder with almost no time left gives one prompt now, or nothing', () => {
  const soon = buildLadder(new Date(NOW.getTime() + 40 * 60_000), NOW);
  assert.equal(soon.length, 1);
  assert.equal(soon[0].label, 'Due very soon');
  assert.ok(soon[0].at.getTime() - NOW.getTime() <= 90_000);
  assert.equal(buildLadder(new Date(NOW.getTime() + 2 * 60_000), NOW).length, 0);
  assert.equal(buildLadder(new Date(NOW.getTime() - 60_000), NOW).length, 0);
});

/* ---------------- digests ---------------- */

test('digests only appear on mornings with something coming up', () => {
  const items = [item({ title: 'Access Youth Tech Forge', deadline: at(2026, 11, 14, 17, 0) })];
  const digests = buildDigests(items, NOW, 14, 8);
  // Due Sat 14 Nov 5 PM: within 72h of the mornings of Thu 12, Fri 13 and Sat 14 (Wed 11 8 AM already passed).
  assert.deepEqual(digests.map((d) => d.key), ['2026-11-12', '2026-11-13', '2026-11-14']);
  assert.match(digests[0].body, /Access Youth Tech Forge/);
  assert.equal(digests[0].title, '1 deadline coming up');
});

test('digest nudges on Monday about links without deadlines', () => {
  const items = [item({}), item({})];
  const digests = buildDigests(items, NOW, 14, 8);
  assert.equal(digests.length, 2); // Mon 16 Nov and Mon 23 Nov
  assert.ok(digests.every((d) => new Date(d.at).getDay() === 1));
  assert.match(digests[0].body, /2 saved links have no deadline yet/);
});

/* ---------------- deadline guessing ---------------- */

const iso = (d: Date | undefined) => (d ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : null);

test('parseDeadline reads common ways of writing a date', () => {
  const cases: [string, string][] = [
    ['Applications close on 30th November 2026', '2026-11-30 23:59'],
    ['Deadline: November 30, 2026', '2026-11-30 23:59'],
    ['Apply by 2026-12-05', '2026-12-5 23:59'],
    ['Deadline 15/12/2026', '2026-12-15 23:59'],
    ['closes 20 Nov', '2026-11-20 23:59'],
    ['Deadline: Nov 20th, 11:59pm', '2026-11-20 23:59'],
    ['Apply before 18 November 2026 by 5pm', '2026-11-18 17:00'],
    ['Submit by 3 Dec at 14:30', '2026-12-3 14:30'],
  ];
  for (const [text, expected] of cases) {
    assert.equal(iso(parseDeadline(text, NOW)?.date), expected, text);
  }
});

test('parseDeadline prefers the date next to a deadline word', () => {
  const g = parseDeadline('Applications open 12 Nov. Deadline: 30 November. Results out 15 December.', NOW)!;
  assert.equal(iso(g.date), '2026-11-30 23:59');
  assert.equal(g.confident, true);
});

test('parseDeadline falls back to the soonest date and says it is unsure', () => {
  const g = parseDeadline('Hackathon runs 20 Nov and 5 December', NOW)!;
  assert.equal(iso(g.date), '2026-11-20 23:59');
  assert.equal(g.confident, false);
});

test('parseDeadline rolls a dateless month forward and ignores invalid dates', () => {
  assert.equal(iso(parseDeadline('closes 5 Jan', NOW)?.date), '2027-1-5 23:59');
  assert.equal(parseDeadline('closes 5 Jan', NOW)?.passed, false);
  assert.equal(parseDeadline('Deadline 31/02/2026', NOW), null);
  assert.equal(parseDeadline('no dates here, just vibes', NOW), null);
  assert.equal(parseDeadline('https://example.com/2026/12/05/post', NOW), null);
});

test('parseDeadline treats today as still valid', () => {
  assert.equal(iso(parseDeadline('Deadline 11 November', NOW)?.date), '2026-11-11 23:59');
  assert.equal(parseDeadline('Deadline 11 November', NOW)?.passed, false);
});

test('parseDeadline reads a recently passed yearless deadline as missed, not next year', () => {
  const g = parseDeadline('Deadline: 5 November', NOW)!;
  assert.equal(iso(g.date), '2026-11-5 23:59');
  assert.equal(g.passed, true);
  assert.equal(g.confident, true);
  // Across New Year: 28 December seen on 3 January is last week, not this December.
  const jan = parseDeadline('Applications closed 28 Dec', new Date(2027, 0, 3, 10, 0))!;
  assert.equal(iso(jan.date), '2026-12-28 23:59');
  assert.equal(jan.passed, true);
});

test('parseDeadline keeps passed dates only next to a deadline word', () => {
  const g = parseDeadline('closed on 3 March 2025', NOW)!;
  assert.equal(iso(g.date), '2025-3-3 23:59');
  assert.equal(g.passed, true);
  assert.equal(parseDeadline('Posted 1 Nov 2026', NOW), null);
  assert.equal(parseDeadline('Posted 1 Nov', NOW), null);
  // An upcoming deadline beats a passed one.
  assert.equal(iso(parseDeadline('Deadline was 5 Nov, now extended. Deadline 30 Nov', NOW)?.date), '2026-11-30 23:59');
});

test('parseDeadline reads yearless dates against when the text was written', () => {
  const sent = new Date(2026, 0, 10, 9, 0); // message from 10 Jan 2026
  const g = parseDeadline('Deadline 5 March', NOW, sent)!;
  assert.equal(iso(g.date), '2026-3-5 23:59');
  assert.equal(g.passed, true);
});

/* ---------------- links and drafts ---------------- */

test('urls are extracted without trailing punctuation and normalised for duplicates', () => {
  assert.deepEqual(extractUrls('see https://a.com/x?utm_source=ig, and (https://b.org/y).'), ['https://a.com/x?utm_source=ig', 'https://b.org/y']);
  assert.equal(normalizeUrl('https://www.A.com/x/?utm_source=ig&id=4#top'), 'https://a.com/x?id=4');
  assert.equal(normalizeUrl('https://a.com/x/'), normalizeUrl('https://www.a.com/x'));
});

test('titleFrom and draftFromShared build a usable draft', () => {
  const text = 'Women in Tech Fellowship 2027\nApply here https://wit.org/apply\nDeadline: 28 November 2026';
  const draft = draftFromShared(text, { source: 'share', now: NOW });
  assert.equal(draft.title, 'Women in Tech Fellowship 2027');
  assert.equal(draft.url, 'https://wit.org/apply');
  assert.equal(iso(draft.deadline ? new Date(draft.deadline) : undefined), '2026-11-28 23:59');
  assert.ok(draft.guessedFrom);
  assert.equal(titleFrom('https://wit.org/apply', 'https://wit.org/apply'), 'wit.org');
  assert.equal(titleFrom('x', null), 'Saved opportunity');
});

/* ---------------- WhatsApp import ---------------- */

const ANDROID_EXPORT = [
  '09/10/2026, 18:02 - Messages and calls are end-to-end encrypted. No one outside of this chat can read them.',
  '09/10/2026, 18:05 - Rasheed: https://forms.gle/abc123',
  '13/10/2026, 09:41 - Rasheed: Tech Fellowship',
  'Deadline: 30 November 2026',
  'https://fellowship.example.org/apply?utm_source=ig',
  '13/10/2026, 09:50 - Rasheed: <Media omitted>',
  '14/10/2026, 10:00 - Rasheed: same link again https://www.forms.gle/abc123/',
  '15/10/2026, 8:15 PM - Rasheed: just a reminder to pray',
].join('\n');

test('WhatsApp export (Android) yields distinct links with their messages, newest first', () => {
  const links = parseWhatsAppExport(ANDROID_EXPORT);
  assert.equal(links.length, 2);
  assert.equal(links[0].url, 'https://fellowship.example.org/apply?utm_source=ig');
  assert.match(links[0].text, /Tech Fellowship\nDeadline: 30 November 2026/);
  assert.equal(links[0].date?.getDate(), 13);
  assert.equal(links[0].date?.getMonth(), 9); // October: day-first detected
  assert.equal(links[1].url, 'https://forms.gle/abc123');
});

test('WhatsApp export (iPhone brackets, month first) is read correctly', () => {
  const raw = [
    '[10/25/26, 3:05:12 PM] Rasheed: https://grant.example.com/apply',
    '[10/26/26, 9:00:00 AM] Rasheed: Deadline 20 Dec https://x.example.com/p',
  ].join('\n');
  const links = parseWhatsAppExport(raw);
  assert.equal(links.length, 2);
  const grant = links.find((l) => l.url.includes('grant'))!;
  assert.equal(grant.date?.getMonth(), 9);
  assert.equal(grant.date?.getDate(), 25);
  assert.equal(grant.date?.getHours(), 15);
});

test('itemsFromImport skips known links and only trusts confident deadlines', () => {
  const links = parseWhatsAppExport(ANDROID_EXPORT);
  let n = 0;
  const existing = [item({ url: 'https://forms.gle/abc123' })];
  const made = itemsFromImport(links, existing, NOW, () => `id${n++}`);
  assert.equal(made.length, 1);
  assert.equal(made[0].source, 'whatsapp');
  assert.equal(iso(made[0].deadline ? new Date(made[0].deadline) : undefined), '2026-11-30 23:59');
  assert.equal(made[0].title, 'Tech Fellowship');

  const none = itemsFromImport(parseWhatsAppExport('01/11/2026, 10:00 - A: Open 20 Nov https://x.org/a'), [], NOW, () => 'z');
  assert.equal(none[0].deadline, null); // "Open 20 Nov" is not a deadline word

  // An old message whose deadline has passed comes in as "Needs a deadline", not next year.
  const old = itemsFromImport(parseWhatsAppExport('10/01/2026, 09:00 - A: Deadline 5 March https://x.org/old'), [], NOW, () => 'o');
  assert.equal(old[0].deadline, null);
});

/* ---------------- home copy ---------------- */

test('headline speaks to the most urgent thing', () => {
  assert.equal(headline([], NOW).title, 'A quiet bank.');
  assert.equal(headline([item({ deadline: at(2026, 11, 11, 20, 0) }), item({ deadline: at(2026, 11, 13) })], NOW).title, 'One closing today.');
  assert.equal(headline([item({ deadline: at(2026, 11, 13) }), item({ deadline: at(2026, 11, 17) })], NOW).title, 'Two closing this week.');
  const h = headline([item({ deadline: at(2026, 12, 20) }), item({}), item({ deadline: at(2026, 11, 1) })], NOW);
  assert.equal(h.title, 'Nothing due this week.');
  assert.equal(h.sub, '1 slipped past · 1 needs a date');
  assert.equal(headline([item({ status: 'applied', deadline: at(2026, 11, 20) })], NOW).title, 'All clear.');
});

test('countdown and nextUp', () => {
  assert.deepEqual(countdown(new Date(NOW.getTime() + 42 * 60_000).toISOString(), NOW), { value: '42', unit: 'min left' });
  assert.deepEqual(countdown(at(2026, 11, 11, 20, 0), NOW), { value: '6', unit: 'hours left' });
  assert.deepEqual(countdown(at(2026, 11, 14), NOW), { value: '3', unit: 'days left' });
  const a = item({ id: 'a', deadline: at(2026, 11, 20) });
  const b = item({ id: 'b', deadline: at(2026, 11, 13) });
  const missed = item({ id: 'm', deadline: at(2026, 11, 1) });
  assert.equal(nextUp([a, missed, b], NOW)?.id, 'b');
  assert.equal(nextUp([missed], NOW), null);
});

test('the deadline snippet starts and ends on whole words', () => {
  const g = parseDeadline('Chevening Scholarships 2027. Deadline: 22 November https://chevening.org/apply', NOW)!;
  assert.equal(g.snippet, '2027. Deadline: 22 November');
});
