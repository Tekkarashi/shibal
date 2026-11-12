import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';

export interface PickOptions {
  mode: 'date' | 'time';
  value: Date;
  minimumDate?: Date;
  /** Called with the picked date (for 'time', only the hours and minutes matter). */
  onPick: (d: Date) => void;
}

/** Opens Android's own date or time dialog. */
export function pickDateTime({ mode, value, minimumDate, onPick }: PickOptions): void {
  DateTimePickerAndroid.open({
    value,
    mode,
    is24Hour: false,
    minimumDate: mode === 'date' ? minimumDate : undefined,
    onChange: (e, d) => {
      if (e.type === 'set' && d) onPick(d);
    },
  });
}
