import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import type {
  CreateEmployeeDependentRequest,
  UpdateEmployeeDependentRequest,
} from '@enterprise-platform/contracts-hrm';
import { hrmTransaction } from './hrm-transaction.js';
import { lockEmployee, isoDate } from './hrm-time.js';
import {
  lockLifecycleRow,
  updateLifecycleRow,
  lifecycleAudit,
} from './hrm-lifecycle.js';
import { requireDate, requireText, requireUuid } from './hrm-validation.js';

const columns: Record<string, string> = {
  fullName: 'full_name',
  relationship: 'relationship',
  dateOfBirth: 'date_of_birth',
  phone: 'phone',
  identityCardNumber: 'identity_card_number',
  taxCode: 'tax_code',
  isDependent: 'is_dependent',
  dependentFrom: 'dependent_from',
  dependentTo: 'dependent_to',
  note: 'note',
};
function validate(input: Record<string, unknown>) {
  requireText(input.full_name, 'Họ tên', 200);
  requireText(input.relationship, 'Quan hệ', 100);
  for (const field of ['date_of_birth', 'dependent_from', 'dependent_to'])
    if (input[field] != null) requireDate(input[field], field);
  if (
    input.date_of_birth &&
    String(input.date_of_birth) > new Date().toISOString().slice(0, 10)
  )
    throw new BadRequestException('Ngày sinh không được sau hôm nay');
  if (
    input.dependent_from &&
    input.dependent_to &&
    String(input.dependent_from) > String(input.dependent_to)
  )
    throw new BadRequestException('Khoảng thời gian khai báo không hợp lệ');
  if (
    input.is_dependent !== undefined &&
    typeof input.is_dependent !== 'boolean'
  )
    throw new BadRequestException('isDependent phải là boolean');
}
function changes(body: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(columns)
      .filter(([key]) => body[key] !== undefined)
      .map(([key, col]) => [col, body[key]]),
  );
}
export async function createFamily(
  pool: Pool,
  tenantId: string,
  employeeId: string,
  actorId: string,
  body: CreateEmployeeDependentRequest,
) {
  requireUuid(employeeId, 'Nhân viên');
  const input = changes(body as unknown as Record<string, unknown>);
  validate(input);
  return hrmTransaction(pool, async (db) => {
    await lockEmployee(db, tenantId, employeeId);
    const entries = Object.entries(input);
    const row = (
      await db.query(
        `INSERT INTO hrm_schema.employee_family_members(tenant_id,employee_id,created_by,${entries.map(([k]) => k).join(',')}) VALUES($1,$2,$3,${entries.map((_, i) => '$' + (i + 4)).join(',')}) RETURNING *`,
        [tenantId, employeeId, actorId, ...entries.map(([, v]) => v)],
      )
    ).rows[0];
    await lifecycleAudit(db, tenantId, actorId, 'FAMILY_DECLARED', row.id, {
      employeeId,
    });
    return row;
  });
}
async function owned(
  db: PoolClient,
  tenantId: string,
  employeeId: string,
  id: string,
  version: unknown,
) {
  requireUuid(id, 'Người thân');
  const owner = await db.query(
    'SELECT 1 FROM hrm_schema.employee_family_members WHERE tenant_id=$1 AND employee_id=$2 AND id=$3 AND deleted_at IS NULL',
    [tenantId, employeeId, id],
  );
  if (!owner.rowCount)
    throw new NotFoundException('Không tìm thấy người thân thuộc nhân viên');
  return lockLifecycleRow(db, 'employee_family_members', tenantId, id, version);
}
export async function updateFamily(
  pool: Pool,
  tenantId: string,
  employeeId: string,
  actorId: string,
  id: string,
  body: UpdateEmployeeDependentRequest,
) {
  return hrmTransaction(pool, async (db) => {
    await lockEmployee(db, tenantId, employeeId);
    const before = await owned(
      db,
      tenantId,
      employeeId,
      id,
      body.expectedUpdatedAt,
    );
    const input = changes(body as Record<string, unknown>);
    const next = { ...before, ...input };
    for (const col of ['date_of_birth', 'dependent_from', 'dependent_to'])
      if (next[col]) next[col] = isoDate(next[col]);
    validate(next);
    const row = await updateLifecycleRow(
      db,
      'employee_family_members',
      tenantId,
      id,
      { ...input, updated_by: actorId },
    );
    await lifecycleAudit(db, tenantId, actorId, 'FAMILY_UPDATED', id, {
      employeeId,
      fields: Object.keys(input),
    });
    return row;
  });
}
export async function deleteFamily(
  pool: Pool,
  tenantId: string,
  employeeId: string,
  actorId: string,
  id: string,
  version: unknown,
) {
  return hrmTransaction(pool, async (db) => {
    await lockEmployee(db, tenantId, employeeId);
    await owned(db, tenantId, employeeId, id, version);
    await updateLifecycleRow(db, 'employee_family_members', tenantId, id, {
      deleted_at: new Date(),
      deleted_by: actorId,
      updated_by: actorId,
    });
    await lifecycleAudit(db, tenantId, actorId, 'FAMILY_DELETED', id, {
      employeeId,
    });
  });
}
