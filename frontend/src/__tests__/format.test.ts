import { describe, expect, it } from 'vitest';
import { fmtNum, fmtPct, levelLabel } from '../format';

describe('fmtPct', () => {
  it('保留一位小数', () => {
    expect(fmtPct(50)).toBe('50.0%');
    expect(fmtPct(33.333)).toBe('33.3%');
    expect(fmtPct(66.666)).toBe('66.7%');
  });
  it('空值和非法值显示破折号', () => {
    expect(fmtPct(null)).toBe('—');
    expect(fmtPct(undefined)).toBe('—');
    expect(fmtPct(NaN)).toBe('—');
    expect(fmtPct(Infinity)).toBe('—');
  });
});

describe('fmtNum', () => {
  it('数值保留一位小数', () => {
    expect(fmtNum(33.333)).toBe(33.3);
    expect(fmtNum(66.666)).toBe(66.7);
    expect(fmtNum(0)).toBe(0);
  });
});

describe('levelLabel', () => {
  it('返回对应等级名称', () => {
    expect(levelLabel(0)).toBe('未掌握');
    expect(levelLabel(1)).toBe('了解');
    expect(levelLabel(2)).toBe('能够在指导下使用');
    expect(levelLabel(3)).toBe('能够独立使用');
  });
  it('未知等级返回数字', () => {
    expect(levelLabel(9)).toBe('9');
  });
});
