import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Image, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, type TextInputInstance } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as IntentLauncher from 'expo-intent-launcher';
import { useApp } from '../context';
import { useConfirm } from '../dialog';
import { pickDateTime } from '../pickDateTime';
import { addDays, atTime, domainOf, endOfDay, extractUrls, parseDeadline, shorten, startOfDay, timeLeft, type DeadlineGuess } from '../logic';
import { readImageText } from '../ocr';
import { findDeadlineOnPage } from '../pageScan';
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
        ? { title: editingItem.title, url: editingItem.url, notes: editingItem.notes, deadline: editingItem.deadline, source: editingItem.source, imageUri: editingItem.imageUri ?? null }
        : route.params?.draft ?? BLANK,
    // Only the first render's values matter; later store changes must not reset the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [title, setTitle] = useState(initial.title);
  const [url, setUrl] = useState(initial.url ?? '');
  const [notes, setNotes] = useState(initial.notes);
  const [imageUri, setImageUri] = useState<string | null>(initial.imageUri ?? null);
  const [viewing, setViewing] = useState(false);
  const [deadline, setDeadline] = useState<Date | null>(initial.deadline ? new Date(initial.deadline) : null);
  const [guessNote, setGuessNote] = useState<string | undefined>(initial.guessedFrom);
  /** Where the guessed date came from: the shared text, the flyer, or the application page. */
  const [guessFrom, setGuessFrom] = useState<'text' | 'flyer' | 'page'>('text');
  /** What the box under an empty date is doing. */
  const [scan, setScan] = useState<'idle' | 'reading' | 'looking' | 'none'>('idle');
  /** A date on the flyer with no deadline word next to it (often the event day): offered, never set on its own. */
  const [maybe, setMaybe] = useState<{ date: Date; snippet: string } | null>(null);
  const [focus, setFocus] = useState<'title' | 'url' | 'notes' | null>(null);
  const titleRef = useRef<TextInputInstance>(null);
  const leaving = useRef(false);

  const finalUrl = cleanUrl(url);
  const past = deadline !== null && deadline.getTime() < now.getTime();
  const dirty =
    title !== initial.title ||
    (finalUrl ?? '') !== (initial.url ?? '') ||
    notes !== initial.notes ||
    imageUri !== (initial.imageUri ?? null) ||
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

  // Reading the flyer and the page takes a moment; never overwrite what the user typed meanwhile.
  const deadlineRef = useRef(deadline);
  deadlineRef.current = deadline;
  const titleNow = useRef(title);
  titleNow.current = title;
  const notesNow = useRef(notes);
  notesNow.current = notes;

  const takeGuess = (g: { date: Date; snippet: string }, from: 'flyer' | 'page') => {
    if (deadlineRef.current) return;
    Haptics.selectionAsync().catch(() => undefined);
    setDeadline(g.date);
    setGuessNote(g.snippet);
    setGuessFrom(from);
    setMaybe(null);
  };

  /** Reads the flyer first (on the phone), then the application page. Stops at the first deadline found. */
  const findDate = async ({ flyer, page }: { flyer?: string | null; page?: string | null }) => {
    let unsure: DeadlineGuess | null = null;
    if (flyer) {
      setScan('reading');
      const text = await readImageText(flyer);
      if (leaving.current) return;
      if (text) {
        // A flyer shared without a caption has nothing else to name it or search it by.
        if (!titleNow.current.trim()) {
          const line = text.split('\n').map((l) => l.trim()).find((l) => l.length > 3 && /[a-z]/i.test(l));
          if (line) setTitle(shorten(line, 90));
        }
        if (!notesNow.current.trim()) setNotes(text.slice(0, 1200));
        const g = parseDeadline(text, new Date());
        if (g?.confident) {
          takeGuess(g, 'flyer');
          setScan('idle');
          return;
        }
        unsure = g;
      }
    }
    if (page) {
      setScan('looking');
      const g = await findDeadlineOnPage(page, new Date());
      if (leaving.current) return;
      if (g) {
        takeGuess(g, 'page');
        setScan('idle');
        return;
      }
    }
    const offer = unsure && !unsure.passed ? { date: unsure.date, snippet: unsure.snippet } : null;
    setMaybe(offer);
    setScan(offer ? 'idle' : 'none');
  };

  const pageUrl = finalUrl && /^https?:\/\//i.test(finalUrl) ? finalUrl : null;
  const site = domainOf(pageUrl) || 'the page';

  // Something new with no date in its text: read the flyer and check the page straight away.
  useEffect(() => {
    if (editing || initial.deadline) return;
    const page = cleanUrl(initial.url ?? '');
    const flyer = initial.imageUri ?? null;
    const pageOk = page && /^https?:\/\//i.test(page) ? page : null;
    if (flyer || pageOk) findDate({ flyer, page: pageOk });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      imageUri,
    };
    const doSave = () => {
      if (editingItem) {
        store.updateItem(editingItem.id, { title: draft.title, url: draft.url, notes: draft.notes, deadline: draft.deadline, imageUri });
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
    if (dirty) store.updateItem(editingItem.id, { title: title.trim() || editingItem.title, url: finalUrl, notes, deadline: deadline?.toISOString() ?? null, imageUri });
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

        {imageUri ? (
          <View style={s.flyer}>
            <Tap onPress={() => setViewing(true)} accessibilityRole="imagebutton" accessibilityLabel="Attached image. Opens full screen." testID="attached-image">
              <Image source={{ uri: imageUri }} style={s.flyerImage} resizeMode="cover" />
            </Tap>
            <View style={s.flyerBar}>
              <Icon name="image" size={15} color={c.muted} />
              <T v="caption" style={{ flex: 1, marginLeft: SPACE.sm }}>
                Shared image, kept with this item
              </T>
              <Tap onPress={() => setImageUri(null)} accessibilityRole="button" accessibilityLabel="Remove the image" hitSlop={10}>
                <T v="caption" style={{ color: c.danger, fontFamily: F.bold }}>
                  Remove
                </T>
              </Tap>
            </View>
          </View>
        ) : null}

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
                  : guessFrom === 'page'
                    ? `Found on ${site}: “${guessNote}”. Check it’s right.`
                    : guessFrom === 'flyer'
                      ? `Read from the flyer: “${guessNote}”. Check it’s right.`
                    : `Spotted in the text: “${guessNote}”. Check it’s right.`}
              </T>
            </View>
          ) : null}

          {!deadline && (pageUrl || imageUri) ? (
            <View style={s.guess}>
              <Icon name={scan === 'none' ? 'help-circle' : maybe ? 'image' : 'search'} size={15} color={c.accent} style={{ marginTop: 2 }} />
              <View style={{ flex: 1, marginLeft: SPACE.sm }}>
                <T v="small" style={{ color: c.inkSoft }}>
                  {scan === 'reading'
                    ? 'Reading the flyer…'
                    : scan === 'looking'
                      ? `Looking for a deadline on ${site}…`
                      : maybe
                        ? `The flyer mentions “${maybe.snippet}”, but not as the deadline. Use it if that’s right.`
                        : scan === 'none'
                          ? imageUri && pageUrl
                            ? `No deadline found on the flyer or on ${site}. Open the link or look at the flyer, then pick the date.`
                            : imageUri
                              ? 'No deadline found on the flyer. Look at it closely or check the application page, then pick the date.'
                              : `No deadline found on ${site}. Open the link and check, then pick the date.`
                          : imageUri && pageUrl
                            ? 'The date might be on the flyer or the application page.'
                            : imageUri
                              ? 'The date might be on the flyer.'
                              : 'The date might be on the application page.'}
                </T>
                {scan !== 'reading' && scan !== 'looking' ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: SPACE.lg, rowGap: SPACE.sm, marginTop: SPACE.sm }}>
                    {maybe ? <Action label="Use this date" onPress={() => takeGuess(maybe, 'flyer')} /> : null}
                    {!maybe && scan === 'idle' && imageUri ? <Action label="Read the flyer" onPress={() => findDate({ flyer: imageUri })} /> : null}
                    {!maybe && scan === 'idle' && pageUrl ? <Action label="Look on the page" onPress={() => findDate({ page: pageUrl })} /> : null}
                    {scan === 'none' && pageUrl ? <Action label="Open the link" onPress={() => Linking.openURL(pageUrl).catch(() => undefined)} /> : null}
                    {scan === 'none' && imageUri ? <Action label="View the flyer" onPress={() => setViewing(true)} /> : null}
                  </View>
                ) : null}
              </View>
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

      {imageUri ? (
        <Modal visible={viewing} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setViewing(false)}>
          <Pressable style={s.viewer} onPress={() => setViewing(false)} accessibilityLabel="Close image">
            <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
          </Pressable>
        </Modal>
      ) : null}
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
  flyer: { borderRadius: RADIUS.xl, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, overflow: 'hidden', marginBottom: SPACE.lg },
  flyerImage: { width: '100%', aspectRatio: 4 / 3, backgroundColor: c.sunken },
  flyerBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' },
}));

/** A small text button for the hint box under the date. */
function Action({ label, onPress }: { label: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Tap onPress={onPress} accessibilityRole="button" hitSlop={10}>
      <T v="caption" style={{ color: c.accent, fontFamily: F.bold }}>
        {label}
      </T>
    </Tap>
  );
}
