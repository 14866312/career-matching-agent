import { describe, expect, it } from 'vitest';
import { createResumeCandidates, mergeAcceptedResumeCandidates, resumeCandidateConflict } from '../lib/resumeReview';
import type { ResumeResp, StudentProfile } from '../types';

const emptyStudent: StudentProfile = {
  major: '', skills: [], certificates: [], qualities: [], experiences: '',
  intention: { target_job_id: '', city: '' }, confirmed: false, advantages: [], improvements: []
};

const parsed: ResumeResp = {
  name: '林晓', mode: 'mock', notice: '', text_length: 10,
  profile: {
    ...emptyStudent,
    major: '软件工程', experiences: '完成课程项目',
    skills: [
      { tag_id: 'typescript', label: 'TypeScript', level: 3, confirmed: true, evidence: '使用 TS 完成项目' },
      { tag_id: 'typescript', label: 'TS', level: 2, confirmed: true, evidence: '重复项' }
    ]
  }
};

describe('resume review', () => {
  it('creates review candidates without changing the current profile', () => {
    const candidates = createResumeCandidates(parsed);
    expect(candidates.map(x => x.kind)).toEqual(['name', 'major', 'experiences', 'ability', 'ability']);
    expect(emptyStudent).toMatchObject({ major: '', experiences: '', skills: [], confirmed: false });
  });

  it('only merges accepted candidates, preserves existing values, and keeps new abilities unconfirmed', () => {
    const candidates = createResumeCandidates(parsed);
    const accepted = candidates.filter(x => x.id === 'major' || x.id === 'skills:typescript:0' || x.id === 'skills:typescript:1');
    const existing: StudentProfile = {
      ...emptyStudent,
      major: '信息管理',
      skills: [{ tag_id: 'typescript', label: 'TS 手动标签', level: 1, confirmed: true, evidence: '手动证据' }],
      confirmed: true,
      advantages: ['旧结论']
    };
    const result = mergeAcceptedResumeCandidates(existing, '', accepted);
    expect(result.student.major).toBe('信息管理');
    expect(result.student.skills).toEqual([{ tag_id: 'typescript', label: 'TS 手动标签', level: 1, confirmed: true, evidence: '手动证据' }]);
    expect(result.student.confirmed).toBe(true);
    expect(result.notes.length).toBeGreaterThan(0);

    const added = mergeAcceptedResumeCandidates(emptyStudent, '', candidates.filter(x => x.kind === 'ability'));
    expect(added.student.skills).toHaveLength(1);
    expect(added.student.skills[0].confirmed).toBe(false);
    expect(added.appliedCount).toBe(1);
  });

  it('keeps parsing names in session state only and reports conflicts for review', () => {
    const candidates = createResumeCandidates(parsed);
    const result = mergeAcceptedResumeCandidates(emptyStudent, '当前姓名', candidates.filter(x => x.kind === 'name'));
    expect(result.resumeName).toBeNull();
    expect(result.student).toBe(emptyStudent);
    const major = candidates.find(x => x.kind === 'major')!;
    expect(resumeCandidateConflict(major, { ...emptyStudent, major: '现有专业' }, '')).toContain('保留');
  });

  it('does not call an identical duplicate a conflict, but explains differing values', () => {
    const skill = createResumeCandidates(parsed).find(x => x.kind === 'ability')!;
    const identical: StudentProfile = {
      ...emptyStudent,
      skills: [{ ...skill.value, confirmed: false }]
    };
    expect(resumeCandidateConflict(skill, identical, '')).toBeNull();
    const different: StudentProfile = {
      ...emptyStudent,
      skills: [{ ...skill.value, level: 1, evidence: '手动证据', confirmed: true }]
    };
    expect(resumeCandidateConflict(skill, different, '')).toContain('保留');
  });
});
