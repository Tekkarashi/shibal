import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, TextInput, View, type TextInputInstance } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useApp } from '../context';
import { pickWhatsAppExport } from '../importFile';
import {
  BUCKET_TITLES,
  countdown,
  domainOf,
  formatDeadline,
  groupItems,
  headline,
  nextUp,
  timeLeft,
  type BucketKey,
} from '../logic';
import type { ScreenProps } from '../nav';
import { SwipeRow, useSwipeA11y, useSwipeGuard } from '../SwipeRow';
import { F, makeStyles, NO_OUTLINE, RADIUS, SPACE, useTheme, type Palette } from '../theme';
import { useToast } from '../toast';
import type { Item, Status } from '../types';
import { Button, Icon, IconButton, Pill, SectionLabel, T, Tap } from '../ui';

type Row =
  | { kind: 'header'; key: string; bucket: BucketKey; count: number }
  | { kind: 'item'; key: string; bucket: BucketKey; item: Item }
  | { kind: 'doneToggle'; key: string; count: number };

const REFLOW = LinearTransition.duration(220);
const HERO_IN = FadeIn.duration(240);

function tone(bucket: BucketKey, c: Palette): string {
  switch (bucket) {
    case 'overdue':
      return c.danger;
    case 'today':
    case 'soon':
      return c.accent;
    case 'week':
      return c.muted;
    default:
      return c.faint;
  }
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function Home({ navigation }: ScreenProps<'home'>) {
  const { store, now, needsSetup } = useApp();
  const { c } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [showDone, setShowDone] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const searchRef = useRef<TextInputInstance>(null);
  const searchOpen = query !== null;

  // autoFocus alone loses to the button that was just tapped, so focus once the box has mounted.
  useEffect(() => {
    if (!searchOpen) return;
    const id = setTimeout(() => searchRef.current?.focus(), 60);
    return () => clearTimeout(id);
  }, [searchOpen]);

  const q = query?.trim().toLowerCase() ?? '';
  const visible = useMemo(
    () =>
      q
        ? store.items.filter((i) => `${i.title} ${i.url ?? ''} ${i.notes}`.toLowerCase().includes(q))
        : store.items,
    [store.items, q],
  );

  const hero = useMemo(() => (q ? null : nextUp(store.items, now)), [store.items, now, q]);
  const head = useMemo(() => headline(store.items, now), [store.items, now]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let doneCount = 0;
    for (const section of groupItems(visible, now)) {
      const data = section.data.filter((i) => i.id !== hero?.id);
      if (section.key === 'done') {
        doneCount = data.length;
        if (!showDone && !q) continue;
      }
      if (data.length === 0) continue;
      out.push({ kind: 'header', key: `h:${section.key}`, bucket: section.key, count: data.length });
      // Keyed by status too, so a card that was swiped away comes back fresh if it reappears.
      for (const item of data) out.push({ kind: 'item', key: `${item.id}:${item.status}`, bucket: section.key, item });
    }
    if (doneCount > 0 && !q) out.push({ kind: 'doneToggle', key: 'done-toggle', count: doneCount });
    return out;
  }, [visible, now, hero, showDone, q]);

  const changeStatus = useCallback(
    (item: Item, status: Status) => {
      const before = item.status;
      store.setStatus(item.id, status);
      const msg = status === 'applied' ? 'Marked as applied. Nice work.' : status === 'skipped' ? 'Skipped. It won’t remind you.' : 'Back on the list.';
      toast({
        message: msg,
        icon: status === 'applied' ? 'check-circle' : status === 'skipped' ? 'slash' : 'rotate-ccw',
        action: { label: 'Undo', onPress: () => store.setStatus(item.id, before) },
      });
    },
    [store, toast],
  );

  const openLink = (url: string) => Linking.openURL(url).catch(() => toast({ message: 'Could not open that link', icon: 'link-2' }));
  const open = (id: string) => navigation.push('form', { id });
  const add = () => navigation.push('form', {});

  const importChat = async () => {
    const res = await pickWhatsAppExport();
    if ('raw' in res) navigation.push('import', { raw: res.raw });
    else if ('error' in res) toast({ message: res.error, icon: 'alert-circle' });
  };

  const dateLine = `${DAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`;

  const header = (
    <View>
      <View style={s.topRow}>
        <T style={s.wordmark} accessibilityRole="header">
          Shibal
        </T>
        {store.items.length > 0 ? (
          <IconButton icon={query === null ? 'search' : 'x'} label={query === null ? 'Search' : 'Close search'} onPress={() => setQuery(query === null ? '' : null)} />
        ) : null}
        <IconButton icon="settings" label="Settings" testID="settings" onPress={() => navigation.push('settings')} />
      </View>

      {query !== null ? (
        <Animated.View entering={HERO_IN} style={s.search}>
          <Icon name="search" size={18} color={c.muted} />
          <TextInput
            ref={searchRef}
            value={query}
            onChangeText={setQuery}
            placeholder="Search titles, links, notes"
            placeholderTextColor={c.faint}
            style={[s.searchInput, NO_OUTLINE]}
            returnKeyType="search"
            accessibilityLabel="Search saved items"
          />
        </Animated.View>
      ) : (
        <View style={{ marginTop: SPACE.lg }}>
          <T v="label" style={{ marginBottom: SPACE.sm }}>
            {dateLine}
          </T>
          <T v="display">
            {head.title}
          </T>
          <T v="body" color="muted" style={{ marginTop: SPACE.xs }}>
            {head.sub}
          </T>
        </View>
      )}

      {needsSetup && query === null ? (
        <Tap onPress={() => navigation.push('settings')} accessibilityRole="button" innerStyle={s.banner} style={{ marginTop: SPACE.xl }}>
          <View style={s.bannerIcon}>
            <Icon name="bell-off" size={18} color={c.danger} />
          </View>
          <View style={{ flex: 1 }}>
            <T v="bodyStrong" style={{ color: c.danger }}>
              Reminders are not fully on
            </T>
            <T v="small" style={{ color: c.danger, opacity: 0.85 }}>
              Tap to fix it so nothing slips past you.
            </T>
          </View>
          <Icon name="chevron-right" size={20} color={c.danger} />
        </Tap>
      ) : null}

      {hero ? <Hero item={hero} now={now} onOpen={() => open(hero.id)} onLink={openLink} onApplied={() => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
            changeStatus(hero, 'applied');
          }} /> : null}

      {store.items.length === 0 ? <Empty onAdd={add} onImport={importChat} /> : null}
      {q && rows.length === 0 ? (
        <T v="body" color="muted" style={{ marginTop: SPACE.xxl, textAlign: 'center' }}>
          Nothing matches “{query}”.
        </T>
      ) : null}
    </View>
  );

  const renderItem = ({ item: row }: { item: Row }) => {
    if (row.kind === 'header') {
      return (
        <SectionLabel color={row.bucket === 'overdue' ? c.danger : undefined} right={<T v="caption">{row.count}</T>}>
          {BUCKET_TITLES[row.bucket]}
        </SectionLabel>
      );
    }
    if (row.kind === 'doneToggle') {
      return (
        <Tap onPress={() => setShowDone((v) => !v)} accessibilityRole="button" innerStyle={s.doneToggle}>
          <Icon name={showDone ? 'chevron-up' : 'archive'} size={15} color={c.muted} />
          <T v="caption" style={{ marginLeft: 8, fontFamily: F.bold }}>
            {showDone ? 'Hide finished' : `Show finished (${row.count})`}
          </T>
        </Tap>
      );
    }
    const { item, bucket } = row;
    const card = <ItemCard item={item} bucket={bucket} now={now} onPress={() => open(item.id)} onLink={openLink} onReopen={() => changeStatus(item, 'open')} />;
    if (bucket === 'done') return <View style={{ marginBottom: SPACE.sm + 2 }}>{card}</View>;
    return (
      <View style={{ marginBottom: SPACE.sm + 2 }}>
        <SwipeRow
          left={{ label: 'Applied', icon: 'check', bg: c.okSoft, fg: c.ok }}
          right={{ label: bucket === 'overdue' ? 'Dismiss' : 'Skip', icon: 'slash', bg: c.sunken, fg: c.inkSoft }}
          onCommit={(side) => changeStatus(item, side === 'left' ? 'applied' : 'skipped')}
        >
          {card}
        </SwipeRow>
      </View>
    );
  };

  // Only when a swipeable card is on screen (the Next up card is not one).
  const hasOpen = rows.some((r) => r.kind === 'item' && r.bucket !== 'done');

  return (
    <View style={s.screen}>
      <Animated.FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        renderItem={renderItem}
        // Web's implementation positions cells absolutely and ignores header growth; native reflows normally.
        itemLayoutAnimation={Platform.OS === 'web' ? undefined : REFLOW}
        ListHeaderComponent={header}
        ListFooterComponent={
          hasOpen && !q ? (
            <T v="caption" style={{ textAlign: 'center', marginTop: SPACE.xl, color: c.faint }}>
              Swipe a card right when you’ve applied, left to skip.
            </T>
          ) : undefined
        }
        contentContainerStyle={{ paddingTop: insets.top + SPACE.sm, paddingBottom: insets.bottom + 120, paddingHorizontal: SPACE.gutter }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      />

      {store.items.length > 0 ? (
      <Tap
        onPress={add}
        haptic="light"
        accessibilityRole="button"
        accessibilityLabel="Save a new opportunity"
        style={[s.fabWrap, { bottom: insets.bottom + SPACE.xl }]}
        innerStyle={s.fab}
      >
        <Icon name="plus" size={20} color={c.onAccent} />
        <T style={s.fabText}>New</T>
      </Tap>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */

function Hero({ item, now, onOpen, onLink, onApplied }: { item: Item; now: Date; onOpen: () => void; onLink: (u: string) => void; onApplied: () => void }) {
  const s = useStyles();
  const { c } = useTheme();
  const cd = countdown(item.deadline!, now);
  const urgent = new Date(item.deadline!).getTime() - now.getTime() < 3 * 86_400_000;
  return (
    <Animated.View entering={HERO_IN} style={{ marginTop: SPACE.xl }}>
      <Tap onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Next up: ${item.title}, ${cd.value} ${cd.unit}`} innerStyle={s.hero}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={[s.heroDot, { backgroundColor: urgent ? c.accent : c.onHeroSoft }]} />
          <T v="label" style={{ color: c.onHeroSoft, flex: 1 }}>
            Next up
          </T>
          <T v="caption" style={{ color: c.onHeroSoft }} numberOfLines={1}>
            {domainOf(item.url)}
          </T>
        </View>
        <T v="title" style={{ color: c.onHero, marginTop: SPACE.md }} numberOfLines={3}>
          {item.title}
        </T>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: SPACE.lg }}>
          <T style={[s.heroCount, { color: urgent ? c.accent : c.onHero }]}>{cd.value}</T>
          <View style={{ marginLeft: SPACE.sm, marginBottom: 9, flex: 1 }}>
            <T v="bodyStrong" style={{ color: c.onHero }}>
              {cd.unit}
            </T>
            <T v="caption" style={{ color: c.onHeroSoft }}>
              {formatDeadline(item.deadline!, now)}
            </T>
          </View>
        </View>
        <View style={{ flexDirection: 'row', marginTop: SPACE.lg, gap: SPACE.sm }}>
          {item.url ? <Button kind="primary" small icon="arrow-up-right" label="Open link" onPress={() => onLink(item.url!)} /> : null}
          <Button small icon="check" label="I applied" onPress={onApplied} kind="secondary" />
        </View>
      </Tap>
    </Animated.View>
  );
}

function ItemCard({
  item,
  bucket,
  now,
  onPress,
  onLink,
  onReopen,
}: {
  item: Item;
  bucket: BucketKey;
  now: Date;
  onPress: () => void;
  onLink: (u: string) => void;
  onReopen: () => void;
}) {
  const s = useStyles();
  const { c } = useTheme();
  const swiping = useSwipeGuard();
  const swipeActions = useSwipeA11y();
  const done = bucket === 'done';
  const meta = [domainOf(item.url), item.source === 'whatsapp' ? 'from WhatsApp' : null].filter(Boolean).join(' · ') || 'No link';
  const pillTone = bucket === 'overdue' ? 'danger' : bucket === 'today' || bucket === 'soon' ? 'accent' : 'neutral';

  return (
    <Tap onPress={() => !swiping() && onPress()} accessibilityRole="button" accessibilityLabel={item.title} accessibilityHint={done ? undefined : 'Opens it. Actions menu: mark applied or skip.'} {...swipeActions} innerStyle={[s.card, done && { opacity: 0.72 }]}>
      <View style={[s.stripe, { backgroundColor: tone(bucket, c) }]} />
      <View style={{ flex: 1, paddingVertical: SPACE.lg, paddingLeft: SPACE.md + 2, paddingRight: SPACE.sm }}>
        <T v="headline" numberOfLines={2} style={done ? { textDecorationLine: 'line-through', color: c.muted } : undefined}>
          {item.title}
        </T>
        <T v="small" numberOfLines={1} style={{ marginTop: 2 }}>
          {meta}
        </T>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: SPACE.md, gap: SPACE.sm }}>
          {done ? (
            <>
              <Pill tone={item.status === 'applied' ? 'ok' : 'neutral'} icon={item.status === 'applied' ? 'check' : 'slash'} label={item.status === 'applied' ? 'Applied' : 'Skipped'} />
              <Tap onPress={onReopen} accessibilityRole="button" hitSlop={10}>
                <T v="caption" style={{ color: c.accent, fontFamily: F.bold }}>
                  Reopen
                </T>
              </Tap>
            </>
          ) : item.deadline ? (
            <>
              <Pill tone={pillTone} icon="clock" label={timeLeft(item.deadline, now)} />
              <T v="caption">{formatDeadline(item.deadline, now)}</T>
            </>
          ) : (
            <Pill tone="neutral" icon="calendar" label="Add a deadline" />
          )}
        </View>
      </View>
      {item.url && !done ? (
        <View style={{ justifyContent: 'center', paddingRight: SPACE.sm }}>
          <IconButton icon="arrow-up-right" label={`Open ${domainOf(item.url) || 'link'}`} onPress={() => !swiping() && onLink(item.url!)} tone="accent" size={40} />
        </View>
      ) : null}
    </Tap>
  );
}

function Empty({ onAdd, onImport }: { onAdd: () => void; onImport: () => void }) {
  const s = useStyles();
  const { c } = useTheme();
  const steps: { icon: 'share-2' | 'calendar' | 'bell'; title: string; body: string }[] = [
    { icon: 'share-2', title: 'Share it here', body: 'From Instagram, X, Chrome or anywhere, tap Share and pick Shibal.' },
    { icon: 'calendar', title: 'Set the deadline', body: 'Shibal spots dates in the text. Check it and save.' },
    { icon: 'bell', title: 'Get nudged in time', body: 'A week, three days, a day, and hours before it closes.' },
  ];
  return (
    <View style={{ marginTop: SPACE.xxl }}>
      {steps.map((st, i) => (
        <View key={st.title} style={s.step}>
          <View style={[s.stepIcon, i === 2 && { backgroundColor: c.accent }]}>
            <Icon name={st.icon} size={18} color={i === 2 ? c.onAccent : c.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <T v="bodyStrong">{st.title}</T>
            <T v="small" style={{ marginTop: 2 }}>
              {st.body}
            </T>
          </View>
        </View>
      ))}
      <Button kind="primary" icon="plus" label="Save your first one" onPress={onAdd} style={{ marginTop: SPACE.xl }} />
      <Button kind="ghost" icon="message-circle" label="Import links from WhatsApp" onPress={onImport} style={{ marginTop: SPACE.xs }} />
    </View>
  );
}

const useStyles = makeStyles(({ c, dark }) => ({
  screen: { flex: 1, backgroundColor: c.bg },
  topRow: { flexDirection: 'row', alignItems: 'center', marginRight: -SPACE.sm, minHeight: 48 },
  wordmark: { flex: 1, fontFamily: F.displayItalic, fontSize: 24, color: c.accent, letterSpacing: -0.3 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACE.md + 2,
    marginTop: SPACE.sm,
    minHeight: 50,
  },
  searchInput: { flex: 1, marginLeft: SPACE.sm, fontFamily: F.medium, fontSize: 16, color: c.ink, paddingVertical: 12 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    padding: SPACE.md + 2,
    borderRadius: RADIUS.lg,
    backgroundColor: c.dangerSoft,
  },
  bannerIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' },
  hero: {
    backgroundColor: c.hero,
    borderRadius: RADIUS.xl,
    padding: SPACE.xl,
    ...(dark ? {} : { shadowColor: '#3B2414', shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 6 }),
  },
  heroDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  heroCount: { fontFamily: F.display, fontSize: 64, lineHeight: 68, letterSpacing: -2 },
  card: {
    flexDirection: 'row',
    backgroundColor: c.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: c.line,
    overflow: 'hidden',
  },
  stripe: { width: 4, borderRadius: 2, marginVertical: SPACE.lg, marginLeft: SPACE.md },
  doneToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: SPACE.lg, marginTop: SPACE.sm },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.md + 2, marginBottom: SPACE.lg },
  stepIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
  fabWrap: { position: 'absolute', right: SPACE.gutter },
  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: c.accent,
    paddingHorizontal: 22,
    minHeight: 56,
    borderRadius: RADIUS.pill,
    shadowColor: '#3B2414',
    shadowOpacity: dark ? 0.5 : 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  fabText: { fontFamily: F.heavy, fontSize: 16, color: c.onAccent },
}));
