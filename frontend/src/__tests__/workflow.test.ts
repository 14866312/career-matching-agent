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
      targetJobId: '', student: { ...empty, confirmed: true }, match: 'current', report: 'not_generated'
    });
    expect(state).toMatchObject({ target: 'optional', profile: 'ready', match: 'current', next: 'advice' });
  });

  it('distinguishes an empty profile from one needing confirmation', () => {
    expect(deriveWorkflowState({ targetJobId: '', student: empty, match: 'not_run', report: 'not_generated' }).profile).toBe('empty');
    expect(deriveWorkflowState({ targetJobId: '', student: { ...empty, major: '计算机' }, match: 'not_run', report: 'not_generated' }).profile).toBe('needs_confirmation');
  });

  it('blocks matches until confirmation and marks stale matches as the next action', () => {
    const unconfirmed = deriveWorkflowState({ targetJobId: 'dev', student: { ...empty, major: '计算机' }, match: 'current', report: 'current' });
    expect(unconfirmed).toMatchObject({ match: 'blocked', report: 'blocked', next: 'profile' });
    const stale = deriveWorkflowState({ targetJobId: 'dev', student: { ...empty, confirmed: true }, match: 'stale', report: 'stale' });
    expect(stale).toMatchObject({ match: 'stale', report: 'stale', next: 'matches' });
  });

  it('keeps stale match and report states visible while the profile needs reconfirmation', () => {
    const state = deriveWorkflowState({
      targetJobId: 'dev', student: { ...empty, major: '计算机' }, match: 'stale', report: 'stale'
    });
    expect(state).toMatchObject({ profile: 'needs_confirmation', match: 'stale', report: 'stale', next: 'profile' });
  });
});
