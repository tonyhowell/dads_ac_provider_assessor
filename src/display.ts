// Display settings (UI-SPEC §5.6), remembered per device. Applied as classes/attributes on <html>.

export interface DisplaySettings {
  textSize: 18 | 20 | 22 | 24;
  theme: 'light' | 'dark' | 'system';
  highContrast: boolean;
  motion: 'system' | 'reduce' | 'full';
  hints: boolean;
}

export const DEFAULT_DISPLAY: DisplaySettings = { textSize: 18, theme: 'system', highContrast: false, motion: 'system', hints: true };
const KEY = 'sah-assessor:display';

export function loadDisplay(): DisplaySettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_DISPLAY, ...(JSON.parse(raw) as Partial<DisplaySettings>) };
    // Carry over the earlier light/dark toggle.
    const legacy = localStorage.getItem('sah-assessor:theme');
    if (legacy === 'light' || legacy === 'dark') return { ...DEFAULT_DISPLAY, theme: legacy };
  } catch {
    /* storage unavailable: defaults */
  }
  return DEFAULT_DISPLAY;
}

export function saveDisplay(s: DisplaySettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* not saved; still applied for this visit */
  }
}

const prefers = (q: string) => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches;

export function applyDisplay(s: DisplaySettings, root: HTMLElement = document.documentElement) {
  const dark = s.theme === 'dark' || (s.theme === 'system' && prefers('(prefers-color-scheme: dark)'));
  const hc = s.highContrast || prefers('(prefers-contrast: more)');
  root.classList.toggle('dark', dark && !hc);
  root.classList.toggle('hc', hc);
  if (s.textSize === 18) root.removeAttribute('data-text-size');
  else root.setAttribute('data-text-size', String(s.textSize));
  const reduce = s.motion === 'reduce' || (s.motion === 'system' && prefers('(prefers-reduced-motion: reduce)'));
  root.setAttribute('data-motion', reduce ? 'reduce' : 'full');
  root.setAttribute('data-hints', s.hints ? 'on' : 'off');
}
