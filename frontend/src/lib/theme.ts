/**
 * Appearance preference: the dark workspace, or the light "eye-care" theme.
 *
 * The dark palette is the design's original look; the light theme is produced by
 * luminance-inverting it (see styles/theme-light.css). The choice is stored per
 * browser, and the value is written to <html data-theme> so the stylesheet can
 * scope every override without touching the dark rules.
 *
 * Storage is injected rather than reached for directly, matching lib/onboarding.ts,
 * so the read/write rules stay unit-testable.
 */
export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'career-appearance';

/** The light theme is the default so the app opens bright rather than all-black. */
export const DEFAULT_THEME: Theme = 'light';

export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light';
}

export function getThemeStorage(): ThemeStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Read the stored preference, falling back to the default when absent or unreadable. */
export function readTheme(storage: ThemeStorage | null): Theme {
  if (!storage) return DEFAULT_THEME;
  try {
    const raw = storage.getItem(THEME_STORAGE_KEY);
    return isTheme(raw) ? raw : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Persist the preference. Storage failures (private mode, quota) are not fatal. */
export function writeTheme(storage: ThemeStorage | null, theme: Theme): void {
  if (!storage) return;
  try {
    storage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* the theme still applies for this session */
  }
}

/** Reflect the theme on <html> so CSS can key off it. */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
}
