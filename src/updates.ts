import { Platform } from 'react-native';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';
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

/** Downloads the update's APK into the app's cache, reporting progress from 0 to 1. */
export async function downloadUpdate(info: UpdateInfo, onProgress: (fraction: number) => void): Promise<File> {
  const dir = new Directory(Paths.cache, 'updates');
  if (dir.exists) dir.delete(); // only ever keep the one being installed
  dir.create({ intermediates: true });
  const dest = new File(dir, `Shibal-${info.version}.apk`);
  const file = await File.downloadFileAsync(info.apkUrl, dest, {
    idempotent: true,
    onProgress: ({ bytesWritten, totalBytes }) => {
      const total = totalBytes > 0 ? totalBytes : info.sizeBytes;
      if (total > 0) onProgress(Math.min(1, bytesWritten / total));
    },
  });
  onProgress(1);
  return file;
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
