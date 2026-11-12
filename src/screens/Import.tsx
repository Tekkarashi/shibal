import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useApp } from '../context';
import { domainOf, normalizeUrl, parseWhatsAppExport, shorten } from '../logic';
import type { ScreenProps } from '../nav';
import { makeStyles, RADIUS, SPACE, useTheme } from '../theme';
import { useToast } from '../toast';
import { Button, Card, Chip, Divider, Icon, T, TopBar } from '../ui';

const RANGES: { label: string; days: number | null }[] = [
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'Everything', days: null },
];

export default function Import({ navigation, route }: ScreenProps<'import'>) {
  const { store, now } = useApp();
  const { c } = useTheme();
  const s = useStyles();
  const toast = useToast();
  const [range, setRange] = useState<number | null>(90);
  const all = useMemo(() => parseWhatsAppExport(route.params.raw), [route.params.raw]);

  const known = useMemo(() => new Set(store.items.filter((i) => i.url).map((i) => normalizeUrl(i.url!))), [store.items]);
  const picked = useMemo(() => {
    const cutoff = range === null ? null : now.getTime() - range * 86_400_000;
    return all.filter((l) => (cutoff === null || !l.date || l.date.getTime() >= cutoff) && !known.has(normalizeUrl(l.url)));
  }, [all, range, known, now]);

  const run = () => {
    const { added, dated } = store.importLinks(picked);
    const undated = added - dated;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    const detail =
      dated === 0 ? 'under “Needs a deadline”' : undated === 0 ? 'with deadlines' : `: ${dated} with a deadline, ${undated} need one`;
    toast({ message: `${added} link${added === 1 ? '' : 's'} added ${detail}`.replace(' :', ':'), icon: 'download' });
    navigation.goBack();
  };

  return (
    <SafeAreaView style={s.screen} edges={['top', 'left', 'right', 'bottom']}>
      <TopBar title="Import from WhatsApp" onBack={() => navigation.goBack()} backIcon="x" />
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {all.length === 0 ? (
          <View style={{ alignItems: 'center', paddingTop: SPACE.xxl }}>
            <View style={s.bigIcon}>
              <Icon name="link-2" size={28} color={c.accent} />
            </View>
            <T v="title" style={{ marginTop: SPACE.lg, textAlign: 'center' }}>
              No links in this file
            </T>
            <T v="body" color="muted" style={{ marginTop: SPACE.sm, textAlign: 'center' }}>
              Check you exported the right chat. Shibal reads the .txt or .zip that WhatsApp makes.
            </T>
          </View>
        ) : (
          <>
            <T v="display">{picked.length} new link{picked.length === 1 ? '' : 's'}</T>
            <T v="body" color="muted" style={{ marginTop: SPACE.xs }}>
              Found {all.length} in this chat. Most land under “Needs a deadline”. A date is filled in only when the message says something like
              “deadline 30 November” and that date is still ahead.
            </T>

            <T v="label" style={{ marginTop: SPACE.xxl, marginBottom: SPACE.sm }}>
              How far back
            </T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: SPACE.sm }}>
              {RANGES.map((r) => (
                <Chip key={r.label} label={r.label} active={range === r.days} onPress={() => setRange(r.days)} />
              ))}
            </View>
            {all.length - picked.length > 0 ? (
              <T v="small" style={{ marginTop: SPACE.sm }}>
                {all.length - picked.length} skipped: older than your range or already saved.
              </T>
            ) : null}

            {picked.length > 0 ? (
              <Card style={{ marginTop: SPACE.xl }}>
                {picked.slice(0, 6).map((l, i) => (
                  <View key={`${l.url}-${i}`}>
                    {i > 0 ? <Divider inset={SPACE.lg} /> : null}
                    <View style={{ padding: SPACE.lg }}>
                      <T v="bodyStrong" numberOfLines={2}>
                        {shorten(l.text || domainOf(l.url) || l.url, 90)}
                      </T>
                      <T v="small" numberOfLines={1} style={{ marginTop: 2 }}>
                        {domainOf(l.url)}
                        {l.date ? ` · ${l.date.getDate()}/${l.date.getMonth() + 1}/${l.date.getFullYear()}` : ''}
                      </T>
                    </View>
                  </View>
                ))}
                {picked.length > 6 ? (
                  <>
                    <Divider inset={SPACE.lg} />
                    <T v="caption" style={{ padding: SPACE.lg }}>
                      and {picked.length - 6} more
                    </T>
                  </>
                ) : null}
              </Card>
            ) : null}

            <Button
              kind="primary"
              icon="download"
              label={picked.length > 0 ? `Import ${picked.length} link${picked.length === 1 ? '' : 's'}` : 'Nothing new to import'}
              onPress={run}
              disabled={picked.length === 0}
              style={{ marginTop: SPACE.xl }}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ c }) => ({
  screen: { flex: 1, backgroundColor: c.bg },
  content: { paddingHorizontal: SPACE.gutter, paddingBottom: 48 },
  bigIcon: { width: 64, height: 64, borderRadius: RADIUS.pill, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
}));
