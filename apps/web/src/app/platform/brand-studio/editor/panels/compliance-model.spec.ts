import type { ComplianceIssue } from '@enterprise-platform/shared-brand-icon';
import { countBySeverity, summaryParts } from './compliance-model';

const issue = (severity: ComplianceIssue['severity'], code = 'X'): ComplianceIssue => ({ code, severity, message: code });

describe('countBySeverity', () => {
  it('đếm theo từng mức', () => {
    expect(countBySeverity([issue('error'), issue('warning'), issue('warning'), issue('info')])).toEqual({ error: 1, warning: 2, info: 1 });
    expect(countBySeverity([])).toEqual({ error: 0, warning: 0, info: 0 });
  });
});

describe('summaryParts', () => {
  it('chỉ liệt kê mức có kết quả, nặng trước', () => {
    expect(summaryParts({ error: 0, warning: 2, info: 3 })).toEqual([
      { severity: 'warning', count: 2, text: '2 cảnh báo' },
      { severity: 'info', count: 3, text: '3 gợi ý' },
    ]);
    expect(summaryParts({ error: 1, warning: 0, info: 0 })).toEqual([{ severity: 'error', count: 1, text: '1 lỗi' }]);
    expect(summaryParts({ error: 0, warning: 0, info: 0 })).toEqual([]);
  });
});
