import type { ApprovalPositionOption } from '@enterprise-platform/contracts-inventory';

export const INVENTORY_ORGANIZATION = Symbol('INVENTORY_ORGANIZATION');

/**
 * Sơ đồ tổ chức do Tenant Core giữ; Kho chỉ đọc qua API nội bộ (luật 4), không đọc schema Core.
 * Không đọc được thì ném lỗi: kiểm người duyệt theo chức danh phải đóng, không được coi là "ai cũng duyệt được".
 */
export interface InventoryOrganizationPort {
  /** Các chức danh của tenant (không gồm đơn vị), theo tên. */
  positions(tenantId: string): Promise<ApprovalPositionOption[]>;
  /** Mã các chức danh người dùng đang được bổ nhiệm. */
  heldPositionIds(tenantId: string, userId: string): Promise<string[]>;
}
