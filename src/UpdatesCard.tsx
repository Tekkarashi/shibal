import React from 'react';
import { Linking, View } from 'react-native';
import * as Application from 'expo-application';
import * as IntentLauncher from 'expo-intent-launcher';
import { shareBackup } from './backup';
import { useApp } from './context';
import { useToast } from './toast';
import { canSelfUpdate, RELEASES_PAGE } from './updates';
import { useUpdater } from './updater';
import { F, makeStyles, RADIUS, SPACE, useTheme } from './theme';
import { Button, Card, Icon, T } from './ui';

const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1048576))} MB`;

/** Settings → App updates: what's new, then download and hand over to Android's installer. */
export function UpdatesCard() {
  const u = useUpdater();
  if (u.needsReinstall && u.info) return <ReinstallGuide />;
  return <RegularUpdate />;
}

/**
 * Moving from the 0.1.x builds (signed with Android's public debug key) to releases signed
 * with Shibal's private key. Android refuses to install over a different key, so this walks
 * through back up, download, uninstall, install, restore. Nothing is lost.
 */
function ReinstallGuide() {
  const u = useUpdater();
  const { store } = useApp();
  const toast = useToast();
  const s = useStyles();
  const { c } = useTheme();
  const info = u.info!;

  const backUp = async () => {
    try {
      if (store.items.length === 0) toast({ message: 'Nothing to back up, so you can skip this step', icon: 'check-circle' });
      else await shareBackup(store.items);
    } catch {
      toast({ message: 'Could not make the backup file', icon: 'alert-circle' });
    }
  };
  const openAppInfo = () =>
    IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS, {
      data: `package:${Application.applicationId}`,
    }).catch(() => undefined);

  const steps: { title: string; body: string; action: string; onPress: () => void; testID: string }[] = [
    { title: 'Back up your items', body: 'Save the file to Drive, Files, or a WhatsApp chat with yourself.', action: 'Back up now', onPress: backUp, testID: 'reinstall-backup' },
    { title: `Download Shibal ${info.version}`, body: 'Your browser saves it to Downloads, where it stays after the next step.', action: 'Download', onPress: () => Linking.openURL(info.apkUrl), testID: 'reinstall-download' },
    { title: 'Uninstall this version', body: 'In the screen that opens, tap Uninstall.', action: 'Open app info', onPress: openAppInfo, testID: 'reinstall-uninstall' },
    { title: 'Install and restore', body: `Open the download to install Shibal ${info.version}, then Settings → Restore from a backup.`, action: '', onPress: () => undefined, testID: 'reinstall-restore' },
  ];

  return (
    <Card style={{ padding: SPACE.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={[s.icon, { backgroundColor: c.accent }]}>
          <Icon name="shield" size={17} color={c.onAccent} />
        </View>
        <View style={{ flex: 1 }}>
          <T v="bodyStrong" testID="update-title">
            Shibal {info.version} needs a one-time reinstall
          </T>
          <T v="small" style={{ marginTop: 2 }}>
            From this version, Shibal is signed with its own private key, so nobody else can publish an “update” for it. Android can’t
            install it over this copy, so it takes four steps, about two minutes, and nothing is lost.
          </T>
        </View>
      </View>
      {steps.map((st, i) => (
        <View key={st.title} style={s.step}>
          <View style={s.stepNum}>
            <T v="caption" style={{ color: c.accent, fontFamily: F.heavy }}>
              {i + 1}
            </T>
          </View>
          <View style={{ flex: 1 }}>
            <T v="bodyStrong">{st.title}</T>
            <T v="small">{st.body}</T>
            {st.action ? <Button small label={st.action} onPress={st.onPress} style={{ alignSelf: 'flex-start', marginTop: SPACE.sm }} testID={st.testID} /> : null}
          </View>
        </View>
      ))}
    </Card>
  );
}

function RegularUpdate() {
  const u = useUpdater();
  const { c } = useTheme();
  const s = useStyles();
  const offer = !!u.info && (u.phase === 'available' || u.phase === 'downloading' || u.phase === 'ready' || u.phase === 'error');

  const title = offer ? `Version ${u.info!.version} is ready` : 'App updates';
  const status =
    u.phase === 'checking'
      ? 'Checking for a new version…'
      : u.phase === 'latest'
        ? `You’re on the latest version (${u.current}).`
        : u.phase === 'error'
          ? (u.error ?? 'Could not check for updates.')
          : offer
            ? `You have ${u.current}. The update is a ${mb(u.info!.sizeBytes)} download.`
            : `You have version ${u.current}.`;

  return (
    <Card style={{ padding: SPACE.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={[s.icon, offer && { backgroundColor: c.accent }]}>
          <Icon name={offer ? 'download' : 'refresh-cw'} size={17} color={offer ? c.onAccent : c.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <T v="bodyStrong" testID="update-title">
            {title}
          </T>
          <T v="small" style={[{ marginTop: 2 }, u.phase === 'error' && { color: c.danger }]} testID="update-status">
            {status}
          </T>
        </View>
      </View>

      {offer && u.info!.notes ? (
        <T v="small" style={s.notes} numberOfLines={10}>
          {u.info!.notes}
        </T>
      ) : null}

      {u.phase === 'downloading' ? (
        <View style={{ marginTop: SPACE.lg }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(u.progress * 100) }}>
          <View style={s.track}>
            <View style={[s.fill, { width: `${Math.round(u.progress * 100)}%` }]} />
          </View>
          <T v="caption" style={{ marginTop: SPACE.sm }}>
            Downloading… {Math.round(u.progress * 100)}%
          </T>
        </View>
      ) : null}

      <View style={{ marginTop: SPACE.lg, gap: SPACE.sm }}>
        {offer && canSelfUpdate ? (
          <Button
            kind="primary"
            icon="download"
            label={u.phase === 'ready' ? 'Install update' : u.phase === 'error' ? 'Try again' : 'Download and install'}
            onPress={u.install}
            disabled={u.phase === 'downloading'}
            testID="update-install"
          />
        ) : null}
        {offer && !canSelfUpdate ? (
          <Button kind="primary" icon="external-link" label="Get it on GitHub" onPress={() => Linking.openURL(u.info?.page ?? RELEASES_PAGE)} />
        ) : null}
        {!offer || u.phase === 'error' ? (
          <Button icon="refresh-cw" label="Check for updates" onPress={u.check} disabled={u.phase === 'checking'} testID="update-check" />
        ) : null}
      </View>

      {offer && canSelfUpdate ? (
        <T v="caption" style={{ marginTop: SPACE.md }}>
          Android asks you to confirm the install. The first time, it also asks you to allow Shibal to install apps. Your saved items
          and reminders stay.
        </T>
      ) : null}
    </Card>
  );
}

const useStyles = makeStyles(({ c }) => ({
  icon: { width: 34, height: 34, borderRadius: 17, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center', marginRight: SPACE.md },
  notes: { marginTop: SPACE.md, padding: SPACE.md, borderRadius: RADIUS.md, backgroundColor: c.sunken, color: c.inkSoft, fontFamily: F.medium },
  step: { flexDirection: 'row', gap: SPACE.md, marginTop: SPACE.lg },
  stepNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  track: { height: 8, borderRadius: 4, backgroundColor: c.sunken, overflow: 'hidden' },
  // Absolutely positioned and childless, so animating its width never re-lays-out anything else.
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: c.accent, borderRadius: 4 },
}));
