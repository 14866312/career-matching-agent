import { describe, expect, it } from 'vitest';
import {
  AUTOSAVE_STORAGE_KEY, DRAFT_STORAGE_KEY, clearLocalDraft, createLocalDraft,
  readAutosavePreference, readLocalDraft, writeAutosavePreference, writeLocalDraft,
  type DraftStorage
} from '../lib/localDraft';
import type { StudentProfile } from '../types';

const student: StudentProfile = {
  major: '计算机', skills: [{ tag_id: 'ts', label: 'TypeScript', level: 2, confirmed: true, evidence: '项目' }],
  certificates: [], qualities: [], experiences: '项目经历', intention: { target_job_id: 'frontend', city: '上海' },
  confirmed: true, advantages: ['a'], improvements: ['b']
};

class MemoryStorage implements DraftStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

class BrokenStorage implements DraftStorage {
  getItem(_key: string): string | null { throw new Error('blocked'); }
  setItem(_key: string, _value: string): void { throw new Error('quota'); }
  removeItem(_key: string): void { throw new Error('blocked'); }
}

describe('local draft storage', () => {
  it('round-trips the allowed draft fields and strips unrelated sensitive fields', () => {
    const storage = new MemoryStorage();
    const draft = createLocalDraft(student, 'paths', { jobId: 'frontend', edgeId: 'edge-1', savedAt: null }, '2026-09-23T00:00:00.000Z');
    expect(writeLocalDraft(storage, draft)).toBe(true);
    storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ ...draft, resumeName: '敏感姓名', report: { export_text: 'private' } }));
    const restored = readLocalDraft(storage);
    expect(restored.status).toBe('restored');
    if (restored.status !== 'restored') return;
    expect(restored.draft.tab).toBe('paths');
    expect(restored.draft.student).toEqual({ ...student, advantages: [], improvements: [] });
    expect(restored.draft.student.advantages).toEqual([]);
    expect(restored.draft.student.improvements).toEqual([]);
    expect(restored.draft.selectedPath).toEqual({ jobId: 'frontend', edgeId: 'edge-1', savedAt: null });
    expect(restored.draft).not.toHaveProperty('resumeName');
    expect(restored.draft).not.toHaveProperty('report');
  });

  it('reports corrupt and incompatible drafts separately', () => {
    const storage = new MemoryStorage();
    storage.setItem(DRAFT_STORAGE_KEY, '{');
    expect(readLocalDraft(storage)).toEqual({ status: 'invalid', reason: 'corrupt' });
    storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ version: 99 }));
    expect(readLocalDraft(storage)).toEqual({ status: 'invalid', reason: 'version' });
  });

  it('supports autosave preference, clearing, and storage failures', () => {
    const storage = new MemoryStorage();
    expect(readAutosavePreference(storage)).toMatchObject({ available: true, configured: false });
    expect(writeAutosavePreference(storage, false)).toBe(true);
    expect(storage.getItem(AUTOSAVE_STORAGE_KEY)).toBe('false');
    expect(readAutosavePreference(storage)).toMatchObject({ enabled: false, configured: true });
    writeLocalDraft(storage, createLocalDraft(student, 'profile', null));
    expect(clearLocalDraft(storage)).toBe(true);
    expect(readLocalDraft(storage)).toEqual({ status: 'none' });
    expect(readLocalDraft(null)).toEqual({ status: 'unavailable' });
    expect(readLocalDraft(new BrokenStorage())).toEqual({ status: 'unavailable' });
    expect(writeLocalDraft(new BrokenStorage(), createLocalDraft(student, 'jobs', null))).toBe(false);
    expect(writeAutosavePreference(new BrokenStorage(), true)).toBe(false);
    expect(clearLocalDraft(new BrokenStorage())).toBe(false);
    expect(readAutosavePreference(new BrokenStorage()).available).toBe(false);
  });
});
