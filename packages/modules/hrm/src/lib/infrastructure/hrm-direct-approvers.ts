import type { HrmRequestKind } from '@enterprise-platform/contracts-hrm';
import type { PoolClient } from 'pg';
import { findChiefs, loadOrgFacts, type OrgFacts } from './hrm-chief-fallback.js';
import { resolveDirectFallbackPosition } from './hrm-approval-policy.js';

type Queryable = Pick<PoolClient, 'query'>;

const MAX_CHAIN = 50;

/**
 * Quản lý trực tiếp của nhân viên: người đang làm việc giữ chức danh đầu tiên còn người trên chuỗi "Báo cáo cho"
 * (cùng quy tắc với `hasCoreManager`). Không có ai thì Tổng giám đốc (không phải chính nhân viên) duyệt thay.
 */
export function managerUserIdsOf(facts: OrgFacts, employeeId: string): string[] {
  const reportsTo = new Map(facts.positions.map((p) => [p.id, p.reportsToId]));
  const holdersOf = new Map<string, OrgFacts['holders']>();
  for (const holder of facts.holders)
    holdersOf.set(holder.positionId, [...(holdersOf.get(holder.positionId) ?? []), holder]);
  const found = new Set<string>();
  for (const own of facts.holders.filter((h) => h.employeeId === employeeId)) {
    const seen = new Set<string>([own.positionId]);
    let cursor = own.overrideId ?? reportsTo.get(own.positionId) ?? null;
    for (let level = 0; cursor && !seen.has(cursor) && level < MAX_CHAIN; level += 1) {
      const eligible = (holdersOf.get(cursor) ?? []).filter((h) => h.employeeId !== employeeId && !h.inactive);
      if (eligible.length) {
        for (const holder of eligible) found.add(holder.userId);
        break;
      }
      seen.add(cursor);
      cursor = reportsTo.get(cursor) ?? null;
    }
  }
  if (found.size) return [...found];
  return findChiefs(facts)
    .filter((chief) => chief.employeeId !== employeeId)
    .map((chief) => chief.userId);
}

/** Người đang giữ chức danh duyệt dự phòng (không tính chủ đơn). */
export function fallbackHolderUserIds(facts: OrgFacts, positionId: string | null, employeeId: string): string[] {
  if (!positionId) return [];
  return facts.holders
    .filter((h) => h.positionId === positionId && h.employeeId !== employeeId && !h.inactive)
    .map((h) => h.userId);
}

/**
 * Những người được giao duyệt một đơn DIRECT theo tổ chức: quản lý trực tiếp và người giữ chức danh dự phòng. Họ có thể
 * không giữ quyền duyệt HRM nên không được tính theo quyền; thông báo cần gửi thẳng cho họ. Chỉ bổ sung người nhận,
 * nên lỗi đọc tổ chức trả về rỗng và thông báo theo quyền vẫn đi như cũ.
 */
export async function directApproverUserIds(
  db: Queryable,
  tenantId: string,
  kind: HrmRequestKind,
  requestId: string,
  employeeId: string,
): Promise<string[]> {
  try {
    const [facts, fallbackPositionId] = await Promise.all([
      loadOrgFacts(db, tenantId),
      resolveDirectFallbackPosition(db, tenantId, kind, requestId),
    ]);
    return [
      ...new Set([
        ...managerUserIdsOf(facts, employeeId),
        ...fallbackHolderUserIds(facts, fallbackPositionId, employeeId),
      ]),
    ];
  } catch {
    return [];
  }
}
