import { deadlineFromPage, type DeadlineGuess } from './logic';

/**
 * Opens the application page the way a browser would and looks for a deadline in it.
 * Nothing about the user is sent: it is a plain request for the page they saved.
 * Pages that only build their text with JavaScript (some form builders) have nothing
 * to read, and any failure comes back as null so the user picks the date themselves.
 */
export async function findDeadlineOnPage(url: string, now = new Date(), timeoutMs = 9000): Promise<DeadlineGuess | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
      },
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (type && !/html|xml|text\/plain/i.test(type)) return null;
    const html = await res.text();
    return deadlineFromPage(html, now);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
