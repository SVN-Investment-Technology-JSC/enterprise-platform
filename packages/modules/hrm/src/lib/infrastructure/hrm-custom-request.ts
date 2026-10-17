import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  CreateCustomRequestPayload,
  HrmCustomRequest,
  HrmRequestTimeMode,
  HrmRequestTypeField,
} from '@enterprise-platform/contracts-hrm';
import { assertOpenRange, lockEmployee } from './hrm-time.js';
import { DEFAULT_TIMEZONE, addDays, zonedMs } from './hrm-timesheet-board.js';
import {
  calendarDatesOf,
  requestTimezone,
  resolveRequestRange,
} from './hrm-request-time.js';
import {
  descriptionColumn,
  pickDescription,
  requestReasonView,
} from './hrm-request-reason-input.js';
import { resolveRequestReason, type ResolvedRequestReason } from './hrm-request-reason.js';
import { loadActiveCustomType } from './hrm-request-types.js';
import { requireDate, requireUuid } from './hrm-validation.js';

/**
 * Đơn của loại do quản trị tạo (engine GENERIC): chỉ ghi nhận và duyệt, KHÔNG ảnh hưởng bảng công, phép, lương.
 * Thời gian theo `timeMode` của loại; trường động theo `fields` của loại; lý do (nếu loại có danh mục lý do) chọn từ
 * danh mục `request_reasons` với `kind` = mã loại. Cách duyệt DIRECT/PROCEDURE chọn theo mã loại (`sub_type_code`).
 */

type Db = Pick<PoolClient, 'query'>;
type Row = Record<string, any>;

const MAX_SPAN_DAYS = 366;
const NAIVE_DATETIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/;

// ---------------------------------------------------------------------------------------------------------------
// Trường động
// ---------------------------------------------------------------------------------------------------------------

/** Kiểm tra và chuẩn hoá giá trị các trường động theo khai báo của loại đơn. Ném 400 tiếng Việt khi sai. */
export function normalizeCustomFields(
  definitions: readonly HrmRequestTypeField[],
  input: unknown,
): Record<string, unknown> {
  const values: Record<string, unknown> =
    input === undefined || input === null ? {} : (input as Record<string, unknown>);
  if (typeof values !== 'object' || Array.isArray(values))
    throw new BadRequestException('Dữ liệu các trường của đơn không hợp lệ.');
  const known = new Set(definitions.map((d) => d.key));
  for (const key of Object.keys(values))
    if (!known.has(key))
      throw new BadRequestException(`Trường "${key}" không thuộc loại đơn này.`);
  const out: Record<string, unknown> = {};
  for (const def of definitions) {
    const raw = values[def.key];
    const empty = raw === undefined || raw === null || raw === '';
    if (def.type === 'checkbox') {
      const checked = raw === true;
      if (!empty && typeof raw !== 'boolean')
        throw new BadRequestException(`"${def.label}" phải là đúng hoặc sai.`);
      if (def.required && !checked) throw new BadRequestException(`Cần chọn "${def.label}".`);
      out[def.key] = checked;
      continue;
    }
    if (empty) {
      if (def.required) throw new BadRequestException(`Cần nhập "${def.label}".`);
      continue;
    }
    switch (def.type) {
      case 'text':
      case 'textarea': {
        const max = def.type === 'text' ? 255 : 2000;
        if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > max)
          throw new BadRequestException(`"${def.label}" cần từ 1 đến ${max} ký tự.`);
        out[def.key] = raw.trim();
        break;
      }
      case 'number': {
        const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
        if (!Number.isFinite(n)) throw new BadRequestException(`"${def.label}" phải là số.`);
        out[def.key] = n;
        break;
      }
      case 'date':
        out[def.key] = requireDate(raw, def.label);
        break;
      case 'datetime': {
        const match = typeof raw === 'string' ? NAIVE_DATETIME.exec(raw.trim()) : null;
        if (!match || Number(match[2]) > 23 || Number(match[3]) > 59)
          throw new BadRequestException(`"${def.label}" cần nhập ngày giờ (YYYY-MM-DDTHH:mm).`);
        requireDate(match[1], def.label);
        out[def.key] = `${match[1]}T${match[2]}:${match[3]}`;
        break;
      }
      case 'select':
        if (typeof raw !== 'string' || !def.options?.includes(raw))
          throw new BadRequestException(`"${def.label}": giá trị không nằm trong các lựa chọn.`);
        out[def.key] = raw;
        break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Thời gian
// ---------------------------------------------------------------------------------------------------------------

export interface CustomTime {
  /** Mốc tuyệt đối (ISO UTC); null khi loại đơn không có thời gian. */
  readonly fromAt: string | null;
  readonly toAt: string | null;
  /** Số phút giữa hai mốc (chỉ với RANGE_DATETIME). */
  readonly durationMinutes: number | null;
  /** Ngày đầu và ngày cuối (địa phương) mà đơn chạm vào, để khoá tháng. */
  readonly fromDate: string | null;
  readonly toDate: string | null;
}

const NO_TIME: CustomTime = {
  fromAt: null,
  toAt: null,
  durationMinutes: null,
  fromDate: null,
  toDate: null,
};

function dateOnly(value: unknown, label: string): string {
  const match = typeof value === 'string' ? /^(\d{4}-\d{2}-\d{2})(?:T|$)/.exec(value.trim()) : null;
  if (!match) throw new BadRequestException(`${label}: cần nhập ngày (YYYY-MM-DD).`);
  return requireDate(match[1], label);
}

const isBlank = (value: unknown) => value === undefined || value === null || value === '';

/** Chốt thời gian của đơn theo `timeMode` của loại. */
export async function resolveCustomTime(
  db: Db,
  tenant: string,
  employeeId: string,
  mode: HrmRequestTimeMode,
  body: { fromAt?: unknown; toAt?: unknown },
): Promise<CustomTime> {
  if (mode === 'NONE') {
    if (!isBlank(body.fromAt) || !isBlank(body.toAt))
      throw new BadRequestException('Loại đơn này không có thời gian.');
    return NO_TIME;
  }
  if (mode === 'RANGE_DATETIME') {
    const { timezone, fromMs, toMs } = await resolveRequestRange(
      db,
      tenant,
      employeeId,
      body.fromAt,
      body.toAt,
    );
    const dates = calendarDatesOf(fromMs, toMs, timezone);
    return {
      fromAt: new Date(fromMs).toISOString(),
      toAt: new Date(toMs).toISOString(),
      durationMinutes: Math.round((toMs - fromMs) / 60000),
      fromDate: dates[0],
      toDate: dates[dates.length - 1],
    };
  }
  // DATE_RANGE và SINGLE_DATE: tính theo cả ngày (đầu ngày bắt đầu đến đầu ngày sau ngày kết thúc).
  const fromDate = dateOnly(body.fromAt, 'Từ ngày');
  const toDate =
    mode === 'SINGLE_DATE' && isBlank(body.toAt) ? fromDate : dateOnly(body.toAt, 'Đến ngày');
  if (mode === 'SINGLE_DATE' && toDate !== fromDate)
    throw new BadRequestException('Loại đơn này chỉ nhận một ngày.');
  if (toDate < fromDate) throw new BadRequestException('Đến ngày phải không trước từ ngày.');
  if ((Date.parse(toDate) - Date.parse(fromDate)) / 86400000 + 1 > MAX_SPAN_DAYS)
    throw new BadRequestException(`Khoảng ngày tối đa ${MAX_SPAN_DAYS} ngày.`);
  const timezone = await requestTimezone(db, tenant, employeeId, fromDate);
  return {
    fromAt: new Date(zonedMs(fromDate, '00:00', timezone)).toISOString(),
    toAt: new Date(zonedMs(addDays(toDate, 1), '00:00', timezone)).toISOString(),
    durationMinutes: null,
    fromDate,
    toDate,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Tạo đơn, duyệt
// ---------------------------------------------------------------------------------------------------------------

/**
 * Lý do của đơn: loại đơn có ít nhất một lý do đang sử dụng thì bắt buộc chọn (và lý do phải thuộc loại);
 * loại không có danh mục lý do thì không nhận `reasonId`.
 */
async function resolveCustomReason(
  db: Db,
  tenant: string,
  typeCode: string,
  reasonId: unknown,
  description: string | null,
): Promise<ResolvedRequestReason | null> {
  const catalog = await db.query(
    `SELECT 1 FROM hrm_schema.request_reasons
      WHERE tenant_id = $1 AND kind = $2 AND active AND deleted_at IS NULL LIMIT 1`,
    [tenant, typeCode],
  );
  if (!catalog.rowCount) {
    if (!isBlank(reasonId)) throw new BadRequestException('Loại đơn này không có danh mục lý do.');
    return null;
  }
  return resolveRequestReason(
    db,
    tenant,
    typeCode,
    isBlank(reasonId) ? undefined : requireUuid(reasonId, 'Lý do'),
    description,
  );
}

/** Tạo đơn của loại tuỳ chỉnh. Gọi trong giao dịch (do `submitHrmRequest` mở và khoá nhân viên). */
export async function createCustomRequest(
  db: PoolClient,
  tenant: string,
  actor: string,
  body: CreateCustomRequestPayload,
): Promise<Row> {
  requireUuid(body.employeeId, 'employeeId');
  const type = await loadActiveCustomType(db, tenant, requireUuid(body.typeId, 'Loại đơn'));
  const fields = normalizeCustomFields(type.fields ?? [], body.fields);
  const time = await resolveCustomTime(db, tenant, body.employeeId, type.time_mode, body);
  // Khoá tháng: không tạo đơn có ngày thuộc tháng đã chốt đơn từ hoặc đã khoá công.
  if (time.fromDate && time.toDate) await assertOpenRange(db, tenant, time.fromDate, time.toDate);
  if (type.requires_attachment && !body.attachmentFileId)
    throw new BadRequestException('Loại đơn yêu cầu chứng từ đính kèm');
  if (body.attachmentFileId) {
    const attachment = await db.query(
      `SELECT id FROM hrm_schema.attachments WHERE tenant_id=$1 AND employee_id=$2 AND id=$3 AND status='READY' AND deleted_at IS NULL`,
      [tenant, body.employeeId, requireUuid(body.attachmentFileId, 'attachmentFileId')],
    );
    if (!attachment.rowCount)
      throw new BadRequestException('Chứng từ chưa tải lên hoặc không thuộc nhân viên');
  }
  const description = pickDescription(body);
  const reason = await resolveCustomReason(db, tenant, type.code, body.reasonId, description);
  const inserted = (
    await db.query(
      `INSERT INTO hrm_schema.custom_requests
         (tenant_id, type_id, type_code, type_name, employee_id, from_at, to_at, duration_minutes,
          reason_id, reason_name, reason, fields, attachment_file_id, submitted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)
       RETURNING *`,
      [
        tenant,
        type.id,
        type.code,
        type.name,
        body.employeeId,
        time.fromAt,
        time.toAt,
        time.durationMinutes,
        reason?.id ?? null,
        reason?.name ?? null,
        descriptionColumn(description),
        JSON.stringify(fields),
        body.attachmentFileId || null,
        actor,
      ],
    )
  ).rows[0];
  await db.query(
    `INSERT INTO hrm_schema.audit_log (tenant_id, actor_id, action, entity_type, entity_id, detail)
     VALUES ($1, $2, 'CUSTOM_REQUEST_SUBMITTED', 'custom_request', $3, $4)`,
    [tenant, actor, inserted.id, JSON.stringify({ typeCode: type.code, fromAt: time.fromAt, toAt: time.toAt })],
  );
  return inserted;
}

const TARGET_AUDIT: Record<'APPROVED' | 'REJECTED' | 'CANCELLED', string> = {
  APPROVED: 'CUSTOM_REQUEST_APPROVED',
  REJECTED: 'CUSTOM_REQUEST_REJECTED',
  CANCELLED: 'CUSTOM_REQUEST_CANCELLED',
};

/**
 * Chuyển trạng thái đơn tuỳ chỉnh (duyệt, từ chối, huỷ): đơn phải đang chờ duyệt; đơn đã ở đúng trạng thái đích thì
 * trả lại như cũ (idempotent). Đơn có thời gian thì tháng của nó phải còn mở. Gọi trong giao dịch.
 */
export async function transitionCustomRequest(
  db: PoolClient,
  tenant: string,
  actor: string,
  id: string,
  target: 'APPROVED' | 'REJECTED' | 'CANCELLED',
  reason?: string,
): Promise<Row> {
  const row = (
    await db.query(
      `SELECT * FROM hrm_schema.custom_requests WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenant, id],
    )
  ).rows[0];
  if (!row) throw new NotFoundException('Không tìm thấy đơn');
  if (row.status === target) return row;
  if (row.status !== 'PENDING') throw new ConflictException('Đơn không còn chờ duyệt');
  await lockEmployee(db, tenant, row.employee_id);
  if (row.from_at && row.to_at) {
    const fromMs = Date.parse(new Date(row.from_at).toISOString());
    const toMs = Date.parse(new Date(row.to_at).toISOString());
    const timezone = await requestTimezone(
      db,
      tenant,
      row.employee_id,
      new Date(row.from_at).toISOString().slice(0, 10),
    );
    const dates = calendarDatesOf(fromMs, toMs, timezone);
    await assertOpenRange(db, tenant, dates[0], dates[dates.length - 1]);
  }
  const updated = (
    await db.query(
      `UPDATE hrm_schema.custom_requests
          SET status = $3::text, approved_by = $4, approved_at = now(),
              rejection_reason = CASE WHEN $3::text = 'REJECTED' THEN $5::text ELSE rejection_reason END,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenant, id, target, actor, reason ?? null],
    )
  ).rows[0];
  await db.query(
    `INSERT INTO hrm_schema.audit_log (tenant_id, actor_id, action, entity_type, entity_id, detail)
     VALUES ($1, $2, $3, 'custom_request', $4, $5)`,
    [tenant, actor, TARGET_AUDIT[target], id, JSON.stringify({ reason: reason ?? null })],
  );
  return updated;
}

/**
 * Số đơn tuỳ chỉnh còn chờ duyệt có ngày trong khoảng (để chặn chốt/khoá công). 0 khi tenant chưa có bảng
 * (chưa chạy migration 0047), nên các luồng khoá công cũ không bị ảnh hưởng.
 */
export async function pendingCustomRequestCount(
  db: Db,
  tenant: string,
  fromDate: string,
  toDate: string,
): Promise<number> {
  const present = await db.query(
    `SELECT to_regclass('hrm_schema.custom_requests') IS NOT NULL AS present`,
  );
  if (present.rows[0]?.present !== true) return 0;
  const res = await db.query(
    `SELECT count(*)::int AS n FROM hrm_schema.custom_requests
      WHERE tenant_id = $1 AND status = 'PENDING' AND from_at IS NOT NULL
        AND (from_at AT TIME ZONE $4)::date <= $3::date
        AND ((to_at - interval '1 millisecond') AT TIME ZONE $4)::date >= $2::date`,
    [tenant, fromDate, toDate, DEFAULT_TIMEZONE],
  );
  return Number(res.rows[0]?.n ?? 0);
}

// ---------------------------------------------------------------------------------------------------------------
// Ánh xạ
// ---------------------------------------------------------------------------------------------------------------

const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null);

export function mapCustomRequest(row: Row): HrmCustomRequest {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    typeId: row.type_id,
    typeCode: row.type_code,
    typeName: row.type_name,
    employeeId: row.employee_id,
    fromAt: iso(row.from_at),
    toAt: iso(row.to_at),
    durationMinutes: row.duration_minutes == null ? null : Number(row.duration_minutes),
    ...requestReasonView(row),
    fields: (row.fields ?? {}) as Record<string, unknown>,
    attachmentFileId: row.attachment_file_id ?? null,
    transportMode: row.transport_mode ?? null,
    transportDetail: row.transport_detail ?? null,
    status: row.status,
    submittedBy: row.submitted_by,
    approvedBy: row.approved_by ?? null,
    approvedAt: iso(row.approved_at),
    rejectionReason: row.rejection_reason ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
