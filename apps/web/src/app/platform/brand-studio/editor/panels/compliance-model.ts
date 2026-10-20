import type { ComplianceIssue, IssueSeverity } from '@enterprise-platform/shared-brand-icon';

export type SeverityCounts = Readonly<Record<IssueSeverity, number>>;

export function countBySeverity(issues: readonly ComplianceIssue[]): SeverityCounts {
  const counts: Record<IssueSeverity, number> = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) counts[issue.severity] += 1;
  return counts;
}

const SEVERITY_NOUNS: Record<IssueSeverity, string> = { error: 'lỗi', warning: 'cảnh báo', info: 'gợi ý' };

/** Các mức có kết quả, theo thứ tự nặng trước, kèm chữ ngắn như `2 cảnh báo`. */
export function summaryParts(counts: SeverityCounts): Array<{ severity: IssueSeverity; count: number; text: string }> {
  return (['error', 'warning', 'info'] as const)
    .filter((severity) => counts[severity] > 0)
    .map((severity) => ({ severity, count: counts[severity], text: `${counts[severity]} ${SEVERITY_NOUNS[severity]}` }));
}
