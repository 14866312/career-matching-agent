export function fmtPct(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—';
  return (Math.round(v * 10) / 10).toFixed(1) + '%';
}

export function fmtNum(v: number): number {
  return Math.round(v * 10) / 10;
}

export function todayStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
}

