import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import { EASE_OUT, F, RADIUS, SPACE, useTheme } from './theme';
import { Tap, type IconName } from './ui';

interface ToastInput {
  message: string;
  icon?: IconName;
  action?: { label: string; onPress: () => void };
}

interface ToastState extends ToastInput {
  key: number;
}

const ToastContext = createContext<(t: ToastInput) => void>(() => undefined);

export const useToast = () => useContext(ToastContext);

// Module scope: layout-animation builders are not rebuilt on every render.
const ENTER = FadeInDown.duration(260).easing(EASE_OUT);
const EXIT = FadeOutDown.duration(200).easing(EASE_OUT);

/** One toast at a time, above the home indicator, with an optional Undo. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counter = useRef(0);

  const show = useCallback((t: ToastInput) => {
    counter.current += 1;
    setToast({ ...t, key: counter.current });
  }, []);

  useEffect(() => {
    if (!toast) return;
    if (timer.current) clearTimeout(timer.current);
    // Undo stays up long enough to read and reach (Material suggests 4-10s for actions).
    timer.current = setTimeout(() => setToast(null), toast.action ? 8000 : 2800);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [toast]);

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? <ToastView key={toast.key} toast={toast} onClose={() => setToast(null)} /> : null}
    </ToastContext.Provider>
  );
}

function ToastView({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  return (
    <Animated.View
      entering={ENTER}
      exiting={EXIT}
      pointerEvents="box-none"
      style={{ position: 'absolute', left: SPACE.lg, right: SPACE.lg, bottom: insets.bottom + 96 }}
      accessibilityLiveRegion="polite"
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: c.hero,
          borderRadius: RADIUS.md + 2,
          paddingLeft: SPACE.lg,
          paddingRight: toast.action ? SPACE.xs : SPACE.lg,
          minHeight: 52,
          elevation: 8,
          shadowColor: '#000',
          shadowOpacity: 0.18,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
        }}
      >
        {toast.icon ? <Feather name={toast.icon} size={17} color={c.onHero} style={{ marginRight: 10 }} /> : null}
        <Text style={{ flex: 1, color: c.onHero, fontFamily: F.semibold, fontSize: 14 }} numberOfLines={2}>
          {toast.message}
        </Text>
        {toast.action ? (
          <Tap
            onPress={() => {
              toast.action!.onPress();
              onClose();
            }}
            accessibilityRole="button"
            innerStyle={{ paddingHorizontal: 14, paddingVertical: 12 }}
          >
            <Text style={{ color: c.accent, fontFamily: F.heavy, fontSize: 14 }}>{toast.action.label}</Text>
          </Tap>
        ) : null}
      </View>
    </Animated.View>
  );
}
