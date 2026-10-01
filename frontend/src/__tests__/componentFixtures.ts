import type { JobSummary, MatchResult, Recommendation, ReportResp, ResumeResp, StudentProfile } from '../types';

export const student: StudentProfile = {
  major: '计算机科学与技术',
  skills: [{ tag_id: 'typescript', label: 'TypeScript', level: 1, confirmed: true, evidence: '', source: 'manual' }],
  certificates: [],
  qualities: [],
  experiences: '参与过前端项目开发',
  intention: { target_job_id: '', city: '' },
  confirmed: false,
  advantages: [],
  improvements: []
};

export const jobs: JobSummary[] = [{
  id: 'frontend-engineer',
  name: '前端工程师',
  family: '软件开发',
  level: '初级',
  summary: '负责网页应用开发。',
  monogram: 'FE',
  color: '#123456',
  requirements: [],
  preferred: [],
  certificate_note: '',
  version: 'data-1'
}];

export function matchFor(jobName = '前端工程师'): MatchResult {
  return {
    job_id: 'frontend-engineer',
    job_name: jobName,
    algorithm_version: 'matching-2.2',
    data_version: 'data-1',
    input_version: 'input-1',
    required: 1,
    satisfied: 1,
    basic: 100,
    enhanced: 100,
    dimensions: [{ id: 'skills', label: '技能', required: 1, satisfied: 1, basic: 100, enhanced: 100 }],
    items: [{
      tag_id: 'typescript', label: 'TypeScript', dimension: 'skills', required_level: 1,
      status: 'satisfied', student_level: 1, student_evidence: '', contribution: 1,
      enhancement_basis: 'exact', related_only: false
    }],
    satisfied_items: [],
    pending_items: []
  };
}

export function recommendationFor(jobName = '前端工程师'): Recommendation {
  return {
    job_id: 'frontend-engineer',
    job_name: jobName,
    match: matchFor(jobName),
    reason: '当前资料与岗位要求相符。',
    samples: [],
    matching_sample_count: 1
  };
}

export function recommendationsFor(jobName = '前端工程师') {
  return {
    items: [recommendationFor(jobName)],
    candidate_count: 1,
    sort_by: 'basic',
    note: '共找到 1 个岗位。'
  };
}

export const report: ReportResp = {
  job_id: 'frontend-engineer',
  job_name: '前端工程师',
  match: matchFor(),
  advice: {
    fit_evaluation: '当前资料已覆盖岗位的核心要求。',
    learning_directions: ['继续完善项目作品。'],
    learning_steps: ['完成一个可展示的项目。']
  },
  input_version: 'input-1',
  status: 'ok',
  mode: 'mock',
  generated_at: '2026-10-01T00:00:00.000Z',
  export_text: '报告正文',
  notice: '建议只作职业决策辅助。'
};

export const resumeResponse: ResumeResp = {
  name: '王同学',
  profile: {
    ...student,
    major: '软件工程',
    major_source: 'resume',
    skills: [{ tag_id: 'react', label: 'React', level: 1, confirmed: true, evidence: '', source: 'resume' }],
    experiences: '简历中的项目经历',
    experiences_source: 'resume'
  },
  notice: '已提取可识别信息',
  mode: 'mock',
  text_length: 128
};
