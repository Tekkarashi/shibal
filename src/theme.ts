import { StyleSheet, useColorScheme, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';
import { cubicBezier, Easing } from 'react-native-reanimated';

/**
 * Shibal's look: the Tekkarashi brand colours (Qarar ink, Uns terracotta,
 * Safaa paper, Balagha brown) on warm paper, with a dark mode built from the
 * same family rather than inverted greys.
 */
export interface Palette {
  bg: string;
  surface: string;
  raised: string;
  sunken: string;
  ink: string;
  inkSoft: string;
  muted: string;
  faint: string;
  line: string;
  accent: string;
  accentPressed: string;
  accentSoft: string;
  onAccent: string;
  hero: string;
  onHero: string;
  onHeroSoft: string;
  danger: string;
  dangerSoft: string;
  ok: string;
  okSoft: string;
  warn: string;
  scrim: string;
}

const light: Palette = {
  bg: '#F5F0E8',
  surface: '#FBF8F2',
  raised: '#FFFFFF',
  sunken: '#ECE4D7',
  ink: '#141210',
  inkSoft: '#4A3F35',
  muted: '#8B6F4E',
  faint: '#B6A58F',
  line: '#E3DACB',
  accent: '#C07B58',
  accentPressed: '#A9684A',
  accentSoft: '#F3E1D3',
  onAccent: '#FFFFFF',
  hero: '#141210',
  onHero: '#F5F0E8',
  onHeroSoft: '#B9AC98',
  danger: '#A93226',
  dangerSoft: '#F5DCD6',
  ok: '#4F7A4A',
  okSoft: '#DCE8D6',
  warn: '#B7791F',
  scrim: 'rgba(20,18,16,0.45)',
};

const dark: Palette = {
  bg: '#12100E',
  surface: '#1C1916',
  raised: '#25211D',
  sunken: '#0C0B0A',
  ink: '#F5F0E8',
  inkSoft: '#D8CDBC',
  muted: '#A8957D',
  faint: '#6E604F',
  line: '#2F2924',
  accent: '#D48E69',
  accentPressed: '#C07B58',
  accentSoft: '#3A271D',
  onAccent: '#1A120D',
  hero: '#F5F0E8',
  onHero: '#141210',
  onHeroSoft: '#6E604F',
  danger: '#E2796A',
  dangerSoft: '#3B1F1A',
  ok: '#93BC8A',
  okSoft: '#1F2A1C',
  warn: '#E0A54B',
  scrim: 'rgba(0,0,0,0.6)',
};

export const F = {
  display: 'Fraunces_600SemiBold',
  displayItalic: 'Fraunces_600SemiBold_Italic',
  regular: 'Manrope_400Regular',
  medium: 'Manrope_500Medium',
  semibold: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
  heavy: 'Manrope_800ExtraBold',
};

export interface Theme {
  dark: boolean;
  c: Palette;
}

const LIGHT: Theme = { dark: false, c: light };
const DARK: Theme = { dark: true, c: dark };

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? DARK : LIGHT;
}

/** Theme-aware StyleSheet, built once per theme. */
type AnyStyle = ViewStyle | TextStyle | ImageStyle;
type Styles = Record<string, AnyStyle>;

export function makeStyles<S extends Styles>(fn: (t: Theme) => S & Styles): () => Readonly<S> {
  const cache = new Map<Theme, Readonly<S>>();
  return () => {
    const t = useTheme();
    let s = cache.get(t);
    if (!s) {
      s = StyleSheet.create(fn(t));
      cache.set(t, s);
    }
    return s;
  };
}

export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, gutter: 20 };
export const RADIUS = { sm: 10, md: 14, lg: 20, xl: 26, pill: 999 };

/** Motion tokens. Strong ease-out for UI; nothing on screen uses ease-in. */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
export const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);
export const PRESS_TRANSITION = {
  transitionProperty: 'transform' as const,
  transitionDuration: '120ms' as const,
  transitionTimingFunction: cubicBezier(0.23, 1, 0.32, 1),
};
