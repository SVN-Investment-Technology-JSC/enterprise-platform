import type { CrmCapabilities } from '@enterprise-platform/contracts-crm';

/**
 * Danh tính người gọi, do `CrmAccessGuard` gắn vào request sau khi
 * access-decision của Platform trả về. Tầng application không tự đọc JWT.
 *
 * Các cờ quyền tính bằng `tenantActionHeld` (đã gồm quyền bao hàm, ví dụ
 * `crm.manage` kéo theo `crm.read.all`) và đều bật khi là quản trị tenant.
 * Thao tác cụ thể cần cờ nào kiểm ở service của thao tác đó.
 */
export interface CrmActor extends CrmCapabilities {
  readonly tenantId: string;
  readonly userId: string;
  readonly displayName: string;
}

/** Cờ quyền để trả cho giao diện (`GET /v1/status`), bỏ phần danh tính. */
export function crmCapabilities(actor: CrmActor): CrmCapabilities {
  return {
    isTenantAdmin: actor.isTenantAdmin,
    canReadAll: actor.canReadAll,
    canWriteOpportunity: actor.canWriteOpportunity,
    canWriteQuote: actor.canWriteQuote,
    canApproveQuote: actor.canApproveQuote,
    canWriteOrder: actor.canWriteOrder,
    canWriteContract: actor.canWriteContract,
    canWriteReceivable: actor.canWriteReceivable,
    canWriteWarranty: actor.canWriteWarranty,
    canReadReport: actor.canReadReport,
    canManage: actor.canManage,
  };
}

/** Thấy toàn bộ dữ liệu Bán hàng, không lọc theo người phụ trách. */
export function crmSeesEverything(actor: CrmActor): boolean {
  return actor.isTenantAdmin || actor.canManage || actor.canReadAll;
}
