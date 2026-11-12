import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, ScrollView, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import * as Haptics from 'expo-haptics';
import * as IntentLauncher from 'expo-intent-launcher';
import { pickBackup, shareBackup } from '../backup';
import { useApp } from '../context';
import { useConfirm } from '../dialog';
import { pickWhatsAppExport } from '../importFile';
import type { ScreenProps } from '../nav';
import { askExactAlarmPermission, askNotificationPermission, getHealth, scheduledCount, scheduleTest, type Health } from '../notifications';
import { makeStyles, RADIUS, SPACE, useTheme } from '../theme';
import { useToast } from '../toast';
import { UpdatesCard } from '../UpdatesCard';
import { useUpdater } from '../updater';
import { Button, Card, Divider, Icon, Pill, SectionLabel, T, Tap, TopBar, type IconName } from '../ui';

function brandTip(): string {
  const id = `${Device.manufacturer ?? ''} ${Device.brand ?? ''}`.toLowerCase();
  if (/tecno|infinix|itel|transsion/.test(id))
    return 'Tecno, Infinix and itel phones often stop background apps. Allow auto-start, set battery use to unrestricted, and lock Shibal in recent apps.';
  if (/xiaomi|redmi|poco/.test(id)) return 'Turn on Autostart for Shibal and set battery saver to “No restrictions”.';
  if (/samsung/.test(id)) return 'Keep Shibal out of “Sleeping apps” and set its battery use to unrestricted.';
  if (/oppo|realme|oneplus|vivo|huawei|honor/.test(id))
    return 'Your phone adds extra battery rules. Allow auto-start and background activity, and set battery to unrestricted.';
  return 'If a reminder ever arrives late, set Shibal’s battery use to unrestricted.';
}

function Row({
  icon,
  title,
  body,
  right,
  onPress,
}: {
  icon: IconName;
  title: string;
  body?: string;
  right?: React.ReactNode;
  onPress?: () => void;
}) {
  const s = useStyles();
  const { c } = useTheme();
  const inner = (
    <View style={s.row}>
      <View style={s.rowIcon}>
        <Icon name={icon} size={17} color={c.accent} />
      </View>
      <View style={{ flex: 1, paddingRight: SPACE.md }}>
        <T v="bodyStrong">{title}</T>
        {body ? (
          <T v="small" style={{ marginTop: 2 }}>
            {body}
          </T>
        ) : null}
      </View>
      {right}
    </View>
  );
  return onPress ? (
    <Tap onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
      {inner}
    </Tap>
  ) : (
    inner
  );
}

export default function Settings({ navigation }: ScreenProps<'settings'>) {
  const { store, checkHealth } = useApp();
  const { settings, updateSettings } = store;
  const { c } = useTheme();
  const s = useStyles();
  const toast = useToast();
  const updater = useUpdater();
  // An update waiting to be installed goes to the top; otherwise the card sits near the bottom.
  const updateFirst = !!updater.info && ['available', 'downloading', 'ready'].includes(updater.phase);
  const confirm = useConfirm();
  const [health, setHealth] = useState<Health | null>(null);
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      setHealth(await getHealth());
      setCount(await scheduledCount());
    } catch {
      setHealth({ notifications: false, exactAlarms: false });
    }
    checkHealth();
  }, [checkHealth]);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (st) => st === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);

  const openAppSettings = () =>
    IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS, {
      data: `package:${Application.applicationId}`,
    }).catch(() => undefined);

  const fixNotifications = async () => {
    const ok = await askNotificationPermission().catch(() => false);
    if (!ok) {
      const go = await confirm({
        title: 'Notifications are blocked',
        message: 'Android won’t ask again from inside the app. Open Shibal’s settings and allow notifications.',
        confirm: 'Open settings',
        cancel: 'Not now',
        icon: 'bell-off',
      });
      if (go) openAppSettings();
    }
    refresh();
  };

  const fixAlarms = async () => {
    const ok = await askExactAlarmPermission();
    if (!ok)
      await confirm({
        title: 'Allow alarms and reminders',
        message: 'Find “Alarms & reminders” for Shibal and switch it on, so reminders fire at the exact minute.',
        confirm: 'Got it',
        icon: 'clock',
      });
    refresh();
  };

  const openBattery = () =>
    IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS).catch(openAppSettings);

  const test = async () => {
    const ok = await askNotificationPermission().catch(() => false);
    if (!ok) {
      fixNotifications();
      return;
    }
    await scheduleTest(60, settings.strict);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    await confirm({
      title: 'Test set for 1 minute',
      message: 'Close Shibal completely (swipe it away) and lock the phone. The reminder should still arrive.',
      confirm: 'Got it',
      icon: 'send',
    });
  };

  const backUp = async () => {
    if (store.items.length === 0) {
      toast({ message: 'Nothing to back up yet', icon: 'save' });
      return;
    }
    try {
      await shareBackup(store.items);
    } catch {
      toast({ message: 'Could not make the backup file', icon: 'alert-circle' });
    }
  };

  const restore = async () => {
    const res = await pickBackup();
    if ('cancelled' in res) return;
    if ('error' in res) {
      toast({ message: res.error, icon: 'alert-circle' });
      return;
    }
    const when = res.exportedAt ? new Date(res.exportedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    const ok = await confirm({
      title: `Restore ${res.items.length} item${res.items.length === 1 ? '' : 's'}?`,
      message: `${when ? `From a backup made ${when}. ` : ''}Nothing you have now is removed. Reminders are set again for restored items.`,
      confirm: 'Restore',
      cancel: 'Cancel',
      icon: 'upload',
    });
    if (!ok) return;
    const { added, updated } = store.restoreItems(res.items);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    toast({
      message: added + updated === 0 ? 'Everything in that backup is already here' : `Restored: ${added} added${updated ? `, ${updated} updated` : ''}`,
      icon: 'check-circle',
    });
  };

  const importChat = async () => {
    const res = await pickWhatsAppExport();
    if ('raw' in res) navigation.push('import', { raw: res.raw });
    else if ('error' in res) toast({ message: res.error, icon: 'alert-circle' });
  };

  const allGood = !!health?.notifications && !!health?.exactAlarms;

  const status = (ok: boolean | undefined, fix: () => void) =>
    ok ? <Pill tone="ok" icon="check" label="On" /> : <Button kind="primary" small label="Allow" onPress={fix} />;

  const toggle = (value: boolean, onChange: (v: boolean) => void, label: string) => (
    <Switch
      value={value}
      onValueChange={(v) => {
        Haptics.selectionAsync().catch(() => undefined);
        onChange(v);
        toast({ message: `${label} ${v ? 'on' : 'off'}`, icon: v ? 'toggle-right' : 'toggle-left' });
      }}
      trackColor={{ true: c.accent, false: c.line }}
      thumbColor={c.raised}
      // react-native-web reads these instead of trackColor/thumbColor
      {...({ activeThumbColor: c.raised, activeTrackColor: c.accent } as object)}
      accessibilityLabel={label}
    />
  );

  return (
    <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
      <TopBar title="Settings" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={[s.healthHero, { backgroundColor: allGood ? c.okSoft : c.dangerSoft }]}>
          <Icon name={allGood ? 'shield' : 'alert-triangle'} size={22} color={allGood ? c.ok : c.danger} />
          <View style={{ flex: 1, marginLeft: SPACE.md }}>
            <T v="headline" style={{ color: allGood ? c.ok : c.danger }}>
              {health === null ? 'Checking reminders…' : allGood ? 'Reminders will reach you' : 'Reminders need a hand'}
            </T>
            <T v="small" style={{ color: allGood ? c.ok : c.danger, opacity: 0.85 }}>
              {count} reminder{count === 1 ? '' : 's'} scheduled on this phone.
            </T>
          </View>
        </View>

        {updateFirst ? (
          <>
            <SectionLabel>App update</SectionLabel>
            <UpdatesCard />
          </>
        ) : null}

        <SectionLabel>Reminder health</SectionLabel>
        <Card>
          <Row icon="bell" title="Notifications" body="Needed for every reminder." right={status(health?.notifications, fixNotifications)} />
          <Divider inset={62} />
          <Row icon="clock" title="Alarms and reminders" body="Lets reminders fire at the exact minute." right={status(health?.exactAlarms, fixAlarms)} />
          <Divider inset={62} />
          <Row icon="battery-charging" title="Battery" body={brandTip()} onPress={openBattery} right={<Icon name="chevron-right" size={18} color={c.faint} />} />
        </Card>
        <View style={{ flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.md }}>
          <Button kind="hero" icon="send" label="Send a test" onPress={test} style={{ flex: 1 }} />
          <Button icon="help-circle" label="Why late?" onPress={() => Linking.openURL('https://dontkillmyapp.com/')} style={{ flex: 1 }} />
        </View>

        <SectionLabel>Behaviour</SectionLabel>
        <Card>
          <Row
            icon="alert-octagon"
            title="Alarm-clock delivery"
            body="Day-of, 3-hour and 1-hour reminders use the alarm-clock path so phone makers can’t hold them back. You may see an alarm icon that day."
            right={toggle(settings.strict, (v) => updateSettings({ strict: v }), 'Alarm-clock delivery')}
          />
          <Divider inset={62} />
          <Row
            icon="sunrise"
            title="Morning summary"
            body="8 AM on days when something is due within 3 days. Mondays also nudge you about links without a date."
            right={toggle(settings.digest, (v) => updateSettings({ digest: v }), 'Morning summary')}
          />
        </Card>

        <SectionLabel>Your data</SectionLabel>
        <Card>
          <Row
            icon="save"
            title="Back up to a file"
            body="Saves every item, with its flyer, to a file you keep: Google Drive, Files, or a WhatsApp chat with yourself."
            onPress={backUp}
            right={<Icon name="chevron-right" size={18} color={c.faint} />}
          />
          <Divider inset={62} />
          <Row
            icon="upload"
            title="Restore from a backup"
            body="Adds what’s in a backup file. Items you already have stay; where both have one, the newer edit wins."
            onPress={restore}
            right={<Icon name="chevron-right" size={18} color={c.faint} />}
          />
        </Card>

        <SectionLabel>Bring your links</SectionLabel>
        <Card>
          <Row
            icon="message-circle"
            title="Import from WhatsApp"
            body="In your chat with yourself: ⋮ → More → Export chat → Without media, then pick “Save to Shibal”. Or pick the file here."
            onPress={importChat}
            right={<Icon name="chevron-right" size={18} color={c.faint} />}
          />
        </Card>

        {!updateFirst ? (
          <>
            <SectionLabel>App updates</SectionLabel>
            <UpdatesCard />
          </>
        ) : null}

        <View style={s.about}>
          <T style={s.wordmark}>Shibal</T>
          <T v="small" style={{ textAlign: 'center', marginTop: SPACE.xs }}>
            Everything stays on this phone. Nothing is uploaded, no account.
          </T>
          <T v="caption" style={{ textAlign: 'center', marginTop: SPACE.sm, color: c.faint }}>
            Version {Application.nativeApplicationVersion ?? '0.1.0'}
          </T>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ c }) => ({
  screen: { flex: 1, backgroundColor: c.bg },
  content: { paddingHorizontal: SPACE.gutter, paddingBottom: 48 },
  healthHero: { flexDirection: 'row', alignItems: 'center', borderRadius: RADIUS.lg, padding: SPACE.lg + 2, marginTop: SPACE.xs },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: SPACE.lg - 2, paddingHorizontal: SPACE.lg },
  rowIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center', marginRight: SPACE.md },
  about: { alignItems: 'center', marginTop: SPACE.xxl + 12 },
  wordmark: { fontFamily: 'Fraunces_600SemiBold_Italic', fontSize: 28, color: c.accent },
}));
