import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_STORAGE_KEY, readOnboardingState, writeOnboardingState,
  type OnboardingStorage
} from '../lib/onboarding';

class MemoryStorage implements OnboardingStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

class BrokenStorage implements OnboardingStorage {
  getItem(_key: string): string | null { throw new Error('blocked'); }
  setItem(_key: string, _value: string): void { throw new Error('quota'); }
}

describe('onboarding state storage', () => {
  it('round-trips a completed or skipped tutorial state', () => {
    const storage = new MemoryStorage();
    expect(writeOnboardingState(storage, 'completed', '2026-09-28T00:00:00.000Z')).toBe(true);
    expect(readOnboardingState(storage)).toEqual({
      status: 'stored',
      state: { version: 1, outcome: 'completed', savedAt: '2026-09-28T00:00:00.000Z' }
    });
    expect(storage.getItem(ONBOARDING_STORAGE_KEY)).toContain('completed');

    expect(writeOnboardingState(storage, 'skipped', '2026-09-29T00:00:00.000Z')).toBe(true);
    expect(readOnboardingState(storage)).toMatchObject({ status: 'stored', state: { outcome: 'skipped' } });
  });

  it('distinguishes no state, corrupt state, and incompatible versions', () => {
    const storage = new MemoryStorage();
    expect(readOnboardingState(storage)).toEqual({ status: 'none' });
    storage.values.set(ONBOARDING_STORAGE_KEY, '{');
    expect(readOnboardingState(storage)).toEqual({ status: 'invalid', reason: 'corrupt' });
    storage.values.set(ONBOARDING_STORAGE_KEY, JSON.stringify({ version: 99 }));
    expect(readOnboardingState(storage)).toEqual({ status: 'invalid', reason: 'version' });
  });

  it('keeps the tutorial usable when browser storage is unavailable or fails', () => {
    const broken = new BrokenStorage();
    expect(readOnboardingState(null)).toEqual({ status: 'unavailable' });
    expect(readOnboardingState(broken)).toEqual({ status: 'unavailable' });
    expect(writeOnboardingState(null, 'skipped')).toBe(false);
    expect(writeOnboardingState(broken, 'skipped')).toBe(false);
  });
});
