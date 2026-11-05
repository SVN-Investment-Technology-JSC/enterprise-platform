/**
 * Khách hàng của Bán hàng (crm) và bản sao ở Workspace (quyết định D1, docs/crm/plan_crm.md mục 10.1).
 *
 * Bán hàng là nguồn gốc khách hàng. Mỗi lần tạo hoặc sửa khách, Bán hàng ghi một sự kiện vào outbox trong cùng
 * transaction; Workspace nghe và cập nhật bản sao theo `customerId` (`workspace_schema.customers.crm_customer_id`).
 * `version` là phiên bản của khách ở Bán hàng, tăng mỗi lần sửa: bên nghe bỏ qua sự kiện có `version` không lớn hơn
 * bản đang giữ, nên sự kiện đến trễ hay giao lặp không ghi đè dữ liệu mới.
 *
 * Khai ở đây (không ở contracts của Bán hàng) vì Workspace không được phụ thuộc package của phân hệ khác.
 */
export const CRM_CUSTOMER_CREATED = 'crm.customer.created';
export const CRM_CUSTOMER_UPDATED = 'crm.customer.updated';

/** Mọi sự kiện khách hàng của Bán hàng; bên nghe bind cả hai. */
export const CRM_CUSTOMER_EVENTS = [CRM_CUSTOMER_CREATED, CRM_CUSTOMER_UPDATED] as const;

export function isCrmCustomerEvent(type: string): boolean {
  return (CRM_CUSTOMER_EVENTS as readonly string[]).includes(type);
}

export interface CrmCustomerEventPayload {
  readonly customerId: string;
  readonly code: string;
  readonly name: string;
  readonly taxCode: string | null;
  /** Phiên bản của khách ở Bán hàng (bắt đầu từ 1, tăng mỗi lần sửa). */
  readonly version: number;
  /** Người tạo hoặc sửa; null khi hệ thống tự làm. */
  readonly actorUserId: string | null;
}

/**
 * Một dòng của `GET /v1/internal/customers` (Bán hàng): chỉ các trường Workspace cần để chọn và giữ bản sao.
 */
export interface CrmCustomerReference {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly taxCode: string | null;
  readonly version: number;
}

export interface CrmCustomerReferencePage {
  readonly items: readonly CrmCustomerReference[];
}
