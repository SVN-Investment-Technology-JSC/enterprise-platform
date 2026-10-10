import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { HrmRequestKind } from '@enterprise-platform/contracts-hrm';
import { isoDate } from './hrm-time.js';

/**
 * FIX-E-05 - Ánh xạ trường HRM -> thuộc tính Procedure Engine.
 *
 * - OVERWRITE: giá trị hệ thống thắng (người nộp không sửa được, thuộc tính bị ẩn khỏi form động).
 * - PREFILL: giá trị người nhập thắng; chỉ điền khi người nộp bỏ trống.
 * Ánh xạ lưu theo binding (hrm_schema.request_procedure_field_mappings). Binding chưa cấu hình
 * (hoặc chưa chạy migration) dùng bảng mặc định tương thích với hành vi mã cố định trước đây.
 */

export type HrmFieldGroup = 'form' | 'employee' | 'business';
export type HrmFieldValueType = 'text' | 'number' | 'boolean' | 'date';
export type HrmMappingMode = 'OVERWRITE' | 'PREFILL';
export type HrmMappingScope = 'any' | 'process' | 'step';
export type HrmMappingTransform =
  | 'none'
  | 'to_number'
  | 'to_string'
  | 'to_boolean'
  | 'to_date'
  | 'upper'
  | 'lower';

export const HRM_MAPPING_TRANSFORMS: readonly HrmMappingTransform[] = [
  'none',
  'to_number',
  'to_string',
  'to_boolean',
  'to_date',
  'upper',
  'lower',
];

export interface HrmFieldDefinition {
  readonly key: string;
  readonly label: string;
  readonly group: HrmFieldGroup;
  readonly valueType: HrmFieldValueType;
  /** Loại đơn có trường này; bỏ trống = mọi loại đơn. */
  readonly kinds?: readonly HrmRequestKind[];
}

export interface HrmFieldMapping {
  hrmField: string;
  attributeCode: string;
  scope: HrmMappingScope;
  /** Chỉ dùng khi scope = 'step'. */
  stepId: string;
  transform: HrmMappingTransform;
  mode: HrmMappingMode;
}

/** Loại đơn có lý do (danh mục hoặc loại nghỉ) tách khỏi mô tả. */
const REASON_KINDS: readonly HrmRequestKind[] = [
  'leave',
  'ot',
  'business_trip',
  'shift_change',
  'correction',
];

export const HRM_FIELD_CATALOG: readonly HrmFieldDefinition[] = [
  // Trường form
  { key: 'form.from_date', label: 'Từ ngày', group: 'form', valueType: 'date', kinds: ['leave', 'business_trip', 'shift_change'] },
  { key: 'form.to_date', label: 'Đến ngày', group: 'form', valueType: 'date', kinds: ['leave', 'business_trip', 'shift_change'] },
  { key: 'form.work_date', label: 'Ngày làm việc', group: 'form', valueType: 'date', kinds: ['ot'] },
  { key: 'form.request_date', label: 'Ngày giải trình', group: 'form', valueType: 'date', kinds: ['correction'] },
  // Lý do là danh mục cấu hình: `form.reason` là TÊN lý do (đơn nghỉ: tên loại nghỉ), `form.reason_code` là mã (đơn nghỉ: mã loại nghỉ),
  // `form.description` là mô tả tự do. Đơn cũ chưa có lý do danh mục: `form.reason` là nội dung cũ.
  { key: 'form.reason', label: 'Lý do (tên)', group: 'form', valueType: 'text' },
  { key: 'form.reason_code', label: 'Lý do (mã)', group: 'form', valueType: 'text', kinds: REASON_KINDS },
  { key: 'form.description', label: 'Mô tả', group: 'form', valueType: 'text', kinds: REASON_KINDS },
  { key: 'form.duration', label: 'Số ngày nghỉ', group: 'form', valueType: 'number', kinds: ['leave'] },
  { key: 'form.leave_type_id', label: 'Loại nghỉ phép (id)', group: 'form', valueType: 'text', kinds: ['leave'] },
  { key: 'form.leave_type_code', label: 'Loại nghỉ phép (mã)', group: 'form', valueType: 'text', kinds: ['leave'] },
  { key: 'form.is_negative_leave', label: 'Nghỉ âm phép', group: 'form', valueType: 'boolean', kinds: ['leave'] },
  { key: 'form.ot_hours', label: 'Số giờ OT', group: 'form', valueType: 'number', kinds: ['ot'] },
  { key: 'form.ot_type', label: 'Loại OT', group: 'form', valueType: 'text', kinds: ['ot'] },
  { key: 'form.is_night_ot', label: 'OT ban đêm', group: 'form', valueType: 'boolean', kinds: ['ot'] },
  { key: 'form.days_count', label: 'Số ngày công tác', group: 'form', valueType: 'number', kinds: ['business_trip'] },
  { key: 'form.trip_type', label: 'Loại công tác', group: 'form', valueType: 'text', kinds: ['business_trip'] },
  { key: 'form.destination', label: 'Địa điểm công tác', group: 'form', valueType: 'text', kinds: ['business_trip'] },
  { key: 'form.allow_ot', label: 'Cho phép OT khi công tác', group: 'form', valueType: 'boolean', kinds: ['business_trip'] },
  { key: 'form.amount', label: 'Số tiền tạm ứng', group: 'form', valueType: 'number', kinds: ['advance'] },
  { key: 'form.installments', label: 'Số kỳ trả', group: 'form', valueType: 'number', kinds: ['advance'] },
  { key: 'form.change_type', label: 'Loại đổi ca', group: 'form', valueType: 'text', kinds: ['shift_change'] },
  // Ngữ cảnh nhân viên (HRM sở hữu hoặc lấy qua API Platform)
  { key: 'employee.department_id', label: 'Phòng ban (id)', group: 'employee', valueType: 'text' },
  { key: 'employee.department_code', label: 'Phòng ban (mã)', group: 'employee', valueType: 'text' },
  { key: 'employee.department_name', label: 'Phòng ban (tên)', group: 'employee', valueType: 'text' },
  { key: 'employee.position_id', label: 'Chức danh (id)', group: 'employee', valueType: 'text' },
  { key: 'employee.position_code', label: 'Chức danh (mã)', group: 'employee', valueType: 'text' },
  { key: 'employee.position_name', label: 'Chức danh (tên)', group: 'employee', valueType: 'text' },
  { key: 'employee.level_code', label: 'Cấp bậc (mã ngạch lương)', group: 'employee', valueType: 'text' },
  { key: 'employee.level', label: 'Cấp bậc (tên ngạch lương)', group: 'employee', valueType: 'text' },
  { key: 'employee.contract_type', label: 'Loại hợp đồng', group: 'employee', valueType: 'text' },
  { key: 'employee.manager_id', label: 'Người quản lý (id nhân viên)', group: 'employee', valueType: 'text' },
  { key: 'employee.manager_name', label: 'Người quản lý (tên)', group: 'employee', valueType: 'text' },
  // Ngữ cảnh nghiệp vụ
  { key: 'business.leave_remaining', label: 'Số phép còn lại của loại phép', group: 'business', valueType: 'number', kinds: ['leave'] },
  { key: 'business.ot_hours_month', label: 'Giờ OT đã dùng trong tháng', group: 'business', valueType: 'number', kinds: ['ot'] },
];

export function fieldCatalogFor(kind?: HrmRequestKind): HrmFieldDefinition[] {
  return HRM_FIELD_CATALOG.filter(
    (field) => !kind || !field.kinds || field.kinds.includes(kind),
  );
}

const fieldByKey = new Map(HRM_FIELD_CATALOG.map((f) => [f.key, f]));
export function fieldDefinition(key: string): HrmFieldDefinition | undefined {
  return fieldByKey.get(key);
}

function d(
  hrmField: string,
  attributeCode: string,
  transform: HrmMappingTransform = 'none',
): HrmFieldMapping {
  return {
    hrmField,
    attributeCode,
    scope: 'any',
    stepId: '',
    transform,
    mode: 'OVERWRITE',
  };
}

/** Bảng mã cố định trước đây (submissionAttributes), nay là ánh xạ mặc định. */
export function defaultFieldMappings(kind: HrmRequestKind): HrmFieldMapping[] {
  const hasDates = ['leave', 'business_trip', 'shift_change'].includes(kind);
  const common = [
    d('form.reason', 'ly_do'),
    ...(REASON_KINDS.includes(kind) ? [d('form.description', 'mo_ta')] : []),
    ...(hasDates
      ? [d('form.from_date', 'tu_ngay'), d('form.to_date', 'den_ngay')]
      : []),
  ];
  switch (kind) {
    case 'leave':
      return [
        ...common,
        d('form.duration', 'so_ngay_nghi'),
        d('form.duration', 'duration'),
        d('form.leave_type_id', 'leave_type_id'),
        d('form.is_negative_leave', 'is_negative_leave'),
      ];
    case 'ot':
      return [
        ...common,
        d('form.ot_hours', 'so_gio_ot'),
        d('form.ot_hours', 'ot_hours'),
        d('form.ot_type', 'loai_ot'),
        d('form.is_night_ot', 'is_night_ot'),
      ];
    case 'business_trip':
      return [
        ...common,
        d('form.days_count', 'so_ngay_cong_tac'),
        d('form.days_count', 'days_count'),
        d('form.trip_type', 'loai_cong_tac'),
        d('form.destination', 'dia_diem'),
        d('form.allow_ot', 'allow_ot'),
      ];
    case 'advance':
      return [
        ...common,
        d('form.amount', 'so_tien'),
        d('form.amount', 'amount'),
        d('form.installments', 'so_ky_tra'),
      ];
    case 'correction':
      return [...common, d('form.request_date', 'ngay')];
    case 'shift_change':
      return [...common, d('form.change_type', 'loai_doi_ca')];
    default:
      return common;
  }
}

/** Giá trị các trường form lấy trực tiếp từ dòng đơn đã được kiểm tra. */
export function formFieldValues(
  kind: HrmRequestKind,
  row: Record<string, unknown>,
): Record<string, unknown> {
  // Lý do: tên lý do chọn từ danh mục (đơn nghỉ: tên loại nghỉ khi dòng có nối bảng loại nghỉ; resolveFieldValues tải thêm).
  // Đơn cũ chưa có lý do danh mục (và đơn ứng lương, đính chính hồ sơ) vẫn gửi nội dung cũ để không đổi hành vi.
  const values: Record<string, unknown> = {
    'form.reason': row.reason_name ?? row.leave_type_name ?? row.reason,
  };
  if (REASON_KINDS.includes(kind)) values['form.description'] = row.reason;
  if (row.from_date) values['form.from_date'] = isoDate(row.from_date);
  if (row.to_date) values['form.to_date'] = isoDate(row.to_date);
  switch (kind) {
    case 'leave':
      Object.assign(values, {
        'form.duration': Number(row.duration),
        'form.leave_type_id': row.leave_type_id,
        'form.is_negative_leave': Boolean(row.is_negative_leave),
      });
      break;
    case 'ot':
      Object.assign(values, {
        'form.ot_hours': Number(row.planned_minutes) / 60,
        'form.ot_type': row.ot_type,
        'form.is_night_ot': Boolean(row.is_night_ot),
      });
      if (row.work_date) values['form.work_date'] = isoDate(row.work_date);
      break;
    case 'business_trip':
      Object.assign(values, {
        'form.days_count': Number(row.days_count),
        'form.trip_type': row.business_trip_type,
        'form.destination': row.destination,
        'form.allow_ot': Boolean(row.allow_ot),
      });
      break;
    case 'advance':
      Object.assign(values, {
        'form.amount': Number(row.requested_amount),
        'form.installments': Number(row.number_of_installments),
      });
      break;
    case 'correction':
      if (row.request_date)
        values['form.request_date'] = isoDate(row.request_date);
      break;
    case 'shift_change':
      values['form.change_type'] = row.change_type;
      break;
    default:
      break;
  }
  return values;
}

export function applyTransform(
  transform: HrmMappingTransform,
  value: unknown,
): unknown {
  switch (transform) {
    case 'to_number': {
      const n = Number(value);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'to_string':
      return String(value);
    case 'to_boolean':
      return value === true || value === 'true' || value === 1 || value === '1';
    case 'to_date':
      return isoDate(value);
    case 'upper':
      return String(value).toUpperCase();
    case 'lower':
      return String(value).toLowerCase();
    default:
      return value;
  }
}

const isEmpty = (value: unknown) =>
  value === undefined || value === null || value === '';

function targetKeys(
  mapping: HrmFieldMapping,
  attributes: Record<string, unknown>,
): string[] {
  const code = mapping.attributeCode;
  if (mapping.scope === 'process') return [`process:${code}`];
  if (mapping.scope === 'step') return [`step:${mapping.stepId}:${code}`];
  const scoped = Object.keys(attributes).filter(
    (key) =>
      (key.startsWith('process:') || key.startsWith('step:')) &&
      key.slice(key.lastIndexOf(':') + 1) === code,
  );
  return [code, ...scoped];
}

/**
 * Trộn giá trị hệ thống vào thuộc tính người nộp gửi lên.
 * `values` là bản đồ hrmField -> giá trị; trường không có giá trị bị bỏ qua.
 */
export function applyFieldMappings(
  userAttributes: Record<string, unknown> | undefined,
  values: Record<string, unknown>,
  mappings: readonly HrmFieldMapping[],
): Record<string, unknown> {
  const attributes: Record<string, unknown> = { ...(userAttributes ?? {}) };
  for (const mapping of mappings) {
    const raw = values[mapping.hrmField];
    if (raw === undefined || raw === null) continue;
    const value = applyTransform(mapping.transform, raw);
    if (value === undefined) continue;
    for (const key of targetKeys(mapping, attributes)) {
      if (mapping.mode === 'OVERWRITE' || isEmpty(attributes[key]))
        attributes[key] = value;
    }
  }
  return attributes;
}

/** Ánh xạ áp cho một thuộc tính của định nghĩa PE (mã + phạm vi + bước), nếu có. */
export function mappingForAttribute(
  mappings: readonly HrmFieldMapping[],
  attribute: { code: string; scope: 'process' | 'step'; valueKey?: string },
): HrmFieldMapping | undefined {
  const stepId = attribute.valueKey?.startsWith('step:')
    ? attribute.valueKey.split(':')[1]
    : '';
  const matches = mappings.filter(
    (m) =>
      m.attributeCode === attribute.code &&
      (m.scope === 'any' ||
        (m.scope === attribute.scope &&
          (m.scope === 'process' || m.stepId === stepId))),
  );
  // OVERWRITE thắng PREFILL nếu cùng thuộc tính có cả hai.
  return matches.find((m) => m.mode === 'OVERWRITE') ?? matches[0];
}

// ---------------------------------------------------------------------------
// Lưu trữ
// ---------------------------------------------------------------------------

type Queryable = Pick<PoolClient, 'query'>;

export async function fieldMappingsReady(db: Queryable): Promise<boolean> {
  const result = await db.query(
    `SELECT to_regclass('hrm_schema.request_procedure_field_mappings') IS NOT NULL AS ready`,
  );
  return result.rows[0]?.ready === true;
}

function mapRow(row: Record<string, unknown>): HrmFieldMapping {
  return {
    hrmField: String(row.hrm_field),
    attributeCode: String(row.attribute_code),
    scope: row.scope as HrmMappingScope,
    stepId: String(row.step_id ?? ''),
    transform: row.transform as HrmMappingTransform,
    mode: row.mode as HrmMappingMode,
  };
}

/**
 * Ánh xạ hiệu lực của binding. Chưa chạy migration, hoặc binding chưa có dòng nào và chưa từng được
 * quản trị cấu hình: dùng bảng mặc định (hành vi cũ).
 */
export async function loadBindingMappings(
  db: Queryable,
  tenantId: string,
  bindingId: string,
  kind: HrmRequestKind,
): Promise<{ mappings: HrmFieldMapping[]; isDefault: boolean }> {
  if (!(await fieldMappingsReady(db)))
    return { mappings: defaultFieldMappings(kind), isDefault: true };
  const rows = (
    await db.query(
      `SELECT hrm_field,attribute_code,scope,step_id,transform,mode
         FROM hrm_schema.request_procedure_field_mappings
        WHERE tenant_id=$1 AND binding_id=$2 ORDER BY scope,step_id,attribute_code,hrm_field`,
      [tenantId, bindingId],
    )
  ).rows;
  if (rows.length) return { mappings: rows.map(mapRow), isDefault: false };
  const configured = (
    await db.query(
      `SELECT field_mappings_configured FROM hrm_schema.request_procedure_bindings WHERE tenant_id=$1 AND id=$2`,
      [tenantId, bindingId],
    )
  ).rows[0]?.field_mappings_configured;
  if (configured === true) return { mappings: [], isDefault: false };
  return { mappings: defaultFieldMappings(kind), isDefault: true };
}

async function insertMappings(
  db: Queryable,
  tenantId: string,
  bindingId: string,
  mappings: readonly HrmFieldMapping[],
  actorId: string | null,
) {
  for (const m of mappings)
    await db.query(
      `INSERT INTO hrm_schema.request_procedure_field_mappings
        (id,tenant_id,binding_id,hrm_field,attribute_code,scope,step_id,transform,mode,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        randomUUID(),
        tenantId,
        bindingId,
        m.hrmField,
        m.attributeCode,
        m.scope,
        m.scope === 'step' ? m.stepId : '',
        m.transform,
        m.mode,
        actorId,
      ],
    );
}

/** Nạp ánh xạ mặc định cho binding chưa có dòng nào (tạo binding mới). Bỏ qua nếu chưa migrate. */
export async function seedDefaultFieldMappings(
  db: Queryable,
  tenantId: string,
  bindingId: string,
  kind: HrmRequestKind,
  actorId: string | null,
): Promise<void> {
  if (!(await fieldMappingsReady(db))) return;
  const existing = await db.query(
    `SELECT 1 FROM hrm_schema.request_procedure_field_mappings WHERE tenant_id=$1 AND binding_id=$2 LIMIT 1`,
    [tenantId, bindingId],
  );
  if (existing.rowCount) return;
  await insertMappings(db, tenantId, bindingId, defaultFieldMappings(kind), actorId);
}

const ATTRIBUTE_CODE = /^[A-Za-z0-9_.-]{1,100}$/;

/** Kiểm tra đầu vào PUT; ném 400 với thông báo rõ. Trả về danh sách đã chuẩn hóa. */
export function validateFieldMappings(
  kind: HrmRequestKind,
  input: unknown,
): HrmFieldMapping[] {
  if (!Array.isArray(input))
    throw new BadRequestException('Danh sách ánh xạ không hợp lệ');
  if (input.length > 200)
    throw new BadRequestException('Tối đa 200 dòng ánh xạ');
  const allowed = new Set(fieldCatalogFor(kind).map((f) => f.key));
  const seen = new Set<string>();
  return input.map((raw, index) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const label = `Dòng ${index + 1}`;
    const hrmField = String(item.hrmField ?? '');
    if (!allowed.has(hrmField))
      throw new BadRequestException(
        `${label}: trường HRM "${hrmField}" không áp dụng cho loại đơn này`,
      );
    const attributeCode = String(item.attributeCode ?? '').trim();
    if (!ATTRIBUTE_CODE.test(attributeCode))
      throw new BadRequestException(`${label}: mã thuộc tính không hợp lệ`);
    const scope = String(item.scope ?? 'any') as HrmMappingScope;
    if (!['any', 'process', 'step'].includes(scope))
      throw new BadRequestException(`${label}: phạm vi không hợp lệ`);
    const stepId = scope === 'step' ? String(item.stepId ?? '').trim() : '';
    if (scope === 'step' && (!stepId || stepId.length > 100))
      throw new BadRequestException(`${label}: thiếu mã bước`);
    const transform = String(item.transform ?? 'none') as HrmMappingTransform;
    if (!HRM_MAPPING_TRANSFORMS.includes(transform))
      throw new BadRequestException(`${label}: phép biến đổi không hợp lệ`);
    const mode = String(item.mode ?? '') as HrmMappingMode;
    if (!['OVERWRITE', 'PREFILL'].includes(mode))
      throw new BadRequestException(`${label}: chế độ phải là OVERWRITE hoặc PREFILL`);
    const identity = `${scope}|${stepId}|${attributeCode}`;
    if (seen.has(identity))
      throw new BadRequestException(
        `${label}: thuộc tính "${attributeCode}" đã được ánh xạ ở dòng khác`,
      );
    seen.add(identity);
    return { hrmField, attributeCode, scope, stepId, transform, mode };
  });
}

/** Thay toàn bộ ánh xạ của binding (đã khóa/kiểm quyền ở bên gọi) và ghi audit. */
export async function saveBindingFieldMappings(
  db: PoolClient,
  input: {
    tenantId: string;
    bindingId: string;
    actorId: string;
    mappings: unknown;
  },
) {
  if (!(await fieldMappingsReady(db)))
    throw new ServiceUnavailableException({
      code: 'FIELD_MAPPINGS_NOT_MIGRATED',
      message: 'Chưa chạy migration bảng ánh xạ trường; liên hệ quản trị hệ thống.',
    });
  const binding = (
    await db.query(
      `SELECT id,request_kind FROM hrm_schema.request_procedure_bindings WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      [input.tenantId, input.bindingId],
    )
  ).rows[0];
  if (!binding) throw new NotFoundException('Không tìm thấy cấu hình quy trình');
  const kind = binding.request_kind as HrmRequestKind;
  const mappings = validateFieldMappings(kind, input.mappings);
  const before = (
    await loadBindingMappings(db, input.tenantId, input.bindingId, kind)
  ).mappings;
  await db.query(
    `DELETE FROM hrm_schema.request_procedure_field_mappings WHERE tenant_id=$1 AND binding_id=$2`,
    [input.tenantId, input.bindingId],
  );
  await insertMappings(db, input.tenantId, input.bindingId, mappings, input.actorId);
  await db.query(
    `UPDATE hrm_schema.request_procedure_bindings SET field_mappings_configured=true,updated_at=now(),updated_by=$3 WHERE tenant_id=$1 AND id=$2`,
    [input.tenantId, input.bindingId, input.actorId],
  );
  await db.query(
    `INSERT INTO hrm_schema.audit_log(tenant_id,actor_id,action,entity_type,entity_id,detail)
     VALUES($1,$2,'PROCEDURE_FIELD_MAPPINGS_CONFIGURED','request_procedure_binding',$3,$4)`,
    [
      input.tenantId,
      input.actorId,
      input.bindingId,
      JSON.stringify({ before, after: mappings }),
    ],
  );
  return { kind, mappings };
}

// ---------------------------------------------------------------------------
// Ngữ cảnh nhân viên / nghiệp vụ
// ---------------------------------------------------------------------------

export interface HrmOrgMember {
  userId: string;
  employeeId?: string;
  displayName?: string;
  unitId: string;
  positionId?: string;
  positionName?: string;
}
export interface HrmOrgSnapshotNames {
  units?: { id: string; code?: string; name?: string; parentId?: string | null }[];
  positions?: { id: string; key?: string; name?: string; unitId?: string }[];
  members?: HrmOrgMember[];
}

/** Cổng lấy ngữ cảnh tổ chức của nhân viên từ Platform (không đọc DB module khác). */
export interface HrmEmployeeOrgPort {
  context(
    tenantId: string,
    userId: string,
  ): Promise<{
    departmentId?: string;
    departmentCode?: string;
    departmentName?: string;
    positionId?: string;
    positionCode?: string;
    positionName?: string;
    managerEmployeeId?: string;
    managerName?: string;
  }>;
}

/** Suy ngữ cảnh tổ chức của `userId` từ snapshot + chuỗi quản lý (thuần, có test). */
export function deriveOrgContext(
  snapshot: HrmOrgSnapshotNames,
  userId: string,
  managerUserId?: string,
) {
  const members = snapshot.members ?? [];
  const own =
    members.find((m) => m.userId === userId && m.positionId) ??
    members.find((m) => m.userId === userId);
  const result: Awaited<ReturnType<HrmEmployeeOrgPort['context']>> = {};
  if (own) {
    const position = (snapshot.positions ?? []).find(
      (p) => p.id === own.positionId,
    );
    const unitId = position?.unitId ?? own.unitId;
    const unit = (snapshot.units ?? []).find((u) => u.id === unitId);
    result.departmentId = unitId;
    result.departmentCode = unit?.code;
    result.departmentName = unit?.name;
    result.positionId = own.positionId;
    result.positionCode = position?.key;
    result.positionName = own.positionName ?? position?.name;
  }
  if (managerUserId) {
    const manager = members.find((m) => m.userId === managerUserId);
    result.managerEmployeeId = manager?.employeeId;
    result.managerName = manager?.displayName;
  }
  return result;
}

export class HttpHrmEmployeeOrgResolver implements HrmEmployeeOrgPort {
  private readonly cache = new Map<
    string,
    { at: number; snapshot: HrmOrgSnapshotNames }
  >();
  constructor(
    private readonly baseUrl: string = process.env[
      'TENANT_CORE_ORGANIZATION_CONTEXT_URL'
    ] ?? 'http://localhost:3333/api/platform/internal/v1/organization-contexts',
    private readonly ttlMs = 15_000,
  ) {}

  private async get<T>(path: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        headers: {
          'x-service-token': process.env['INTERNAL_SERVICE_TOKEN'] ?? '',
        },
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw this.unavailable();
    }
    if (!response.ok) throw this.unavailable();
    return (await response.json()) as T;
  }

  private unavailable() {
    return new ServiceUnavailableException({
      code: 'ORG_CONTEXT_UNAVAILABLE',
      message:
        'Không lấy được sơ đồ tổ chức để điền thuộc tính quy trình (phòng ban, chức danh...). Vui lòng thử lại.',
    });
  }

  async context(tenantId: string, userId: string) {
    const tenant = encodeURIComponent(tenantId);
    let cached = this.cache.get(tenantId);
    if (!cached || Date.now() - cached.at >= this.ttlMs) {
      cached = {
        at: Date.now(),
        snapshot: await this.get<HrmOrgSnapshotNames>(`/${tenant}`),
      };
      this.cache.set(tenantId, cached);
    }
    const chain = await this.get<{
      chain?: { holderUserIds?: string[] }[];
    }>(`/${tenant}/users/${encodeURIComponent(userId)}/manager-chain`);
    const managerUserId = (chain.chain ?? [])
      .flatMap((link) => link.holderUserIds ?? [])
      .find((id) => id && id !== userId);
    return deriveOrgContext(cached.snapshot, userId, managerUserId);
  }
}

let defaultOrg: HrmEmployeeOrgPort | undefined;
export function defaultEmployeeOrgPort(): HrmEmployeeOrgPort {
  defaultOrg ??= new HttpHrmEmployeeOrgResolver();
  return defaultOrg;
}

export interface FieldValueSource {
  tenantId: string;
  employeeId: string;
  kind: HrmRequestKind;
  row: Record<string, unknown>;
  org?: HrmEmployeeOrgPort;
}

/**
 * Giá trị mọi trường mà `mappings` cần: trường form luôn có; ngữ cảnh nhân viên/nghiệp vụ chỉ tải
 * khi có ánh xạ dùng đến. Lỗi Platform làm gửi đơn thất bại 503 để không rẽ nhánh cổng điều kiện sai.
 */
export async function resolveFieldValues(
  db: Queryable,
  source: FieldValueSource,
  mappings: readonly HrmFieldMapping[],
): Promise<Record<string, unknown>> {
  const values = formFieldValues(source.kind, source.row);
  const needed = new Set(mappings.map((m) => m.hrmField));
  const wants = (prefix: string) =>
    [...needed].some((key) => key.startsWith(prefix));

  if (
    source.kind === 'leave' &&
    source.row.leave_type_id &&
    (needed.has('form.leave_type_code') ||
      needed.has('form.reason') ||
      needed.has('form.reason_code'))
  ) {
    // Lý do của đơn nghỉ là loại nghỉ: `form.reason` = tên, `form.reason_code` = mã.
    const type = (
      await db.query(
        `SELECT code,name FROM hrm_schema.leave_types WHERE tenant_id=$1 AND id=$2`,
        [source.tenantId, source.row.leave_type_id],
      )
    ).rows[0];
    if (type) {
      values['form.leave_type_code'] = type.code;
      values['form.reason_code'] = type.code;
      values['form.reason'] = type.name;
    }
  } else if (
    source.kind !== 'leave' &&
    source.row.reason_id &&
    needed.has('form.reason_code')
  ) {
    values['form.reason_code'] = (
      await db.query(
        `SELECT code FROM hrm_schema.request_reasons WHERE tenant_id=$1 AND id=$2`,
        [source.tenantId, source.row.reason_id],
      )
    ).rows[0]?.code;
  }
  if (wants('employee.')) {
    const user = (
      await db.query(
        `SELECT user_id FROM core_schema.employees WHERE tenant_id=$1 AND id=$2`,
        [source.tenantId, source.employeeId],
      )
    ).rows[0]?.user_id as string | undefined;
    let positionId: string | undefined;
    if (
      user &&
      [...needed].some((k) =>
        /^employee\.(department|position|manager)/.test(k),
      )
    ) {
      const org = await (source.org ?? defaultEmployeeOrgPort()).context(
        source.tenantId,
        user,
      );
      positionId = org.positionId;
      Object.assign(values, {
        'employee.department_id': org.departmentId,
        'employee.department_code': org.departmentCode,
        'employee.department_name': org.departmentName,
        'employee.position_id': org.positionId,
        'employee.position_code': org.positionCode,
        'employee.position_name': org.positionName,
        'employee.manager_id': org.managerEmployeeId,
        'employee.manager_name': org.managerName,
      });
    }
    if (
      (needed.has('employee.level') || needed.has('employee.level_code')) &&
      positionId
    ) {
      const grade = (
        await db.query(
          `SELECT g.name,g.code FROM hrm_schema.position_profiles p
             JOIN hrm_schema.salary_grades g ON g.id=p.salary_grade_id
            WHERE p.tenant_id=$1 AND p.position_id=$2`,
          [source.tenantId, positionId],
        )
      ).rows[0];
      values['employee.level'] = grade?.name;
      values['employee.level_code'] = grade?.code;
    }
    if (needed.has('employee.contract_type')) {
      values['employee.contract_type'] = (
        await db.query(
          `SELECT contract_type FROM hrm_schema.employment_contracts
            WHERE tenant_id=$1 AND employee_id=$2 AND deleted_at IS NULL AND status='ACTIVE'
            ORDER BY effective_from DESC LIMIT 1`,
          [source.tenantId, source.employeeId],
        )
      ).rows[0]?.contract_type;
    }
  }
  if (
    needed.has('business.leave_remaining') &&
    source.kind === 'leave' &&
    source.row.leave_type_id &&
    source.row.from_date
  ) {
    const remaining = (
      await db.query(
        `SELECT remaining FROM hrm_schema.leave_balances
          WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=$4`,
        [
          source.tenantId,
          source.employeeId,
          source.row.leave_type_id,
          Number(isoDate(source.row.from_date).slice(0, 4)),
        ],
      )
    ).rows[0]?.remaining;
    if (remaining !== undefined) values['business.leave_remaining'] = Number(remaining);
  }
  if (
    needed.has('business.ot_hours_month') &&
    source.kind === 'ot' &&
    source.row.work_date
  ) {
    const minutes = (
      await db.query(
        `SELECT COALESCE(SUM(CASE WHEN COALESCE(approved_minutes,0)>0 THEN approved_minutes ELSE planned_minutes END),0) AS minutes
           FROM hrm_schema.ot_requests
          WHERE tenant_id=$1 AND employee_id=$2 AND status='APPROVED' AND id<>$3
            AND date_trunc('month',work_date)=date_trunc('month',$4::date)`,
        [
          source.tenantId,
          source.employeeId,
          source.row.id ?? randomUUID(),
          isoDate(source.row.work_date),
        ],
      )
    ).rows[0]?.minutes;
    values['business.ot_hours_month'] = Number(minutes ?? 0) / 60;
  }
  return values;
}
