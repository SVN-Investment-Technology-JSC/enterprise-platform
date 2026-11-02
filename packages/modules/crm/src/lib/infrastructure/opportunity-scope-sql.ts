import type { CrmDataScope } from '../application/data-scope.js';
import { ownerScopeSql, type ScopeSqlFragment } from './owner-scope-sql.js';

const COLUMN_PATTERN = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/;

/**
 * Điều kiện phạm vi cho một đối tượng gắn với cơ hội (chính cơ hội, báo giá, tài liệu của cơ hội): thuộc
 * phạm vi theo người phụ trách (`ownerColumn`) HOẶC cơ hội (`opportunityColumn`) có giai đoạn ACTIVE hoặc
 * PENDING giao cho chính người gọi (ASG-02). Người được gán chỉ thấy cơ hội được giao, không thấy cơ hội
 * khác của cùng khách: bộ lọc nằm trên cơ hội, không mở rộng theo khách.
 *
 * Tìm bằng index `ix_crm_opportunity_stage_plan_assignee (assignee_user_id, opportunity_id)`. Phạm vi
 * `all` hay không có `selfUserId` thì chỉ còn điều kiện theo người phụ trách.
 */
export function opportunityScopeSql(
  scope: CrmDataScope,
  ownerColumn: string,
  opportunityColumn: string,
  firstParam: number,
): ScopeSqlFragment {
  const owner = ownerScopeSql(scope, ownerColumn, firstParam);
  if (scope.kind === 'all' || !scope.selfUserId) return owner;
  if (!COLUMN_PATTERN.test(opportunityColumn)) throw new Error(`Invalid scope column: "${opportunityColumn}".`);
  const self = `$${firstParam + owner.params.length}`;
  return {
    sql: `(${owner.sql} OR EXISTS (
        SELECT 1 FROM crm_schema.opportunity_stage_plan sp
         WHERE sp.opportunity_id = ${opportunityColumn}
           AND sp.assignee_user_id = ${self}::uuid
           AND sp.status IN ('ACTIVE', 'PENDING')))`,
    params: [...owner.params, scope.selfUserId],
  };
}
