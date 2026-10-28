import type { ReportingLineSnapshot } from '../domain/reporting-line.js';

/** Token DI của `ReportingLineReader`. */
export const REPORTING_LINE_READER = Symbol('CRM_REPORTING_LINE_READER');

/**
 * Đọc quan hệ "Báo cáo cho" của một tenant từ Tenant Core.
 *
 * Không đọc được và chưa có bản nào đã biết thì ném
 * `CrmOrganizationUnavailableError` (503): phạm vi dữ liệu không bao giờ được
 * đoán.
 */
export interface ReportingLineReader {
  snapshot(tenantId: string): Promise<ReportingLineSnapshot>;
}
