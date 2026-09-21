import { describe, expect, it } from 'vitest';
import { parseFilters, filtersSummary } from '../lib/filters';

describe('parseFilters', () => {
  it('全部留空返回空筛选', () => {
    const r = parseFilters('', '', '', 'month', '');
    expect(r.ok).toBe(true);
    expect(r.filters).toEqual({ city: '', salary_min: null, salary_max: null, salary_period: 'month', skills: [] });
  });
  it('解析城市和技能分隔符', () => {
    const r = parseFilters(' 上海 ', '', '', 'month', 'Java, MySQL、Vue;C++');
    expect(r.ok).toBe(true);
    expect(r.filters!.city).toBe('上海');
    expect(r.filters!.skills).toEqual(['Java', 'MySQL', 'Vue', 'C++']);
  });
  it('薪资必须为非负数字', () => {
    expect(parseFilters('', '-5', '', 'month', '').ok).toBe(false);
    expect(parseFilters('', 'abc', '', 'month', '').ok).toBe(false);
  });
  it('下限大于上限时报错', () => {
    const r = parseFilters('', '9000', '5000', 'month', '');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('下限不能大于上限');
  });
  it('日薪周期保留 period 字段', () => {
    const r = parseFilters('', '200', '400', 'day', '');
    expect(r.ok).toBe(true);
    expect(r.filters!.salary_period).toBe('day');
  });
});

describe('filtersSummary', () => {
  it('拼接摘要文本', () => {
    expect(filtersSummary({ city: '上海', salary_min: 5000, salary_max: null, salary_period: 'month', skills: ['Java'] }))
      .toBe('城市 上海 · 薪资 5000-不限 元/月 · 须含 Java');
  });
  it('无条件时返回未设置', () => {
    expect(filtersSummary({ city: '', salary_min: null, salary_max: null, salary_period: 'month', skills: [] }))
      .toBe('未设置筛选条件');
  });
});
