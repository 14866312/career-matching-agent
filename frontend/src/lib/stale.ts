export interface ReportMeta {
  studentRev: number;
  jobId: string;
  inputVersion: string;
}

export function isReportStale(
  meta: ReportMeta | null,
  currentRev: number,
  currentJobId: string | null,
  currentInputVersion: string | null
): boolean {
  if (!meta) return false;
  if (meta.studentRev !== currentRev) return true;
  if (currentJobId && meta.jobId !== currentJobId) return true;
  if (currentInputVersion && meta.inputVersion !== currentInputVersion) return true;
  return false;
}

