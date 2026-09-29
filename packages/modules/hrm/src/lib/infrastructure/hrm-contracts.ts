import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  CreateEmploymentContractRequest,
  HrmEmploymentContract,
} from '@enterprise-platform/contracts-hrm';
import { isoDate, lockEmployee } from './hrm-time.js';
import { requireDate, requireText, requireUuid } from './hrm-validation.js';
import { lifecycleAudit, timestamp } from './hrm-lifecycle.js';

export function mapContract(row: Record<string, any>): HrmEmploymentContract {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    employeeId: row.employee_id,
    contractCode: row.contract_code,
    contractType: row.contract_type,
    signDate: row.sign_date ? isoDate(row.sign_date) : null,
    effectiveFrom: isoDate(row.effective_from),
    effectiveTo: row.effective_to ? isoDate(row.effective_to) : null,
    status: row.status,
    baseSalary: row.base_salary == null ? null : Number(row.base_salary),
    note: row.note,
    fileUrl: row.file_url,
    parentContractId: row.parent_contract_id || null,
    issuedSnapshot: row.issued_snapshot || null,
    terminatedOn: row.terminated_on ? isoDate(row.terminated_on) : null,
    terminationReason: row.termination_reason || null,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}
export const contractColumns: Record<string, string> = {
  contractCode: 'contract_code',
  contractType: 'contract_type',
  signDate: 'sign_date',
  effectiveFrom: 'effective_from',
  effectiveTo: 'effective_to',
  baseSalary: 'base_salary',
  note: 'note',
  fileUrl: 'file_url',
};
export function contractInput(body: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(contractColumns)
      .filter(([k]) => body[k] !== undefined)
      .map(([k, v]) => [v, body[k]]),
  );
}
export function validateContract(row: Record<string, any>) {
  requireText(row.contract_code, 'Số hợp đồng', 100);
  requireText(row.contract_type, 'Loại hợp đồng', 100);
  const from = requireDate(isoDate(row.effective_from), 'Ngày hiệu lực');
  if (
    row.effective_to &&
    requireDate(isoDate(row.effective_to), 'Ngày hết hạn') < from
  )
    throw new BadRequestException('Ngày hết hạn phải từ ngày hiệu lực');
  if (row.sign_date) requireDate(isoDate(row.sign_date), 'Ngày ký');
  if (
    row.base_salary != null &&
    ((typeof row.base_salary !== 'number' &&
      typeof row.base_salary !== 'string') ||
      !Number.isFinite(Number(row.base_salary)) ||
      Number(row.base_salary) < 0)
  )
    throw new BadRequestException('Mức lương phải là số không âm');
  if (
    row.file_url != null &&
    (typeof row.file_url !== 'string' ||
      !/^(\/[^/]|https?:\/\/)/.test(row.file_url))
  )
    throw new BadRequestException(
      'Đường dẫn chứng từ phải là đường dẫn nội bộ hoặc HTTP(S)',
    );
}
export async function insertContract(
  db: PoolClient,
  tenantId: string,
  employeeId: string,
  actorId: string,
  body: CreateEmploymentContractRequest,
  parentId?: string,
) {
  requireUuid(employeeId, 'Nhân viên');
  if (body.status !== undefined && body.status !== 'DRAFT')
    throw new BadRequestException(
      'Hợp đồng mới phải ở trạng thái nháp; dùng thao tác ban hành riêng',
    );
  const input = contractInput(body as unknown as Record<string, unknown>);
  validateContract(input);
  await lockEmployee(db, tenantId, employeeId);
  const result = await db.query(
    `INSERT INTO hrm_schema.employment_contracts(tenant_id,employee_id,contract_code,contract_type,sign_date,effective_from,effective_to,status,base_salary,note,file_url,created_by${parentId ? ',parent_contract_id' : ''})
    VALUES($1,$2,$3,$4,$5,$6,$7,'DRAFT',$8,$9,$10,$11${parentId ? ',$12' : ''}) ON CONFLICT DO NOTHING RETURNING *`,
    [
      tenantId,
      employeeId,
      body.contractCode.trim(),
      body.contractType.trim(),
      body.signDate || null,
      body.effectiveFrom,
      body.effectiveTo || null,
      body.baseSalary ?? null,
      body.note || null,
      body.fileUrl || null,
      actorId,
      ...(parentId ? [parentId] : []),
    ],
  );
  if (!result.rowCount) throw new ConflictException('Số hợp đồng đã tồn tại');
  await lifecycleAudit(
    db,
    tenantId,
    actorId,
    'CONTRACT_DRAFT_CREATED',
    result.rows[0].id,
    { employeeId, parentContractId: parentId || null },
  );
  return result.rows[0];
}
/** Obtain the employee lock before row locks to serialize issue/amend/terminate. */
export async function contractEmployee(
  db: PoolClient,
  tenantId: string,
  id: string,
) {
  requireUuid(id, 'Hợp đồng');
  const row = (
    await db.query(
      'SELECT employee_id FROM hrm_schema.employment_contracts WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL',
      [tenantId, id],
    )
  ).rows[0];
  if (!row) throw new NotFoundException('Không tìm thấy hợp đồng');
  await lockEmployee(db, tenantId, row.employee_id);
  return row.employee_id as string;
}
