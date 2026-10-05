import { BadRequestException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { loadAllowSelfApproval } from './hrm-approval-policy.js';
import { requireText } from './hrm-validation.js';

type Queryable = Pick<PoolClient, 'query'>;

export interface ApprovalPolicySettings {
  allowSelfApproval: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

/** Cài đặt hiện tại; chưa có dòng hoặc chưa migrate = mặc định tắt. */
export async function loadApprovalPolicySettings(
  db: Queryable,
  tenantId: string,
): Promise<ApprovalPolicySettings> {
  const ready = await db.query(
    `SELECT to_regclass('hrm_schema.approval_policy_settings') IS NOT NULL AS ready`,
  );
  if (ready.rows[0]?.ready !== true)
    return { allowSelfApproval: false, updatedBy: null, updatedAt: null };
  const row = (
    await db.query(
      `SELECT allow_self_approval, updated_by, updated_at
         FROM hrm_schema.approval_policy_settings WHERE tenant_id=$1`,
      [tenantId],
    )
  ).rows[0];
  return {
    allowSelfApproval: row?.allow_self_approval === true,
    updatedBy: row?.updated_by ?? null,
    updatedAt: row?.updated_at
      ? new Date(row.updated_at).toISOString()
      : null,
  };
}

export function parseApprovalPolicyInput(body: unknown): {
  allowSelfApproval: boolean;
  reason: string;
} {
  const input = (body ?? {}) as Record<string, unknown>;
  if (typeof input['allowSelfApproval'] !== 'boolean')
    throw new BadRequestException({
      code: 'HRM_INVALID_INPUT',
      message: 'allowSelfApproval: cần là true hoặc false',
    });
  const reason = requireText(input['reason'], 'Lý do', 500).trim();
  if (reason.length < 10)
    throw new BadRequestException({
      code: 'HRM_INVALID_INPUT',
      message: 'Lý do: cần nhập tối thiểu 10 ký tự',
    });
  return { allowSelfApproval: input['allowSelfApproval'], reason };
}

/**
 * Lưu ngoại lệ tự duyệt và ghi audit APPROVAL_POLICY_CHANGED (trong cùng giao dịch của `db`).
 * Chính sách đọc trực tiếp từ DB ở mỗi lần duyệt (không có cache) nên có hiệu lực ngay.
 */
export async function saveApprovalPolicySettings(
  db: Queryable,
  tenantId: string,
  actorId: string,
  body: unknown,
): Promise<ApprovalPolicySettings & { changed: boolean }> {
  const input = parseApprovalPolicyInput(body);
  const previous = await loadAllowSelfApproval(db, tenantId);
  await db.query(
    `INSERT INTO hrm_schema.approval_policy_settings(tenant_id,allow_self_approval,updated_by,updated_at)
     VALUES($1,$2,$3,now())
     ON CONFLICT (tenant_id) DO UPDATE
       SET allow_self_approval=EXCLUDED.allow_self_approval, updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [tenantId, input.allowSelfApproval, actorId],
  );
  await db.query(
    `INSERT INTO hrm_schema.audit_log(tenant_id,actor_id,action,entity_type,entity_id,detail)
     VALUES($1,$2,'APPROVAL_POLICY_CHANGED','approval_policy_settings',$1,$3)`,
    [
      tenantId,
      actorId,
      JSON.stringify({
        setting: 'allow_self_approval',
        previous,
        current: input.allowSelfApproval,
        reason: input.reason,
      }),
    ],
  );
  return {
    ...(await loadApprovalPolicySettings(db, tenantId)),
    changed: previous !== input.allowSelfApproval,
  };
}
