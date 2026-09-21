export function fmtPct(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—';
  return (Math.round(v * 10) / 10).toFixed(1) + '%';
}

export function fmtNum(v: number): number {
  return Math.round(v * 10) / 10;
}

export function levelLabel(level: number): string {
  return ['未掌握', '了解', '能够在指导下使用', '能够独立使用'][level] ?? String(level);
}

export function todayStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
}

