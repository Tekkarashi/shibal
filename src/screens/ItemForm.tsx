import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, ScrollView, TextInput, View, type TextInputInstance } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as IntentLauncher from 'expo-intent-launcher';
import { useApp } from '../context';
import { useConfirm } from '../dialog';
import { pickDateTime } from '../pickDateTime';
import { addDays, atTime, endOfDay, extractUrls, startOfDay, timeLeft } from '../logic';
import type { ScreenProps } from '../nav';
import { F, makeStyles, NO_OUTLINE, RADIUS, SPACE, useTheme } from '../theme';
import { useToast } from '../toast';
import type { Draft } from '../types';
import { Button, Chip, Icon, Pill, T, Tap, TopBar } from '../ui';

const BLANK: Draft = { title: '', url: null, notes: '', deadline: null, source: 'manual' };
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function cleanUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(t)) return `https://${t}`;
  return t;
}

function clock(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

export default function ItemForm({ navigation, route }: ScreenProps<'form'>) {
  const { store, now } = useApp();
  const { c } = useTheme();
  const s = useStyles();
  const toast = useToast();
  const confirm = useConfirm();

  const editingItem = route.params?.id ? store.items.find((i) => i.id === route.params.id) : undefined;
  const editing = !!route.params?.id;
  const initial: Draft = useMemo(
    () =>
      editingItem
        ? { title: editingItem.title, url: editingItem.url, notes: editingItem.notes, deadline: editingItem.deadline, source: editingItem.source }
        : route.params?.draft ?? BLANK,
    // Only the first render's values matter; later store changes must not reset the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [title, setTitle] = useState(initial.title);
  const [url, setUrl] = useState(initial.url ?? '');
  const [notes, setNotes] = useState(initial.notes);
  const [deadline, setDeadline] = useState<Date | null>(initial.deadline ? new Date(initial.deadline) : null);
  const [guessNote, setGuessNote] = useState<string | undefined>(initial.guessedFrom);
  const [focus, setFocus] = useState<'title' | 'url' | 'notes' | null>(null);
  const titleRef = useRef<TextInputInstance>(null);
  const leaving = useRef(false);

  const finalUrl = cleanUrl(url);
  const past = deadline !== null && deadline.getTime() < now.getTime();
  const dirty =
    title !== initial.title ||
    (finalUrl ?? '') !== (initial.url ?? '') ||
    notes !== initial.notes ||
    (deadline?.toISOString() ?? null) !== initial.deadline;

  // Android sizes a multiline input to its text by itself. In the browser the box only ever grows,
  // so measure it from scratch on every change: Enter adds a line, Backspace takes it away again.
  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = titleRef.current as unknown as HTMLTextAreaElement | null;
    if (!el?.style) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [title]);

  // The item was deleted elsewhere (e.g. from a notification tap after deletion).
  useEffect(() => {
    if (editing && !editingItem && !leaving.current) {
      leaving.current = true;
      navigation.goBack();
    }
  }, [editing, editingItem, navigation]);

  // Ask before throwing away unsaved changes, whether by Back, the close button or a gesture.
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (!dirty || leaving.current) return;
        e.preventDefault();
        confirm({
          title: 'Discard changes?',
          message: 'What you typed here will be lost.',
          confirm: 'Discard',
          cancel: 'Keep editing',
          tone: 'danger',
          icon: 'edit-3',
        }).then((ok) => {
          if (ok) {
            leaving.current = true;
            navigation.dispatch(e.data.action);
          }
        });
      }),
    [navigation, dirty, confirm],
  );

  const setDate = (d: Date | null) => {
    setDeadline(d);
    setGuessNote(undefined);
  };

  const openPicker = (mode: 'date' | 'time') => {
    const base = deadline ?? endOfDay(addDays(startOfDay(now), 7));
    pickDateTime({
      mode,
      value: base,
      minimumDate: editing ? undefined : startOfDay(now),
      onPick: (d) => {
        Haptics.selectionAsync().catch(() => undefined);
        if (mode === 'date') {
          // Keep the time already chosen; a fresh date defaults to the end of that day.
          const time = deadline ?? endOfDay(d);
          setDate(atTime(d, time.getHours(), time.getMinutes()));
        } else {
          setDate(atTime(base, d.getHours(), d.getMinutes()));
        }
      },
    });
  };

  const quick = (days: number) => setDate(endOfDay(addDays(startOfDay(now), days)));
  const endOfMonth = () => setDate(endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0)));

  const paste = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      const found = extractUrls(text)[0] ?? cleanUrl(text);
      if (found && /^https?:\/\//i.test(found)) {
        setUrl(found);
        Haptics.selectionAsync().catch(() => undefined);
      } else {
        toast({ message: 'No link on the clipboard', icon: 'clipboard' });
      }
    } catch {
      toast({ message: 'Could not read the clipboard', icon: 'clipboard' });
    }
  };

  const finish = (message: string) => {
    leaving.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    toast({ message, icon: 'check-circle' });
    navigation.goBack();
  };

  const save = () => {
    const t = title.trim();
    if (!t && !finalUrl) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      toast({ message: 'Add a title or a link first', icon: 'edit-3' });
      titleRef.current?.focus();
      return;
    }
    const draft: Draft = {
      title: t || finalUrl || 'Saved opportunity',
      url: finalUrl,
      notes,
      deadline: deadline ? deadline.toISOString() : null,
      source: initial.source,
    };
    const doSave = () => {
      if (editingItem) {
        store.updateItem(editingItem.id, { title: draft.title, url: draft.url, notes: draft.notes, deadline: draft.deadline });
        finish('Saved');
      } else {
        store.addItem(draft);
        finish(draft.deadline ? 'In the bank. Reminders are set.' : 'In the bank. Add a deadline to get reminders.');
      }
    };
    if (past && !editing) {
      confirm({
        title: 'That date has passed',
        message: 'Save it anyway? You won’t get reminders for a past deadline.',
        confirm: 'Save anyway',
        cancel: 'Change date',
        icon: 'alert-circle',
      }).then((ok) => ok && doSave());
      return;
    }
    doSave();
  };

  const addToCalendar = () => {
    if (!deadline) return;
    const end = deadline.getTime();
    IntentLauncher.startActivityAsync('android.intent.action.INSERT', {
      data: 'content://com.android.calendar/events',
      extra: {
        title: `Deadline: ${title.trim() || 'Application'}`,
        description: [finalUrl, notes].filter(Boolean).join('\n\n'),
        beginTime: end - 30 * 60_000,
        endTime: end,
      },
    }).catch(() => toast({ message: 'No calendar app found on this phone', icon: 'calendar' }));
  };

  const openLink = () => {
    if (finalUrl) Linking.openURL(finalUrl).catch(() => toast({ message: 'Could not open that link', icon: 'link-2' }));
  };

  const setStatus = (status: 'applied' | 'skipped' | 'open') => {
    if (!editingItem) return;
    const before = editingItem.status;
    if (dirty) store.updateItem(editingItem.id, { title: title.trim() || editingItem.title, url: finalUrl, notes, deadline: deadline?.toISOString() ?? null });
    store.setStatus(editingItem.id, status);
    leaving.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    toast({
      message: status === 'applied' ? 'Marked as applied. Nice work.' : status === 'skipped' ? 'Skipped. It won’t remind you.' : 'Back on the list.',
      icon: status === 'applied' ? 'check-circle' : status === 'skipped' ? 'slash' : 'rotate-ccw',
      action: { label: 'Undo', onPress: () => store.setStatus(editingItem.id, before) },
    });
    navigation.goBack();
  };

  const confirmDelete = async () => {
    const ok = await confirm({
      title: 'Delete this?',
      message: 'It will be removed along with its reminders.',
      confirm: 'Delete',
      cancel: 'Cancel',
      tone: 'danger',
      icon: 'trash-2',
    });
    if (!ok || !editingItem) return;
    const copy = editingItem;
    leaving.current = true;
    store.removeItem(copy.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    toast({ message: 'Deleted', icon: 'trash-2', action: { label: 'Undo', onPress: () => store.restoreItem(copy) } });
    navigation.goBack();
  };

  return (
    <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
      <TopBar
        title={editing ? 'Edit' : 'New opportunity'}
        onBack={() => navigation.goBack()}
        backIcon="x"
        right={<Button kind="primary" small label="Save" testID="save-top" onPress={save} />}
      />
      <KeyboardAwareScrollView bottomOffset={28} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {route.params?.notice ? (
          <View style={s.notice}>
            <Icon name="info" size={16} color={c.accent} />
            <T v="bodyStrong" style={{ flex: 1, marginLeft: SPACE.sm }}>
              {route.params.notice}
            </T>
          </View>
        ) : null}

        <TextInput
          ref={titleRef}
          testID="title-input"
          style={[s.titleInput, NO_OUTLINE, focus === 'title' && { borderBottomColor: c.accent }]}
          value={title}
          onChangeText={setTitle}
          onFocus={() => setFocus('title')}
          onBlur={() => setFocus(null)}
          placeholder="What’s the opportunity?"
          placeholderTextColor={c.faint}
          multiline
          {...(Platform.OS === 'web' ? { rows: 1 } : null)}
          autoFocus={!editing && !initial.title}
          accessibilityLabel="Title"
        />

        {/* Deadline */}
        <View style={s.deadlineCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <T v="label" style={{ flex: 1 }}>
              Deadline
            </T>
            {deadline ? <Pill tone={past ? 'danger' : 'accent'} icon="clock" label={timeLeft(deadline.toISOString(), now)} /> : null}
          </View>

          <Tap onPress={() => openPicker('date')} accessibilityRole="button" accessibilityLabel="Pick a date" style={{ marginTop: SPACE.md }}>
            {deadline ? (
              <View>
                <T style={[s.bigDate, past && { color: c.danger }]}>
                  {WEEKDAYS[deadline.getDay()]} {deadline.getDate()} {MONTHS[deadline.getMonth()]}
                </T>
                <T v="body" color="muted">
                  {deadline.getFullYear() !== now.getFullYear() ? `${deadline.getFullYear()} · ` : ''}by {clock(deadline)}
                </T>
              </View>
            ) : (
              <View>
                <T style={[s.bigDate, { color: c.faint }]}>No date yet</T>
                <T v="body" color="muted">
                  Without one, Shibal can’t remind you.
                </T>
              </View>
            )}
          </Tap>

          {guessNote ? (
            <View style={[s.guess, past && { backgroundColor: c.dangerSoft }]}>
              <Icon name={past ? 'alert-circle' : 'zap'} size={15} color={past ? c.danger : c.accent} style={{ marginTop: 2 }} />
              <T v="small" style={{ flex: 1, marginLeft: SPACE.sm, color: past ? c.danger : c.inkSoft }}>
                {past
                  ? `Read from “${guessNote}”. That date has already passed. Check for a new round or a later deadline.`
                  : `Spotted in the text: “${guessNote}”. Check it’s right.`}
              </T>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', marginTop: SPACE.lg, gap: SPACE.sm }}>
            <Button small kind="hero" icon="calendar" label={deadline ? 'Change date' : 'Pick a date'} testID="pick-date" onPress={() => openPicker('date')} />
            <Button small icon="clock" label="Time" testID="pick-time" onPress={() => openPicker('time')} disabled={!deadline} />
            {deadline ? <Button small kind="ghost" icon="x" label="" accessibilityLabel="Clear the deadline" onPress={() => setDate(null)} /> : null}
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -SPACE.gutter, marginTop: SPACE.md }} contentContainerStyle={{ paddingHorizontal: SPACE.gutter }}>
          <Chip label="Tomorrow" onPress={() => quick(1)} />
          <Chip label="In 3 days" onPress={() => quick(3)} />
          <Chip label="In a week" onPress={() => quick(7)} />
          <Chip label="In 2 weeks" onPress={() => quick(14)} />
          <Chip label="End of month" onPress={endOfMonth} />
        </ScrollView>

        {/* Link */}
        <T v="label" style={s.fieldLabel}>
          Link
        </T>
        <View style={[s.field, focus === 'url' && s.fieldFocused]}>
          <Icon name="link-2" size={18} color={focus === 'url' ? c.accent : c.muted} />
          <TextInput
            testID="link-input"
            style={[s.fieldInput, NO_OUTLINE]}
            value={url}
            onChangeText={setUrl}
            onFocus={() => setFocus('url')}
            onBlur={() => setFocus(null)}
            placeholder="Paste or type a link"
            placeholderTextColor={c.faint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            accessibilityLabel="Link"
          />
          {finalUrl ? (
            <Tap onPress={openLink} accessibilityRole="button" accessibilityLabel="Open link" hitSlop={8} innerStyle={s.fieldAction}>
              <T v="caption" style={{ color: c.accent, fontFamily: F.heavy }}>
                Open
              </T>
            </Tap>
          ) : (
            <Tap onPress={paste} accessibilityRole="button" accessibilityLabel="Paste link from clipboard" hitSlop={8} innerStyle={s.fieldAction}>
              <T v="caption" style={{ color: c.accent, fontFamily: F.heavy }}>
                Paste
              </T>
            </Tap>
          )}
        </View>

        {/* Notes */}
        <T v="label" style={s.fieldLabel}>
          Notes
        </T>
        <TextInput
          testID="notes-input"
          style={[s.field, s.notes, NO_OUTLINE, focus === 'notes' && s.fieldFocused]}
          value={notes}
          onChangeText={setNotes}
          onFocus={() => setFocus('notes')}
          onBlur={() => setFocus(null)}
          placeholder="What it asks for, who to ask, anything you’ll need later"
          placeholderTextColor={c.faint}
          multiline
          accessibilityLabel="Notes"
        />

        <Button kind="primary" label={editing ? 'Save changes' : 'Save to the bank'} onPress={save} style={{ marginTop: SPACE.xxl }} />

        {deadline && !past && Platform.OS === 'android' ? (
          <Button kind="ghost" icon="calendar" label="Also add to Google Calendar" onPress={addToCalendar} style={{ marginTop: SPACE.xs }} />
        ) : null}

        {editingItem ? (
          <View style={s.manage}>
            {editingItem.status === 'open' ? (
              <View style={{ flexDirection: 'row', gap: SPACE.sm }}>
                <Button icon="check" label="I applied" onPress={() => setStatus('applied')} style={{ flex: 1 }} />
                <Button icon="slash" label="Skip" onPress={() => setStatus('skipped')} style={{ flex: 1 }} />
              </View>
            ) : (
              <Button icon="rotate-ccw" label="Put it back on the list" onPress={() => setStatus('open')} />
            )}
            <Button kind="danger" icon="trash-2" label="Delete" testID="delete" onPress={confirmDelete} style={{ marginTop: SPACE.sm }} />
          </View>
        ) : null}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ c }) => ({
  screen: { flex: 1, backgroundColor: c.bg },
  content: { paddingHorizontal: SPACE.gutter, paddingBottom: 48 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.accentSoft,
    borderRadius: RADIUS.md,
    padding: SPACE.md + 2,
    marginBottom: SPACE.lg,
  },
  titleInput: {
    fontFamily: F.display,
    fontSize: 28,
    lineHeight: 35,
    letterSpacing: -0.4,
    color: c.ink,
    paddingTop: SPACE.sm,
    paddingBottom: SPACE.md,
    marginBottom: SPACE.xl,
    borderBottomWidth: 2,
    borderBottomColor: c.line,
  },
  fieldFocused: { borderColor: c.accent },
  deadlineCard: {
    backgroundColor: c.surface,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: c.line,
    padding: SPACE.xl,
  },
  bigDate: { fontFamily: F.display, fontSize: 26, lineHeight: 32, color: c.ink, letterSpacing: -0.3 },
  guess: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: c.accentSoft,
    borderRadius: RADIUS.md,
    padding: SPACE.md,
    marginTop: SPACE.lg,
  },
  fieldLabel: { marginTop: SPACE.xxl, marginBottom: SPACE.sm },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: RADIUS.md,
    paddingLeft: SPACE.md + 2,
    minHeight: 54,
  },
  fieldInput: { flex: 1, marginLeft: SPACE.sm, fontFamily: F.medium, fontSize: 16, color: c.ink, paddingVertical: 14 },
  fieldAction: { paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md },
  notes: {
    minHeight: 120,
    textAlignVertical: 'top',
    paddingTop: 14,
    paddingRight: SPACE.md + 2,
    fontFamily: F.medium,
    fontSize: 16,
    lineHeight: 23,
    color: c.ink,
  },
  manage: { marginTop: SPACE.xxl, paddingTop: SPACE.xl, borderTopWidth: 1, borderTopColor: c.line },
}));
