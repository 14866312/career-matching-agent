import type { Ability, Dimension, ResumeResp, StudentProfile } from '../types';

export interface ResumeMergeResult {
  student: StudentProfile;
  /** The name is session-only and must never be merged into StudentProfile. */
  resumeName: string | null;
  notes: string[];
  appliedCount: number;
}

/** Replace the previous resume import while retaining everything the user edited by hand. */
export function mergeResumeProfile(student: StudentProfile, parsed: ResumeResp): ResumeMergeResult {
  const next: StudentProfile = { ...student };
  const notes: string[] = [];
  let changed = false;
  let appliedCount = 0;

  for (const field of ['major', 'experiences'] as const) {
    const sourceField = field === 'major' ? 'major_source' : 'experiences_source';
    const incoming = parsed.profile[field].trim();
    const manualValue = next[field].trim() && next[sourceField] !== 'resume';
    if (manualValue) {
      if (incoming && incoming !== next[field].trim()) {
        notes.push((field === 'major' ? '专业' : '经历') + '：保留手动填写的内容');
      }
      continue;
    }
    if (next[field] !== incoming || next[sourceField] !== (incoming ? 'resume' : undefined)) {
      next[field] = incoming;
      next[sourceField] = incoming ? 'resume' : undefined;
      changed = true;
      if (incoming) appliedCount += 1;
    }
  }

  for (const dimension of ['skills', 'certificates', 'qualities'] as const satisfies readonly Dimension[]) {
    const retained = student[dimension].filter(item => item.source !== 'resume');
    const seen = new Set(retained.map(item => item.tag_id.trim().toLowerCase()));
    const imported: Ability[] = [];
    const limit = dimension === 'skills' ? 100 : 50;
    for (const item of parsed.profile[dimension]) {
      const tagId = item.tag_id.trim();
      const label = item.label.trim();
      const key = (tagId || label).toLowerCase();
      if (!key || seen.has(key)) continue;
      if (retained.length + imported.length >= limit) {
        notes.push('部分' + dimensionLabel(dimension) + '超过数量上限，未导入');
        break;
      }
      seen.add(key);
      imported.push({
        ...item,
        tag_id: tagId || key,
        label: label || tagId,
        // A parsed mention counts as present. These compatibility fields do not
        // ask the user to confirm a proficiency level or submit evidence.
        level: Number.isFinite(item.level) && item.level > 0 ? item.level : 1,
        confirmed: true,
        evidence: item.evidence || '',
        source: 'resume'
      });
      appliedCount += 1;
    }
    if (retained.length !== student[dimension].length || imported.length) changed = true;
    next[dimension] = [...retained, ...imported];
  }

  return {
    student: changed ? { ...next, advantages: [], improvements: [] } : student,
    resumeName: parsed.name.trim() || null,
    notes,
    appliedCount
  };
}

function dimensionLabel(dimension: Dimension): string {
  return dimension === 'skills' ? '技能' : dimension === 'certificates' ? '证书' : '通用素质';
}
