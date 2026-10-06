// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME, THEME_STORAGE_KEY, applyTheme, isTheme, readTheme, writeTheme,
  type ThemeStorage
} from '../lib/theme';

class MemoryStorage implements ThemeStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

class BrokenStorage implements ThemeStorage {
  getItem(_key: string): string | null { throw new Error('blocked'); }
  setItem(_key: string, _value: string): void { throw new Error('quota'); }
}

describe('appearance preference storage', () => {
  it('round-trips the chosen theme', () => {
    const storage = new MemoryStorage();
    writeTheme(storage, 'dark');
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(readTheme(storage)).toBe('dark');

    writeTheme(storage, 'light');
    expect(readTheme(storage)).toBe('light');
  });

  it('defaults to the light eye-care theme so the app never opens all-black', () => {
    expect(DEFAULT_THEME).toBe('light');
    expect(readTheme(new MemoryStorage())).toBe(DEFAULT_THEME);
  });

  it('ignores a stored value that is not a known theme', () => {
    const storage = new MemoryStorage();
    storage.values.set(THEME_STORAGE_KEY, 'solarized');
    expect(readTheme(storage)).toBe(DEFAULT_THEME);
    storage.values.set(THEME_STORAGE_KEY, '');
    expect(readTheme(storage)).toBe(DEFAULT_THEME);
  });

  it('keeps working when browser storage is unavailable or fails', () => {
    expect(readTheme(null)).toBe(DEFAULT_THEME);
    expect(readTheme(new BrokenStorage())).toBe(DEFAULT_THEME);
    expect(() => writeTheme(null, 'dark')).not.toThrow();
    expect(() => writeTheme(new BrokenStorage(), 'dark')).not.toThrow();
  });

  it('recognises only the two supported themes', () => {
    expect(isTheme('dark')).toBe(true);
    expect(isTheme('light')).toBe(true);
    expect(isTheme('LIGHT')).toBe(false);
    expect(isTheme(null)).toBe(false);
    expect(isTheme(undefined)).toBe(false);
  });

  it('reflects the theme on the root element for the stylesheet to key off', () => {
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
