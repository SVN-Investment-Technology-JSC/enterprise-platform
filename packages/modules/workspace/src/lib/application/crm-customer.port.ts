import type { CrmCustomerReference } from '@enterprise-platform/contracts-integration';
import type { Customer } from '@enterprise-platform/contracts-workspace';

/** Token Symbol: port HTTP sang Bán hàng (xem `FLEET_AVAILABILITY_READER`). */
export const CRM_CUSTOMER_DIRECTORY = Symbol('CRM_CUSTOMER_DIRECTORY');
/** Token Symbol: nơi ghi bản sao khách Bán hàng trong `workspace_schema`. */
export const CRM_CUSTOMER_COPIES = Symbol('CRM_CUSTOMER_COPIES');

/**
 * Khách hàng ở Bán hàng (D1). Workspace không đọc schema của Bán hàng: tra qua
 * `GET /v1/internal/customers` bằng service token, và hỏi Platform tenant có
 * bật phân hệ crm không.
 */
export interface CrmCustomerDirectory {
  /** Tenant có entitlement `crm` đang hiệu lực. */
  enabled(tenantId: string): Promise<boolean>;
  lookup(
    tenantId: string,
    query: { readonly search?: string; readonly ids?: readonly string[]; readonly limit?: number },
  ): Promise<readonly CrmCustomerReference[]>;
}

/** Kết quả cập nhật một bản sao. */
export interface CrmCustomerCopyResult {
  readonly action: 'ignored' | 'updated' | 'linked' | 'created';
  readonly customer: Customer;
}

/** Bản sao khách Bán hàng trong `workspace_schema.customers` (cột `crm_customer_id`, `crm_version`). */
export interface CrmCustomerCopyStore {
  /** Cột liên kết đã có ở tenant này (migration 0031 đã chạy). */
  ready(tenantId: string): Promise<boolean>;
  /**
   * Tạo, gắn hoặc cập nhật bản sao theo `crm_customer_id`, bỏ qua phiên bản cũ
   * (`decideCrmCustomerSync`). Chạy lại cùng dữ liệu không đổi gì. Xung đột mã
   * ném `CrmCustomerLinkConflictError`.
   */
  apply(
    tenantId: string,
    reference: CrmCustomerReference,
    options: { readonly actorUserId: string; readonly targetCustomerId?: string },
  ): Promise<CrmCustomerCopyResult>;
  /** Bản sao đã có của các khách Bán hàng: `crmCustomerId → customerId`. */
  linkedIds(tenantId: string, crmCustomerIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}
