import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { DarkTheme, DefaultTheme, NavigationContainer, StackActions, type Theme as NavTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { File } from 'expo-file-system';
import { useFonts } from 'expo-font';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { Fraunces_600SemiBold, Fraunces_600SemiBold_Italic } from '@expo-google-fonts/fraunces';
import { Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold } from '@expo-google-fonts/manrope';
import { cleanupAttachments, keepSharedImage } from './src/attachments';
import { AppProvider, useApp } from './src/context';
import { draftFromShared, normalizeUrl, parseWhatsAppExport } from './src/logic';
import { navRef, type RootStack } from './src/nav';
import { askNotificationPermission, setupNotifications } from './src/notifications';
import Home from './src/screens/Home';
import Import from './src/screens/Import';
import ItemForm from './src/screens/ItemForm';
import Settings from './src/screens/Settings';
import { useTheme } from './src/theme';
import { useNotificationTap } from './src/useNotificationTap';
import { chatTextFromZip, looksLikeZip } from './src/zip';
import './src/webPreview';

// Keep the branded splash up until fonts and saved items are ready, then fade it out.
SplashScreen.preventAutoHideAsync().catch(() => undefined);
SplashScreen.setOptions({ fade: true, duration: 220 });
import { DialogProvider } from './src/dialog';
import { ToastProvider, useToast } from './src/toast';

const Stack = createNativeStackNavigator<RootStack>();

/**
 * Opens a screen for something that came from outside the app (a share, a reminder tap).
 * It sits on top of home, so saving or going back lands where the item is, not on whatever
 * screen happened to be open. A form being edited is kept underneath instead of discarded.
 */
function openFromOutside<K extends 'form' | 'import'>(name: K, params: RootStack[K]) {
  if (!navRef.isReady()) return;
  if (navRef.getCurrentRoute()?.name === 'form') {
    navRef.dispatch(StackActions.push(name, params));
  } else {
    navRef.reset({ index: 1, routes: [{ name: 'home' }, { name, params }] });
  }
}

/** Side effects that need the store and navigation: first-run setup, shares, notification taps. */
function Effects({ navReady }: { navReady: boolean }) {
  const { store, checkHealth, now } = useApp();
  const { replan } = store;
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const toast = useToast();
  const ready = useRef(false);

  // First launch: channel, permission, and an initial plan of every reminder.
  useEffect(() => {
    if (!store.loaded || ready.current) return;
    ready.current = true;
    (async () => {
      cleanupAttachments(store.items.map((i) => i.imageUri));
      await setupNotifications();
      await askNotificationPermission();
      await checkHealth();
      replan();
    })().catch(() => undefined);
  }, [store.loaded, replan, checkHealth]);

  // Re-plan whenever the app comes back to the front (the clock ticks then).
  const lastPlan = useRef(0);
  useEffect(() => {
    if (!ready.current || now.getTime() - lastPlan.current < 5 * 60_000) return;
    lastPlan.current = now.getTime();
    checkHealth();
    replan();
  }, [now, replan, checkHealth]);

  // Something was shared into the app from another app.
  useEffect(() => {
    if (!hasShareIntent || !store.loaded || !navReady) return;
    (async () => {
      const file = shareIntent.files?.[0];
      const name = file?.fileName ?? file?.path ?? '';
      const mime = file?.mimeType ?? '';
      let text = shareIntent.text ?? '';
      let imageUri: string | null = null;

      if (file && (/zip/i.test(mime) || /\.zip$/i.test(name))) {
        // WhatsApp "Export chat" on newer versions: a zip with _chat.txt inside.
        let raw: string | null = null;
        try {
          const bytes = await new File(file.path).bytes();
          raw = looksLikeZip(bytes) ? chatTextFromZip(bytes) : null;
        } catch {
          raw = null;
        }
        if (raw && parseWhatsAppExport(raw).length > 0) openFromOutside('import', { raw });
        else toast({ message: 'No WhatsApp chat with links in that zip', icon: 'alert-circle' });
        return;
      }

      if (file && (mime.startsWith('text/') || /\.txt$/i.test(name))) {
        try {
          text = await new File(file.path).text();
        } catch {
          text = '';
        }
      } else if (file && (mime.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(name))) {
        // A flyer or screenshot. Keep a copy with the item; any caption that came with it is the text.
        imageUri = await keepSharedImage(file.path, mime, file.fileName);
        if (!imageUri) {
          toast({ message: 'Could not read that image', icon: 'alert-circle' });
          return;
        }
      }

      if (text.includes('\n') && parseWhatsAppExport(text).length > 0) {
        openFromOutside('import', { raw: text });
        return;
      }

      if (!text.trim() && !shareIntent.webUrl && !imageUri) {
        toast({ message: 'That share had no text or link to save', icon: 'alert-circle' });
        return;
      }

      const draft = draftFromShared(text || shareIntent.webUrl || '', {
        metaTitle: shareIntent.meta?.title,
        webUrl: shareIntent.webUrl,
        source: 'share',
        now: new Date(),
      });
      if (imageUri) {
        draft.imageUri = imageUri;
        // With no caption there is nothing to read a title from; leave it for the user to type.
        if (!text.trim() && !shareIntent.webUrl) draft.title = '';
      }
      const dup = draft.url ? store.items.find((i) => i.url && normalizeUrl(i.url) === normalizeUrl(draft.url!)) : undefined;
      openFromOutside('form', dup ? { id: dup.id, notice: 'You already saved this link.' } : { draft });
    })()
      .catch((e) => console.warn('[share] could not handle the share', String(e)))
      .finally(() => resetShareIntent());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasShareIntent, store.loaded, navReady]);

  // Tapping a reminder opens that item.
  const response = useNotificationTap();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!response || !store.loaded || !navReady) return;
    const stamp = `${response.notification.request.identifier}:${response.notification.date}`;
    if (handled.current === stamp) return;
    handled.current = stamp;
    const id = response.notification.request.content.data?.itemId;
    if (typeof id === 'string' && store.items.some((i) => i.id === id)) openFromOutside('form', { id });
  }, [response, store.loaded, store.items, navReady]);

  return null;
}

function Navigator() {
  const { store } = useApp();
  const t = useTheme();
  const [navReady, setNavReady] = useState(false);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(t.c.bg).catch(() => undefined);
  }, [t]);

  const base = t.dark ? DarkTheme : DefaultTheme;
  const navTheme: NavTheme = {
    ...base,
    colors: { ...base.colors, background: t.c.bg, card: t.c.bg, text: t.c.ink, border: t.c.line, primary: t.c.accent },
  };

  useEffect(() => {
    if (store.loaded) SplashScreen.hideAsync().catch(() => undefined);
  }, [store.loaded]);

  if (!store.loaded) return <View style={{ flex: 1, backgroundColor: t.c.bg }} />;

  return (
    <NavigationContainer ref={navRef} theme={navTheme} onReady={() => setNavReady(true)}>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      <Effects navReady={navReady} />
      <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.c.bg } }}>
        <Stack.Screen name="home" component={Home} />
        <Stack.Screen name="form" component={ItemForm} />
        <Stack.Screen name="settings" component={Settings} />
        <Stack.Screen name="import" component={Import} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  const t = useTheme();
  const [fontsLoaded, fontError] = useFonts({
    Fraunces_600SemiBold,
    Fraunces_600SemiBold_Italic,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
  });

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: t.c.bg }}>
      <SafeAreaProvider>
        <KeyboardProvider>
        <ShareIntentProvider>
          <AppProvider>
            <ToastProvider>
              <DialogProvider>{fontsLoaded || fontError ? <Navigator /> : <View style={{ flex: 1, backgroundColor: t.c.bg }} />}</DialogProvider>
            </ToastProvider>
          </AppProvider>
        </ShareIntentProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
