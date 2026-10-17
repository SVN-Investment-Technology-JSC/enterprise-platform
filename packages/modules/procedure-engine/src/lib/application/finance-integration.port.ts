import type { ProcedureFinanceCapabilities } from '@enterprise-platform/contracts-procedure-engine';

export const FINANCE_INTEGRATION_RESOLVER = Symbol('FINANCE_INTEGRATION_RESOLVER');

/**
 * Hỏi module Tài chính qua route nội bộ chỉ đọc, lúc công bố quy trình có bước Tài
 * chính: Tài chính có đang phục vụ tenant và nhận loại phiếu nào từ quy trình.
 *
 * Ném lỗi khi Tài chính không trả lời được; bên gọi chặn công bố.
 */
export interface FinanceIntegrationResolver {
  capabilities(tenantId: string): Promise<ProcedureFinanceCapabilities>;
}
