import { describe, expect, it } from 'vitest';
import { mergeResumeProfile } from '../lib/resumeImport';
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
      { tag_id: 'typescript', label: 'TypeScript', level: 3, confirmed: false, evidence: '使用 TS 完成项目' },
      { tag_id: 'TYPESCRIPT', label: 'TS', level: 2, confirmed: false, evidence: '重复项' }
    ]
  }
};

describe('resume import', () => {
  it('merges current resume data directly and deduplicates normalized skill IDs', () => {
    const result = mergeResumeProfile(emptyStudent, parsed);
    expect(result.student.major).toBe('软件工程');
    expect(result.student.experiences).toBe('完成课程项目');
    expect(result.student.skills).toHaveLength(1);
    expect(result.student.skills[0]).toMatchObject({ tag_id: 'typescript', source: 'resume', level: 3, confirmed: true });
    expect(result.appliedCount).toBe(3);
    expect(emptyStudent.skills).toEqual([]);
  });

  it('keeps existing manual values and never puts the resume name in the profile', () => {
    const existing: StudentProfile = {
      ...emptyStudent,
      major: '信息管理', experiences: '手动填写的项目',
      skills: [{ tag_id: 'typescript', label: '手动标签', level: 1, confirmed: false, evidence: '', source: 'manual' }]
    };
    const result = mergeResumeProfile(existing, parsed);
    expect(result.student.major).toBe('信息管理');
    expect(result.student.experiences).toBe('手动填写的项目');
    expect(result.student.skills).toEqual(existing.skills);
    expect(result.resumeName).toBe('林晓');
    expect(JSON.stringify(result.student)).not.toContain('林晓');
    expect(result.notes).toHaveLength(2);
  });

  it('replaces obsolete resume-sourced data on reimport but retains manual additions', () => {
    const first = mergeResumeProfile(emptyStudent, parsed).student;
    const withManual: StudentProfile = {
      ...first,
      skills: [...first.skills, { tag_id: 'java', label: 'Java', level: 1, confirmed: true, evidence: '', source: 'manual' }]
    };
    const second: ResumeResp = {
      ...parsed, name: '新姓名',
      profile: {
        ...parsed.profile, major: '计算机科学', experiences: '新的实习经历',
        skills: [{ tag_id: 'python', label: 'Python', level: 1, confirmed: false, evidence: '' }]
      }
    };
    const result = mergeResumeProfile(withManual, second);
    expect(result.student.major).toBe('计算机科学');
    expect(result.student.experiences).toBe('新的实习经历');
    expect(result.student.skills.map(x => x.tag_id)).toEqual(['java', 'python']);
    expect(result.resumeName).toBe('新姓名');
  });

  it('does not mutate current data when parsing fails before merge', () => {
    const existing = mergeResumeProfile(emptyStudent, parsed).student;
    expect(() => { throw new Error('parse failed'); }).toThrow('parse failed');
    expect(existing.skills.map(x => x.tag_id)).toEqual(['typescript']);
  });
});
