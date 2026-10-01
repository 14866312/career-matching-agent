import { describe, expect, it } from 'vitest';
import { fmtNum, fmtPct } from '../format';

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
