import type { ReportResp } from './types';

// 报告正文一律使用服务端返回的 export_text 原文：复制与导出是同一份文本，
// 不在客户端重新拼装时间或分数，避免两处内容不一致。
export function getReportText(d: ReportResp): string {
  return typeof d.export_text === 'string' ? d.export_text : '';
}

export function reportFileName(jobName: string): string {
  const safe = jobName.replace(/[\\/:*?"<>|]/g, '-');
  return '职业建议-' + safe + '.txt';
}
