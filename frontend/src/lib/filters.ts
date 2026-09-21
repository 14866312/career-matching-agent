import type { Filters } from '../types';

export interface ParsedFilters {
  ok: boolean;
  error?: string;
  filters?: Filters;
}

export function parseFilters(
  city: string,
  minText: string,
  maxText: string,
  period: Filters['salary_period'],
  skillsText: string
): ParsedFilters {
  const min = minText.trim() === '' ? null : Number(minText);
  const max = maxText.trim() === '' ? null : Number(maxText);
  if (min !== null && (!isFinite(min) || min < 0)) return { ok: false, error: '薪资下限请输入不小于 0 的数字。' };
  if (max !== null && (!isFinite(max) || max < 0)) return { ok: false, error: '薪资上限请输入不小于 0 的数字。' };
  if (min !== null && max !== null && min > max) return { ok: false, error: '薪资下限不能大于上限，请修正后重试。' };
  const skills = skillsText.split(/[,，、;；\s]+/).map(s => s.trim()).filter(Boolean);
  return { ok: true, filters: { city: city.trim(), salary_min: min, salary_max: max, salary_period: period, skills } };
}

export function filtersSummary(f: Filters): string {
  const parts: string[] = [];
  if (f.city) parts.push('城市 ' + f.city);
  if (f.salary_min != null || f.salary_max != null) {
    const per = f.salary_period === 'day' ? '天' : '月';
    parts.push('薪资 ' + (f.salary_min ?? '0') + '-' + (f.salary_max ?? '不限') + ' 元/' + per);
  }
  if (f.skills.length) parts.push('须含 ' + f.skills.join('、'));
  return parts.length ? parts.join(' · ') : '未设置筛选条件';
}

