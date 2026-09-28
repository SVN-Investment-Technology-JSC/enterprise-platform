import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  HrmRequestKind,
  HrmProcedureLink,
  HrmSubmission,
  HrmSyncStatus,
} from '@enterprise-platform/contracts-hrm';
import { requireUuid, requireText } from './hrm-validation.js';

export const HRM_REQUEST_TABLES: Readonly<Record<HrmRequestKind, string>> = {
  leave: 'leave_requests',
  ot: 'ot_requests',
  business_trip: 'business_trip_requests',
  shift_change: 'shift_change_requests',
  correction: 'attendance_corrections',
  advance: 'salary_advance_requests',
  profile_correction: 'profile_corrections',
};
const aliases: Readonly<Record<string, HrmRequestKind>> = {
  LEAVE: 'leave',
  OT: 'ot',
  BUSINESS_TRIP: 'business_trip',
  SHIFT_CHANGE: 'shift_change',
  ATTENDANCE: 'correction',
  ADVANCE: 'advance',
  PROFILE: 'profile_correction',
};
export function normalizeHrmRequestKind(kind: string): HrmRequestKind {
  const canonical = Object.hasOwn(aliases, kind) ? aliases[kind] : kind;
  if (!Object.hasOwn(HRM_REQUEST_TABLES, canonical))
    throw new BadRequestException('Loại đơn không hợp lệ');
  return canonical as HrmRequestKind;
}
export function mapHrmProcedureLink(
  row: Record<string, unknown>,
): HrmProcedureLink {
  return {
    id: row.id as string,
    ref: {
      tenantId: row.tenant_id as string,
      kind: row.request_kind as HrmRequestKind,
      requestId: row.request_id as string,
      revision: Number(row.revision),
    },
    instanceId: (row.instance_id as string | null) ?? null,
    syncStatus: row.sync_status as HrmSyncStatus,
  };
}

export async function saveHrmProcedureBinding(
  db: PoolClient,
  input: {
    tenantId: string;
    kind: string;
    subTypeCode?: string;
    mode: 'DIRECT' | 'PROCEDURE';
    definitionId?: string;
    actorId: string;
  },
) {
  const kind = normalizeHrmRequestKind(input.kind);
  if (!['DIRECT', 'PROCEDURE'].includes(input.mode))
    throw new BadRequestException('Chế độ duyệt không hợp lệ');
  const subtype = input.subTypeCode?.trim() || null;
  if (subtype && subtype.length > 50)
    throw new BadRequestException('Mã loại con quá dài');
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
    `hrm-binding:${input.tenantId}:${kind}`,
  ]);
  if (input.mode === 'PROCEDURE') {
    requireUuid(input.definitionId, 'Quy trình');
    const definition = await db.query(
      `SELECT id FROM procedure_schema.definitions WHERE id=$1 AND status='published' AND current_version_id IS NOT NULL FOR SHARE`,
      [input.definitionId],
    );
    if (!definition.rowCount)
      throw new ConflictException('Quy trình chưa có phiên bản công bố');
  }
  const old = (
    await db.query(
      `SELECT * FROM hrm_schema.request_procedure_bindings WHERE tenant_id=$1 AND request_kind=$2 AND sub_type_code IS NOT DISTINCT FROM $3 ORDER BY created_at,id FOR UPDATE`,
      [input.tenantId, kind, subtype],
    )
  ).rows;
  const id = old[0]?.id ?? randomUUID();
  await db.query(
    `UPDATE hrm_schema.request_procedure_bindings SET is_active=false,updated_at=now(),updated_by=$4
    WHERE tenant_id=$1 AND request_kind=$2 AND sub_type_code IS NOT DISTINCT FROM $3 AND id<>$5`,
    [input.tenantId, kind, subtype, input.actorId, id],
  );
  const row = (
    await db.query(
      `INSERT INTO hrm_schema.request_procedure_bindings(id,tenant_id,request_kind,sub_type_code,mode,procedure_definition_id,updated_by)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET mode=$5,procedure_definition_id=$6,updated_by=$7,
      is_active=true,configuration_status='ACTIVE',updated_at=now() RETURNING *`,
      [
        id,
        input.tenantId,
        kind,
        subtype,
        input.mode,
        input.mode === 'PROCEDURE' ? input.definitionId : null,
        input.actorId,
      ],
    )
  ).rows[0];
  await db.query(
    `INSERT INTO hrm_schema.audit_log(tenant_id,actor_id,action,entity_type,entity_id,detail)
    VALUES($1,$2,'PROCEDURE_BINDING_CONFIGURED','request_procedure_binding',$3,$4)`,
    [
      input.tenantId,
      input.actorId,
      id,
      JSON.stringify({ before: old, after: row }),
    ],
  );
  return row;
}

/** Called inside the request transaction; the HTTP start occurs only after commit. */
export async function prepareHrmProcedureLink(
  db: PoolClient,
  input: HrmSubmission,
): Promise<HrmProcedureLink | null> {
  const kind = normalizeHrmRequestKind(input.kind);
  requireUuid(input.tenantId, 'Tenant');
  requireUuid(input.requestId, 'Đơn');
  requireUuid(input.employeeId, 'Nhân viên');
  requireUuid(input.initiatedBy, 'Người gửi');
  requireText(input.title, 'Tiêu đề', 255);
  if (!Number.isSafeInteger(input.revision) || input.revision < 1)
    throw new BadRequestException('Lần gửi không hợp lệ');
  const request = (
    await db.query(
      `SELECT * FROM hrm_schema.${HRM_REQUEST_TABLES[kind]} WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      [input.tenantId, input.requestId],
    )
  ).rows[0];
  if (!request || request.employee_id !== input.employeeId)
    throw new NotFoundException(
      'Không tìm thấy đơn của nhân viên trong tenant',
    );
  if (Number(request.revision ?? 1) !== input.revision)
    throw new ConflictException('Lần gửi đơn đã thay đổi; vui lòng tải lại');
  const existing = (
    await db.query(
      `SELECT * FROM hrm_schema.procedure_links WHERE tenant_id=$1 AND request_kind=$2 AND request_id=$3 AND revision=$4`,
      [input.tenantId, kind, input.requestId, input.revision],
    )
  ).rows[0];
  if (existing) {
    if (existing.sync_status === 'CONFLICT')
      throw new ConflictException(
        'Liên kết Procedure xung đột; cần đối soát trước khi xử lý',
      );
    return mapHrmProcedureLink(existing);
  }
  if (!['PENDING', 'PEER_CONFIRMED'].includes(request.status))
    throw new ConflictException('Chỉ gửi quy trình cho đơn đang chờ duyệt');
  if (
    kind === 'shift_change' &&
    request.swap_with_employee_id &&
    !request.swap_peer_confirmed
  )
    throw new ConflictException(
      'Đổi ca cần đồng nghiệp xác nhận trước khi gửi quy trình',
    );
  // Serialize with configuration writers, including insertion of a new default.
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
    `hrm-binding:${input.tenantId}:${kind}`,
  ]);
  const candidates = (
    await db.query(
      `SELECT * FROM hrm_schema.request_procedure_bindings
    WHERE tenant_id=$1 AND request_kind=$2 AND is_active AND (sub_type_code IS NULL OR sub_type_code=$3) FOR SHARE`,
      [input.tenantId, kind, input.subTypeCode || null],
    )
  ).rows;
  const specific = candidates.filter(
    (row) => row.sub_type_code === input.subTypeCode,
  );
  const selected = specific.length
    ? specific
    : candidates.filter((row) => row.sub_type_code == null);
  if (!selected.length)
    throw new ConflictException('Chưa cấu hình chế độ duyệt cho loại đơn');
  const binding = selected[0];
  if (
    selected.some(
      (row) =>
        row.configuration_status === 'CONFLICT' ||
        row.mode !== binding.mode ||
        row.procedure_definition_id !== binding.procedure_definition_id,
    )
  )
    throw new ConflictException(
      'Cấu hình quy trình xung đột; quản trị viên cần chọn một cấu hình',
    );
  if (binding.mode === 'DIRECT') return null;
  if (!binding.procedure_definition_id)
    throw new ConflictException('Chưa cấu hình quy trình được công bố');
  const definition = (
    await db.query(
      `SELECT d.id,d.current_version_id,v.snapshot FROM procedure_schema.definitions d JOIN procedure_schema.versions v ON v.id=d.current_version_id WHERE d.id=$1 AND d.status='published' FOR SHARE`,
      [binding.procedure_definition_id],
    )
  ).rows[0];
  if (!definition?.current_version_id)
    throw new ConflictException('Quy trình chưa có phiên bản công bố');
  const id = randomUUID();
  const attributes = input.attributes ?? {};
  if (
    typeof attributes !== 'object' ||
    Array.isArray(attributes) ||
    JSON.stringify(attributes).length > 100_000
  )
    throw new BadRequestException(
      'Thuộc tính biểu mẫu không hợp lệ hoặc quá lớn',
    );
  const row = (
    await db.query(
      `INSERT INTO hrm_schema.procedure_links
    (id,tenant_id,request_kind,request_id,revision,employee_id,initiated_by,title,attributes,binding_id,definition_id,definition_version_id,source_id,start_idempotency_key,definition_snapshot)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$1,$13,$14) RETURNING *`,
      [
        id,
        input.tenantId,
        kind,
        input.requestId,
        input.revision,
        input.employeeId,
        input.initiatedBy,
        input.title,
        JSON.stringify(attributes),
        binding.id,
        definition.id,
        definition.current_version_id,
        `hrm:${input.tenantId}:${kind}:${input.requestId}:${input.revision}`,
        JSON.stringify(definition.snapshot),
      ],
    )
  ).rows[0];
  return mapHrmProcedureLink(row);
}
