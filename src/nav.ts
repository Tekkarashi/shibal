import { createNavigationContainerRef } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Draft } from './types';

export type RootStack = {
  home: undefined;
  form: { id?: string; draft?: Draft; notice?: string };
  settings: undefined;
  import: { raw: string };
};

export type ScreenProps<K extends keyof RootStack> = NativeStackScreenProps<RootStack, K>;

export const navRef = createNavigationContainerRef<RootStack>();
