import type { HrmRequestKind } from '@enterprise-platform/contracts-hrm';
import { loadOrgFacts, managerUserIdsOf } from './hrm-chief-fallback.js';
import { directBindingOf, loadBindingRows, loadDirectCandidates, type Queryable } from './hrm-approval-policy.js';

export interface PendingDirectApprover {
  requestId: string;
  employeeId: string;
  names: string[];
}

/**
 * Tên người duyệt của các đơn loại `kind` đang chờ duyệt trực tiếp (không qua Procedure Engine), theo đúng quy tắc
 * chọn người duyệt lúc gửi đơn: quản lý trực tiếp theo chuỗi "Báo cáo cho" (nguồn DIRECT_MANAGER) hoặc người giữ chức
 * danh được chỉ định (nguồn POSITION). Người giữ chức danh dự phòng không được liệt kê vì họ chỉ xử lý khi đơn chờ quá hạn.
 * Đơn không xác định được người duyệt thì không có trong kết quả.
 */
export async function pendingDirectApproverNames(
  db: Queryable,
  tenantId: string,
  kind: HrmRequestKind,
): Promise<PendingDirectApprover[]> {
  const result: PendingDirectApprover[] = [];
  const candidates = await loadDirectCandidates(db, tenantId, kind);
  if (!candidates.length) return result;
  const rows = await loadBindingRows(db, tenantId, kind);
  const facts = await loadOrgFacts(db, tenantId);
  const nameOfUser = new Map<string, string>();
  for (const holder of facts.holders) if (holder.name && !nameOfUser.has(holder.userId)) nameOfUser.set(holder.userId, holder.name);

  for (const row of candidates) {
    const binding = directBindingOf(rows, row.sub_type_code);
    if (!binding) continue;
    const userIds =
      binding.source === 'POSITION' && binding.approverPositionId
        ? facts.holders
            .filter((holder) => holder.positionId === binding.approverPositionId && !holder.inactive)
            .map((holder) => holder.userId)
        : managerUserIdsOf(facts, row.employee_id);
    const names = [...new Set(userIds.map((id) => nameOfUser.get(id)).filter((name): name is string => Boolean(name)))];
    if (names.length) result.push({ requestId: row.id, employeeId: row.employee_id, names });
  }
  return result;
}
