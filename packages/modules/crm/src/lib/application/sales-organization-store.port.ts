import type {
  NormalizedSalesOrganization,
  SalesOrganization,
  SalesOrganizationSummary,
} from '@enterprise-platform/contracts-crm';

/**
 * Port của danh mục tổ chức báo giá (plan phase 3 mục 16, D3-24). Đọc cho mọi người có `crm.read` (chọn trên báo
 * giá); ghi chỉ `crm.manage` (kiểm ở `SalesOrganizationService`).
 */
export const CRM_SALES_ORGANIZATION_STORE = Symbol('CRM_SALES_ORGANIZATION_STORE');

/** Tổ chức đã kiểm và chuẩn hoá bằng `validateSalesOrganization`, sẵn sàng ghi. */
export type SalesOrganizationRecord = NormalizedSalesOrganization;

/** Kết quả xoá: tổ chức đã có phiên bản báo giá dùng thì không xoá được, chỉ tắt. */
export type SalesOrganizationRemoval = 'deleted' | 'not-found' | 'in-use';

export interface SalesOrganizationStore {
  /** Danh sách không có logo (`hasLogo` thay thế), kèm `inUse`. */
  list(tenantId: string, includeInactive: boolean): Promise<SalesOrganizationSummary[]>;
  /** Một tổ chức kèm logo, kể cả đang tắt; không có: `undefined`. */
  get(tenantId: string, id: string): Promise<SalesOrganization | undefined>;
  /** Tổ chức mặc định đang bật (chọn sẵn khi lập báo giá); không có: `undefined`. */
  defaultOrganization(tenantId: string): Promise<SalesOrganization | undefined>;
  /**
   * Tạo, sửa và ghi `audit_log` (không ghi logo) trong một transaction. Đặt mặc định thì bỏ mặc định cũ trong cùng
   * transaction. Trùng tên (không phân biệt hoa thường) hoặc mã: `CrmConflictError` 409.
   */
  create(tenantId: string, record: SalesOrganizationRecord, actorId: string): Promise<SalesOrganization>;
  update(tenantId: string, id: string, record: SalesOrganizationRecord, actorId: string): Promise<SalesOrganization | undefined>;
  remove(tenantId: string, id: string, actorId: string): Promise<SalesOrganizationRemoval>;
}

/** Phần báo giá cần: tổ chức theo id và tổ chức mặc định. */
export type SalesOrganizationReader = Pick<SalesOrganizationStore, 'get' | 'defaultOrganization'>;
