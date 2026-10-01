import type { Ability, Dimension, StudentProfile } from '../types';

export type FlowTabId = 'jobs' | 'profile' | 'matches' | 'paths';

export interface PathSelection {
  jobId: string;
  edgeId: string | null;
  savedAt: string | null;
  /** Target job when this focus was chosen; used to invalidate stale paths after a target change. */
  targetJobId?: string;
}

export interface LocalDraft {
  version: 1;
  savedAt: string;
  student: StudentProfile;
  tab: FlowTabId;
  selectedPath: PathSelection | null;
}

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type DraftReadResult =
  | { status: 'none' }
  | { status: 'restored'; draft: LocalDraft }
  | { status: 'invalid'; reason: 'corrupt' | 'version' }
  | { status: 'unavailable' };

export const DRAFT_STORAGE_KEY = 'career-planner.local-draft';
export const AUTOSAVE_STORAGE_KEY = 'career-planner.autosave';
const DRAFT_VERSION = 1;
const FLOW_TABS: FlowTabId[] = ['jobs', 'profile', 'matches', 'paths'];
const DIMENSIONS: Dimension[] = ['skills', 'certificates', 'qualities'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbility(value: unknown): value is Ability {
  return isRecord(value) && typeof value.tag_id === 'string' && typeof value.label === 'string' &&
    typeof value.level === 'number' && Number.isFinite(value.level) &&
    typeof value.confirmed === 'boolean' && typeof value.evidence === 'string' &&
    (value.source === undefined || value.source === 'resume' || value.source === 'manual');
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isStudentProfile(value: unknown): value is StudentProfile {
  if (!isRecord(value) || !isRecord(value.intention)) return false;
  return typeof value.major === 'string' && typeof value.experiences === 'string' &&
    (value.major_source === undefined || value.major_source === 'resume' || value.major_source === 'manual') &&
    (value.experiences_source === undefined || value.experiences_source === 'resume' || value.experiences_source === 'manual') &&
    typeof value.intention.target_job_id === 'string' && typeof value.intention.city === 'string' &&
    typeof value.confirmed === 'boolean' && isStringArray(value.advantages) &&
    isStringArray(value.improvements) && DIMENSIONS.every(key =>
      Array.isArray(value[key]) && (value[key] as unknown[]).every(isAbility)
    );
}

function isPathSelection(value: unknown): value is PathSelection {
  if (!isRecord(value)) return false;
  return typeof value.jobId === 'string' &&
    (typeof value.edgeId === 'string' || value.edgeId === null) &&
    (value.savedAt === null || (typeof value.savedAt === 'string' && !Number.isNaN(Date.parse(value.savedAt)))) &&
    (value.targetJobId === undefined || typeof value.targetJobId === 'string');
}

function isLocalDraft(value: unknown): value is LocalDraft {
  return isRecord(value) && value.version === DRAFT_VERSION &&
    typeof value.savedAt === 'string' && !Number.isNaN(Date.parse(value.savedAt)) &&
    FLOW_TABS.includes(value.tab as FlowTabId) && isStudentProfile(value.student) &&
    (value.selectedPath === null || isPathSelection(value.selectedPath));
}

export function sanitizeStudent(student: StudentProfile): StudentProfile {
  // Old drafts may contain level=0 entries created by the removed “不具备”
  // workflow. They are not evidence of a skill and must not reappear as tags.
  const copyAbilities = (items: Ability[]) => items.filter(item => item.level > 0).map(item => ({
    tag_id: item.tag_id,
    label: item.label,
    level: item.level,
    confirmed: item.confirmed,
    evidence: item.evidence,
    source: item.source
  }));
  return {
    major: student.major,
    major_source: student.major_source,
    skills: copyAbilities(student.skills),
    certificates: copyAbilities(student.certificates),
    qualities: copyAbilities(student.qualities),
    experiences: student.experiences,
    experiences_source: student.experiences_source,
    intention: { target_job_id: student.intention.target_job_id, city: student.intention.city },
    confirmed: student.confirmed,
    // These are generated analysis, not editable profile fields. Keep them out
    // of the browser draft so a refresh never restores stale AI conclusions.
    advantages: [],
    improvements: []
  };
}

export function getBrowserStorage(): DraftStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readLocalDraft(storage: DraftStorage | null): DraftReadResult {
  if (!storage) return { status: 'unavailable' };
  let raw: string | null;
  try {
    raw = storage.getItem(DRAFT_STORAGE_KEY);
  } catch {
    return { status: 'unavailable' };
  }
  if (raw == null) return { status: 'none' };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed) && parsed.version !== DRAFT_VERSION) return { status: 'invalid', reason: 'version' };
    return isLocalDraft(parsed)
      ? { status: 'restored', draft: createLocalDraft(parsed.student, parsed.tab, parsed.selectedPath, parsed.savedAt) }
      : { status: 'invalid', reason: 'corrupt' };
  } catch {
    return { status: 'invalid', reason: 'corrupt' };
  }
}

export function readAutosavePreference(storage: DraftStorage | null): { enabled: boolean; available: boolean; configured: boolean } {
  if (!storage) return { enabled: false, available: false, configured: false };
  try {
    const value = storage.getItem(AUTOSAVE_STORAGE_KEY);
    return { enabled: value === 'true', available: true, configured: value === 'true' || value === 'false' };
  } catch {
    return { enabled: false, available: false, configured: false };
  }
}

export function writeAutosavePreference(storage: DraftStorage | null, enabled: boolean): boolean {
  if (!storage) return false;
  try {
    storage.setItem(AUTOSAVE_STORAGE_KEY, String(enabled));
    return true;
  } catch {
    return false;
  }
}

export function createLocalDraft(
  student: StudentProfile,
  tab: FlowTabId,
  selectedPath: PathSelection | null,
  savedAt = new Date().toISOString()
): LocalDraft {
  return {
    version: DRAFT_VERSION,
    savedAt,
    student: sanitizeStudent(student),
    tab,
    selectedPath: selectedPath ? {
      jobId: selectedPath.jobId,
      edgeId: selectedPath.edgeId,
      savedAt: selectedPath.savedAt,
      ...(selectedPath.targetJobId ? { targetJobId: selectedPath.targetJobId } : {})
    } : null
  };
}

export function writeLocalDraft(storage: DraftStorage | null, draft: LocalDraft): boolean {
  if (!storage) return false;
  try {
    storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearLocalDraft(storage: DraftStorage | null): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(DRAFT_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
