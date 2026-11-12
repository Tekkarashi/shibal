import type { Draft, Item } from './types';

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

const DAY_MS = 86_400_000;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 0, 0);
}

export function atTime(d: Date, hour: number, minute = 0): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute, 0, 0);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), 0, 0);
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function calendarDaysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS);
}

function clock(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** "Today, 5:00 PM", "Tomorrow, 11:59 PM", "Thu 14 Nov, 9:00 AM". */
export function formatDeadline(iso: string, now: Date): string {
  const d = new Date(iso);
  const diff = calendarDaysBetween(now, d);
  if (diff === 0) return `Today, ${clock(d)}`;
  if (diff === 1) return `Tomorrow, ${clock(d)}`;
  const yearPart = d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}${yearPart}, ${clock(d)}`;
}

/** "in 2 days", "in 3 hours", "42 min left", "missed 2 days ago". */
export function timeLeft(iso: string, now: Date): string {
  const ms = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(ms);
  const mins = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = calendarDaysBetween(now, new Date(iso));
  if (ms < 0) {
    if (mins < 60) return `missed ${Math.max(mins, 1)} min ago`;
    if (hours < 24) return `missed ${hours} h ago`;
    const d = Math.abs(days);
    return `missed ${d} day${d === 1 ? '' : 's'} ago`;
  }
  if (mins < 60) return `${Math.max(mins, 1)} min left`;
  if (hours < 24 && days === 0) return `${hours} h left`;
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

/* ------------------------------------------------------------------ */
/* Urgency buckets                                                     */
/* ------------------------------------------------------------------ */

export type BucketKey = 'overdue' | 'today' | 'soon' | 'week' | 'later' | 'nodeadline' | 'done';

export const BUCKET_TITLES: Record<BucketKey, string> = {
  overdue: 'Missed or passed',
  today: 'Due today',
  soon: 'Next 3 days',
  week: 'This week',
  later: 'Later',
  nodeadline: 'Needs a deadline',
  done: 'Done',
};

export const BUCKET_ORDER: BucketKey[] = ['overdue', 'today', 'soon', 'week', 'later', 'nodeadline', 'done'];

export function bucketOf(item: Item, now: Date): BucketKey {
  if (item.status !== 'open') return 'done';
  if (!item.deadline) return 'nodeadline';
  const d = new Date(item.deadline);
  if (d.getTime() < now.getTime()) return 'overdue';
  const days = calendarDaysBetween(now, d);
  if (days === 0) return 'today';
  if (days <= 3) return 'soon';
  if (days <= 7) return 'week';
  return 'later';
}

export interface Section {
  key: BucketKey;
  title: string;
  data: Item[];
}

export function groupItems(items: Item[], now: Date): Section[] {
  const buckets = new Map<BucketKey, Item[]>();
  for (const key of BUCKET_ORDER) buckets.set(key, []);
  for (const item of items) buckets.get(bucketOf(item, now))!.push(item);

  const byDeadlineAsc = (a: Item, b: Item) => new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime();
  const byNewest = (a: Item, b: Item) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  const byUpdated = (a: Item, b: Item) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();

  buckets.get('overdue')!.sort((a, b) => byDeadlineAsc(b, a)); // most recently missed first
  for (const k of ['today', 'soon', 'week', 'later'] as BucketKey[]) buckets.get(k)!.sort(byDeadlineAsc);
  buckets.get('nodeadline')!.sort(byNewest);
  buckets.get('done')!.sort(byUpdated);

  return BUCKET_ORDER.filter((k) => buckets.get(k)!.length > 0).map((k) => ({
    key: k,
    title: BUCKET_TITLES[k],
    data: buckets.get(k)!,
  }));
}

/* ------------------------------------------------------------------ */
/* Reminder ladder                                                     */
/* ------------------------------------------------------------------ */

export interface Rung {
  at: Date;
  label: string;
  /** Last-day reminders; these get alarm-clock delivery when strict mode is on. */
  critical: boolean;
}

const MIN_GAP_MS = 45 * 60_000;

/**
 * Reminders for one deadline: a week, three days and one day out at 9 AM,
 * the morning of the day, then three hours and one hour before.
 * Anything already in the past is dropped, and rungs closer than 45 minutes
 * to an earlier one are merged so the phone does not buzz twice in a row.
 */
export function buildLadder(deadline: Date, now: Date): Rung[] {
  const day = startOfDay(deadline);
  const candidates: Rung[] = [
    { at: atTime(addDays(day, -7), 9), label: '1 week left', critical: false },
    { at: atTime(addDays(day, -3), 9), label: '3 days left', critical: false },
    { at: atTime(addDays(day, -1), 9), label: 'Due tomorrow', critical: false },
    { at: atTime(day, 8), label: 'Due today', critical: true },
    { at: new Date(deadline.getTime() - 3 * 3_600_000), label: '3 hours left', critical: true },
    { at: new Date(deadline.getTime() - 3_600_000), label: '1 hour left', critical: true },
  ];

  const floor = now.getTime() + 30_000;
  const future = candidates
    .filter((r) => r.at.getTime() > floor && r.at.getTime() < deadline.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const kept: Rung[] = [];
  for (const r of future) {
    const last = kept[kept.length - 1];
    if (last && r.at.getTime() - last.at.getTime() < MIN_GAP_MS) {
      // Keep the earlier one, but let it inherit "critical" so strict delivery is not lost.
      if (r.critical) last.critical = true;
      continue;
    }
    kept.push({ ...r });
  }

  // Saved with very little time left: one prompt right away beats silence.
  if (kept.length === 0 && deadline.getTime() - now.getTime() > 5 * 60_000) {
    kept.push({ at: new Date(now.getTime() + 60_000), label: 'Due very soon', critical: true });
  }
  return kept;
}

/* ------------------------------------------------------------------ */
/* Morning digest                                                      */
/* ------------------------------------------------------------------ */

export interface Digest {
  at: Date;
  title: string;
  body: string;
  key: string;
}

/**
 * One summary per morning for the next `days` days, only on mornings where
 * something is due within the following 72 hours. Mondays also nudge about
 * saved links that still have no deadline.
 */
export function buildDigests(items: Item[], now: Date, days = 14, hour = 8): Digest[] {
  const open = items.filter((i) => i.status === 'open');
  const dated = open.filter((i) => i.deadline).map((i) => ({ item: i, t: new Date(i.deadline!).getTime() }));
  const undated = open.filter((i) => !i.deadline).length;
  const out: Digest[] = [];

  for (let n = 0; n < days; n++) {
    const day = addDays(startOfDay(now), n);
    const at = atTime(day, hour);
    if (at.getTime() <= now.getTime() + 60_000) continue;

    const horizon = at.getTime() + 3 * DAY_MS;
    const due = dated.filter((x) => x.t > at.getTime() && x.t <= horizon).sort((a, b) => a.t - b.t);
    const mondayNudge = at.getDay() === 1 && undated > 0;
    if (due.length === 0 && !mondayNudge) continue;

    const lines = due.slice(0, 4).map((x) => `${shorten(x.item.title, 42)}, ${formatDeadline(x.item.deadline!, at)}`);
    if (due.length > 4) lines.push(`and ${due.length - 4} more`);
    if (mondayNudge) lines.push(`${undated} saved link${undated === 1 ? ' has' : 's have'} no deadline yet`);

    out.push({
      at,
      key: `${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`,
      title: due.length > 0 ? `${due.length} deadline${due.length === 1 ? '' : 's'} coming up` : 'Saved links need deadlines',
      body: lines.join('\n'),
    });
  }
  return out;
}

export function shorten(s: string, max: number): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/* ------------------------------------------------------------------ */
/* Links and titles                                                    */
/* ------------------------------------------------------------------ */

const URL_RE = /https?:\/\/[^\s<>"'‎‏]+/gi;

export function extractUrls(text: string): string[] {
  const found = text.match(URL_RE) ?? [];
  return found.map((u) => u.replace(/[)\].,;:!?'"]+$/g, ''));
}

export function stripUrls(text: string): string {
  return text.replace(URL_RE, ' ').replace(/[ \t]+/g, ' ').trim();
}

export function domainOf(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (key.startsWith('utm_') || key === 'igsh' || key === 'igshid' || key === 'fbclid') u.searchParams.delete(key);
    }
    return `${u.protocol}//${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

export function titleFrom(text: string, url: string | null, metaTitle?: string | null): string {
  if (metaTitle && metaTitle.trim()) return shorten(metaTitle, 90);
  const line = stripUrls(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 3);
  if (line) return shorten(line, 90);
  const domain = domainOf(url);
  return domain || 'Saved opportunity';
}

/* ------------------------------------------------------------------ */
/* Guessing a deadline from text                                       */
/* ------------------------------------------------------------------ */

const MONTH_LOOKUP: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4,
  jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const ORD = '(?:st|nd|rd|th)?';
const KEYWORD_RE = /(deadline|closes?|closing|closed(?: on)?|apply by|apply before|applications?\s+(?:close|end|due)|due|before|until|till|ends?|submit(?:ted)? by|last day|no later than|on or before|register by)\W*$/i;

export interface DeadlineGuess {
  date: Date;
  /** The words the date was read from. */
  snippet: string;
  /** True when a word like "deadline" or "closes" sat right before the date. */
  confident: boolean;
  /** True when the date is already behind `now`. Only confident guesses can be passed. */
  passed: boolean;
}

/** A yearless date this far back is read as recently missed, not as next year's. */
const RECENT_PAST_DAYS = 90;

interface Candidate {
  index: number;
  end: number;
  date: Date;
  explicitTime: { h: number; m: number } | null;
  snippet: string;
  confident: boolean;
}

function validDate(y: number, mo: number, d: number): boolean {
  const t = new Date(y, mo, d);
  return t.getFullYear() === y && t.getMonth() === mo && t.getDate() === d;
}

/**
 * The words around a date, for showing the user where it was read from.
 * About two words of context each side, widened to whole words so it never
 * starts or ends mid-word ("…27. Deadline" instead of "2027. Deadline").
 */
export function snippetAround(text: string, start: number, end: number): string {
  let from = Math.max(0, start - 14);
  let to = Math.min(text.length, end + 8);
  while (from > 0 && !/\s/.test(text[from - 1])) from--;
  while (to < text.length && !/\s/.test(text[to])) to++;
  return text.slice(from, to).replace(/\s+/g, ' ').trim();
}

function readTime(after: string): { h: number; m: number } | null {
  const head = after.slice(0, 40);
  const ampm = head.match(/(?:^|[^\d])(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\b/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10) % 12;
    if (ampm[3].toLowerCase() === 'p') h += 12;
    return { h, m: ampm[2] ? parseInt(ampm[2], 10) : 0 };
  }
  const h24 = head.match(/(?:^|[^\d])([01]?\d|2[0-3]):([0-5]\d)(?!\d)/);
  if (h24) return { h: parseInt(h24[1], 10), m: parseInt(h24[2], 10) };
  return null;
}

/**
 * Looks for a date in free text such as a pasted announcement. Links are
 * ignored. Returns the best guess or null; callers must show the guess to the
 * user instead of trusting it silently.
 *
 * A date written without a year gets the year that puts it on or after
 * `writtenAt` (when the text was written, e.g. a WhatsApp message's time).
 * Without `writtenAt`, a date up to 90 days back stays in this year and comes
 * back as `passed`, so "Deadline: 5 November" seen on 11 November reads as
 * missed rather than as next November.
 *
 * Past dates are kept only when a deadline word sits next to them; a lone
 * past date ("posted 1 Nov") is not a deadline.
 */
export function parseDeadline(rawText: string, now: Date, writtenAt?: Date): DeadlineGuess | null {
  const text = rawText.replace(URL_RE, (m) => ' '.repeat(m.length));
  const today = startOfDay(now);
  const anchor = startOfDay(writtenAt ?? now);
  const yearlessFloor = writtenAt ? anchor : addDays(anchor, -RECENT_PAST_DAYS);
  const candidates: Candidate[] = [];

  const push = (m: RegExpExecArray, y: number | null, mo: number, d: number) => {
    let date: Date | null = null;
    if (y === null) {
      // Earliest of last, this and next year that is not before the floor.
      for (let year = anchor.getFullYear() - 1; year <= anchor.getFullYear() + 1; year++) {
        if (!validDate(year, mo, d)) continue;
        const t = new Date(year, mo, d);
        if (t.getTime() >= yearlessFloor.getTime()) {
          date = t;
          break;
        }
      }
    } else if (validDate(y, mo, d)) {
      date = new Date(y, mo, d);
    }
    if (!date) return;
    const before = text.slice(Math.max(0, m.index - 36), m.index);
    const confident = KEYWORD_RE.test(before);
    if (date.getTime() < today.getTime() && !confident) return;
    candidates.push({
      index: m.index,
      end: m.index + m[0].length,
      date,
      explicitTime: readTime(text.slice(m.index + m[0].length)),
      snippet: snippetAround(text, m.index, m.index + m[0].length),
      confident,
    });
  };

  const iso = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g;
  const dayMonth = new RegExp(`\\b(\\d{1,2})${ORD}\\s+(?:of\\s+)?${MONTH_RE}\\b\\.?(?:,?\\s*(20\\d{2}))?`, 'gi');
  const monthDay = new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})${ORD}\\b(?:,?\\s*(20\\d{2}))?`, 'gi');
  const numeric = /\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2}|\d{2})\b/g;

  let m: RegExpExecArray | null;
  while ((m = iso.exec(text))) push(m, +m[1], +m[2] - 1, +m[3]);
  while ((m = dayMonth.exec(text))) push(m, m[3] ? +m[3] : null, MONTH_LOOKUP[m[2].toLowerCase()], +m[1]);
  while ((m = monthDay.exec(text))) push(m, m[3] ? +m[3] : null, MONTH_LOOKUP[m[1].toLowerCase()], +m[2]);
  while ((m = numeric.exec(text))) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    push(m, year, +m[2] - 1, +m[1]); // day first, the way it is written in Nigeria and the UK
  }

  if (candidates.length === 0) return null;

  // A date right after "deadline", "closes", etc. wins. Within that, the soonest
  // upcoming date, and only if none is upcoming, the most recently passed one.
  const confident = candidates.filter((c) => c.confident);
  const pool = confident.length > 0 ? confident : candidates;
  const t0 = today.getTime();
  pool.sort((a, b) => {
    const ta = a.date.getTime();
    const tb = b.date.getTime();
    const pa = ta < t0;
    const pb = tb < t0;
    if (pa !== pb) return pa ? 1 : -1;
    return (pa ? tb - ta : ta - tb) || a.index - b.index;
  });
  const best = pool[0];

  const date = best.explicitTime
    ? atTime(best.date, best.explicitTime.h, best.explicitTime.m)
    : endOfDay(best.date);
  return { date, snippet: best.snippet, confident: confident.length > 0, passed: date.getTime() < now.getTime() };
}

/** Builds the starting point for the add form from a shared or pasted message. */
export function draftFromShared(
  text: string,
  opts: { metaTitle?: string | null; webUrl?: string | null; source: Draft['source']; now: Date },
): Draft {
  const urls = extractUrls(text);
  const url = opts.webUrl ?? urls[0] ?? null;
  const guess = parseDeadline(text, opts.now);
  return {
    title: titleFrom(text, url, opts.metaTitle),
    url,
    notes: stripUrls(text).slice(0, 1200),
    deadline: guess ? guess.date.toISOString() : null,
    source: opts.source,
    guessedFrom: guess?.snippet,
  };
}

/* ------------------------------------------------------------------ */
/* WhatsApp chat export                                                */
/* ------------------------------------------------------------------ */

export interface ImportedLink {
  url: string;
  text: string;
  date: Date | null;
}

const HEADER_ANDROID = /^‎?(\d{1,2})[/.](\d{1,2})[/.](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp]\.?[Mm]\.?)?\s+-\s+(.*)$/;
const HEADER_IOS = /^‎?\[(\d{1,2})[/.](\d{1,2})[/.](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp]\.?[Mm]\.?)?\]\s+(.*)$/;

interface RawMessage {
  a: number;
  b: number;
  y: number;
  hh: number;
  mm: number;
  ampm: string | undefined;
  text: string;
}

/**
 * Reads a WhatsApp "Export chat" text file (Android or iPhone format) and
 * returns every link found, newest first, one entry per distinct link.
 */
export function parseWhatsAppExport(raw: string): ImportedLink[] {
  const clean = raw.replace(/[  ]/g, ' ').replace(/\r/g, '');
  const messages: RawMessage[] = [];

  for (const line of clean.split('\n')) {
    const m = HEADER_ANDROID.exec(line) ?? HEADER_IOS.exec(line);
    if (m) {
      messages.push({ a: +m[1], b: +m[2], y: +m[3], hh: +m[4], mm: +m[5], ampm: m[6], text: m[7] });
    } else if (messages.length > 0) {
      messages[messages.length - 1].text += `\n${line}`;
    }
  }

  // Day-first unless the numbers prove month-first.
  const monthFirst = messages.some((x) => x.a <= 12 && x.b > 12) && !messages.some((x) => x.a > 12);

  const seen = new Set<string>();
  const out: ImportedLink[] = [];
  for (const msg of messages) {
    if (/<Media omitted>|image omitted|video omitted/i.test(msg.text) && !/https?:\/\//i.test(msg.text)) continue;
    const body = msg.text.replace(/^[^:\n]{1,60}: /, ''); // drop the sender name
    const urls = extractUrls(body);
    if (urls.length === 0) continue;

    const day = monthFirst ? msg.b : msg.a;
    const month = monthFirst ? msg.a : msg.b;
    const year = msg.y < 100 ? 2000 + msg.y : msg.y;
    let hour = msg.hh;
    if (msg.ampm) {
      hour = hour % 12;
      if (/^p/i.test(msg.ampm)) hour += 12;
    }
    const date = validDate(year, month - 1, day) ? new Date(year, month - 1, day, hour, msg.mm) : null;
    const text = stripUrls(body);

    for (const url of urls) {
      const key = normalizeUrl(url);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ url, text, date });
    }
  }
  return out.sort((x, y) => (y.date?.getTime() ?? 0) - (x.date?.getTime() ?? 0));
}

/** Turns imported links into items. Only a deadline next to a word like "deadline" is trusted. */
export function itemsFromImport(
  links: ImportedLink[],
  existing: Item[],
  now: Date,
  makeId: () => string,
): Item[] {
  const known = new Set(existing.filter((i) => i.url).map((i) => normalizeUrl(i.url!)));
  const stamp = now.toISOString();
  const out: Item[] = [];
  for (const link of links) {
    const key = normalizeUrl(link.url);
    if (known.has(key)) continue;
    known.add(key);
    // Read yearless dates against the message's own date, and leave
    // already-passed deadlines out so old chats do not flood "Missed".
    const guess = parseDeadline(link.text, now, link.date ?? undefined);
    out.push({
      id: makeId(),
      title: titleFrom(link.text, link.url),
      url: link.url,
      notes: link.text.slice(0, 1200),
      deadline: guess && guess.confident && !guess.passed ? guess.date.toISOString() : null,
      status: 'open',
      source: 'whatsapp',
      createdAt: link.date ? link.date.toISOString() : stamp,
      updatedAt: stamp,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Home screen copy                                                    */
/* ------------------------------------------------------------------ */

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const word = (n: number) => WORDS[n] ?? String(n);

/** The big line at the top of the home screen, and the one under it. */
export function headline(items: Item[], now: Date): { title: string; sub: string } {
  if (items.length === 0) {
    return { title: 'A quiet bank.', sub: 'Save your first opportunity and Shibal keeps watch.' };
  }
  const count = (k: BucketKey) => items.filter((i) => bucketOf(i, now) === k).length;
  const today = count('today');
  const week = count('soon') + count('week');
  const later = count('later');
  const missed = count('overdue');
  const undated = count('nodeadline');

  const extras: string[] = [];
  if (missed > 0) extras.push(`${missed} slipped past`);
  if (undated > 0) extras.push(`${undated} need${undated === 1 ? 's' : ''} a date`);

  if (today > 0) {
    const more = week > 0 ? `${week} more this week` : 'Make it count';
    return { title: `${word(today)} closing today.`, sub: [more, ...extras].join(' · ') };
  }
  if (week > 0) {
    return { title: `${word(week)} closing this week.`, sub: extras.length ? extras.join(' · ') : 'You have time. Use it well.' };
  }
  if (later > 0) {
    return { title: 'Nothing due this week.', sub: extras.length ? extras.join(' · ') : `${later} further out, all on watch.` };
  }
  if (undated > 0 || missed > 0) {
    return { title: 'Nothing on the clock.', sub: extras.join(' · ') };
  }
  return { title: 'All clear.', sub: 'Every saved opportunity is handled.' };
}

/** "3" + "days left", "5" + "hours left", "42" + "min left". */
export function countdown(iso: string, now: Date): { value: string; unit: string } {
  const ms = new Date(iso).getTime() - now.getTime();
  if (ms <= 0) return { value: '0', unit: 'min left' };
  const mins = Math.max(1, Math.floor(ms / 60_000));
  if (mins < 60) return { value: String(mins), unit: 'min left' };
  const hours = Math.floor(ms / 3_600_000);
  const days = calendarDaysBetween(now, new Date(iso));
  if (days === 0 || hours < 12) return { value: String(hours), unit: hours === 1 ? 'hour left' : 'hours left' };
  return { value: String(days), unit: days === 1 ? 'day left' : 'days left' };
}

/** The most urgent open item that has not passed yet. */
export function nextUp(items: Item[], now: Date): Item | null {
  let best: Item | null = null;
  for (const i of items) {
    if (i.status !== 'open' || !i.deadline) continue;
    const t = new Date(i.deadline).getTime();
    if (t < now.getTime()) continue;
    if (!best || t < new Date(best.deadline!).getTime()) best = i;
  }
  return best;
}
