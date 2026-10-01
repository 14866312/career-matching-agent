import { describe, expect, it } from 'vitest';
import { deriveWorkflowState } from '../lib/workflow';
import type { StudentProfile } from '../types';

const empty: StudentProfile = {
  major: '', skills: [], certificates: [], qualities: [], experiences: '',
  intention: { target_job_id: '', city: '' }, confirmed: false, advantages: [], improvements: []
};

describe('deriveWorkflowState', () => {
  it('allows a profile and recommendations without a target job', () => {
    const state = deriveWorkflowState({
      targetJobId: '', student: { ...empty, major: '计算机' }, match: 'current', report: 'not_generated'
    });
    expect(state).toMatchObject({ target: 'optional', profile: 'ready', match: 'current', next: 'advice' });
  });

  it('distinguishes an empty profile from one ready for matching', () => {
    expect(deriveWorkflowState({ targetJobId: '', student: empty, match: 'not_run', report: 'not_generated' }).profile).toBe('empty');
    expect(deriveWorkflowState({ targetJobId: '', student: { ...empty, major: '计算机' }, match: 'not_run', report: 'not_generated' }).profile).toBe('ready');
  });

  it('blocks an empty profile but allows matching without confirmation', () => {
    const blocked = deriveWorkflowState({ targetJobId: 'dev', student: empty, match: 'not_run', report: 'not_generated' });
    expect(blocked).toMatchObject({ match: 'blocked', report: 'blocked', next: 'profile' });
    const ready = deriveWorkflowState({ targetJobId: 'dev', student: { ...empty, major: '计算机' }, match: 'current', report: 'current' });
    expect(ready).toMatchObject({ profile: 'ready', match: 'current', report: 'current', next: 'advice' });
  });

  it('marks stale matching and advice for refresh after inputs change', () => {
    const stale = deriveWorkflowState({ targetJobId: 'dev', student: { ...empty, major: '计算机' }, match: 'stale', report: 'stale' });
    expect(stale).toMatchObject({ match: 'stale', report: 'stale', next: 'matches' });
  });

  it('keeps stale states visible while profile content remains editable', () => {
    const state = deriveWorkflowState({
      targetJobId: 'dev', student: { ...empty, major: '计算机' }, match: 'stale', report: 'stale'
    });
    expect(state).toMatchObject({ profile: 'ready', match: 'stale', report: 'stale', next: 'matches' });
  });
});
