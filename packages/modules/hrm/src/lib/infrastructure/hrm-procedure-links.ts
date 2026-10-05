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
import {
  fetchPublishedProcedureDefinition,
  procedureStartStepWarnings,
} from './hrm-procedure-api.js';
import {
  collectUserReferences,
  initialProcedureAttributes,
  loadEmployeeUserMap,
  normalizeAttributesForProcedure,
} from './hrm-attribute-values.js';
import {
  applyFieldMappings,
  loadBindingMappings,
  resolveFieldValues,
  seedDefaultFieldMappings,
  type HrmEmployeeOrgPort,
} from './hrm-field-mappings.js';

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
  let warnings: string[] = [];
  if (input.mode === 'PROCEDURE') {
    requireUuid(input.definitionId, 'Quy trình');
    // Module không đọc DB của nhau: hỏi Procedure qua API nội bộ (service token).
    // PE tắt/không trả lời -> 409 PROCEDURE_UNAVAILABLE, không lưu binding PROCEDURE.
    const published = await fetchPublishedProcedureDefinition(
      input.tenantId,
      input.definitionId as string,
    );
    warnings = procedureStartStepWarnings(published);
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
  if (input.mode === 'PROCEDURE')
    await seedDefaultFieldMappings(db, input.tenantId, id, kind, input.actorId);
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
  // Cảnh báo cho quản trị (không chặn lưu): xem procedureStartStepWarnings.
  return warnings.length ? { ...row, warnings } : row;
}

/** Called inside the request transaction; the HTTP start occurs only after commit. */
export async function prepareHrmProcedureLink(
  db: PoolClient,
  input: HrmSubmission & {
    /** Dòng đơn đã kiểm tra: có thì thuộc tính được trộn theo ánh xạ trường của binding (FIX-E-05). */
    fieldRow?: Record<string, unknown>;
    fieldOrg?: HrmEmployeeOrgPort;
  },
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
  // Chưa có binding (tenant cũ chưa chạy migration seed): mặc định DIRECT, không chặn gửi đơn.
  if (!selected.length) return null;
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
  // Đọc định nghĩa đã công bố + bản chụp qua API nội bộ của Procedure.
  const definition = await fetchPublishedProcedureDefinition(
    input.tenantId,
    binding.procedure_definition_id,
  );
  const id = randomUUID();
  let attributes: Record<string, unknown> = input.attributes ?? {};
  if (
    typeof attributes !== 'object' ||
    Array.isArray(attributes) ||
    JSON.stringify(attributes).length > 100_000
  )
    throw new BadRequestException(
      'Thuộc tính biểu mẫu không hợp lệ hoặc quá lớn',
    );
  if (input.fieldRow) {
    const { mappings } = await loadBindingMappings(
      db,
      input.tenantId,
      binding.id,
      kind,
    );
    const values = await resolveFieldValues(
      db,
      {
        tenantId: input.tenantId,
        employeeId: input.employeeId,
        kind,
        row: input.fieldRow,
        org: input.fieldOrg,
      },
      mappings,
    );
    attributes = applyFieldMappings(attributes, values, mappings);
  }
  // file -> mảng id đính kèm; user -> id người dùng Platform (form chọn theo id nhân viên HRM).
  {
    const specs = initialProcedureAttributes(definition);
    attributes = normalizeAttributesForProcedure(
      specs,
      attributes,
      await loadEmployeeUserMap(
        db,
        input.tenantId,
        collectUserReferences(specs, attributes),
      ),
    );
  }
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
        null,
        `hrm:${input.tenantId}:${kind}:${input.requestId}:${input.revision}`,
        JSON.stringify(definition),
      ],
    )
  ).rows[0];
  return mapHrmProcedureLink(row);
}
