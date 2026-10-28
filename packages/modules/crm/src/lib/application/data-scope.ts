import { computeSubordinateUserIds } from '../domain/reporting-line.js';
import { crmSeesEverything, type CrmActor } from './crm-actor.js';
import type { ReportingLineReader } from './organization-scope.port.js';

/**
 * Phạm vi dữ liệu của một người ở Bán hàng (mục 6.3 kế hoạch):
 *
 * - `all`: `crm.read.all`, `crm.manage` hoặc quản trị tenant — không lọc.
 * - `users`: chính mình cộng cấp dưới theo chuỗi "Báo cáo cho" ở Tenant Core.
 *   Người không có cấp dưới thì danh sách chỉ có chính mình ("của tôi").
 *
 * Lọc theo `owner_user_id` (người phụ trách) ở tầng store, xem
 * `ownerScopeSql`. Đối tượng ngoài phạm vi trả 404 như không có.
 */
export type CrmDataScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'users'; readonly userIds: readonly string[] };

export class CrmDataScopeService {
  constructor(private readonly reportingLines: ReportingLineReader) {}

  /**
   * Phạm vi của actor. Tenant Core lỗi và chưa có bản đã biết thì để
   * `CrmOrganizationUnavailableError` (503) đi ra: không mở rộng phạm vi.
   */
  async resolve(actor: CrmActor): Promise<CrmDataScope> {
    if (crmSeesEverything(actor)) return { kind: 'all' };
    const snapshot = await this.reportingLines.snapshot(actor.tenantId);
    const subordinates = computeSubordinateUserIds(snapshot, actor.userId);
    return { kind: 'users', userIds: [actor.userId, ...[...subordinates].sort()] };
  }
}

/** Người phụ trách `ownerUserId` có nằm trong phạm vi không (kiểm một bản ghi đã đọc). */
export function scopeIncludes(scope: CrmDataScope, ownerUserId: string | null | undefined): boolean {
  if (scope.kind === 'all') return true;
  return !!ownerUserId && scope.userIds.includes(ownerUserId);
}
