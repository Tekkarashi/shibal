import { Platform } from 'react-native';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Directory, DownloadTask, File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import { isNewerVersion, releaseNotesSummary } from './logic';

/** Where releases are published. The app only ever talks to GitHub's public releases API. */
export const REPO = 'Tekkarashi/shibal';
export const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

export interface UpdateInfo {
  version: string;
  notes: string;
  apkUrl: string;
  sizeBytes: number;
  page: string;
  /** Signed with Shibal's private key (every release from 0.2.0). */
  newSigningKey: boolean;
}

/** Marker the release workflow adds to the notes of releases signed with the private key. */
export const SIGNING_MARKER = '<!-- shibal-signing: release -->';

/** Which key signed this copy of the app: the public debug key (0.1.x) or Shibal's own. */
export function installedSigning(): 'debug' | 'release' {
  return Constants.expoConfig?.extra?.signedWith === 'release' ? 'release' : 'debug';
}

export function installedVersion(): string {
  return Application.nativeApplicationVersion ?? '0.0.0';
}

/** True where Shibal can download and open the installer itself (Android). */
export const canSelfUpdate = Platform.OS === 'android';

/** The latest published release, or null if it has no APK attached. Throws on network errors. */
export async function fetchLatestRelease(): Promise<UpdateInfo | null> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(res.status === 403 ? 'GitHub is busy right now. Try again in a while.' : `GitHub answered ${res.status}.`);
  const r = (await res.json()) as {
    tag_name?: string;
    body?: string;
    html_url?: string;
    assets?: { name: string; browser_download_url: string; size: number }[];
  };
  const apk = r.assets?.find((a) => a.name === 'Shibal.apk') ?? r.assets?.find((a) => /\.apk$/i.test(a.name));
  if (!apk || !r.tag_name) return null;
  return {
    version: r.tag_name.replace(/^v/i, ''),
    notes: releaseNotesSummary(r.body ?? ''),
    apkUrl: apk.browser_download_url,
    sizeBytes: apk.size,
    page: r.html_url ?? RELEASES_PAGE,
    newSigningKey: (r.body ?? '').includes(SIGNING_MARKER),
  };
}

/** A newer release than the one installed, or null when this is the latest. */
export async function findUpdate(): Promise<UpdateInfo | null> {
  const latest = await fetchLatestRelease();
  return latest && isNewerVersion(latest.version, installedVersion()) ? latest : null;
}

/** How a download that stopped is explained, with how far it got. */
export class DownloadStopped extends Error {
  constructor(public readonly fraction: number, cause: unknown) {
    const pct = Math.floor(fraction * 100);
    super(
      `The download stopped${pct > 0 ? ` at ${pct}%` : ''}: the connection is slow or dropped. ` +
        'Tap Try again to carry on from there.',
    );
    this.name = 'DownloadStopped';
    console.warn('[update] download stopped', String(cause));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Downloads the update's APK into the app's cache, reporting progress from 0 to 1.
 *
 * Built for slow and patchy mobile data: the file is written as `.part` and every retry, by
 * itself or from Try again (even after Shibal was closed), carries on from the bytes already
 * saved instead of starting over. It retries on its own while the download keeps moving, and
 * gives up only after a few attempts in a row get nowhere.
 */
export async function downloadUpdate(info: UpdateInfo, onProgress: (fraction: number) => void): Promise<File> {
  const dir = new Directory(Paths.cache, 'updates');
  if (!dir.exists) dir.create({ intermediates: true });
  const name = `Shibal-${info.version}.apk`;
  // Only ever keep the version being installed (finished or partial).
  for (const entry of dir.list()) {
    if (!entry.name.startsWith(name)) entry.delete();
  }

  const done = new File(dir, name);
  const expected = info.sizeBytes > 0 ? info.sizeBytes : null;
  if (done.exists && (expected === null || done.size === expected)) {
    onProgress(1);
    return done;
  }
  if (done.exists) done.delete();

  const part = new File(dir, `${name}.part`);
  const sizeOf = (f: File) => (f.exists ? f.size : 0);
  const report = ({ bytesWritten, totalBytes }: { bytesWritten: number; totalBytes: number }) => {
    const total = expected ?? (totalBytes > 0 ? totalBytes : 0);
    if (total > 0) onProgress(Math.min(1, bytesWritten / total));
  };

  let attempts = 0;
  let stuck = 0;
  for (;;) {
    const before = sizeOf(part);
    if (expected !== null && before > expected) part.delete(); // something is off; start clean
    const offset = sizeOf(part);
    try {
      if (offset > 0) {
        report({ bytesWritten: offset, totalBytes: expected ?? -1 });
        const task = DownloadTask.fromSavable(
          { url: info.apkUrl, fileUri: part.uri, isDirectory: false, resumeData: String(offset) },
          { onProgress: report },
        );
        await task.resumeAsync();
      } else {
        await new DownloadTask(info.apkUrl, part, { onProgress: report }).downloadAsync();
      }
      if (expected !== null && sizeOf(part) !== expected) throw new Error(`got ${sizeOf(part)} of ${expected} bytes`);
      break;
    } catch (e) {
      const after = sizeOf(part);
      stuck = after > offset ? 0 : stuck + 1;
      attempts++;
      if (stuck >= 3 || attempts >= 15) throw new DownloadStopped(expected ? after / expected : 0, e);
      console.warn(`[update] attempt ${attempts} stopped at ${after} bytes, retrying`, String(e));
      await sleep(Math.min(2000 * 2 ** stuck, 15_000));
    }
  }

  part.move(done);
  onProgress(1);
  return done;
}

/**
 * Hands the APK to Android's package installer. Android asks the user to confirm (and, the
 * first time, to allow Shibal to install apps). If they confirm, Shibal is replaced in place,
 * so saved items and reminders stay.
 */
export async function openInstaller(apk: File): Promise<void> {
  const FLAG_GRANT_READ_URI_PERMISSION = 0x00000001;
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: apk.contentUri,
    type: 'application/vnd.android.package-archive',
    flags: FLAG_GRANT_READ_URI_PERMISSION,
  });
}
