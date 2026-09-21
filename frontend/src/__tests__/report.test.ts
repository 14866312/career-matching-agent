import { describe, expect, it } from 'vitest';
import { getReportText, reportFileName } from '../report';
import type { ReportResp } from '../types';

const report: ReportResp = {
  job_id: 'frontend-dev',
  job_name: '前端开发工程师',
  match: {
    job_id: 'frontend-dev',
    job_name: '前端开发工程师',
    algorithm_version: 'a1',
    data_version: 'd1',
    input_version: 'v1',
    required: 10,
    satisfied: 4,
    basic: 40,
    enhanced: 52.5,
    dimensions: [],
    items: [],
    satisfied_items: [],
    gap_items: [],
    pending_items: []
  },
  advice: { fit_evaluation: '基础尚可。', learning_directions: ['Vue 生态'], learning_steps: ['完成官方教程'] },
  input_version: 'v1',
  status: 'complete',
  mode: 'live',
  generated_at: '2026-09-16T00:00:00+00:00',
  export_text: '大学生职业规划建议\n目标岗位：前端开发工程师\n基础匹配度：40.0%（4/10）',
  notice: '示例说明'
};

describe('reportFileName', () => {
  it('替换文件系统非法字符', () => {
    expect(reportFileName('C/C++ 开发工程师')).toBe('职业建议-C-C++ 开发工程师.txt');
    expect(reportFileName('a*b?c')).toBe('职业建议-a-b-c.txt');
  });
  it('正常名称保持不变', () => {
    expect(reportFileName('前端开发工程师')).toBe('职业建议-前端开发工程师.txt');
  });
});

describe('getReportText', () => {
  it('逐字返回服务端 export_text，不做任何客户端改写', () => {
    expect(getReportText(report)).toBe(report.export_text);
  });
  it('字段缺失或非字符串时返回空串，由界面提示失败', () => {
    expect(getReportText({ ...report, export_text: undefined as unknown as string })).toBe('');
    expect(getReportText({ ...report, export_text: '' })).toBe('');
  });
});
