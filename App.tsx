import React, { useEffect, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { DarkTheme, DefaultTheme, NavigationContainer, StackActions, type Theme as NavTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { File } from 'expo-file-system';
import { useFonts } from 'expo-font';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { Fraunces_600SemiBold, Fraunces_600SemiBold_Italic } from '@expo-google-fonts/fraunces';
import { Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold } from '@expo-google-fonts/manrope';
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
import { ToastProvider } from './src/toast';

const Stack = createNativeStackNavigator<RootStack>();

/** Side effects that need the store and navigation: first-run setup, shares, notification taps. */
function Effects({ navReady }: { navReady: boolean }) {
  const { store, checkHealth, now } = useApp();
  const { replan } = store;
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const ready = useRef(false);

  // First launch: channel, permission, and an initial plan of every reminder.
  useEffect(() => {
    if (!store.loaded || ready.current) return;
    ready.current = true;
    (async () => {
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
      let text = shareIntent.text ?? '';

      if (file && (file.mimeType?.startsWith('text/') || /\.txt$/i.test(file.fileName ?? file.path ?? ''))) {
        try {
          text = await new File(file.path).text();
        } catch {
          text = '';
        }
      }

      if (text.includes('\n') && parseWhatsAppExport(text).length > 0) {
        navRef.dispatch(StackActions.push('import', { raw: text }));
        return;
      }

      if (!text.trim() && !shareIntent.webUrl) {
        Alert.alert('Nothing to save', 'That share had no text or link in it.');
        return;
      }

      const draft = draftFromShared(text || shareIntent.webUrl || '', {
        metaTitle: shareIntent.meta?.title,
        webUrl: shareIntent.webUrl,
        source: 'share',
        now: new Date(),
      });
      const dup = draft.url ? store.items.find((i) => i.url && normalizeUrl(i.url) === normalizeUrl(draft.url!)) : undefined;
      navRef.dispatch(StackActions.push('form', dup ? { id: dup.id, notice: 'You already saved this link.' } : { draft }));
    })()
      .catch(() => undefined)
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
    if (typeof id === 'string' && store.items.some((i) => i.id === id)) navRef.dispatch(StackActions.push('form', { id }));
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
        <ShareIntentProvider>
          <AppProvider>
            <ToastProvider>{fontsLoaded || fontError ? <Navigator /> : <View style={{ flex: 1, backgroundColor: t.c.bg }} />}</ToastProvider>
          </AppProvider>
        </ShareIntentProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
