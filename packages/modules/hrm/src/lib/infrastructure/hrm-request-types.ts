import { BadRequestException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  HrmRequestEngine,
  HrmRequestFieldType,
  HrmRequestKind,
  HrmRequestTimeMode,
  HrmRequestType,
  HrmRequestTypeField,
} from '@enterprise-platform/contracts-hrm';
import { REQUEST_REASON_CODE_PATTERN } from './hrm-request-reason.js';

/**
 * Loại đơn là CẤU HÌNH (hrm_schema.request_reason_categories, migration 0047):
 *  - 7 loại hệ thống, mỗi loại một engine có sẵn (nghỉ phép, làm thêm giờ, công tác, đổi ca, giải trình công,
 *    tạm ứng lương, đính chính hồ sơ): không xoá, không đổi engine, được đổi tên/mô tả/bật tắt/thứ tự.
 *  - Loại do quản trị tạo luôn là engine GENERIC (bảng custom_requests): chỉ ghi nhận và duyệt, không đụng
 *    bảng công, phép, lương. Nghỉ có lương/không lương tiếp tục cấu hình bằng lý do nghỉ (leave_types).
 */
export const REQUEST_ENGINES: readonly HrmRequestEngine[] = [
  'LEAVE',
  'OVERTIME',
  'BUSINESS_TRIP',
  'SHIFT_CHANGE',
  'ATTENDANCE_CORRECTION',
  'ADVANCE',
  'PROFILE_CORRECTION',
  'GENERIC',
];

/** `kind` (đường duyệt, quy trình, bảng đơn) của từng engine. */
export const ENGINE_REQUEST_KIND: Readonly<Record<HrmRequestEngine, HrmRequestKind>> = {
  LEAVE: 'leave',
  OVERTIME: 'ot',
  BUSINESS_TRIP: 'business_trip',
  SHIFT_CHANGE: 'shift_change',
  ATTENDANCE_CORRECTION: 'correction',
  ADVANCE: 'advance',
  PROFILE_CORRECTION: 'profile_correction',
  GENERIC: 'custom',
};

export const REQUEST_TIME_MODES: readonly HrmRequestTimeMode[] = [
  'RANGE_DATETIME',
  'DATE_RANGE',
  'SINGLE_DATE',
  'NONE',
];

export const REQUEST_FIELD_TYPES: readonly HrmRequestFieldType[] = [
  'text',
  'textarea',
  'number',
  'date',
  'datetime',
  'select',
  'checkbox',
];

export interface SystemRequestType {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly engine: Exclude<HrmRequestEngine, 'GENERIC'>;
  readonly timeMode: HrmRequestTimeMode;
  readonly sortOrder: number;
}

/**
 * 7 loại hệ thống. Cùng nội dung với phần seed trong migration 0047-hrm-request-types.sql (có test đối chiếu);
 * `ensureSystemRequestTypes` dùng danh sách này cho tenant mới. Mã trùng `request_reasons.kind` đang dùng.
 */
export const SYSTEM_REQUEST_TYPES: readonly SystemRequestType[] = [
  { code: 'LEAVE', name: 'Nghỉ phép', description: 'Nghỉ phép năm, nghỉ ốm, việc riêng, nghỉ không lương theo lý do nghỉ đã cấu hình.', engine: 'LEAVE', timeMode: 'RANGE_DATETIME', sortOrder: 10 },
  { code: 'OVERTIME', name: 'Làm thêm giờ', description: 'Đăng ký làm thêm ngoài ca theo hệ số của chính sách làm thêm.', engine: 'OVERTIME', timeMode: 'RANGE_DATETIME', sortOrder: 20 },
  { code: 'BUSINESS_TRIP', name: 'Công tác', description: 'Công tác thực địa, hội thảo, hỗ trợ dự án kèm phụ cấp công tác.', engine: 'BUSINESS_TRIP', timeMode: 'RANGE_DATETIME', sortOrder: 30 },
  { code: 'SHIFT_CHANGE', name: 'Đổi ca', description: 'Hoán đổi ca với đồng nghiệp hoặc chuyển sang ca khác trong khoảng ngày chọn.', engine: 'SHIFT_CHANGE', timeMode: 'DATE_RANGE', sortOrder: 40 },
  { code: 'ATTENDANCE_CORRECTION', name: 'Giải trình công', description: 'Giải trình quên chấm công, lỗi thiết bị, bổ sung giờ vào ra thực tế.', engine: 'ATTENDANCE_CORRECTION', timeMode: 'SINGLE_DATE', sortOrder: 50 },
  { code: 'ADVANCE', name: 'Tạm ứng lương', description: 'Đề nghị tạm ứng một phần lương, hoàn trả bằng khấu trừ các kỳ lương sau.', engine: 'ADVANCE', timeMode: 'NONE', sortOrder: 60 },
  { code: 'PROFILE_CORRECTION', name: 'Đính chính hồ sơ', description: 'Đề nghị đính chính họ tên, ngày sinh, giấy tờ; hồ sơ chỉ đổi sau khi được duyệt.', engine: 'PROFILE_CORRECTION', timeMode: 'NONE', sortOrder: 70 },
];

const SYSTEM_CODES = new Set(SYSTEM_REQUEST_TYPES.map((t) => t.code));

/** Mã loại tự tạo không được trùng mã loại hệ thống. */
export function isSystemRequestTypeCode(code: string): boolean {
  return SYSTEM_CODES.has(code.toUpperCase());
}

type Queryable = Pick<PoolClient, 'query'>;
type Row = Record<string, any>;

/** Tạo 7 loại hệ thống cho tenant chưa có loại hệ thống nào (idempotent); trả số loại vừa tạo. */
export async function ensureSystemRequestTypes(db: Queryable, tenantId: string): Promise<number> {
  const present = await db.query(
    `SELECT count(*)::int AS n FROM hrm_schema.request_reason_categories
      WHERE tenant_id = $1 AND is_system`,
    [tenantId],
  );
  // Tenant đã có loại hệ thống (kể cả loại quản trị đã xoá mềm) thì không tạo lại: loại đã xoá phải giữ nguyên là đã xoá.
  if (Number(present.rows[0]?.n ?? 0) > 0) return 0;
  const inserted = await db.query(
    `INSERT INTO hrm_schema.request_reason_categories
       (tenant_id, code, name, description, engine, time_mode, is_system, sort_order)
     SELECT $1, d.code, d.name, d.description, d.engine, d.time_mode, true, d.sort_order
       FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::int[])
            AS d(code, name, description, engine, time_mode, sort_order)
     ON CONFLICT (tenant_id, upper(code)) WHERE deleted_at IS NULL DO NOTHING
     RETURNING id`,
    [
      tenantId,
      SYSTEM_REQUEST_TYPES.map((t) => t.code),
      SYSTEM_REQUEST_TYPES.map((t) => t.name),
      SYSTEM_REQUEST_TYPES.map((t) => t.description),
      SYSTEM_REQUEST_TYPES.map((t) => t.engine),
      SYSTEM_REQUEST_TYPES.map((t) => t.timeMode),
      SYSTEM_REQUEST_TYPES.map((t) => t.sortOrder),
    ],
  );
  return inserted.rowCount ?? 0;
}

export function mapRequestType(row: Row): HrmRequestType {
  const engine = row.engine as HrmRequestEngine;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    description: row.description ?? null,
    engine,
    kind: ENGINE_REQUEST_KIND[engine] ?? 'custom',
    timeMode: row.time_mode as HrmRequestTimeMode,
    requiresAttachment: row.requires_attachment === true,
    requiresTransport: row.requires_transport === true,
    fields: Array.isArray(row.fields) ? (row.fields as HrmRequestTypeField[]) : [],
    icon: row.icon ?? null,
    isSystem: row.is_system === true,
    active: Boolean(row.active),
    sortOrder: Number(row.sort_order),
    usageCount: row.usage_count === undefined ? undefined : Number(row.usage_count),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

const FIELD_KEY = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_FIELDS = 30;
const MAX_OPTIONS = 50;

/** Kiểm tra và chuẩn hoá danh sách trường động của loại GENERIC. Ném 400 tiếng Việt khi sai. */
export function validateRequestTypeFields(input: unknown): HrmRequestTypeField[] {
  if (!Array.isArray(input)) throw new BadRequestException('Danh sách trường phải là một mảng.');
  if (input.length > MAX_FIELDS)
    throw new BadRequestException(`Mỗi loại đơn tối đa ${MAX_FIELDS} trường.`);
  const seen = new Set<string>();
  return input.map((raw, index) => {
    const at = `Trường ${index + 1}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new BadRequestException(`${at}: dữ liệu không hợp lệ.`);
    const item = raw as Record<string, unknown>;
    const key = typeof item.key === 'string' ? item.key.trim() : '';
    if (!FIELD_KEY.test(key))
      throw new BadRequestException(`${at}: mã trường gồm chữ thường không dấu, số, gạch dưới; bắt đầu bằng chữ cái (tối đa 40 ký tự).`);
    if (seen.has(key)) throw new BadRequestException(`${at}: mã trường "${key}" bị trùng.`);
    seen.add(key);
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    if (!label || label.length > 100)
      throw new BadRequestException(`${at}: tên trường cần từ 1 đến 100 ký tự.`);
    if (!REQUEST_FIELD_TYPES.includes(item.type as HrmRequestFieldType))
      throw new BadRequestException(`${at}: kiểu trường không hợp lệ.`);
    const type = item.type as HrmRequestFieldType;
    if (item.required !== undefined && typeof item.required !== 'boolean')
      throw new BadRequestException(`${at}: "bắt buộc" phải là đúng hoặc sai.`);
    const field: { -readonly [K in keyof HrmRequestTypeField]: HrmRequestTypeField[K] } = {
      key,
      label,
      type,
      required: item.required === true,
    };
    if (type === 'select') {
      const options = Array.isArray(item.options)
        ? item.options.map((o) => (typeof o === 'string' ? o.trim() : ''))
        : [];
      if (!options.length || options.length > MAX_OPTIONS || options.some((o) => !o || o.length > 100))
        throw new BadRequestException(`${at}: trường chọn cần từ 1 đến ${MAX_OPTIONS} lựa chọn, mỗi lựa chọn tối đa 100 ký tự.`);
      if (new Set(options).size !== options.length)
        throw new BadRequestException(`${at}: các lựa chọn bị trùng.`);
      field.options = options;
    }
    return field;
  });
}

export function requireTypeCode(value: unknown): string {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!REQUEST_REASON_CODE_PATTERN.test(code))
    throw new BadRequestException(
      'Mã loại đơn gồm chữ hoa không dấu, số, gạch dưới; bắt đầu bằng chữ cái (2-50 ký tự).',
    );
  if (isSystemRequestTypeCode(code))
    throw new BadRequestException(`Mã "${code}" là mã của loại đơn hệ thống, hãy chọn mã khác.`);
  return code;
}

/** Loại đơn tự tạo đang bật; dùng khi tạo đơn. Ném 400 nếu không có hoặc đã ngừng. */
export async function loadActiveCustomType(db: Queryable, tenantId: string, typeId: string): Promise<Row> {
  const row = (
    await db.query(
      `SELECT * FROM hrm_schema.request_reason_categories
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL AND engine = 'GENERIC'`,
      [tenantId, typeId],
    )
  ).rows[0];
  if (!row) throw new BadRequestException('Loại đơn không tồn tại.');
  if (!row.active) throw new BadRequestException(`Loại đơn "${row.name}" đã ngừng sử dụng.`);
  return row;
}
