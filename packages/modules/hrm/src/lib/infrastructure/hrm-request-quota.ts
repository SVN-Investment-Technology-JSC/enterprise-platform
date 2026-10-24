import { UnprocessableEntityException } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import type { HrmRequestKind } from '@enterprise-platform/contracts-hrm';
import { HRM_REQUEST_TABLES } from './hrm-procedure-links.js';
import { requestDateRange } from './hrm-request-month.js';

type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

export const REQUEST_QUOTA_EXCEEDED = 'REQUEST_MONTHLY_QUOTA_EXCEEDED';

/** Mã loại đơn hệ thống của từng `kind`; đơn `custom` dùng mã loại tự tạo ghi trên chính đơn (`type_code`). */
const SYSTEM_TYPE_CODE: Readonly<Record<Exclude<HrmRequestKind, 'custom'>, string>> = {
  leave: 'LEAVE',
  ot: 'OVERTIME',
  business_trip: 'BUSINESS_TRIP',
  shift_change: 'SHIFT_CHANGE',
  correction: 'ATTENDANCE_CORRECTION',
  advance: 'ADVANCE',
  profile_correction: 'PROFILE_CORRECTION',
};

export function quotaTypeCode(kind: HrmRequestKind, row: Record<string, unknown>): string | null {
  if (kind === 'custom') return typeof row.type_code === 'string' ? row.type_code : null;
  return SYSTEM_TYPE_CODE[kind] ?? null;
}

export async function requestQuotaReady(db: Queryable): Promise<boolean> {
  const res = await db.query(`SELECT to_regclass('hrm_schema.request_quota_settings') IS NOT NULL AS ok`);
  return res.rows[0]?.ok === true;
}

/** Hạn mức tháng của loại đơn; `null` là không giới hạn (chưa đặt, hoặc tenant chưa chạy migration). */
export async function loadRequestQuotaLimit(db: Queryable, tenant: string, typeCode: string): Promise<number | null> {
  if (!(await requestQuotaReady(db))) return null;
  const res = await db.query(
    `SELECT monthly_limit FROM hrm_schema.request_quota_settings WHERE tenant_id = $1 AND upper(type_code) = upper($2)`,
    [tenant, typeCode],
  );
  return res.rows[0] ? Number(res.rows[0].monthly_limit) : null;
}

const TZ = "'Asia/Ho_Chi_Minh'";
/** Ngày để xếp đơn vào tháng: ngày ghi trên đơn; đơn không có ngày thì lấy ngày tạo. */
const MONTH_DATE_SQL: Readonly<Record<HrmRequestKind, string>> = {
  leave: 'from_date',
  ot: 'work_date',
  business_trip: 'from_date',
  shift_change: 'from_date',
  correction: 'request_date',
  advance: 'request_date',
  profile_correction: `(created_at AT TIME ZONE ${TZ})::date`,
  custom: `COALESCE((from_at AT TIME ZONE ${TZ})::date, (to_at AT TIME ZONE ${TZ})::date, (created_at AT TIME ZONE ${TZ})::date)`,
};

/** Tháng (ngày đầu tháng) mà đơn được tính vào: theo ngày ghi trên đơn; không có ngày thì theo `fallback`. */
function monthOfRequest(kind: HrmRequestKind, row: Record<string, unknown>, fallback: Date | string): string {
  const day = requestDateRange(kind, row)?.from ?? new Date(fallback).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
  return `${day.slice(0, 7)}-01`;
}

/**
 * Số đơn ĐÃ DUYỆT cùng loại của nhân viên trong tháng chứa `month` (ngày bất kỳ trong tháng), tính theo ngày ghi trên đơn
 * (ngày nghỉ, ngày làm thêm giờ, ngày giải trình...), không theo ngày tạo đơn. Đơn chờ duyệt, bị từ chối hoặc đã huỷ không tính.
 */
export async function countApprovedInMonth(
  db: Queryable,
  tenant: string,
  employeeId: string,
  kind: HrmRequestKind,
  typeCode: string,
  month: Date | string,
): Promise<number> {
  const res = await db.query(
    `SELECT count(*)::int AS n FROM hrm_schema.${HRM_REQUEST_TABLES[kind]}
      WHERE tenant_id = $1 AND employee_id = $2 AND status = 'APPROVED'
        ${kind === 'custom' ? 'AND upper(type_code) = upper($4)' : 'AND $4::text IS NOT NULL'}
        AND date_trunc('month', ${MONTH_DATE_SQL[kind]}::timestamp) = date_trunc('month', $3::date)`,
    [tenant, employeeId, typeof month === 'string' ? month : month.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }), typeCode],
  );
  return Number(res.rows[0]?.n ?? 0);
}

async function assertWithinQuota(
  db: Queryable,
  tenant: string,
  kind: HrmRequestKind,
  row: Record<string, unknown>,
  at: Date | string,
  message: (limit: number) => string,
): Promise<void> {
  const typeCode = quotaTypeCode(kind, row);
  if (!typeCode) return;
  const limit = await loadRequestQuotaLimit(db, tenant, typeCode);
  if (limit === null) return;
  const used = await countApprovedInMonth(db, tenant, String(row.employee_id), kind, typeCode, monthOfRequest(kind, row, at));
  if (used >= limit)
    throw new UnprocessableEntityException({ code: REQUEST_QUOTA_EXCEEDED, message: message(limit), limit, used });
}

/** Gọi sau khi đơn vừa được tạo, trong giao dịch đã khoá nhân viên: tháng của ngày ghi trên đơn đã đủ hạn mức thì không cho tạo thêm. */
export function assertQuotaOnCreate(db: Queryable, tenant: string, kind: HrmRequestKind, row: Record<string, unknown>) {
  return assertWithinQuota(
    db,
    tenant,
    kind,
    row,
    new Date(),
    (limit) => `Tháng của ngày ghi trên đơn đã đủ ${limit} đơn được duyệt của loại đơn này; không thể tạo thêm.`,
  );
}

/** Gọi trước khi duyệt một đơn đang chờ: tháng của ngày ghi trên đơn đã đủ hạn mức đơn được duyệt thì không duyệt được nữa. */
export function assertQuotaOnApprove(db: Queryable, tenant: string, kind: HrmRequestKind, row: Record<string, unknown>) {
  return assertWithinQuota(
    db,
    tenant,
    kind,
    row,
    (row.created_at as Date | string | undefined) ?? new Date(),
    (limit) =>
      `Tháng của ngày ghi trên đơn đã đủ ${limit} đơn được duyệt của loại đơn này; không thể duyệt thêm. Hãy từ chối đơn.`,
  );
}
