import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { requireUuid } from './hrm-validation.js';

export type LifecycleTable =
  | 'employee_profiles'
  | 'position_profiles'
  | 'salary_grades'
  | 'salary_grade_steps'
  | 'employee_family_members'
  | 'employment_contracts';
const keys: Record<LifecycleTable, string> = {
  employee_profiles: 'employee_id',
  position_profiles: 'position_id',
  salary_grades: 'id',
  salary_grade_steps: 'id',
  employee_family_members: 'id',
  employment_contracts: 'id',
};
export function timestamp(value: unknown): string {
  return new Date(
    value instanceof Date ? value.getTime() : String(value),
  ).toISOString();
}

/** Call inside the mutation transaction; the row lock and version check are indivisible. */
export async function lockLifecycleRow(
  db: PoolClient,
  table: LifecycleTable,
  tenantId: string,
  id: string,
  expectedUpdatedAt: unknown,
) {
  requireUuid(id, 'id');
  const result = await db.query(
    `SELECT * FROM hrm_schema.${table} WHERE tenant_id=$1 AND ${keys[table]}=$2 AND deleted_at IS NULL FOR UPDATE`,
    [tenantId, id],
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundException('Không tìm thấy bản ghi trong tenant');
  assertLifecycleVersion(row, expectedUpdatedAt);
  return row;
}

export function assertLifecycleVersion(
  row: { updated_at: unknown },
  expectedUpdatedAt: unknown,
) {
  if (
    typeof expectedUpdatedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T/.test(expectedUpdatedAt) ||
    !Number.isFinite(Date.parse(expectedUpdatedAt))
  ) {
    throw new BadRequestException('Cần expectedUpdatedAt từ bản ghi vừa tải');
  }
  if (timestamp(row.updated_at) !== timestamp(expectedUpdatedAt)) {
    throw new ConflictException({
      code: 'HRM_STALE_VERSION',
      message:
        'Dữ liệu đã được người khác thay đổi. Tải lại bản ghi trước khi lưu.',
    });
  }
}

/** Only controller-owned column names may be passed here, never request keys. */
export async function updateLifecycleRow(
  db: PoolClient,
  table: LifecycleTable,
  tenantId: string,
  id: string,
  changes: Record<string, unknown>,
) {
  const entries = Object.entries(changes).filter(
    ([, value]) => value !== undefined,
  );
  const assignments = entries.map(([key], i) => `${key}=$${i + 3}`);
  assignments.push(
    "updated_at=GREATEST(clock_timestamp(),updated_at + interval '1 millisecond')",
  );
  const result = await db.query(
    `UPDATE hrm_schema.${table} SET ${assignments.join(',')} WHERE tenant_id=$1 AND ${keys[table]}=$2 RETURNING *`,
    [tenantId, id, ...entries.map(([, value]) => value)],
  );
  return result.rows[0];
}

export async function lifecycleAudit(
  db: PoolClient,
  tenantId: string,
  actorId: string,
  action: string,
  id: string,
  detail: unknown,
) {
  await db.query(
    'INSERT INTO hrm_schema.audit_log (tenant_id,actor_id,action,entity_id,detail) VALUES ($1,$2,$3,$4,$5)',
    [tenantId, actorId, action, id, JSON.stringify(detail)],
  );
}
