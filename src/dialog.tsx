import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { RADIUS, SPACE, useTheme } from './theme';
import { Button, Icon, Rise, T, type IconName } from './ui';

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** Label of the main button. Leave out `cancel` for a one-button notice. */
  confirm: string;
  cancel?: string;
  tone?: 'default' | 'danger';
  icon?: IconName;
}

type Ask = (o: ConfirmOptions) => Promise<boolean>;

const DialogContext = createContext<Ask>(async () => false);

/** `await confirm({...})` resolves true when the main button is pressed. */
export const useConfirm = () => useContext(DialogContext);


/**
 * In-app confirm dialogs. They look the same on every phone and in the browser
 * preview, follow the theme, and close with Android's back button.
 */
export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const ask = useCallback<Ask>((o) => {
    resolver.current?.(false);
    if (o.tone === 'danger') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
    setCurrent(o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = useCallback((answer: boolean) => {
    resolver.current?.(answer);
    resolver.current = null;
    setCurrent(null);
  }, []);

  const value = useMemo(() => ask, [ask]);

  return (
    <DialogContext.Provider value={value}>
      {children}
      <Modal visible={!!current} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={() => close(false)}>
        {current ? <DialogCard o={current} onClose={close} /> : null}
      </Modal>
    </DialogContext.Provider>
  );
}

function DialogCard({ o, onClose }: { o: ConfirmOptions; onClose: (answer: boolean) => void }) {
  const { c } = useTheme();
  const danger = o.tone === 'danger';
  return (
    <View style={styles.fill}>
      {/* The Modal fades in natively; the card only rises, so it can never be left invisible. */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => onClose(false)} accessibilityLabel="Close dialog" />
      </View>
      <Rise
        distance={12}
        accessibilityViewIsModal
        accessibilityRole="alert"
        style={[styles.card, { backgroundColor: c.raised, borderColor: c.line }]}
      >
        {o.icon ? (
          <View style={[styles.icon, { backgroundColor: danger ? c.dangerSoft : c.accentSoft }]}>
            <Icon name={o.icon} size={20} color={danger ? c.danger : c.accent} />
          </View>
        ) : null}
        <T v="title" style={{ fontSize: 22, lineHeight: 28 }}>
          {o.title}
        </T>
        {o.message ? (
          <T v="body" color="muted" style={{ marginTop: SPACE.sm }}>
            {o.message}
          </T>
        ) : null}
        <View style={styles.actions}>
          {o.cancel ? <Button label={o.cancel} testID="dialog-cancel" onPress={() => onClose(false)} style={{ flex: 1 }} /> : null}
          <Button kind={danger ? 'danger' : 'primary'} label={o.confirm} testID="dialog-confirm" onPress={() => onClose(true)} style={{ flex: 1 }} />
        </View>
      </Rise>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACE.xl },
  card: {
    width: '100%',
    maxWidth: 400,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    padding: SPACE.xl + 2,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: SPACE.md },
  actions: { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.xl },
});
