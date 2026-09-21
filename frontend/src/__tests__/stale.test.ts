import { describe, expect, it } from 'vitest';
import { isReportStale } from '../lib/stale';

describe('isReportStale', () => {
  const meta = { studentRev: 3, jobId: 'frontend-dev', inputVersion: 'v1' };
  it('未生成过报告时永远不失效', () => {
    expect(isReportStale(null, 99, 'x', 'v9')).toBe(false);
  });
  it('学生版本变化即失效', () => {
    expect(isReportStale(meta, 4, 'frontend-dev', 'v1')).toBe(true);
  });
  it('岗位变化即失效', () => {
    expect(isReportStale(meta, 3, 'java-dev', 'v1')).toBe(true);
  });
  it('输入版本变化即失效', () => {
    expect(isReportStale(meta, 3, 'frontend-dev', 'v2')).toBe(true);
  });
  it('全部一致时不失效', () => {
    expect(isReportStale(meta, 3, 'frontend-dev', 'v1')).toBe(false);
  });
});
