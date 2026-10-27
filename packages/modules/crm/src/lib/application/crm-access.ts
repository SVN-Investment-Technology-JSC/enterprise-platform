import { CrmForbiddenError, CrmValidationError } from '../domain/crm.error.js';
import type { CrmActor } from './crm-actor.js';
import type { CrmDataScope } from './data-scope.js';

/**
 * Kiểm quyền theo thao tác ở tầng application. Guard chỉ bảo đảm `crm.read`;
 * cờ ở đây đã gồm quản trị tenant (guard tính sẵn).
 */

/** Ghi khách hàng, lead, cơ hội, hoạt động: `crm.opportunity.write`. */
export function requireSalesWriter(actor: CrmActor): void {
  if (!actor.canWriteOpportunity) {
    throw new CrmForbiddenError('Bạn không có quyền quản lý khách hàng, cơ hội.');
  }
}

/** Nhóm khách, cấu hình phân hệ: `crm.manage`. */
export function requireSalesManager(actor: CrmActor): void {
  if (!actor.canManage) {
    throw new CrmForbiddenError('Chỉ quản trị bán hàng mới được thay đổi cấu hình này.');
  }
}

/**
 * Người phụ trách mới phải nằm trong phạm vi của người giao: nhân viên chỉ giao
 * cho chính mình, trưởng nhóm giao cho mình hoặc cấp dưới. Giao ra ngoài phạm
 * vi thì chính người giao mất quyền thấy bản ghi, nên chặn.
 */
export function assertOwnerInScope(scope: CrmDataScope, ownerUserId: string): void {
  if (scope.kind === 'all') return;
  if (!scope.userIds.includes(ownerUserId)) {
    throw new CrmValidationError('OWNER_OUT_OF_SCOPE', 'Chỉ giao được cho bạn hoặc cấp dưới của bạn.');
  }
}
