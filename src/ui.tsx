import React, { useState } from 'react';
import { Pressable, Text, View, type PressableProps, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import Feather from '@expo/vector-icons/Feather';
import * as Haptics from 'expo-haptics';
import { F, makeStyles, PRESS_TRANSITION, RADIUS, SPACE, useTheme, type Palette } from './theme';

export type IconName = React.ComponentProps<typeof Feather>['name'];

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

type Variant = 'display' | 'title' | 'headline' | 'body' | 'bodyStrong' | 'small' | 'label' | 'caption';

export function T({
  v = 'body',
  color,
  style,
  ...rest
}: TextProps & { v?: Variant; color?: keyof Palette | (string & {}) }) {
  const s = useText();
  const { c } = useTheme();
  const tint = color ? ((c as unknown as Record<string, string>)[color] ?? color) : undefined;
  return <Text {...rest} style={[s[v], tint ? { color: tint } : null, style]} />;
}

const useText = makeStyles(({ c }) => ({
  display: { fontFamily: F.display, fontSize: 34, lineHeight: 40, letterSpacing: -0.6, color: c.ink },
  title: { fontFamily: F.display, fontSize: 24, lineHeight: 30, letterSpacing: -0.3, color: c.ink },
  headline: { fontFamily: F.bold, fontSize: 17, lineHeight: 23, color: c.ink },
  body: { fontFamily: F.medium, fontSize: 15, lineHeight: 22, color: c.inkSoft },
  bodyStrong: { fontFamily: F.bold, fontSize: 15, lineHeight: 22, color: c.ink },
  small: { fontFamily: F.medium, fontSize: 13, lineHeight: 18, color: c.muted },
  label: { fontFamily: F.heavy, fontSize: 11, lineHeight: 14, letterSpacing: 1.2, textTransform: 'uppercase', color: c.muted },
  caption: { fontFamily: F.semibold, fontSize: 12, lineHeight: 16, color: c.muted },
}));

/* ------------------------------------------------------------------ */
/* Press feedback                                                      */
/* ------------------------------------------------------------------ */

/** Every tappable thing: 3% scale on press-in, 120ms, no ripple. */
export function Tap({
  children,
  style,
  innerStyle,
  haptic,
  onPress,
  disabled,
  ...rest
}: PressableProps & {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  innerStyle?: StyleProp<ViewStyle>;
  haptic?: 'select' | 'light';
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      {...rest}
      disabled={disabled}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={(e) => {
        if (haptic === 'select') Haptics.selectionAsync().catch(() => undefined);
        if (haptic === 'light') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        onPress?.(e);
      }}
      pressRetentionOffset={16}
      style={style}
    >
      <Animated.View style={[PRESS_TRANSITION, { transform: [{ scale: pressed && !disabled ? 0.97 : 1 }] }, innerStyle]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

type Kind = 'primary' | 'secondary' | 'ghost' | 'danger' | 'hero';

export function Button({
  label,
  onPress,
  kind = 'secondary',
  icon,
  small,
  disabled,
  style,
  full,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  kind?: Kind;
  icon?: IconName;
  small?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  full?: boolean;
  accessibilityLabel?: string;
}) {
  const { c } = useTheme();
  const s = useButton();
  const palette: Record<Kind, { bg: string; fg: string; border: string }> = {
    primary: { bg: c.accent, fg: c.onAccent, border: c.accent },
    secondary: { bg: c.surface, fg: c.ink, border: c.line },
    ghost: { bg: 'transparent', fg: c.ink, border: 'transparent' },
    danger: { bg: c.dangerSoft, fg: c.danger, border: c.dangerSoft },
    hero: { bg: c.hero, fg: c.onHero, border: c.hero },
  };
  const p = palette[kind];
  return (
    <Tap
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={small ? 8 : 0}
      style={[full && { alignSelf: 'stretch' }, style]}
      innerStyle={[
        s.btn,
        small && s.small,
        { backgroundColor: p.bg, borderColor: p.border, opacity: disabled ? 0.4 : 1 },
      ]}
    >
      {icon ? <Feather name={icon} size={small ? 15 : 18} color={p.fg} style={{ marginRight: label ? (small ? 6 : 8) : 0 }} /> : null}
      {label ? <Text style={[s.text, small && s.textSmall, { color: p.fg }]}>{label}</Text> : null}
    </Tap>
  );
}

const useButton = makeStyles(() => ({
  btn: {
    minHeight: 52,
    paddingHorizontal: SPACE.xl,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  small: { minHeight: 38, paddingHorizontal: 14, borderRadius: RADIUS.sm + 2 },
  text: { fontFamily: F.bold, fontSize: 16 },
  textSmall: { fontSize: 14 },
}));

export function IconButton({
  icon,
  onPress,
  label,
  tone = 'plain',
  size = 44,
}: {
  icon: IconName;
  onPress: () => void;
  label: string;
  tone?: 'plain' | 'filled' | 'accent';
  size?: number;
}) {
  const { c } = useTheme();
  const bg = tone === 'filled' ? c.surface : tone === 'accent' ? c.accentSoft : 'transparent';
  const fg = tone === 'accent' ? c.accent : c.ink;
  return (
    <Tap
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      innerStyle={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        borderWidth: tone === 'filled' ? 1 : 0,
        borderColor: c.line,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Feather name={icon} size={Math.round(size * 0.45)} color={fg} />
    </Tap>
  );
}

/* ------------------------------------------------------------------ */
/* Chips, pills, cards                                                 */
/* ------------------------------------------------------------------ */

export function Chip({ label, onPress, active, icon }: { label: string; onPress: () => void; active?: boolean; icon?: IconName }) {
  const { c } = useTheme();
  const s = useChip();
  return (
    <Tap
      onPress={onPress}
      haptic="select"
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      innerStyle={[s.chip, active && { backgroundColor: c.ink, borderColor: c.ink }]}
    >
      {icon ? <Feather name={icon} size={14} color={active ? c.bg : c.inkSoft} style={{ marginRight: 6 }} /> : null}
      <Text style={[s.text, active && { color: c.bg }]}>{label}</Text>
    </Tap>
  );
}

const useChip = makeStyles(({ c }) => ({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 38,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.surface,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 14,
    marginRight: SPACE.sm,
  },
  text: { fontFamily: F.bold, fontSize: 13, color: c.ink },
}));

export function Pill({ label, tone = 'neutral', icon }: { label: string; tone?: 'neutral' | 'accent' | 'danger' | 'ok' | 'solid'; icon?: IconName }) {
  const { c } = useTheme();
  const map = {
    neutral: { bg: c.sunken, fg: c.inkSoft },
    accent: { bg: c.accentSoft, fg: c.accent },
    danger: { bg: c.dangerSoft, fg: c.danger },
    ok: { bg: c.okSoft, fg: c.ok },
    solid: { bg: c.ink, fg: c.bg },
  }[tone];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: map.bg, borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' }}>
      {icon ? <Feather name={icon} size={12} color={map.fg} style={{ marginRight: 5 }} /> : null}
      <Text style={{ fontFamily: F.bold, fontSize: 12, color: map.fg }}>{label}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <View style={[{ backgroundColor: c.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: c.line }, style]}>{children}</View>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const { c } = useTheme();
  return <View style={{ height: 1, backgroundColor: c.line, marginLeft: inset }} />;
}

export function Icon({ name, size = 18, color, style }: { name: IconName; size?: number; color?: string; style?: StyleProp<TextStyle> }) {
  const { c } = useTheme();
  return <Feather name={name} size={size} color={color ?? c.ink} style={style} />;
}

/* ------------------------------------------------------------------ */
/* Top bar                                                             */
/* ------------------------------------------------------------------ */

export function TopBar({
  title,
  onBack,
  backIcon = 'arrow-left',
  right,
}: {
  title?: string;
  onBack?: () => void;
  backIcon?: IconName;
  right?: React.ReactNode;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACE.md, paddingTop: SPACE.xs, paddingBottom: SPACE.sm, minHeight: 56 }}>
      {onBack ? <IconButton icon={backIcon} label="Back" onPress={onBack} /> : <View style={{ width: 44 }} />}
      <T v="headline" numberOfLines={1} style={{ flex: 1, textAlign: 'center', marginHorizontal: SPACE.sm }}>
        {title ?? ''}
      </T>
      <View style={{ minWidth: 44, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}

/** A small uppercase heading above a group. */
export function SectionLabel({ children, right, color }: { children: React.ReactNode; right?: React.ReactNode; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: SPACE.xxl, marginBottom: SPACE.sm + 2 }}>
      <T v="label" style={[{ flex: 1 }, color ? { color } : null]}>
        {children}
      </T>
      {right}
    </View>
  );
}
