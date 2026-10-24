import { UnprocessableEntityException } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import type { HrmRequestKind } from '@enterprise-platform/contracts-hrm';
import { requestDateRange } from './hrm-request-month.js';

type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

export const REQUEST_TOO_LATE = 'REQUEST_TOO_LATE';
export const REQUEST_TOO_OLD = 'REQUEST_TOO_OLD';

const TIME_ZONE = 'Asia/Ho_Chi_Minh';
const DAY_MS = 86_400_000;

/**
 * Quy tắc thời gian của một loại đơn. Mỗi giá trị null là chưa dùng quy tắc đó (mặc định của mọi tenant).
 *  - minNoticeDays: tạo đơn trước ngày bắt đầu ghi trên đơn ít nhất N ngày;
 *  - maxBackdateDays: không tạo đơn cho ngày đã qua quá N ngày;
 *  - escalateAfterDays: đơn chờ đủ N ngày thì người giữ chức danh dự phòng mới được xử lý (và được báo).
 */
export interface RequestTimeRule {
  minNoticeDays: number | null;
  maxBackdateDays: number | null;
  escalateAfterDays: number | null;
}

export const NO_TIME_RULE: RequestTimeRule = {
  minNoticeDays: null,
  maxBackdateDays: null,
  escalateAfterDays: null,
};

export const TIME_RULE_KINDS: readonly HrmRequestKind[] = [
  'leave',
  'ot',
  'business_trip',
  'shift_change',
  'correction',
  'advance',
  'profile_correction',
  'custom',
];

const todayVn = (now: Date) => now.toLocaleDateString('en-CA', { timeZone: TIME_ZONE });
const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
const display = (iso: string) => iso.split('-').reverse().join('/');

export async function requestTimeRulesReady(db: Queryable): Promise<boolean> {
  const res = await db.query(`SELECT to_regclass('hrm_schema.request_time_rules') IS NOT NULL AS ok`);
  return res.rows[0]?.ok === true;
}

const toRule = (row: Record<string, unknown> | undefined): RequestTimeRule =>
  row
    ? {
        minNoticeDays: row['min_notice_days'] === null ? null : Number(row['min_notice_days']),
        maxBackdateDays: row['max_backdate_days'] === null ? null : Number(row['max_backdate_days']),
        escalateAfterDays: row['escalate_after_days'] === null ? null : Number(row['escalate_after_days']),
      }
    : NO_TIME_RULE;

/** Quy tắc của loại đơn; chưa cấu hình hoặc tenant chưa chạy migration thì không có quy tắc nào. */
export async function loadRequestTimeRule(db: Queryable, tenant: string, kind: HrmRequestKind): Promise<RequestTimeRule> {
  if (!(await requestTimeRulesReady(db))) return NO_TIME_RULE;
  const res = await db.query(
    `SELECT min_notice_days, max_backdate_days, escalate_after_days
       FROM hrm_schema.request_time_rules WHERE tenant_id = $1 AND request_kind = $2`,
    [tenant, kind],
  );
  return toRule(res.rows[0]);
}

/** Lỗi thời điểm tạo đơn so với ngày ghi trên đơn; null khi hợp lệ hoặc đơn không gắn với ngày nào. */
export function timingViolation(
  rule: RequestTimeRule,
  range: { from: string; to: string } | null,
  now: Date = new Date(),
): { code: string; message: string } | null {
  if (!range) return null;
  const today = dayNumber(todayVn(now));
  const start = dayNumber(range.from);
  if (rule.minNoticeDays !== null && start - today < rule.minNoticeDays)
    return {
      code: REQUEST_TOO_LATE,
      message:
        rule.minNoticeDays === 0
          ? `Không tạo đơn cho ngày đã qua (ngày ${display(range.from)}).`
          : `Cần tạo đơn trước ngày bắt đầu (${display(range.from)}) ít nhất ${rule.minNoticeDays} ngày.`,
    };
  if (rule.maxBackdateDays !== null && today - start > rule.maxBackdateDays)
    return {
      code: REQUEST_TOO_OLD,
      message: `Không tạo đơn cho ngày đã qua quá ${rule.maxBackdateDays} ngày (ngày ${display(range.from)}).`,
    };
  return null;
}

/** Gọi khi đơn vừa được tạo (trong giao dịch): vi phạm quy tắc thời gian thì huỷ giao dịch bằng 422. */
export async function assertRequestTiming(
  db: Queryable,
  tenant: string,
  kind: HrmRequestKind,
  row: Record<string, unknown>,
): Promise<void> {
  const rule = await loadRequestTimeRule(db, tenant, kind);
  const violation = timingViolation(rule, requestDateRange(kind, row));
  if (violation) throw new UnprocessableEntityException(violation);
}

/**
 * Người giữ chức danh dự phòng đã được xử lý đơn chưa. Không đặt `escalateAfterDays` thì dự phòng xử lý ngay
 * (như trước); đặt thì phải chờ đủ số ngày kể từ lúc đơn được tạo.
 */
export function fallbackMayAct(rule: RequestTimeRule, createdAt: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (rule.escalateAfterDays === null) return true;
  if (!createdAt) return false;
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return false;
  return now.getTime() - created.getTime() >= rule.escalateAfterDays * DAY_MS;
}
