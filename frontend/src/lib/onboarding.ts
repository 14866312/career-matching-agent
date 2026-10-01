export type OnboardingOutcome = 'completed' | 'skipped';

export interface OnboardingState {
  version: 1;
  outcome: OnboardingOutcome;
  savedAt: string;
}

export interface OnboardingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type OnboardingReadResult =
  | { status: 'none' }
  | { status: 'stored'; state: OnboardingState }
  | { status: 'invalid'; reason: 'corrupt' | 'version' }
  | { status: 'unavailable' };

export const ONBOARDING_STORAGE_KEY = 'career-planner.onboarding';
const ONBOARDING_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOnboardingState(value: unknown): value is OnboardingState {
  return isRecord(value) && value.version === ONBOARDING_VERSION &&
    (value.outcome === 'completed' || value.outcome === 'skipped') &&
    typeof value.savedAt === 'string' && !Number.isNaN(Date.parse(value.savedAt));
}

export function readOnboardingState(storage: OnboardingStorage | null): OnboardingReadResult {
  if (!storage) return { status: 'unavailable' };
  let raw: string | null;
  try {
    raw = storage.getItem(ONBOARDING_STORAGE_KEY);
  } catch {
    return { status: 'unavailable' };
  }
  if (raw == null) return { status: 'none' };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed) && parsed.version !== ONBOARDING_VERSION) {
      return { status: 'invalid', reason: 'version' };
    }
    return isOnboardingState(parsed)
      ? { status: 'stored', state: parsed }
      : { status: 'invalid', reason: 'corrupt' };
  } catch {
    return { status: 'invalid', reason: 'corrupt' };
  }
}

export function writeOnboardingState(storage: OnboardingStorage | null, outcome: OnboardingOutcome, savedAt = new Date().toISOString()): boolean {
  if (!storage) return false;
  const state: OnboardingState = { version: ONBOARDING_VERSION, outcome, savedAt };
  try {
    storage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
