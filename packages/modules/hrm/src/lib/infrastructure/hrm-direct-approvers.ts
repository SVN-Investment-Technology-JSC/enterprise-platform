import type { HrmRequestKind } from '@enterprise-platform/contracts-hrm';
import type { PoolClient } from 'pg';
import { loadOrgFacts, positionHolderUserIds, superiorUserIdsOf } from './hrm-chief-fallback.js';
import { fallbackHolderUserIds, managerUserIdsOf } from './hrm-chief-fallback.js';
import { resolveDirectBinding } from './hrm-approval-policy.js';
import { loadRequestTimeRule } from './hrm-request-time-rules.js';

export { fallbackHolderUserIds, managerUserIdsOf } from './hrm-chief-fallback.js';

type Queryable = Pick<PoolClient, 'query'>;

export interface ApprovalAudience {
  /** Người được giao duyệt theo cấu hình (quản lý trực tiếp hoặc chức danh chỉ định, cộng dự phòng); duyệt không cần quyền. */
  readonly assigned: string[];
  /** Mọi cấp trên của chủ đơn; chỉ duyệt được nếu giữ `hrm.request.approve`, nên người nhận là phần giao với người giữ quyền. */
  readonly superiors: string[];
}

/**
 * Những người được giao duyệt một đơn DIRECT theo tổ chức, theo nguồn người duyệt của cấu hình:
 * DIRECT_MANAGER là quản lý trực tiếp, POSITION là người giữ chức danh được chỉ định; cộng người giữ chức danh dự phòng
 * (nếu có). Họ có thể không giữ quyền duyệt HRM nên không được tính theo quyền; thông báo cần gửi thẳng cho họ. Kèm theo
 * mọi cấp trên của chủ đơn để thông báo chỉ báo cho người giữ quyền duyệt có đơn nằm trong phạm vi cấp dưới của họ. Chỉ bổ
 * sung người nhận, nên lỗi đọc tổ chức trả về rỗng và thông báo theo quyền toàn tenant vẫn đi như cũ.
 */
export async function approvalAudienceOf(
  db: Queryable,
  tenantId: string,
  kind: HrmRequestKind,
  requestId: string,
  employeeId: string,
): Promise<ApprovalAudience> {
  try {
    const [facts, binding, timeRule] = await Promise.all([
      loadOrgFacts(db, tenantId),
      resolveDirectBinding(db, tenantId, kind, requestId),
      loadRequestTimeRule(db, tenantId, kind),
    ]);
    if (!binding) return { assigned: [], superiors: superiorUserIdsOf(facts, employeeId) };
    const primary =
      binding.source === 'POSITION'
        ? positionHolderUserIds(facts, binding.approverPositionId, employeeId)
        : managerUserIdsOf(facts, employeeId);
    return {
      // Đặt chuyển dự phòng sau N ngày thì lúc tạo đơn chưa báo cho người dự phòng (họ chưa được xử lý).
      assigned: [
        ...new Set([
          ...primary,
          ...(timeRule.escalateAfterDays === null ? fallbackHolderUserIds(facts, binding.fallbackPositionId, employeeId) : []),
        ]),
      ],
      // Chỉ định chức danh thì cấp trên giữ quyền duyệt bị loại khỏi danh sách và không duyệt được (xem `positionExcluded`),
      // nên cũng không báo cho họ.
      superiors: binding.source === 'POSITION' ? [] : superiorUserIdsOf(facts, employeeId),
    };
  } catch {
    return { assigned: [], superiors: [] };
  }
}

export async function directApproverUserIds(
  db: Queryable,
  tenantId: string,
  kind: HrmRequestKind,
  requestId: string,
  employeeId: string,
): Promise<string[]> {
  return (await approvalAudienceOf(db, tenantId, kind, requestId, employeeId)).assigned;
}
