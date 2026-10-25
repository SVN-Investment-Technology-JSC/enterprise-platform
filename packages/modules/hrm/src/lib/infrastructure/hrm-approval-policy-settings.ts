import { BadRequestException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { loadAllowSelfApproval } from './hrm-approval-policy.js';
import { requireText, requireUuid } from './hrm-validation.js';

type Queryable = Pick<PoolClient, 'query'>;

export interface ApprovalPolicySettings {
  allowSelfApproval: boolean;
  /** Chức danh dự phòng cuối nhận đơn của nhân viên không có "Báo cáo cho"; null = không dùng. */
  lastResortPositionId: string | null;
  lastResortPositionName: string | null;
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
    return {
      allowSelfApproval: false,
      lastResortPositionId: null,
      lastResortPositionName: null,
      updatedBy: null,
      updatedAt: null,
    };
  const hasLastResort =
    (
      await db.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_schema='hrm_schema' AND table_name='approval_policy_settings'
            AND column_name='last_resort_position_id'`,
      )
    ).rows.length > 0;
  const row = (
    await db.query(
      `SELECT s.allow_self_approval, s.updated_by, s.updated_at,
              ${hasLastResort ? 's.last_resort_position_id' : 'NULL::uuid'} AS last_resort_position_id,
              ${hasLastResort ? 'n.name' : 'NULL::text'} AS last_resort_position_name
         FROM hrm_schema.approval_policy_settings s
         ${hasLastResort ? 'LEFT JOIN core_schema.organization_nodes n ON n.id = s.last_resort_position_id AND n.deleted_at IS NULL' : ''}
        WHERE s.tenant_id=$1`,
      [tenantId],
    )
  ).rows[0];
  return {
    allowSelfApproval: row?.allow_self_approval === true,
    lastResortPositionId: row?.last_resort_position_name ? (row?.last_resort_position_id ?? null) : null,
    lastResortPositionName: row?.last_resort_position_name ?? null,
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

/**
 * Chọn (hoặc bỏ chọn bằng null) chức danh dự phòng cuối. Người giữ chức danh này duyệt đơn của nhân viên không có
 * "Báo cáo cho"; bỏ chọn thì không còn bậc dự phòng cuối. Ghi audit APPROVAL_POLICY_CHANGED.
 */
export async function saveLastResortPosition(
  db: Queryable,
  tenantId: string,
  actorId: string,
  positionId: unknown,
): Promise<ApprovalPolicySettings> {
  const next = positionId === null || positionId === '' ? null : requireUuid(positionId, 'Chức danh dự phòng cuối');
  if (next) {
    const found = await db.query(
      `SELECT 1 FROM core_schema.organization_nodes WHERE id=$1 AND category='position' AND deleted_at IS NULL`,
      [next],
    );
    if (found.rows.length === 0)
      throw new BadRequestException({
        code: 'HRM_INVALID_INPUT',
        message: 'Chức danh dự phòng cuối: không tìm thấy chức danh',
      });
  }
  const previous = (await loadApprovalPolicySettings(db, tenantId)).lastResortPositionId;
  await db.query(
    `INSERT INTO hrm_schema.approval_policy_settings(tenant_id,last_resort_position_id,updated_by,updated_at)
     VALUES($1,$2,$3,now())
     ON CONFLICT (tenant_id) DO UPDATE
       SET last_resort_position_id=EXCLUDED.last_resort_position_id, updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [tenantId, next, actorId],
  );
  await db.query(
    `INSERT INTO hrm_schema.audit_log(tenant_id,actor_id,action,entity_type,entity_id,detail)
     VALUES($1,$2,'APPROVAL_POLICY_CHANGED','approval_policy_settings',$1,$3)`,
    [tenantId, actorId, JSON.stringify({ setting: 'last_resort_position_id', previous, current: next })],
  );
  return loadApprovalPolicySettings(db, tenantId);
}
