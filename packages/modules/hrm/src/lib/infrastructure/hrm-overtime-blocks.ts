import type {
  HrmNextDayRest,
  HrmOvertimeBlock,
  HrmOvertimeClassifyPreview,
  OverrideHrmOvertimeBlockRequest,
  PreviewHrmOvertimeClassifyRequest,
} from '@enterprise-platform/contracts-hrm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  classifyBlock,
  crossesMidnight,
  formatLocalMinutes,
  localMinutes,
  splitBlockByMonth,
  type OvertimeBlock,
} from '../domain/overtime-classification.js';
import {
  classificationConfigOf,
  parseOvertimeCompPolicy,
  type OvertimeCompPolicy,
} from '../domain/overtime-comp-policy.js';
import { lifecycleAudit } from './hrm-lifecycle.js';
import { deriveOvertimeTime, resolveRequestRange } from './hrm-request-time.js';
import {
  dayKindOf,
  isoDate,
  isUnassignedSunday,
  resolvePolicy,
  shiftForDate,
} from './hrm-time.js';

type Db = Pick<PoolClient, 'query'>;

const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';

/**
 * Tenant đã có bảng phân loại làm thêm (migration 0077) chưa. Mã chạy được trên tenant chưa chuyển schema:
 * chưa có bảng thì các hàm ghi / xóa ca không làm gì thay vì lỗi cả giao dịch duyệt đơn.
 */
export async function overtimeSchemaReady(db: Db): Promise<boolean> {
  const res = await db.query(`SELECT to_regclass('hrm_schema.overtime_blocks') IS NOT NULL AS ok`);
  return res.rows[0]?.ok === true;
}

/** Kỳ công đã có cột `policy_snapshot` (migration 0077) chưa. */
export async function snapshotColumnReady(db: Db): Promise<boolean> {
  const res = await db.query(
    `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='hrm_schema' AND table_name='timesheet_periods' AND column_name='policy_snapshot') AS ok`,
  );
  return res.rows[0]?.ok === true;
}
const REST_FRACTION: Record<HrmNextDayRest, 0 | 0.5 | 1> = { NONE: 0, HALF: 0.5, FULL: 1 };

export interface LoadedOvertimeCompPolicy {
  readonly policy: OvertimeCompPolicy;
  /** Phiên bản chính sách OT đã dùng; null khi tenant chưa có chính sách OT hiệu lực. */
  readonly policyVersionId: string | null;
}

/**
 * Cấu hình làm thêm và nghỉ bù hiệu lực tại mùng 1 của tháng (phiên bản có `effective_from` lớn nhất không vượt quá ngày đó).
 * Tenant chưa có chính sách OT thì dùng mặc định (tắt quy tắc trần và nghỉ bù).
 */
export async function loadOvertimeCompPolicy(
  db: Db,
  tenant: string,
  month: string,
  employeeId?: string,
): Promise<LoadedOvertimeCompPolicy> {
  const found = await resolvePolicy(db as PoolClient, tenant, 'OT', `${month}-01`, employeeId);
  return {
    policy: parseOvertimeCompPolicy(found?.config_json),
    policyVersionId: found?.id ?? null,
  };
}

async function timezoneOf(db: Db, tenant: string, date: string, employeeId: string): Promise<string> {
  const attendance = await resolvePolicy(db as PoolClient, tenant, 'ATTENDANCE', date, employeeId);
  return String(attendance?.config_json?.timezone || DEFAULT_TIMEZONE);
}

const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/**
 * Ngày làm việc kế tiếp để ghi ngày nghỉ sau ca đêm: ngày của mốc kết thúc ca, nếu là ngày nghỉ hằng tuần, Chủ nhật chưa
 * phân ca hoặc ngày lễ thì sang ngày làm việc gần nhất sau đó (tối đa 14 ngày).
 */
export async function nextWorkingDate(db: Db, tenant: string, employeeId: string, endLocal: string): Promise<string> {
  let date = endLocal.slice(0, 10);
  const timezone = await timezoneOf(db, tenant, date, employeeId);
  for (let i = 0; i < 14; i++) {
    const kind = (await dayKindOf(db, tenant, date, employeeId)) || 'WORK';
    if (kind === 'WORK') {
      const shift = await shiftForDate(db as PoolClient, tenant, employeeId, date, timezone);
      if (!isUnassignedSunday(date, kind, Boolean(shift))) return date;
    }
    date = shiftDate(date, 1);
  }
  return endLocal.slice(0, 10);
}

export interface OvertimeRequestRow {
  readonly id: string;
  readonly employee_id: string;
  readonly work_date: unknown;
  readonly start_time: unknown;
  readonly planned_minutes: number | string;
  readonly status: string;
  readonly next_day_rest?: string | null;
}

/** Ca làm thêm theo giờ địa phương của đơn: ngày làm, giờ bắt đầu, cộng số phút đã đăng ký. */
export function blockOfRequest(row: Pick<OvertimeRequestRow, 'work_date' | 'start_time' | 'planned_minutes'>): OvertimeBlock {
  const start = `${isoDate(row.work_date)}T${String(row.start_time).slice(0, 5)}`;
  return { start, end: formatLocalMinutes(localMinutes(start) + Number(row.planned_minutes)) };
}

export interface ClassifiedPart {
  readonly periodMonth: string;
  readonly block: OvertimeBlock;
  readonly hours: number;
  readonly crossesMidnight: boolean;
  readonly restFraction: 0 | 0.5 | 1;
  readonly otHours: number;
  readonly nightHours: number;
  readonly warnings: readonly string[];
  readonly policy: LoadedOvertimeCompPolicy;
}

/**
 * Phân loại các phần (theo tháng) của một ca làm thêm. Phần nghỉ sau ca chỉ áp cho phần xuyên đêm đầu tiên của ca.
 * Mỗi phần dùng chính sách của tháng của nó.
 */
export async function classifyRequestParts(
  db: Db,
  tenant: string,
  employeeId: string,
  block: OvertimeBlock,
  nextDayRest: HrmNextDayRest,
): Promise<ClassifiedPart[]> {
  const policies = new Map<string, LoadedOvertimeCompPolicy>();
  const out: ClassifiedPart[] = [];
  let restUsed = false;
  for (const part of splitBlockByMonth(block)) {
    let loaded = policies.get(part.periodMonth);
    if (!loaded) {
      loaded = await loadOvertimeCompPolicy(db, tenant, part.periodMonth, employeeId);
      policies.set(part.periodMonth, loaded);
    }
    const crosses = crossesMidnight(part.block);
    const restFraction = crosses && !restUsed ? REST_FRACTION[nextDayRest] : 0;
    if (crosses) restUsed = true;
    const result = classifyBlock({
      ruleSet: loaded.policy.ruleSet,
      block: part.block,
      restFraction,
      ...classificationConfigOf(loaded.policy),
    });
    const hours = Math.round((result.otHours + result.nightHours) * 100) / 100;
    out.push({
      periodMonth: part.periodMonth,
      block: part.block,
      hours,
      crossesMidnight: crosses,
      restFraction,
      otHours: result.otHours,
      nightHours: result.nightHours,
      warnings: result.warnings,
      policy: loaded,
    });
  }
  return out;
}

/**
 * Ghi các ca phân loại của một đơn làm thêm đã duyệt vào `overtime_blocks` và ngày nghỉ sau ca đêm vào `night_rest_days`.
 * Chạy lại được: ca đã sửa tay (source MANUAL) giữ nguyên giá trị chính thức, chỉ cập nhật phần gợi ý.
 * Tháng nào chưa bật quy tắc thì không ghi ca của tháng đó.
 */
export async function syncOvertimeBlocks(
  db: Db,
  tenant: string,
  actor: string | null,
  otRequestId: string,
  /** Dòng đơn đã đọc sẵn (vừa duyệt xong) để khỏi đọc lại. */
  loaded?: OvertimeRequestRow,
): Promise<number> {
  if (!(await overtimeSchemaReady(db))) return 0;
  const ot =
    loaded ??
    ((
      await db.query(
        `SELECT id,employee_id,work_date,start_time,planned_minutes,status,next_day_rest FROM hrm_schema.ot_requests WHERE tenant_id=$1 AND id=$2`,
        [tenant, otRequestId],
      )
    ).rows[0] as OvertimeRequestRow | undefined);
  if (!ot) throw new NotFoundException('Không tìm thấy đơn làm thêm');
  await db.query(
    `DELETE FROM hrm_schema.overtime_blocks WHERE tenant_id=$1 AND ot_request_id=$2 AND source<>'MANUAL'`,
    [tenant, otRequestId],
  );
  if (ot.status !== 'APPROVED') {
    await db.query(`DELETE FROM hrm_schema.overtime_blocks WHERE tenant_id=$1 AND ot_request_id=$2`, [tenant, otRequestId]);
    await db.query(`DELETE FROM hrm_schema.night_rest_days WHERE tenant_id=$1 AND ot_request_id=$2`, [tenant, otRequestId]);
    return 0;
  }
  const nextDayRest = (['HALF', 'FULL'].includes(String(ot.next_day_rest)) ? ot.next_day_rest : 'NONE') as HrmNextDayRest;
  const timezone = await timezoneOf(db, tenant, isoDate(ot.work_date), ot.employee_id);
  const parts = await classifyRequestParts(db, tenant, ot.employee_id, blockOfRequest(ot), nextDayRest);
  let written = 0;
  let restDate: string | null = null;
  let restFraction = 0;
  for (const part of parts) {
    if (!part.policy.policy.enabled) continue;
    await db.query(
      `INSERT INTO hrm_schema.overtime_blocks
         (tenant_id,ot_request_id,employee_id,period_month,start_at,end_at,hours,crosses_midnight,rule_set,policy_version_id,
          rest_fraction_suggested,ot_hours_suggested,night_hours_suggested,ot_hours_final,night_hours_final,source)
       VALUES ($1,$2,$3,$4,($5::text)::timestamp AT TIME ZONE ($6::text),($7::text)::timestamp AT TIME ZONE ($6::text),$8,$9,$10,$11,$12,$13,$14,$13,$14,'RULE')
       ON CONFLICT (tenant_id,ot_request_id,start_at) DO UPDATE SET
         period_month=EXCLUDED.period_month,end_at=EXCLUDED.end_at,hours=EXCLUDED.hours,crosses_midnight=EXCLUDED.crosses_midnight,
         rule_set=EXCLUDED.rule_set,policy_version_id=EXCLUDED.policy_version_id,rest_fraction_suggested=EXCLUDED.rest_fraction_suggested,
         ot_hours_suggested=EXCLUDED.ot_hours_suggested,night_hours_suggested=EXCLUDED.night_hours_suggested,
         ot_hours_final=CASE WHEN hrm_schema.overtime_blocks.source='MANUAL' THEN hrm_schema.overtime_blocks.ot_hours_final ELSE EXCLUDED.ot_hours_final END,
         night_hours_final=CASE WHEN hrm_schema.overtime_blocks.source='MANUAL' THEN hrm_schema.overtime_blocks.night_hours_final ELSE EXCLUDED.night_hours_final END,
         updated_at=now()`,
      [
        tenant,
        otRequestId,
        ot.employee_id,
        part.periodMonth,
        part.block.start,
        timezone,
        part.block.end,
        part.hours,
        part.crossesMidnight,
        part.policy.policy.ruleSet,
        part.policy.policyVersionId,
        part.restFraction,
        part.otHours,
        part.nightHours,
      ],
    );
    written++;
    if (part.policy.policy.ruleSet === 'NIGHT_REST' && part.restFraction > 0 && restDate === null) {
      restDate = await nextWorkingDate(db, tenant, ot.employee_id, part.block.end);
      restFraction = part.restFraction;
    }
  }
  if (restDate) {
    await db.query(
      `INSERT INTO hrm_schema.night_rest_days (tenant_id,employee_id,rest_date,fraction,ot_request_id,reason,created_by)
       VALUES ($1,$2,$3,$4,$5,'Theo đơn làm thêm xuyên đêm',$6)
       ON CONFLICT (tenant_id,employee_id,rest_date) DO UPDATE SET fraction=GREATEST(hrm_schema.night_rest_days.fraction,EXCLUDED.fraction),ot_request_id=EXCLUDED.ot_request_id`,
      [tenant, ot.employee_id, restDate, restFraction, otRequestId, actor],
    );
    await db.query(
      `DELETE FROM hrm_schema.night_rest_days WHERE tenant_id=$1 AND ot_request_id=$2 AND rest_date<>$3`,
      [tenant, otRequestId, restDate],
    );
  } else {
    await db.query(`DELETE FROM hrm_schema.night_rest_days WHERE tenant_id=$1 AND ot_request_id=$2`, [tenant, otRequestId]);
  }
  return written;
}

/** Xóa ca phân loại và ngày nghỉ sau ca của đơn (khi đảo đơn làm thêm đã duyệt). */
export async function removeOvertimeBlocks(db: Db, tenant: string, otRequestId: string): Promise<void> {
  if (!(await overtimeSchemaReady(db))) return;
  await db.query(`DELETE FROM hrm_schema.overtime_blocks WHERE tenant_id=$1 AND ot_request_id=$2`, [tenant, otRequestId]);
  await db.query(`DELETE FROM hrm_schema.night_rest_days WHERE tenant_id=$1 AND ot_request_id=$2`, [tenant, otRequestId]);
}

/** Đảm bảo mọi đơn làm thêm đã duyệt của tháng đã có ca phân loại (đơn duyệt trước khi bật quy tắc). Trả số đơn vừa ghi. */
export async function ensureBlocksForMonth(db: Db, tenant: string, month: string, actor: string | null): Promise<number> {
  const missing = await db.query(
    `SELECT o.id FROM hrm_schema.ot_requests o
      WHERE o.tenant_id=$1 AND o.status='APPROVED'
        AND to_char(o.work_date,'YYYY-MM')=$2
        AND NOT EXISTS (SELECT 1 FROM hrm_schema.overtime_blocks b WHERE b.tenant_id=o.tenant_id AND b.ot_request_id=o.id)
      ORDER BY o.work_date,o.start_time`,
    [tenant, month],
  );
  let synced = 0;
  for (const row of missing.rows) {
    if ((await syncOvertimeBlocks(db, tenant, actor, row.id as string)) > 0) synced++;
  }
  return synced;
}

/** Xem trước phân loại của một khoảng làm thêm trước khi gửi đơn. */
export async function previewOvertimeClassification(
  db: PoolClient,
  tenant: string,
  body: PreviewHrmOvertimeClassifyRequest,
): Promise<HrmOvertimeClassifyPreview> {
  const nextDayRest: HrmNextDayRest = body.nextDayRest === 'HALF' || body.nextDayRest === 'FULL' ? body.nextDayRest : 'NONE';
  const { timezone, fromMs, toMs } = await resolveRequestRange(db, tenant, body.employeeId, body.fromAt, body.toAt);
  const schedule = deriveOvertimeTime(fromMs, toMs, timezone);
  const parts = await classifyRequestParts(db, tenant, body.employeeId, blockOfRequest({
    work_date: schedule.workDate,
    start_time: schedule.startTime,
    planned_minutes: schedule.plannedMinutes,
  }), nextDayRest);
  const first = parts[0];
  return {
    enabled: parts.some((p) => p.policy.policy.enabled),
    ruleSet: first?.policy.policy.ruleSet ?? 'CLOCK_WINDOW',
    parts: parts.map((p) => ({
      periodMonth: p.periodMonth,
      start: p.block.start,
      end: p.block.end,
      hours: p.hours,
      restFraction: p.restFraction,
      otHours: p.otHours,
      nightHours: p.nightHours,
      warnings: p.warnings,
    })),
    otHours: Math.round(parts.reduce((n, p) => n + p.otHours, 0) * 100) / 100,
    nightHours: Math.round(parts.reduce((n, p) => n + p.nightHours, 0) * 100) / 100,
    askNextDayRest:
      parts.some((p) => p.crossesMidnight) && parts.some((p) => p.policy.policy.ruleSet === 'NIGHT_REST'),
  };
}

const num = (v: unknown) => Math.round(Number(v) * 100) / 100;

function mapBlock(row: Record<string, any>, timezone: string): HrmOvertimeBlock {
  const local = (value: unknown) =>
    new Date(String(value instanceof Date ? value.toISOString() : value))
      .toLocaleString('sv-SE', { timeZone: timezone, hour12: false })
      .slice(0, 16)
      .replace(' ', 'T');
  return {
    id: row.id,
    otRequestId: row.ot_request_id ?? null,
    tripDayLineId: row.trip_day_line_id ?? null,
    employeeId: row.employee_id,
    employeeCode: row.employee_code ?? null,
    employeeName: row.full_name ?? null,
    periodMonth: row.period_month,
    start: local(row.start_at),
    end: local(row.end_at),
    hours: num(row.hours),
    crossesMidnight: Boolean(row.crosses_midnight),
    ruleSet: row.rule_set,
    restFractionSuggested: Number(row.rest_fraction_suggested),
    otHoursSuggested: num(row.ot_hours_suggested),
    nightHoursSuggested: num(row.night_hours_suggested),
    otHoursFinal: num(row.ot_hours_final),
    nightHoursFinal: num(row.night_hours_final),
    source: row.source,
    overrideReason: row.override_reason ?? null,
    overriddenAt: row.overridden_at ? new Date(row.overridden_at).toISOString() : null,
    locked: Boolean(row.locked),
  };
}

const BLOCK_SELECT = `
  SELECT b.*,d.employee_code,d.full_name,
         EXISTS(SELECT 1 FROM hrm_schema.timesheet_periods p WHERE p.tenant_id=b.tenant_id AND p.period_code=b.period_month AND p.status='LOCKED') AS locked
    FROM hrm_schema.overtime_blocks b
    LEFT JOIN hrm_schema.employee_directory d ON d.tenant_id=b.tenant_id AND d.employee_id=b.employee_id`;

/** Danh sách ca đã phân loại của một tháng (có thể lọc theo nhân viên), kèm tình trạng khóa kỳ. */
export async function listOvertimeBlocks(
  db: Db,
  tenant: string,
  month: string,
  employeeId?: string,
): Promise<HrmOvertimeBlock[]> {
  const rows = await db.query(
    `${BLOCK_SELECT} WHERE b.tenant_id=$1 AND b.period_month=$2 AND ($3::uuid IS NULL OR b.employee_id=$3) ORDER BY d.employee_code,b.start_at`,
    [tenant, month, employeeId ?? null],
  );
  return rows.rows.map((r) => mapBlock(r, DEFAULT_TIMEZONE));
}

/**
 * HR sửa phân loại một ca: nhập giờ làm thêm chính thức (phần còn lại là ca đêm) kèm lý do, hoặc bỏ sửa tay để về gợi ý.
 * Không sửa ca của tháng đã chốt công.
 */
export async function overrideOvertimeBlock(
  db: Db,
  tenant: string,
  actor: string,
  blockId: string,
  body: OverrideHrmOvertimeBlockRequest,
): Promise<HrmOvertimeBlock> {
  const found = await db.query(`${BLOCK_SELECT} WHERE b.tenant_id=$1 AND b.id=$2 FOR UPDATE OF b`, [tenant, blockId]);
  const block = found.rows[0];
  if (!block) throw new NotFoundException('Không tìm thấy ca làm thêm');
  if (block.locked)
    throw new ConflictException(`Tháng ${block.period_month.slice(5)}/${block.period_month.slice(0, 4)} đã chốt công; cần mở lại tháng trước khi sửa phân loại`);
  const hours = Number(block.hours);
  if (body.revert) {
    await db.query(
      `UPDATE hrm_schema.overtime_blocks SET ot_hours_final=ot_hours_suggested,night_hours_final=night_hours_suggested,source='RULE',overridden_by=NULL,overridden_at=NULL,override_reason=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
      [tenant, blockId],
    );
    await lifecycleAudit(db, tenant, actor, 'OVERTIME_BLOCK_REVERTED', blockId, { before: block });
  } else {
    const reason = String(body.reason ?? '').trim();
    if (!reason) throw new BadRequestException('Cần nhập lý do khi sửa phân loại ca làm thêm');
    if (reason.length > 2000) throw new BadRequestException('Lý do tối đa 2000 ký tự');
    const ot = Number(body.otHours);
    if (!Number.isFinite(ot) || ot < 0 || ot > hours + 0.005)
      throw new BadRequestException(`Giờ làm thêm phải từ 0 đến ${hours} giờ (số giờ của ca)`);
    const rounded = Math.round(ot * 100) / 100;
    const night = Math.round((hours - rounded) * 100) / 100;
    await db.query(
      `UPDATE hrm_schema.overtime_blocks SET ot_hours_final=$3,night_hours_final=$4,source='MANUAL',overridden_by=$5,overridden_at=now(),override_reason=$6,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
      [tenant, blockId, rounded, night, actor, reason],
    );
    await lifecycleAudit(db, tenant, actor, 'OVERTIME_BLOCK_OVERRIDDEN', blockId, {
      before: { ot: block.ot_hours_final, night: block.night_hours_final, source: block.source },
      after: { ot: rounded, night },
      reason,
    });
  }
  const updated = await db.query(`${BLOCK_SELECT} WHERE b.tenant_id=$1 AND b.id=$2`, [tenant, blockId]);
  return mapBlock(updated.rows[0], DEFAULT_TIMEZONE);
}
