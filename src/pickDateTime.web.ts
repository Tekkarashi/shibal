import type { PickOptions } from './pickDateTime';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Browser preview: uses the browser's own date or time picker through a
 * hidden input, so the same buttons work as on the phone.
 */
export function pickDateTime({ mode, value, minimumDate, onPick }: PickOptions): void {
  const input = document.createElement('input');
  input.type = mode;
  input.value = mode === 'date' ? ymd(value) : `${pad(value.getHours())}:${pad(value.getMinutes())}`;
  if (mode === 'date' && minimumDate) input.min = ymd(minimumDate);
  Object.assign(input.style, { position: 'fixed', left: '50%', bottom: '40%', width: '1px', height: '1px', opacity: '0', border: '0' });
  document.body.appendChild(input);

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    setTimeout(() => input.remove(), 0);
  };
  input.addEventListener('change', () => {
    if (!input.value) return cleanup();
    if (mode === 'date') {
      const [y, m, d] = input.value.split('-').map(Number);
      onPick(new Date(y, m - 1, d, value.getHours(), value.getMinutes()));
    } else {
      const [h, min] = input.value.split(':').map(Number);
      onPick(new Date(value.getFullYear(), value.getMonth(), value.getDate(), h, min));
    }
    cleanup();
  });
  input.addEventListener('blur', () => setTimeout(cleanup, 300));

  try {
    input.showPicker();
  } catch {
    input.focus();
    input.click();
  }
}
