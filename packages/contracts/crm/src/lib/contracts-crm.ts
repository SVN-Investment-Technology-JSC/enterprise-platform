/**
 * Hợp đồng dùng chung giữa giao diện (`feature-crm`) và API (`crm-api`) của
 * phân hệ Bán hàng. Chỉ có kiểu và hằng số; không có logic phụ thuộc server.
 */

/** Mã phân hệ: khoá entitlement, tiền tố quyền và tên schema `crm_schema`. */
export const CRM_MODULE_KEY = 'crm';

/** Gốc API của phân hệ, đi qua gateway. */
export const CRM_API_ROOT = '/api/crm/v1';

/**
 * Quyền của người đang đăng nhập, chỉ để giao diện ẩn hiện. Quyền thật kiểm ở
 * API (guard và tầng application).
 */
export interface CrmCapabilities {
  /** Quản trị viên tenant: có mọi quyền nghiệp vụ của Bán hàng. */
  readonly isTenantAdmin: boolean;
  /** `crm.read.all`: thấy toàn bộ dữ liệu, không lọc theo người phụ trách. */
  readonly canReadAll: boolean;
  /** `crm.opportunity.write`: lead, cơ hội, hoạt động, khách hàng của mình. */
  readonly canWriteOpportunity: boolean;
  /** `crm.quote.write`: lập báo giá. */
  readonly canWriteQuote: boolean;
  /** `crm.quote.approve`: duyệt báo giá. */
  readonly canApproveQuote: boolean;
  /** `crm.order.write`: lập và xác nhận đơn bán. */
  readonly canWriteOrder: boolean;
  /** `crm.contract.write`: quản lý hợp đồng. */
  readonly canWriteContract: boolean;
  /** `crm.receivable.write`: thu tiền, điều chỉnh công nợ. */
  readonly canWriteReceivable: boolean;
  /** `crm.warranty.write`: xử lý bảo hành, đổi trả. */
  readonly canWriteWarranty: boolean;
  /** `crm.report.read`: xem báo cáo Bán hàng. */
  readonly canReadReport: boolean;
  /** `crm.manage`: bảng giá, chính sách, nhóm khách, hạn mức, cấu hình. */
  readonly canManage: boolean;
}

/** Không có quyền nào: giá trị mặc định khi chưa tải xong trạng thái. */
export const CRM_NO_CAPABILITIES: CrmCapabilities = {
  isTenantAdmin: false,
  canReadAll: false,
  canWriteOpportunity: false,
  canWriteQuote: false,
  canApproveQuote: false,
  canWriteOrder: false,
  canWriteContract: false,
  canWriteReceivable: false,
  canWriteWarranty: false,
  canReadReport: false,
  canManage: false,
};

/** `GET /api/crm/v1/status`: mức sẵn sàng của phân hệ và quyền của người gọi. */
export interface CrmStatus {
  readonly tenantId: string;
  /** Đã có `crm_schema` trong DB của tenant. */
  readonly schemaExists: boolean;
  /** Migration nền (0001) đã chạy xong. */
  readonly tablesReady: boolean;
  readonly capabilities: CrmCapabilities;
}
