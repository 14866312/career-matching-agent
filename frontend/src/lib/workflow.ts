import type { StudentProfile } from '../types';

export type MatchFreshness = 'not_run' | 'current' | 'stale';
export type ReportFreshness = 'not_generated' | 'current' | 'stale';

export interface WorkflowInput {
  targetJobId: string;
  student: StudentProfile;
  match: MatchFreshness;
  report: ReportFreshness;
}

export interface WorkflowState {
  target: 'chosen' | 'optional';
  profile: 'empty' | 'needs_confirmation' | 'ready';
  match: 'blocked' | MatchFreshness;
  report: 'blocked' | 'waiting_for_match' | ReportFreshness;
  next: 'profile' | 'matches' | 'advice';
}

function hasProfileContent(student: StudentProfile): boolean {
  return Boolean(
    student.major.trim() || student.experiences.trim() || student.skills.length ||
    student.certificates.length || student.qualities.length || student.intention.city.trim()
  );
}

export function deriveWorkflowState(input: WorkflowInput): WorkflowState {
  const profile = input.student.confirmed
    ? 'ready'
    : hasProfileContent(input.student) ? 'needs_confirmation' : 'empty';
  const match = input.match === 'stale' ? 'stale' : profile === 'ready' ? input.match : 'blocked';
  const report = input.report === 'stale'
    ? 'stale'
    : profile !== 'ready' ? 'blocked'
    : match !== 'current' ? 'waiting_for_match' : input.report;
  const next = profile !== 'ready' ? 'profile' : match !== 'current' ? 'matches' : 'advice';

  return { target: input.targetJobId ? 'chosen' : 'optional', profile, match, report, next };
}
