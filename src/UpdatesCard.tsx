import React from 'react';
import { Linking, View } from 'react-native';
import { canSelfUpdate, RELEASES_PAGE } from './updates';
import { useUpdater } from './updater';
import { F, makeStyles, RADIUS, SPACE, useTheme } from './theme';
import { Button, Card, Icon, T } from './ui';

const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1048576))} MB`;

/** Settings → App updates: what's new, then download and hand over to Android's installer. */
export function UpdatesCard() {
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
  track: { height: 8, borderRadius: 4, backgroundColor: c.sunken, overflow: 'hidden' },
  // Absolutely positioned and childless, so animating its width never re-lays-out anything else.
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: c.accent, borderRadius: 4 },
}));
