import type { Ability, Dimension, StudentProfile } from '../types';
import type { ResumeResp } from '../types';

export type ResumeCandidate =
  | { id: string; kind: 'name'; value: string }
  | { id: string; kind: 'major'; value: string }
  | { id: string; kind: 'experiences'; value: string }
  | { id: string; kind: 'ability'; dimension: Dimension; value: Ability };

export type CandidateDecision = 'accept' | 'skip';

export function createResumeCandidates(result: ResumeResp): ResumeCandidate[] {
  const candidates: ResumeCandidate[] = [];
  if (result.name.trim()) candidates.push({ id: 'name', kind: 'name', value: result.name.trim() });
  if (result.profile.major.trim()) candidates.push({ id: 'major', kind: 'major', value: result.profile.major.trim() });
  if (result.profile.experiences.trim()) candidates.push({ id: 'experiences', kind: 'experiences', value: result.profile.experiences.trim() });
  const dimensions: Dimension[] = ['skills', 'certificates', 'qualities'];
  for (const dimension of dimensions) {
    const occurrences = new Map<string, number>();
    for (const ability of result.profile[dimension]) {
      const tagKey = ability.tag_id.toLowerCase();
      const occurrence = occurrences.get(tagKey) ?? 0;
      occurrences.set(tagKey, occurrence + 1);
      candidates.push({
        id: dimension + ':' + tagKey + ':' + occurrence,
        kind: 'ability',
        dimension,
        value: { ...ability, confirmed: false }
      });
    }
  }
  return candidates;
}

export interface ResumeMergeResult {
  student: StudentProfile;
  resumeName: string | null;
  notes: string[];
  appliedCount: number;
}

export function mergeAcceptedResumeCandidates(
  student: StudentProfile,
  currentName: string,
  candidates: ResumeCandidate[]
): ResumeMergeResult {
  let next = student;
  let resumeName: string | null = null;
  let appliedCount = 0;
  const notes: string[] = [];
  const acceptedProfileCandidates = candidates.filter(candidate => candidate.kind !== 'name');

  if (acceptedProfileCandidates.length) {
    const mutable: StudentProfile = { ...student };
    let profileChanged = false;
    for (const candidate of acceptedProfileCandidates) {
      if (candidate.kind === 'major' || candidate.kind === 'experiences') {
        const existing = mutable[candidate.kind];
        if (existing.trim()) {
          if (existing.trim() !== candidate.value.trim()) notes.push((candidate.kind === 'major' ? '专业' : '经历') + '（已保留已有内容）');
        } else {
          mutable[candidate.kind] = candidate.value;
          profileChanged = true;
          appliedCount += 1;
        }
        continue;
      }

      const list = mutable[candidate.dimension];
      const index = list.findIndex(item => item.tag_id.toLowerCase() === candidate.value.tag_id.toLowerCase());
      if (index < 0) {
        if (list.length < abilityLimit(candidate.dimension)) {
          mutable[candidate.dimension] = [...list, { ...candidate.value, confirmed: false }];
          profileChanged = true;
          appliedCount += 1;
        } else {
          notes.push(dimensionLabel(candidate.dimension) + '已达数量上限，未添加「' + candidate.value.label + '」');
        }
        continue;
      }

      const existing = list[index];
      const merged: Ability = {
        ...existing,
        label: existing.label.trim() ? existing.label : candidate.value.label,
        evidence: existing.evidence.trim() ? existing.evidence : candidate.value.evidence,
        // 熟练度、确认状态和其他已有非空值都以档案为准。
        level: existing.level,
        confirmed: existing.confirmed
      };
      if (merged.label !== existing.label || merged.evidence !== existing.evidence) {
        const updated = [...list];
        updated[index] = merged;
        mutable[candidate.dimension] = updated;
        profileChanged = true;
        appliedCount += 1;
      } else {
        notes.push(dimensionLabel(candidate.dimension) + '「' + existing.label + '」已存在，保留已有内容');
      }
    }
    if (profileChanged) next = { ...mutable, confirmed: false, advantages: [], improvements: [] };
  }

  const nameCandidate = candidates.find((candidate): candidate is Extract<ResumeCandidate, { kind: 'name' }> => candidate.kind === 'name');
  if (nameCandidate) {
    if (currentName.trim()) {
      if (currentName.trim() !== nameCandidate.value) notes.push('姓名（已保留你当前填写的内容）');
    } else {
      resumeName = nameCandidate.value;
      appliedCount += 1;
    }
  }

  return { student: next, resumeName, notes, appliedCount };
}

export function resumeCandidateConflict(candidate: ResumeCandidate, student: StudentProfile, currentName: string): string | null {
  if (candidate.kind === 'name') {
    return currentName.trim() && currentName.trim() !== candidate.value
      ? '当前会话已有姓名；接受后仍保留当前填写值。'
      : null;
  }
  if (candidate.kind === 'major' || candidate.kind === 'experiences') {
    const current = student[candidate.kind].trim();
    return current && current !== candidate.value.trim()
      ? '档案已有内容；接受后仍保留档案中的非空内容。'
      : null;
  }
  const current = student[candidate.dimension].find(item => item.tag_id.toLowerCase() === candidate.value.tag_id.toLowerCase());
  if (!current) return null;
  const differs =
    (current.label.trim() && current.label.trim() !== candidate.value.label.trim()) ||
    current.level !== candidate.value.level ||
    (current.evidence.trim() && current.evidence.trim() !== candidate.value.evidence.trim());
  return differs ? '档案中已有同名能力；已有名称、等级和非空证据优先保留。' : null;
}

function abilityLimit(dimension: Dimension): number {
  return dimension === 'skills' ? 100 : 50;
}

function dimensionLabel(dimension: Dimension): string {
  return dimension === 'skills' ? '技能标签' : dimension === 'certificates' ? '证书' : '通用素质';
}
