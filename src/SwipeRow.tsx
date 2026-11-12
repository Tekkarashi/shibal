import React, { createContext, useContext, useMemo, useRef } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  ReduceMotion,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import Feather from '@expo/vector-icons/Feather';
import * as Haptics from 'expo-haptics';
import { EASE_OUT, F, RADIUS } from './theme';
import type { IconName } from './ui';

export interface SwipeAction {
  label: string;
  icon: IconName;
  bg: string;
  fg: string;
}

const THRESHOLD = 92;

/**
 * True while a card is being swiped and for a moment after, so the tap that
 * ends a drag does not also open the card.
 */
const SwipeGuard = createContext<() => boolean>(() => false);
export const useSwipeGuard = () => useContext(SwipeGuard);

/**
 * Screen readers cannot swipe, so the card offers the same actions through
 * the accessibility actions menu. Spread these onto the card's pressable.
 */
type A11yActions = {
  accessibilityActions?: { name: string; label: string }[];
  onAccessibilityAction?: (e: { nativeEvent: { actionName: string } }) => void;
};
const SwipeA11y = createContext<A11yActions>({});
export const useSwipeA11y = () => useContext(SwipeA11y);

/** Where a flick would come to rest if it kept decelerating (Apple's decay form). */
function project(velocity: number, rate = 0.998) {
  'worklet';
  return ((velocity / 1000) * rate) / (1 - rate);
}

/** The further past the edge, the less the card follows. */
function rubberband(overshoot: number, dimension: number, constant = 0.55) {
  'worklet';
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

function tick() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

/**
 * Swipe a card right or left to commit an action. A flick is enough: the
 * release velocity is projected, so a short fast swipe commits and a slow
 * long one that comes back does not.
 */
export function SwipeRow({
  children,
  left,
  right,
  onCommit,
}: {
  children: React.ReactNode;
  /** Revealed when swiping right. */
  left?: SwipeAction;
  /** Revealed when swiping left. */
  right?: SwipeAction;
  onCommit: (side: 'left' | 'right') => void;
}) {
  const x = useSharedValue(0);
  const start = useSharedValue(0);
  const width = useSharedValue(360);
  const hasLeft = !!left;
  const hasRight = !!right;
  const dragging = useRef(false);
  const endedAt = useRef(0);
  const guard = useMemo(() => () => dragging.current || Date.now() - endedAt.current < 400, []);
  const a11y = useMemo<A11yActions>(
    () => ({
      accessibilityActions: [
        ...(left ? [{ name: 'left', label: left.label }] : []),
        ...(right ? [{ name: 'right', label: right.label }] : []),
      ],
      onAccessibilityAction: (e) => {
        const side = e.nativeEvent.actionName;
        if (side === 'left' || side === 'right') onCommit(side);
      },
    }),
    [left, right, onCommit],
  );
  const dragStart = () => {
    dragging.current = true;
  };
  const dragEnd = () => {
    dragging.current = false;
    endedAt.current = Date.now();
  };

  const commit = (side: 'left' | 'right') => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    onCommit(side);
  };

  const pan = usePanGesture({
    activeOffsetX: [-14, 14],
    failOffsetY: [-12, 12],
    onActivate: () => {
      'worklet';
      start.set(x.get());
      scheduleOnRN(dragStart);
    },
    onUpdate: (e) => {
      'worklet';
      let next = start.get() + e.translationX;
      if (next > 0 && !hasLeft) next = rubberband(next, width.get(), 0.15);
      if (next < 0 && !hasRight) next = rubberband(next, width.get(), 0.15);
      x.set(next);
    },
    onDeactivate: (e) => {
      'worklet';
      scheduleOnRN(dragEnd);
      const now = x.get();
      const projected = now + project(e.velocityX) * 0.35;
      const w = width.get();
      if (hasLeft && now > 32 && projected > THRESHOLD) {
        x.set(withTiming(w + 24, { duration: 200, easing: EASE_OUT, reduceMotion: ReduceMotion.System }, (done) => {
          if (done) scheduleOnRN(commit, 'left');
        }));
      } else if (hasRight && now < -32 && projected < -THRESHOLD) {
        x.set(withTiming(-w - 24, { duration: 200, easing: EASE_OUT, reduceMotion: ReduceMotion.System }, (done) => {
          if (done) scheduleOnRN(commit, 'right');
        }));
      } else {
        x.set(withSpring(0, { duration: 380, dampingRatio: 0.85, velocity: e.velocityX, reduceMotion: ReduceMotion.System }));
      }
    },
  });

  // One light tick when the card crosses the commit line, either way.
  useAnimatedReaction(
    () => (x.get() > THRESHOLD ? 1 : x.get() < -THRESHOLD ? -1 : 0),
    (cur, prev) => {
      if (prev !== null && cur !== prev && cur !== 0) scheduleOnRN(tick);
    },
  );

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  const leftStyle = useAnimatedStyle(() => ({
    opacity: interpolate(x.get(), [0, 24], [0, 1], Extrapolation.CLAMP),
  }));
  const rightStyle = useAnimatedStyle(() => ({
    opacity: interpolate(x.get(), [-24, 0], [1, 0], Extrapolation.CLAMP),
  }));
  const leftIcon = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(x.get(), [24, THRESHOLD, THRESHOLD + 30], [0.8, 1, 1.12], Extrapolation.CLAMP) }],
  }));
  const rightIcon = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(x.get(), [-THRESHOLD - 30, -THRESHOLD, -24], [1.12, 1, 0.8], Extrapolation.CLAMP) }],
  }));

  const onLayout = (e: LayoutChangeEvent) => width.set(e.nativeEvent.layout.width);

  return (
    <View onLayout={onLayout}>
      {left ? (
        <Animated.View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden aria-hidden style={[styles.under, { backgroundColor: left.bg, justifyContent: 'flex-start' }, leftStyle]}>
          <Animated.View style={[styles.action, leftIcon]}>
            <Feather name={left.icon} size={20} color={left.fg} />
            <Text style={[styles.label, { color: left.fg }]}>{left.label}</Text>
          </Animated.View>
        </Animated.View>
      ) : null}
      {right ? (
        <Animated.View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden aria-hidden style={[styles.under, { backgroundColor: right.bg, justifyContent: 'flex-end' }, rightStyle]}>
          <Animated.View style={[styles.action, rightIcon]}>
            <Text style={[styles.label, { color: right.fg }]}>{right.label}</Text>
            <Feather name={right.icon} size={20} color={right.fg} />
          </Animated.View>
        </Animated.View>
      ) : null}
      <GestureDetector gesture={pan}>
        <Animated.View style={cardStyle}>
          <SwipeGuard.Provider value={guard}>
            <SwipeA11y.Provider value={a11y}>{children}</SwipeA11y.Provider>
          </SwipeGuard.Provider>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  under: {
    ...StyleSheet.absoluteFill,
    borderRadius: RADIUS.lg,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
  },
  action: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontFamily: F.heavy, fontSize: 14 },
});
