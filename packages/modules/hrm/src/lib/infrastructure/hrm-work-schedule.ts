import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  CONFLICT_MODES,
  compactRuns,
  expandPattern,
  listDates,
  normalizePattern,
  patternShiftIds,
  planSchedule,
  type ConflictMode,
  type ExistingDay,
  type IncomingDay,
  type PlannedDay,
  type PlanSummary,
  type WeekdayRule,
  type WorkDaySource,
  type WorkDayType,
} from '../domain/work-schedule.js';
import { lifecycleAudit } from './hrm-lifecycle.js';
import { workScheduleTableExists } from './hrm-shift-resolution.js';
import { resolveRuleDays } from './hrm-work-schedule-resolve.js';
import { assertOpenRange, isoDate } from './hrm-time.js';
import { requireDate, requireUuid } from './hrm-validation.js';

type Db = Pick<PoolClient, 'query'>;

export type ScheduleScopeType = 'EMPLOYEE' | 'EMPLOYEES' | 'UNIT' | 'COMPANY';
export interface ScheduleScope {
  type: ScheduleScopeType;
  employeeIds?: string[];
  unitIds?: string[];
  includeChildUnits?: boolean;
  excludeEmployeeIds?: string[];
}

export interface ScheduleEmployee {
  employeeId: string;
  code: string;
  name: string;
  unitId: string | null;
  unitName: string | null;
  joinDate: string;
  inactiveFrom: string | null;
}

export interface ShiftInfo {
  id: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
}

export type ScheduleKind = 'ASSIGN' | 'EXCEPTION';

export interface ApplyScheduleInput {
  kind?: ScheduleKind;
  scope: ScheduleScope;
  templateId?: string | null;
  pattern?: WeekdayRule[];
  fromDate: string;
  /** Bỏ trống = lịch định kỳ không có ngày kết thúc (xử lý ở hrm-work-schedule-rules.ts). */
  toDate?: string | null;
  conflictMode?: ConflictMode;
  reason?: string | null;
  confirm?: boolean;
}

export interface SchedulePreviewResult {
  summary: PlanSummary;
  employeeCount: number;
  dayCount: number;
  conflictTotal: number;
  conflicts: ScheduleConflictView[];
  employees: { employeeId: string; code: string; name: string; unitName: string | null; days: number }[];
  requiresConfirmation: boolean;
  confirmReasons: string[];
  lockedPeriods: string[];
}

export interface ScheduleConflictView {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  date: string;
  existing: { dayType: WorkDayType; shiftCode: string | null; source: WorkDaySource };
  incoming: { dayType: WorkDayType; shiftCode: string | null };
}

export const MAX_EMPLOYEES = 5000;
export const MAX_ROWS = 200_000;
const CONFLICT_PREVIEW_LIMIT = 200;
const INSERT_CHUNK = 5000;

export async function assertWorkScheduleReady(db: Db, tenantId: string) {
  if (!(await workScheduleTableExists(db, tenantId)))
    throw new ConflictException({
      code: 'HRM_SCHEDULE_NOT_MIGRATED',
      message: 'Dữ liệu phân ca chưa được khởi tạo cho tenant này; cần chạy migration HRM 0035 trước.',
    });
}

export function requireConflictMode(value: unknown): ConflictMode {
  if (value === undefined || value === null || value === '') return 'REPORT';
  if (!CONFLICT_MODES.includes(value as ConflictMode))
    throw new BadRequestException({ code: 'HRM_INVALID_INPUT', message: 'conflictMode không hợp lệ' });
  return value as ConflictMode;
}

function badInput(message: string): never {
  throw new BadRequestException({ code: 'HRM_INVALID_INPUT', message });
}

/** Bao bọc lỗi RangeError của lõi nghiệp vụ thành 400. */
export function guard<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof RangeError) badInput(error.message);
    throw error;
  }
}

export function validateScope(scope: ScheduleScope | undefined): ScheduleScope {
  if (!scope || typeof scope !== 'object') badInput('Cần chọn phạm vi áp dụng');
  const ids = (list: unknown, field: string): string[] => {
    if (list === undefined || list === null) return [];
    if (!Array.isArray(list)) badInput(`${field}: cần là danh sách`);
    return [...new Set((list as unknown[]).map((v) => requireUuid(v, field)))];
  };
  const result: ScheduleScope = {
    type: scope.type,
    employeeIds: ids(scope.employeeIds, 'employeeIds'),
    unitIds: ids(scope.unitIds, 'unitIds'),
    includeChildUnits: scope.includeChildUnits !== false,
    excludeEmployeeIds: ids(scope.excludeEmployeeIds, 'excludeEmployeeIds'),
  };
  if (result.type === 'EMPLOYEE' && result.employeeIds!.length !== 1) badInput('Chọn đúng một nhân viên');
  else if (result.type === 'EMPLOYEES' && !result.employeeIds!.length) badInput('Chọn ít nhất một nhân viên');
  else if (result.type === 'UNIT' && !result.unitIds!.length) badInput('Chọn ít nhất một phòng ban');
  else if (!['EMPLOYEE', 'EMPLOYEES', 'UNIT', 'COMPANY'].includes(result.type)) badInput('Phạm vi không hợp lệ');
  if (result.employeeIds!.length > MAX_EMPLOYEES) badInput(`Tối đa ${MAX_EMPLOYEES} nhân viên mỗi lần`);
  return result;
}

const EMPLOYEE_SQL = `
  SELECT p.employee_id, p.employee_code, e.full_name, p.join_date, p.inactive_from,
         au.unit_id, un.name AS unit_name
    FROM hrm_schema.employee_profiles p
    JOIN core_schema.employees e ON e.id = p.employee_id AND e.tenant_id = p.tenant_id AND e.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT CASE WHEN n.category = 'position' THEN n.parent_id ELSE n.id END AS unit_id
        FROM core_schema.organization_node_assignments a
        JOIN core_schema.organization_nodes n ON n.id = a.node_id AND n.deleted_at IS NULL
       WHERE a.deleted_at IS NULL AND a.status = 'active'
         AND (a.employee_id = e.id OR a.user_id = e.user_id)
         AND (a.start_date IS NULL OR a.start_date <= $3::date)
         AND (a.end_date IS NULL OR a.end_date >= $3::date)
       ORDER BY a.is_primary DESC, a.created_at
       LIMIT 1
    ) au ON true
    LEFT JOIN core_schema.organization_nodes un ON un.id = au.unit_id
   WHERE p.tenant_id = $1 AND p.deleted_at IS NULL
     AND p.join_date <= $2::date AND (p.inactive_from IS NULL OR p.inactive_from > $3::date)`;

/** Nhân viên thuộc phạm vi, còn làm việc ít nhất một ngày trong [from, to]. Phòng ban lấy theo phân công tổ chức tại ngày bắt đầu. */
export async function resolveScopeEmployees(
  db: Db,
  tenantId: string,
  scope: ScheduleScope,
  from: string,
  to: string,
): Promise<ScheduleEmployee[]> {
  const params: unknown[] = [tenantId, to, from];
  let filter = '';
  if (scope.type === 'EMPLOYEE' || scope.type === 'EMPLOYEES') {
    params.push(scope.employeeIds);
    filter = ` AND p.employee_id = ANY($${params.length}::uuid[])`;
  } else if (scope.type === 'UNIT') {
    let unitIds = scope.unitIds ?? [];
    if (scope.includeChildUnits !== false) {
      const sub = await db.query(
        `WITH RECURSIVE sub AS (
           SELECT id, 0 AS depth FROM core_schema.organization_nodes WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
           UNION ALL
           SELECT n.id, s.depth + 1 FROM core_schema.organization_nodes n JOIN sub s ON n.parent_id = s.id
            WHERE n.deleted_at IS NULL AND s.depth < 20
         ) SELECT DISTINCT id FROM sub`,
        [unitIds],
      );
      unitIds = sub.rows.map((r) => r.id as string);
    }
    if (!unitIds.length) return [];
    params.push(unitIds);
    filter = ` AND au.unit_id = ANY($${params.length}::uuid[])`;
  }
  if (scope.excludeEmployeeIds?.length) {
    params.push(scope.excludeEmployeeIds);
    filter += ` AND NOT (p.employee_id = ANY($${params.length}::uuid[]))`;
  }
  const res = await db.query(`${EMPLOYEE_SQL}${filter} ORDER BY p.employee_code`, params);
  if (res.rows.length > MAX_EMPLOYEES) badInput(`Phạm vi có ${res.rows.length} nhân viên, tối đa ${MAX_EMPLOYEES} mỗi lần`);
  if ((scope.type === 'EMPLOYEE' || scope.type === 'EMPLOYEES') && res.rows.length < (scope.employeeIds?.length ?? 0)) {
    const found = new Set(res.rows.map((r) => r.employee_id as string));
    const missing = (scope.employeeIds ?? []).filter((id) => !found.has(id));
    badInput(`Có ${missing.length} nhân viên không hợp lệ hoặc đã nghỉ việc trong khoảng ngày này`);
  }
  return res.rows.map((r) => ({
    employeeId: r.employee_id as string,
    code: r.employee_code as string,
    name: r.full_name as string,
    unitId: (r.unit_id as string | null) ?? null,
    unitName: (r.unit_name as string | null) ?? null,
    joinDate: isoDate(r.join_date),
    inactiveFrom: r.inactive_from ? isoDate(r.inactive_from) : null,
  }));
}

export async function loadShifts(db: Db, tenantId: string, ids: string[], mustBeActive = true): Promise<Map<string, ShiftInfo>> {
  const map = new Map<string, ShiftInfo>();
  if (!ids.length) return map;
  const res = await db.query(
    `SELECT id, code, name, to_char(start_time,'HH24:MI') AS start_time, to_char(end_time,'HH24:MI') AS end_time, break_minutes, status
       FROM hrm_schema.shift_definitions WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
    [tenantId, ids],
  );
  for (const r of res.rows) {
    if (mustBeActive && r.status !== 'ACTIVE') badInput(`Ca ${r.code} đã ngừng sử dụng`);
    map.set(r.id, {
      id: r.id,
      code: r.code,
      name: r.name,
      startTime: r.start_time,
      endTime: r.end_time,
      breakMinutes: Number(r.break_minutes ?? 0),
    });
  }
  const missing = ids.filter((id) => !map.has(id));
  if (missing.length) badInput('Có ca không tồn tại trong danh mục ca của tenant');
  return map;
}

export async function loadExisting(db: Db, tenantId: string, employeeIds: string[], from: string, to: string): Promise<ExistingDay[]> {
  if (!employeeIds.length) return [];
  const res = await db.query(
    `SELECT id, employee_id, work_date, day_type, shift_id, source FROM hrm_schema.employee_work_days
      WHERE tenant_id = $1 AND status = 'ACTIVE' AND employee_id = ANY($2::uuid[]) AND work_date BETWEEN $3::date AND $4::date`,
    [tenantId, employeeIds, from, to],
  );
  return res.rows.map((r) => ({
    id: r.id as string,
    employeeId: r.employee_id as string,
    date: isoDate(r.work_date),
    dayType: r.day_type as WorkDayType,
    shiftId: (r.shift_id as string | null) ?? null,
    source: r.source as WorkDaySource,
  }));
}

/** Kỳ công đã khoá giao với khoảng ngày (chỉ đọc, dùng cho xem trước). */
export async function lockedPeriodsIn(db: Db, tenantId: string, from: string, to: string): Promise<string[]> {
  const r = await db.query(
    `SELECT period_code FROM hrm_schema.timesheet_periods WHERE tenant_id = $1 AND status = 'LOCKED' AND from_date <= $3::date AND to_date >= $2::date ORDER BY from_date`,
    [tenantId, from, to],
  );
  return r.rows.map((x) => String(x.period_code));
}

async function resolvePattern(db: Db, tenantId: string, input: ApplyScheduleInput): Promise<WeekdayRule[]> {
  if (input.templateId) {
    requireUuid(input.templateId, 'templateId');
    const t = await db.query(
      `SELECT t.id, t.status, d.weekday, d.day_type, d.shift_id
         FROM hrm_schema.work_schedule_templates t
         LEFT JOIN hrm_schema.work_schedule_template_days d ON d.template_id = t.id
        WHERE t.tenant_id = $1 AND t.id = $2`,
      [tenantId, input.templateId],
    );
    if (!t.rows.length) throw new NotFoundException('Không tìm thấy mẫu lịch');
    if (t.rows[0].status !== 'ACTIVE') badInput('Mẫu lịch đã ngừng sử dụng');
    return t.rows
      .filter((r) => r.weekday)
      .map((r) => ({ weekday: Number(r.weekday), dayType: r.day_type, shiftId: r.shift_id ?? null }));
  }
  if (!Array.isArray(input.pattern) || !input.pattern.length) badInput('Cần chọn mẫu lịch hoặc thiết lập lịch tuần');
  return input.pattern;
}

interface Plan {
  kind: ScheduleKind;
  from: string;
  to: string;
  mode: ConflictMode;
  pattern: WeekdayRule[];
  employees: ScheduleEmployee[];
  shifts: Map<string, ShiftInfo>;
  incoming: IncomingDay[];
  existing: ExistingDay[];
  days: PlannedDay[];
  summary: PlanSummary;
}

async function buildPlan(db: Db, tenantId: string, input: ApplyScheduleInput): Promise<Plan> {
  const kind: ScheduleKind = input.kind === 'EXCEPTION' ? 'EXCEPTION' : 'ASSIGN';
  const from = requireDate(input.fromDate, 'fromDate');
  const to = requireDate(input.toDate, 'toDate');
  const dates = guard(() => listDates(from, to));
  const scope = validateScope(input.scope);
  const mode = requireConflictMode(input.conflictMode);
  const pattern = await resolvePattern(db, tenantId, input);
  guard(() => normalizePattern(pattern));
  const shifts = await loadShifts(db, tenantId, patternShiftIds(pattern));
  const employees = await resolveScopeEmployees(db, tenantId, scope, from, to);
  if (!employees.length) badInput('Không có nhân viên nào trong phạm vi đã chọn');
  if (employees.length * dates.length > MAX_ROWS)
    badInput(`Quá nhiều dữ liệu (${employees.length} nhân viên x ${dates.length} ngày); hãy chia nhỏ khoảng ngày hoặc phạm vi`);
  const source: WorkDaySource = kind === 'EXCEPTION' ? 'EXCEPTION' : 'TEMPLATE';
  const incoming = employees.flatMap((e) =>
    guard(() => expandPattern(pattern, e.employeeId, from, to, source, { joinDate: e.joinDate, inactiveFrom: e.inactiveFrom })),
  );
  if (!incoming.length) badInput('Lịch đã chọn không sinh ra ngày làm việc nào trong khoảng này');
  const existing = await loadExisting(db, tenantId, employees.map((e) => e.employeeId), from, to);
  const { days, summary } = planSchedule(incoming, existing, mode);
  return { kind, from, to, mode, pattern, employees, shifts, incoming, existing, days, summary };
}

function conflictViews(plan: Plan, limit: number): ScheduleConflictView[] {
  const byEmployee = new Map(plan.employees.map((e) => [e.employeeId, e]));
  return plan.days
    .filter((d) => d.action === 'CONFLICT' && d.existing)
    .slice(0, limit)
    .map((d) => {
      const e = byEmployee.get(d.incoming.employeeId)!;
      const shiftCode = (id: string | null) => (id ? (plan.shifts.get(id)?.code ?? null) : null);
      return {
        employeeId: e.employeeId,
        employeeCode: e.code,
        employeeName: e.name,
        date: d.incoming.date,
        existing: { dayType: d.existing!.dayType, shiftCode: null, source: d.existing!.source },
        incoming: { dayType: d.incoming.dayType, shiftCode: shiftCode(d.incoming.shiftId) },
      };
    });
}

/** Tên mã ca của dòng hiện có (không nằm trong mẫu) để hiển thị xung đột. */
async function attachExistingShiftCodes(db: Db, tenantId: string, plan: Plan, views: ScheduleConflictView[]) {
  const ids = plan.days
    .filter((d) => d.action === 'CONFLICT' && d.existing?.shiftId)
    .map((d) => d.existing!.shiftId!)
    .slice(0, CONFLICT_PREVIEW_LIMIT * 2);
  const known = await loadShifts(db, tenantId, [...new Set(ids)], false);
  const lookup = new Map<string, ExistingDay>();
  for (const d of plan.days) if (d.existing) lookup.set(`${d.existing.employeeId}|${d.existing.date}`, d.existing);
  for (const v of views) {
    const ex = lookup.get(`${v.employeeId}|${v.date}`);
    v.existing.shiftCode = ex?.shiftId ? (known.get(ex.shiftId)?.code ?? plan.shifts.get(ex.shiftId)?.code ?? null) : null;
  }
}

function confirmationOf(plan: Plan, scope: ScheduleScope): string[] {
  const reasons: string[] = [];
  if (plan.summary.replace > 0) reasons.push(`Ghi đè ${plan.summary.replace} ngày đã có lịch`);
  if (scope.type === 'COMPANY') reasons.push(`Áp dụng cho toàn công ty (${plan.summary.employees} nhân viên)`);
  return reasons;
}

export async function previewSchedule(db: Db, tenantId: string, input: ApplyScheduleInput): Promise<SchedulePreviewResult> {
  await assertWorkScheduleReady(db, tenantId);
  const plan = await buildPlan(db, tenantId, input);
  const scope = validateScope(input.scope);
  const perEmployee = new Map<string, number>();
  for (const d of plan.days)
    if (d.action === 'INSERT' || d.action === 'REPLACE') perEmployee.set(d.incoming.employeeId, (perEmployee.get(d.incoming.employeeId) ?? 0) + 1);
  const views = conflictViews(plan, CONFLICT_PREVIEW_LIMIT);
  await attachExistingShiftCodes(db, tenantId, plan, views);
  const reasons = confirmationOf(plan, scope);
  return {
    summary: plan.summary,
    employeeCount: plan.summary.employees,
    dayCount: plan.incoming.length,
    conflictTotal: plan.summary.conflicts,
    conflicts: views,
    employees: plan.employees.slice(0, 100).map((e) => ({
      employeeId: e.employeeId,
      code: e.code,
      name: e.name,
      unitName: e.unitName,
      days: perEmployee.get(e.employeeId) ?? 0,
    })),
    requiresConfirmation: reasons.length > 0,
    confirmReasons: reasons,
    lockedPeriods: await lockedPeriodsIn(db, tenantId, plan.from, plan.to),
  };
}

function snapshotOf(shift: ShiftInfo | undefined) {
  return shift
    ? JSON.stringify({ code: shift.code, name: shift.name, startTime: shift.startTime, endTime: shift.endTime, breakMinutes: shift.breakMinutes })
    : null;
}

interface InsertRow {
  employeeId: string;
  date: string;
  dayType: WorkDayType;
  shiftId: string | null;
  source: WorkDaySource;
}

async function insertDays(
  db: Db,
  tenantId: string,
  actorId: string,
  batchId: string,
  holidayId: string | null,
  rows: InsertRow[],
  shifts: Map<string, ShiftInfo>,
  note: string | null,
) {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK);
    await db.query(
      `INSERT INTO hrm_schema.employee_work_days
         (tenant_id, employee_id, work_date, day_type, shift_id, source, holiday_id, batch_id, shift_snapshot, note, status, created_by)
       SELECT $1, u.employee_id, u.work_date, u.day_type, u.shift_id, u.source, $2::uuid, $3::uuid, u.snap::jsonb, $4, 'ACTIVE', $5::uuid
         FROM unnest($6::uuid[], $7::date[], $8::text[], $9::uuid[], $10::text[], $11::text[]) AS u(employee_id, work_date, day_type, shift_id, source, snap)`,
      [
        tenantId,
        holidayId,
        batchId,
        note,
        actorId,
        chunk.map((r) => r.employeeId),
        chunk.map((r) => r.date),
        chunk.map((r) => r.dayType),
        chunk.map((r) => r.shiftId),
        chunk.map((r) => r.source),
        chunk.map((r) => snapshotOf(r.shiftId ? shifts.get(r.shiftId) : undefined)),
      ],
    );
  }
}

async function cancelRows(db: Db, tenantId: string, ids: string[], reason: string) {
  for (let i = 0; i < ids.length; i += INSERT_CHUNK) {
    await db.query(
      `UPDATE hrm_schema.employee_work_days SET status = 'CANCELLED', cancel_reason = $3, updated_at = now()
        WHERE tenant_id = $1 AND status = 'ACTIVE' AND id = ANY($2::uuid[])`,
      [tenantId, ids.slice(i, i + INSERT_CHUNK), reason],
    );
  }
}

async function writeAudit(
  db: Db,
  tenantId: string,
  actorId: string,
  batchId: string,
  action: string,
  from: string,
  to: string,
  reason: string | null,
  entries: { employeeId: string; unitId: string | null; before: ExistingDay[]; after: { date: string; dayType: WorkDayType; shiftId: string | null; source: WorkDaySource }[] }[],
  shifts: Map<string, ShiftInfo>,
) {
  const code = (id: string | null) => (id ? (shifts.get(id)?.code ?? id) : null);
  const withCodes = (runs: ReturnType<typeof compactRuns>) => runs.map((r) => ({ ...r, shiftCode: code(r.shiftId) }));
  for (let i = 0; i < entries.length; i += 1000) {
    const chunk = entries.slice(i, i + 1000);
    await db.query(
      `INSERT INTO hrm_schema.work_schedule_audit (tenant_id, batch_id, action, actor_id, employee_id, unit_id, from_date, to_date, before, after, reason)
       SELECT $1, $2::uuid, $3, $4::uuid, u.employee_id, u.unit_id, $5::date, $6::date, u.before::jsonb, u.after::jsonb, $7
         FROM unnest($8::uuid[], $9::uuid[], $10::text[], $11::text[]) AS u(employee_id, unit_id, before, after)`,
      [
        tenantId,
        batchId,
        action,
        actorId,
        from,
        to,
        reason,
        chunk.map((e) => e.employeeId),
        chunk.map((e) => e.unitId),
        chunk.map((e) => JSON.stringify(withCodes(compactRuns(e.before)))),
        chunk.map((e) => JSON.stringify(withCodes(compactRuns(e.after)))),
      ],
    );
  }
}

export interface ApplyResult {
  batchId: string;
  summary: PlanSummary;
  employeeCount: number;
  appliedDays: number;
}

/** Chạy trong transaction của controller. Ghi lịch, thay thế (CANCELLED) lịch cũ và ghi nhật ký. */
export async function applySchedule(db: Db, tenantId: string, actorId: string, input: ApplyScheduleInput): Promise<ApplyResult> {
  await assertWorkScheduleReady(db, tenantId);
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`hrm:work-schedule:${tenantId}`]);
  const scope = validateScope(input.scope);
  const plan = await buildPlan(db, tenantId, input);
  await assertOpenRange(db as PoolClient, tenantId, plan.from, plan.to);
  if (plan.summary.conflicts > 0) {
    const views = conflictViews(plan, CONFLICT_PREVIEW_LIMIT);
    await attachExistingShiftCodes(db, tenantId, plan, views);
    throw new ConflictException({
      code: 'HRM_SCHEDULE_CONFLICT',
      message: `Có ${plan.summary.conflicts} ngày đã có lịch khác; chọn cách xử lý (bỏ qua, ghi đè giữ ngoại lệ, ghi đè tất cả) rồi thử lại.`,
      summary: plan.summary,
      conflicts: views,
    });
  }
  const reasons = confirmationOf(plan, scope);
  if (reasons.length && input.confirm !== true)
    throw new ConflictException({
      code: 'HRM_SCHEDULE_CONFIRM_REQUIRED',
      message: `Cần xác nhận trước khi áp dụng: ${reasons.join('; ')}.`,
      summary: plan.summary,
      confirmReasons: reasons,
    });

  const writable = plan.days.filter((d) => d.action === 'INSERT' || d.action === 'REPLACE');
  const batch = await db.query(
    `INSERT INTO hrm_schema.work_schedule_batches (tenant_id, kind, scope_type, scope, template_id, pattern_snapshot, from_date, to_date, conflict_mode, employee_count, day_count, reason, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [
      tenantId,
      plan.kind,
      scope.type,
      JSON.stringify(scope),
      input.templateId ?? null,
      JSON.stringify(plan.pattern),
      plan.from,
      plan.to,
      plan.mode,
      plan.summary.employees,
      writable.length,
      input.reason ?? null,
      actorId,
    ],
  );
  const batchId = batch.rows[0].id as string;
  const replaced = writable.filter((d) => d.action === 'REPLACE' && d.existing).map((d) => d.existing!.id);
  await cancelRows(db, tenantId, replaced, `REPLACED_BY_BATCH:${batchId}`);
  await insertDays(
    db,
    tenantId,
    actorId,
    batchId,
    null,
    writable.map((d) => d.incoming),
    plan.shifts,
    input.reason ?? null,
  );

  const unitOf = new Map(plan.employees.map((e) => [e.employeeId, e.unitId]));
  const perEmployee = new Map<string, { before: ExistingDay[]; after: InsertRow[] }>();
  for (const d of writable) {
    const entry = perEmployee.get(d.incoming.employeeId) ?? { before: [], after: [] };
    if (d.existing) entry.before.push(d.existing);
    entry.after.push(d.incoming);
    perEmployee.set(d.incoming.employeeId, entry);
  }
  await writeAudit(
    db,
    tenantId,
    actorId,
    batchId,
    plan.kind === 'EXCEPTION' ? 'SCHEDULE_EXCEPTION' : replaced.length ? 'SCHEDULE_OVERWRITE' : 'SCHEDULE_ASSIGN',
    plan.from,
    plan.to,
    input.reason ?? null,
    [...perEmployee.entries()].map(([employeeId, v]) => ({ employeeId, unitId: unitOf.get(employeeId) ?? null, before: v.before, after: v.after })),
    plan.shifts,
  );
  await lifecycleAudit(db, tenantId, actorId, 'WORK_SCHEDULE_APPLIED', batchId, {
    kind: plan.kind,
    scope,
    from: plan.from,
    to: plan.to,
    mode: plan.mode,
    summary: plan.summary,
    reason: input.reason ?? null,
  });
  return { batchId, summary: plan.summary, employeeCount: plan.summary.employees, appliedDays: writable.length };
}

export interface CancelScheduleInput {
  scope: ScheduleScope;
  fromDate: string;
  toDate: string;
  includeExceptions?: boolean;
  reason?: string | null;
  confirm?: boolean;
}

/** Huỷ (CANCELLED) lịch phân ca của phạm vi trong khoảng ngày; mặc định giữ ngoại lệ và ngày lễ. Không xoá cứng. */
export async function cancelSchedule(db: Db, tenantId: string, actorId: string, input: CancelScheduleInput, dryRun = false) {
  await assertWorkScheduleReady(db, tenantId);
  if (!dryRun) await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`hrm:work-schedule:${tenantId}`]);
  const from = requireDate(input.fromDate, 'fromDate');
  const to = requireDate(input.toDate, 'toDate');
  guard(() => listDates(from, to));
  const scope = validateScope(input.scope);
  const employees = await resolveScopeEmployees(db, tenantId, scope, from, to);
  const sources = input.includeExceptions ? ['TEMPLATE', 'MANUAL', 'EXCEPTION', 'HOLIDAY'] : ['TEMPLATE', 'MANUAL'];
  const rows = await loadExisting(db, tenantId, employees.map((e) => e.employeeId), from, to);
  const targets = rows.filter((r) => sources.includes(r.source));
  const kept = rows.length - targets.length;
  const result = { employeeCount: new Set(targets.map((t) => t.employeeId)).size, dayCount: targets.length, keptProtected: kept };
  if (dryRun) return { ...result, batchId: null as string | null };
  if (input.confirm !== true)
    throw new ConflictException({
      code: 'HRM_SCHEDULE_CONFIRM_REQUIRED',
      message: `Cần xác nhận huỷ ${targets.length} ngày lịch của ${result.employeeCount} nhân viên.`,
      ...result,
    });
  if (!targets.length) return { ...result, batchId: null };
  await assertOpenRange(db as PoolClient, tenantId, from, to);
  const batch = await db.query(
    `INSERT INTO hrm_schema.work_schedule_batches (tenant_id, kind, scope_type, scope, from_date, to_date, employee_count, day_count, reason, created_by)
     VALUES ($1,'CANCEL',$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [tenantId, scope.type, JSON.stringify(scope), from, to, result.employeeCount, targets.length, input.reason ?? null, actorId],
  );
  const batchId = batch.rows[0].id as string;
  await cancelRows(db, tenantId, targets.map((t) => t.id), `CANCELLED_BY_BATCH:${batchId}`);
  const shiftIds = [...new Set(targets.map((t) => t.shiftId).filter((x): x is string => !!x))];
  const shifts = await loadShifts(db, tenantId, shiftIds, false);
  const unitOf = new Map(employees.map((e) => [e.employeeId, e.unitId]));
  const byEmployee = new Map<string, ExistingDay[]>();
  for (const t of targets) byEmployee.set(t.employeeId, [...(byEmployee.get(t.employeeId) ?? []), t]);
  await writeAudit(
    db,
    tenantId,
    actorId,
    batchId,
    'SCHEDULE_CANCEL',
    from,
    to,
    input.reason ?? null,
    [...byEmployee.entries()].map(([employeeId, before]) => ({ employeeId, unitId: unitOf.get(employeeId) ?? null, before, after: [] })),
    shifts,
  );
  await lifecycleAudit(db, tenantId, actorId, 'WORK_SCHEDULE_CANCELLED', batchId, { scope, from, to, ...result, reason: input.reason ?? null });
  return { ...result, batchId };
}

export interface CopyScheduleInput {
  sourceEmployeeId: string;
  scope: ScheduleScope;
  fromDate: string;
  toDate: string;
  conflictMode?: ConflictMode;
  reason?: string | null;
  confirm?: boolean;
}

/** Sao chép lịch của một nhân viên (đúng từng ngày, kể cả ngày nghỉ) sang phạm vi khác trong cùng khoảng ngày. */
export async function copySchedule(db: Db, tenantId: string, actorId: string, input: CopyScheduleInput, dryRun: boolean) {
  await assertWorkScheduleReady(db, tenantId);
  const sourceId = requireUuid(input.sourceEmployeeId, 'sourceEmployeeId');
  const from = requireDate(input.fromDate, 'fromDate');
  const to = requireDate(input.toDate, 'toDate');
  guard(() => listDates(from, to));
  const scope = validateScope(input.scope);
  const sourceRows = (await loadExisting(db, tenantId, [sourceId], from, to)).filter((r) => r.source !== 'HOLIDAY');
  if (!sourceRows.length) badInput('Nhân viên nguồn chưa có lịch phân ca trong khoảng ngày này');
  const targets = (await resolveScopeEmployees(db, tenantId, scope, from, to)).filter((e) => e.employeeId !== sourceId);
  if (!targets.length) badInput('Không có nhân viên đích trong phạm vi đã chọn');
  const shifts = await loadShifts(db, tenantId, [...new Set(sourceRows.map((r) => r.shiftId).filter((x): x is string => !!x))], false);
  const incoming: IncomingDay[] = targets.flatMap((t) =>
    sourceRows
      .filter((r) => r.date >= t.joinDate && (!t.inactiveFrom || r.date < t.inactiveFrom))
      .map((r) => ({ employeeId: t.employeeId, date: r.date, dayType: r.dayType, shiftId: r.shiftId, source: (r.source === 'EXCEPTION' ? 'EXCEPTION' : 'TEMPLATE') as WorkDaySource })),
  );
  const existing = await loadExisting(db, tenantId, targets.map((t) => t.employeeId), from, to);
  const mode = requireConflictMode(input.conflictMode);
  const { days, summary } = planSchedule(incoming, existing, mode);
  const reasons = [
    ...(summary.replace > 0 ? [`Ghi đè ${summary.replace} ngày đã có lịch`] : []),
    ...(scope.type === 'COMPANY' ? [`Áp dụng cho toàn công ty (${summary.employees} nhân viên)`] : []),
  ];
  if (dryRun) return { summary, requiresConfirmation: reasons.length > 0, confirmReasons: reasons, batchId: null as string | null };
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`hrm:work-schedule:${tenantId}`]);
  await assertOpenRange(db as PoolClient, tenantId, from, to);
  if (summary.conflicts > 0)
    throw new ConflictException({ code: 'HRM_SCHEDULE_CONFLICT', message: `Có ${summary.conflicts} ngày đã có lịch khác; chọn cách xử lý rồi thử lại.`, summary });
  if (reasons.length && input.confirm !== true)
    throw new ConflictException({ code: 'HRM_SCHEDULE_CONFIRM_REQUIRED', message: `Cần xác nhận: ${reasons.join('; ')}.`, summary, confirmReasons: reasons });
  const writable = days.filter((d) => d.action === 'INSERT' || d.action === 'REPLACE');
  const batch = await db.query(
    `INSERT INTO hrm_schema.work_schedule_batches (tenant_id, kind, scope_type, scope, from_date, to_date, conflict_mode, employee_count, day_count, reason, created_by)
     VALUES ($1,'COPY',$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [tenantId, scope.type, JSON.stringify({ ...scope, sourceEmployeeId: sourceId }), from, to, mode, summary.employees, writable.length, input.reason ?? null, actorId],
  );
  const batchId = batch.rows[0].id as string;
  await cancelRows(db, tenantId, writable.filter((d) => d.action === 'REPLACE' && d.existing).map((d) => d.existing!.id), `REPLACED_BY_BATCH:${batchId}`);
  await insertDays(db, tenantId, actorId, batchId, null, writable.map((d) => d.incoming), shifts, input.reason ?? null);
  const unitOf = new Map(targets.map((t) => [t.employeeId, t.unitId]));
  const per = new Map<string, { before: ExistingDay[]; after: InsertRow[] }>();
  for (const d of writable) {
    const e = per.get(d.incoming.employeeId) ?? { before: [], after: [] };
    if (d.existing) e.before.push(d.existing);
    e.after.push(d.incoming);
    per.set(d.incoming.employeeId, e);
  }
  await writeAudit(db, tenantId, actorId, batchId, 'SCHEDULE_COPY', from, to, input.reason ?? null,
    [...per.entries()].map(([employeeId, v]) => ({ employeeId, unitId: unitOf.get(employeeId) ?? null, before: v.before, after: v.after })), shifts);
  await lifecycleAudit(db, tenantId, actorId, 'WORK_SCHEDULE_COPIED', batchId, { sourceEmployeeId: sourceId, scope, from, to, summary });
  return { summary, requiresConfirmation: false, confirmReasons: [], batchId };
}

// ---------------------------------------------------------------- Ngày lễ / đặc biệt

export type HolidayKind = 'HOLIDAY' | 'TET' | 'COMPENSATORY' | 'SPECIAL';
export interface HolidayInput {
  name: string;
  kind: HolidayKind;
  fromDate: string;
  toDate: string;
  scope: { type: 'COMPANY' | 'UNIT' | 'EMPLOYEES'; employeeIds?: string[]; unitIds?: string[]; includeChildUnits?: boolean };
  treatment: 'OFF' | 'SHIFT';
  shiftId?: string | null;
  paid?: boolean;
  note?: string | null;
}

export async function createHoliday(db: Db, tenantId: string, actorId: string, input: HolidayInput) {
  await assertWorkScheduleReady(db, tenantId);
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`hrm:work-schedule:${tenantId}`]);
  const name = String(input.name ?? '').trim();
  if (!name || name.length > 180) badInput('Tên ngày lễ cần từ 1 đến 180 ký tự');
  if (!['HOLIDAY', 'TET', 'COMPENSATORY', 'SPECIAL'].includes(input.kind)) badInput('Loại ngày không hợp lệ');
  if (!['OFF', 'SHIFT'].includes(input.treatment)) badInput('Cách xử lý phải là nghỉ hoặc vẫn bố trí ca');
  const from = requireDate(input.fromDate, 'fromDate');
  const to = requireDate(input.toDate, 'toDate');
  const dates = guard(() => listDates(from, to));
  if (dates.length > 60) badInput('Một đợt lễ tối đa 60 ngày');
  const scope = validateScope(input.scope as ScheduleScope);
  if (!['COMPANY', 'UNIT', 'EMPLOYEES'].includes(scope.type)) badInput('Phạm vi ngày lễ không hợp lệ');
  const shiftId = input.treatment === 'SHIFT' ? requireUuid(input.shiftId, 'shiftId') : null;
  const shifts = await loadShifts(db, tenantId, shiftId ? [shiftId] : []);
  await assertOpenRange(db as PoolClient, tenantId, from, to);
  const employees = await resolveScopeEmployees(db, tenantId, scope, from, to);
  const paid = input.paid !== false;

  const created = await db.query(
    `INSERT INTO hrm_schema.company_holidays (tenant_id, name, kind, from_date, to_date, scope_type, scope, treatment, shift_id, paid, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [tenantId, name, input.kind, from, to, scope.type, JSON.stringify(scope), input.treatment, shiftId, paid, input.note ?? null, actorId],
  );
  const holidayId = created.rows[0].id as string;

  // Đồng bộ lịch lễ công ty để công thức tính công hiện có nhận biết ngày lễ (không ghi đè dòng đã có).
  let calendarIds: string[] = [];
  if (scope.type === 'COMPANY' && input.treatment === 'OFF' && input.kind !== 'SPECIAL') {
    const cal = await db.query(
      `INSERT INTO hrm_schema.work_calendar (tenant_id, work_date, day_kind, name, paid, created_by)
       SELECT $1, d::date, 'HOLIDAY', $2, $3, $4 FROM unnest($5::date[]) AS d
       ON CONFLICT (tenant_id, work_date) DO NOTHING RETURNING id`,
      [tenantId, name, paid, actorId, dates],
    );
    calendarIds = cal.rows.map((r) => r.id as string);
    if (calendarIds.length)
      await db.query(`UPDATE hrm_schema.company_holidays SET calendar_ids = $2 WHERE id = $1`, [holidayId, calendarIds]);
  }

  const dayType: WorkDayType = input.treatment === 'OFF' ? 'HOLIDAY' : 'SHIFT';
  const incoming: IncomingDay[] = employees.flatMap((e) =>
    dates
      .filter((date) => date >= e.joinDate && (!e.inactiveFrom || date < e.inactiveFrom))
      .map((date) => ({ employeeId: e.employeeId, date, dayType, shiftId, source: 'HOLIDAY' as WorkDaySource })),
  );
  const existing = await loadExisting(db, tenantId, employees.map((e) => e.employeeId), from, to);
  const { days, summary } = planSchedule(incoming, existing, 'OVERWRITE_KEEP_EXCEPTIONS');
  const writable = days.filter((d) => d.action === 'INSERT' || d.action === 'REPLACE');
  if (dayType === 'HOLIDAY') {
    // Giữ ca thường lệ bị ngày lễ thay thế để tính công trả lương ngày lễ theo số phút của ca đó.
    for (const d of writable)
      if (d.existing?.dayType === 'SHIFT' && d.existing.shiftId) d.incoming = { ...d.incoming, shiftId: d.existing.shiftId };
    const carried = [...new Set(writable.map((d) => d.incoming.shiftId).filter((x): x is string => !!x))];
    for (const [id, info] of await loadShifts(db, tenantId, carried, false)) shifts.set(id, info);
  }
  const batch = await db.query(
    `INSERT INTO hrm_schema.work_schedule_batches (tenant_id, kind, scope_type, scope, from_date, to_date, conflict_mode, employee_count, day_count, reason, created_by)
     VALUES ($1,'HOLIDAY',$2,$3,$4,$5,'OVERWRITE_KEEP_EXCEPTIONS',$6,$7,$8,$9) RETURNING id`,
    [tenantId, scope.type, JSON.stringify(scope), from, to, summary.employees, writable.length, name, actorId],
  );
  const batchId = batch.rows[0].id as string;
  await cancelRows(db, tenantId, writable.filter((d) => d.action === 'REPLACE' && d.existing).map((d) => d.existing!.id), `OVERRIDDEN_BY_HOLIDAY:${holidayId}`);
  await insertDays(db, tenantId, actorId, batchId, holidayId, writable.map((d) => d.incoming), shifts, input.note ?? null);
  const unitOf = new Map(employees.map((e) => [e.employeeId, e.unitId]));
  const per = new Map<string, { before: ExistingDay[]; after: InsertRow[] }>();
  for (const d of writable) {
    const e = per.get(d.incoming.employeeId) ?? { before: [], after: [] };
    if (d.existing) e.before.push(d.existing);
    e.after.push(d.incoming);
    per.set(d.incoming.employeeId, e);
  }
  await writeAudit(db, tenantId, actorId, batchId, 'HOLIDAY_CREATE', from, to, name,
    [...per.entries()].map(([employeeId, v]) => ({ employeeId, unitId: unitOf.get(employeeId) ?? null, before: v.before, after: v.after })), shifts);
  await lifecycleAudit(db, tenantId, actorId, 'WORK_HOLIDAY_CREATED', holidayId, { input, summary, calendarIds });
  return { id: holidayId, batchId, summary, employeeCount: summary.employees, calendarRows: calendarIds.length };
}

export async function cancelHoliday(db: Db, tenantId: string, actorId: string, holidayId: string, reason: string | null) {
  await assertWorkScheduleReady(db, tenantId);
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`hrm:work-schedule:${tenantId}`]);
  requireUuid(holidayId, 'id');
  const found = await db.query(`SELECT * FROM hrm_schema.company_holidays WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, holidayId]);
  const holiday = found.rows[0];
  if (!holiday) throw new NotFoundException('Không tìm thấy ngày lễ');
  if (holiday.status === 'CANCELLED') throw new ConflictException('Ngày lễ đã được huỷ trước đó');
  const from = isoDate(holiday.from_date);
  const to = isoDate(holiday.to_date);
  await assertOpenRange(db as PoolClient, tenantId, from, to);
  const cancelled = await db.query(
    `UPDATE hrm_schema.employee_work_days SET status = 'CANCELLED', cancel_reason = 'HOLIDAY_CANCELLED', updated_at = now()
      WHERE tenant_id = $1 AND holiday_id = $2 AND status = 'ACTIVE' RETURNING id`,
    [tenantId, holidayId],
  );
  // Trả lại lịch thường đã bị ngày lễ thay thế (chỉ khi ngày đó hiện không còn dòng hiệu lực nào).
  const restored = await db.query(
    `UPDATE hrm_schema.employee_work_days w SET status = 'ACTIVE', cancel_reason = NULL, updated_at = now()
      WHERE w.tenant_id = $1 AND w.cancel_reason = $2 AND w.status = 'CANCELLED'
        AND NOT EXISTS (SELECT 1 FROM hrm_schema.employee_work_days a WHERE a.tenant_id = w.tenant_id AND a.employee_id = w.employee_id AND a.work_date = w.work_date AND a.status = 'ACTIVE')
      RETURNING id`,
    [tenantId, `OVERRIDDEN_BY_HOLIDAY:${holidayId}`],
  );
  const calendarIds = (holiday.calendar_ids as string[] | null) ?? [];
  if (calendarIds.length)
    await db.query(`DELETE FROM hrm_schema.work_calendar WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, calendarIds]);
  await db.query(`UPDATE hrm_schema.company_holidays SET status = 'CANCELLED', updated_at = now() WHERE tenant_id = $1 AND id = $2`, [tenantId, holidayId]);
  const batch = await db.query(
    `INSERT INTO hrm_schema.work_schedule_batches (tenant_id, kind, scope_type, scope, from_date, to_date, employee_count, day_count, reason, created_by)
     VALUES ($1,'HOLIDAY',$2,$3,$4,$5,0,$6,$7,$8) RETURNING id`,
    [tenantId, holiday.scope_type, holiday.scope, from, to, cancelled.rowCount ?? 0, reason ?? `Huỷ ngày lễ: ${holiday.name}`, actorId],
  );
  await db.query(
    `INSERT INTO hrm_schema.work_schedule_audit (tenant_id, batch_id, action, actor_id, from_date, to_date, before, after, reason)
     VALUES ($1,$2,'HOLIDAY_CANCEL',$3,$4,$5,$6,$7,$8)`,
    [tenantId, batch.rows[0].id, actorId, from, to,
      JSON.stringify({ holidayId, name: holiday.name, removedDays: cancelled.rowCount ?? 0 }),
      JSON.stringify({ restoredDays: restored.rowCount ?? 0 }), reason],
  );
  await lifecycleAudit(db, tenantId, actorId, 'WORK_HOLIDAY_CANCELLED', holidayId, { removedDays: cancelled.rowCount, restoredDays: restored.rowCount, reason });
  return { id: holidayId, removedDays: cancelled.rowCount ?? 0, restoredDays: restored.rowCount ?? 0 };
}

// ---------------------------------------------------------------- Tra cứu

export interface ScheduleQuery {
  from: string;
  to: string;
  unitId?: string | null;
  includeChildUnits?: boolean;
  employeeId?: string | null;
  q?: string | null;
  coverage?: 'unassigned' | null;
  page?: number;
  pageSize?: number;
}

export async function queryScheduleGrid(db: Db, tenantId: string, query: ScheduleQuery) {
  await assertWorkScheduleReady(db, tenantId);
  const from = requireDate(query.from, 'from');
  const to = requireDate(query.to, 'to');
  const dates = guard(() => listDates(from, to));
  if (dates.length > 62) badInput('Chế độ lưới xem tối đa 62 ngày');
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Math.trunc(query.pageSize ?? 50)));
  const params: unknown[] = [tenantId, to, from];
  let filter = '';
  if (query.employeeId) {
    params.push(requireUuid(query.employeeId, 'employeeId'));
    filter += ` AND p.employee_id = $${params.length}`;
  }
  if (query.unitId) {
    const unitId = requireUuid(query.unitId, 'unitId');
    const sub = await db.query(
      query.includeChildUnits === false
        ? `SELECT id FROM core_schema.organization_nodes WHERE id = $1 AND deleted_at IS NULL`
        : `WITH RECURSIVE sub AS (
             SELECT id, 0 AS depth FROM core_schema.organization_nodes WHERE id = $1 AND deleted_at IS NULL
             UNION ALL SELECT n.id, s.depth + 1 FROM core_schema.organization_nodes n JOIN sub s ON n.parent_id = s.id WHERE n.deleted_at IS NULL AND s.depth < 20
           ) SELECT DISTINCT id FROM sub`,
      [unitId],
    );
    params.push(sub.rows.map((r) => r.id as string));
    filter += ` AND au.unit_id = ANY($${params.length}::uuid[])`;
  }
  if (query.q?.trim()) {
    params.push(`%${query.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    filter += ` AND (p.employee_code ILIKE $${params.length} OR e.full_name ILIKE $${params.length})`;
  }
  if (query.coverage === 'unassigned') {
    params.push(from, to);
    filter += ` AND NOT EXISTS (SELECT 1 FROM hrm_schema.employee_work_days w WHERE w.tenant_id = p.tenant_id AND w.employee_id = p.employee_id AND w.status = 'ACTIVE' AND w.work_date BETWEEN $${params.length - 1}::date AND $${params.length}::date)`;
  }
  const total = await db.query(`SELECT count(*)::int AS n FROM (${EMPLOYEE_SQL}${filter}) x`, params);
  params.push(pageSize, (page - 1) * pageSize);
  const employees = await db.query(`${EMPLOYEE_SQL}${filter} ORDER BY p.employee_code LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  const ids = employees.rows.map((r) => r.employee_id as string);
  const rows = ids.length
    ? await db.query(
        `SELECT w.employee_id, w.work_date, w.day_type, w.shift_id, w.source, w.holiday_id, w.note,
                s.code AS shift_code, s.name AS shift_name, to_char(s.start_time,'HH24:MI') AS start_time, to_char(s.end_time,'HH24:MI') AS end_time
           FROM hrm_schema.employee_work_days w LEFT JOIN hrm_schema.shift_definitions s ON s.id = w.shift_id
          WHERE w.tenant_id = $1 AND w.status = 'ACTIVE' AND w.employee_id = ANY($2::uuid[]) AND w.work_date BETWEEN $3::date AND $4::date`,
        [tenantId, ids, from, to],
      )
    : { rows: [] };
  const holidays = await db.query(
    `SELECT id, name, kind, from_date, to_date, scope_type, treatment FROM hrm_schema.company_holidays
      WHERE tenant_id = $1 AND status = 'ACTIVE' AND from_date <= $3::date AND to_date >= $2::date ORDER BY from_date`,
    [tenantId, from, to],
  );
  const materialized: ScheduleDayView[] = rows.rows.map((r) => ({
    employeeId: r.employee_id as string,
    date: isoDate(r.work_date),
    dayType: r.day_type as WorkDayType,
    shiftId: (r.shift_id as string | null) ?? null,
    shiftCode: (r.shift_code as string | null) ?? null,
    shiftName: (r.shift_name as string | null) ?? null,
    startTime: (r.start_time as string | null) ?? null,
    endTime: (r.end_time as string | null) ?? null,
    source: r.source as WorkDaySource,
    holidayId: (r.holiday_id as string | null) ?? null,
    note: (r.note as string | null) ?? null,
  }));
  const fromRules = await ruleDaysNotMaterialized(db, tenantId, ids, from, to, materialized);
  return {
    employees: employees.rows.map((r) => ({
      employeeId: r.employee_id,
      code: r.employee_code,
      name: r.full_name,
      unitId: r.unit_id ?? null,
      unitName: r.unit_name ?? null,
    })),
    days: [...materialized, ...fromRules],
    holidays: holidays.rows.map((h) => ({
      id: h.id as string,
      name: h.name as string,
      kind: h.kind as HolidayKind,
      fromDate: isoDate(h.from_date),
      toDate: isoDate(h.to_date),
      scopeType: h.scope_type as string,
      treatment: h.treatment as string,
    })),
    meta: { total: total.rows[0].n as number, page, pageSize },
  };
}

/** Danh sách phân ca theo đợt: mỗi dòng là một nhóm ngày cùng ca/nguồn/đợt của một nhân viên. */
export async function queryScheduleList(db: Db, tenantId: string, query: ScheduleQuery) {
  await assertWorkScheduleReady(db, tenantId);
  const from = requireDate(query.from, 'from');
  const to = requireDate(query.to, 'to');
  guard(() => listDates(from, to));
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(500, Math.max(1, Math.trunc(query.pageSize ?? 100)));
  const params: unknown[] = [tenantId, from, to];
  let filter = '';
  if (query.employeeId) {
    params.push(requireUuid(query.employeeId, 'employeeId'));
    filter += ` AND w.employee_id = $${params.length}`;
  }
  if (query.unitId) {
    const sub = await db.query(
      `WITH RECURSIVE sub AS (
         SELECT id, 0 AS depth FROM core_schema.organization_nodes WHERE id = $1 AND deleted_at IS NULL
         UNION ALL SELECT n.id, s.depth + 1 FROM core_schema.organization_nodes n JOIN sub s ON n.parent_id = s.id WHERE n.deleted_at IS NULL AND s.depth < 20
       ) SELECT DISTINCT id FROM sub`,
      [requireUuid(query.unitId, 'unitId')],
    );
    params.push(sub.rows.map((r) => r.id as string));
    filter += ` AND au.unit_id = ANY($${params.length}::uuid[])`;
  }
  if (query.q?.trim()) {
    params.push(`%${query.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    filter += ` AND (p.employee_code ILIKE $${params.length} OR e.full_name ILIKE $${params.length})`;
  }
  const base = `
    FROM hrm_schema.employee_work_days w
    JOIN hrm_schema.employee_profiles p ON p.employee_id = w.employee_id AND p.tenant_id = w.tenant_id
    JOIN core_schema.employees e ON e.id = p.employee_id AND e.tenant_id = p.tenant_id
    LEFT JOIN LATERAL (
      SELECT CASE WHEN n.category = 'position' THEN n.parent_id ELSE n.id END AS unit_id
        FROM core_schema.organization_node_assignments a
        JOIN core_schema.organization_nodes n ON n.id = a.node_id AND n.deleted_at IS NULL
       WHERE a.deleted_at IS NULL AND a.status = 'active' AND (a.employee_id = e.id OR a.user_id = e.user_id)
         AND (a.start_date IS NULL OR a.start_date <= $2::date) AND (a.end_date IS NULL OR a.end_date >= $2::date)
       ORDER BY a.is_primary DESC, a.created_at LIMIT 1) au ON true
    LEFT JOIN core_schema.organization_nodes un ON un.id = au.unit_id
    LEFT JOIN hrm_schema.shift_definitions s ON s.id = w.shift_id
   WHERE w.tenant_id = $1 AND w.status = 'ACTIVE' AND w.work_date BETWEEN $2::date AND $3::date${filter}`;
  const grouped = `SELECT w.employee_id, p.employee_code, e.full_name, un.name AS unit_name, w.day_type, w.shift_id, s.code AS shift_code, s.name AS shift_name,
        w.source, w.batch_id, min(w.work_date) AS from_date, max(w.work_date) AS to_date, count(*)::int AS days,
        array_agg(DISTINCT extract(isodow FROM w.work_date)::int ORDER BY extract(isodow FROM w.work_date)::int) AS weekdays
      ${base} GROUP BY w.employee_id, p.employee_code, e.full_name, un.name, w.day_type, w.shift_id, s.code, s.name, w.source, w.batch_id`;
  const total = await db.query(`SELECT count(*)::int AS n FROM (${grouped}) g`, params);
  params.push(pageSize, (page - 1) * pageSize);
  const res = await db.query(`${grouped} ORDER BY employee_code, from_date LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return {
    rows: res.rows.map((r) => ({
      employeeId: r.employee_id as string,
      employeeCode: r.employee_code as string,
      employeeName: r.full_name as string,
      unitName: (r.unit_name as string | null) ?? null,
      dayType: r.day_type as WorkDayType,
      shiftId: (r.shift_id as string | null) ?? null,
      shiftCode: (r.shift_code as string | null) ?? null,
      shiftName: (r.shift_name as string | null) ?? null,
      source: r.source as WorkDaySource,
      batchId: (r.batch_id as string | null) ?? null,
      fromDate: isoDate(r.from_date),
      toDate: isoDate(r.to_date),
      days: r.days as number,
      weekdays: r.weekdays as number[],
      status: 'ACTIVE' as const,
    })),
    meta: { total: total.rows[0].n as number, page, pageSize },
  };
}

export async function queryScheduleAudit(db: Db, tenantId: string, filter: { employeeId?: string | null; batchId?: string | null; limit?: number }) {
  await assertWorkScheduleReady(db, tenantId);
  const params: unknown[] = [tenantId];
  let where = '';
  if (filter.employeeId) {
    params.push(requireUuid(filter.employeeId, 'employeeId'));
    where += ` AND a.employee_id = $${params.length}`;
  }
  if (filter.batchId) {
    params.push(requireUuid(filter.batchId, 'batchId'));
    where += ` AND a.batch_id = $${params.length}`;
  }
  params.push(Math.min(500, Math.max(1, Math.trunc(filter.limit ?? 100))));
  const res = await db.query(
    `SELECT a.id, a.batch_id, a.action, a.actor_id, a.employee_id, a.from_date, a.to_date, a.before, a.after, a.reason, a.created_at,
            p.employee_code, e.full_name, u.full_name AS actor_name
       FROM hrm_schema.work_schedule_audit a
       LEFT JOIN hrm_schema.employee_profiles p ON p.employee_id = a.employee_id AND p.tenant_id = a.tenant_id
       LEFT JOIN core_schema.employees e ON e.id = a.employee_id
       LEFT JOIN core_schema.users u ON u.id = a.actor_id
      WHERE a.tenant_id = $1${where} ORDER BY a.created_at DESC LIMIT $${params.length}`,
    params,
  );
  return res.rows.map((r) => ({
    id: r.id as string,
    batchId: (r.batch_id as string | null) ?? null,
    action: r.action as string,
    actorId: (r.actor_id as string | null) ?? null,
    actorName: (r.actor_name as string | null) ?? null,
    employeeId: (r.employee_id as string | null) ?? null,
    employeeCode: (r.employee_code as string | null) ?? null,
    employeeName: (r.full_name as string | null) ?? null,
    fromDate: r.from_date ? isoDate(r.from_date) : null,
    toDate: r.to_date ? isoDate(r.to_date) : null,
    before: r.before,
    after: r.after,
    reason: (r.reason as string | null) ?? null,
    createdAt: new Date(r.created_at as string).toISOString(),
  }));
}

export interface ScheduleDayView {
  employeeId: string;
  date: string;
  dayType: WorkDayType;
  shiftId: string | null;
  shiftCode: string | null;
  shiftName: string | null;
  startTime: string | null;
  endTime: string | null;
  source: WorkDaySource | 'RULE';
  holidayId: string | null;
  note: string | null;
}

/** Ngày đến từ lịch định kỳ (không kết thúc) mà nhân viên chưa có dòng sinh sẵn: dòng sinh sẵn luôn thắng. */
export async function ruleDaysNotMaterialized(
  db: Db,
  tenantId: string,
  employeeIds: string[],
  from: string,
  to: string,
  materialized: { employeeId: string; date: string }[],
): Promise<ScheduleDayView[]> {
  const ruleDays = await resolveRuleDays(db, tenantId, employeeIds, from, to);
  if (!ruleDays.length) return [];
  const taken = new Set(materialized.map((d) => `${d.employeeId}|${d.date}`));
  const fresh = ruleDays.filter((d) => !taken.has(`${d.employeeId}|${d.date}`));
  const shifts = await loadShifts(db, tenantId, [...new Set(fresh.map((d) => d.shiftId).filter((x): x is string => !!x))], false);
  return fresh.map((d) => {
    const shift = d.shiftId ? shifts.get(d.shiftId) : undefined;
    return {
      employeeId: d.employeeId,
      date: d.date,
      dayType: d.dayType,
      shiftId: d.shiftId,
      shiftCode: shift?.code ?? null,
      shiftName: shift?.name ?? null,
      startTime: shift?.startTime ?? null,
      endTime: shift?.endTime ?? null,
      source: 'RULE' as const,
      holidayId: null,
      note: null,
    };
  });
}

/** Dữ liệu từng ngày để xuất file: dòng sinh sẵn cộng ngày từ lịch định kỳ, theo cùng bộ lọc với lưới. */
export async function queryScheduleExport(db: Db, tenantId: string, query: ScheduleQuery, maxRows = 100_000) {
  await assertWorkScheduleReady(db, tenantId);
  const from = requireDate(query.from, 'from');
  const to = requireDate(query.to, 'to');
  const dates = guard(() => listDates(from, to));
  const params: unknown[] = [tenantId, to, from];
  let filter = '';
  if (query.employeeId) {
    params.push(requireUuid(query.employeeId, 'employeeId'));
    filter += ` AND p.employee_id = $${params.length}`;
  }
  if (query.unitId) {
    const sub = await db.query(
      `WITH RECURSIVE sub AS (
         SELECT id, 0 AS depth FROM core_schema.organization_nodes WHERE id = $1 AND deleted_at IS NULL
         UNION ALL SELECT n.id, s.depth + 1 FROM core_schema.organization_nodes n JOIN sub s ON n.parent_id = s.id WHERE n.deleted_at IS NULL AND s.depth < 20
       ) SELECT DISTINCT id FROM sub`,
      [requireUuid(query.unitId, 'unitId')],
    );
    params.push(sub.rows.map((r) => r.id as string));
    filter += ` AND au.unit_id = ANY($${params.length}::uuid[])`;
  }
  if (query.q?.trim()) {
    params.push(`%${query.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    filter += ` AND (p.employee_code ILIKE $${params.length} OR e.full_name ILIKE $${params.length})`;
  }
  const employees = await db.query(`${EMPLOYEE_SQL}${filter} ORDER BY p.employee_code LIMIT ${MAX_EMPLOYEES + 1}`, params);
  if (employees.rows.length > MAX_EMPLOYEES) badInput(`Quá ${MAX_EMPLOYEES} nhân viên; hãy lọc theo phòng ban`);
  if (employees.rows.length * dates.length > maxRows) badInput(`Quá ${maxRows} dòng; hãy thu hẹp khoảng ngày hoặc phạm vi`);
  const ids = employees.rows.map((r) => r.employee_id as string);
  if (!ids.length) return [];
  const rows = await db.query(
    `SELECT w.employee_id, w.work_date, w.day_type, w.shift_id, w.source, s.code AS shift_code, s.name AS shift_name,
            to_char(s.start_time,'HH24:MI') AS start_time, to_char(s.end_time,'HH24:MI') AS end_time
       FROM hrm_schema.employee_work_days w LEFT JOIN hrm_schema.shift_definitions s ON s.id = w.shift_id
      WHERE w.tenant_id = $1 AND w.status = 'ACTIVE' AND w.employee_id = ANY($2::uuid[]) AND w.work_date BETWEEN $3::date AND $4::date`,
    [tenantId, ids, from, to],
  );
  const materialized: ScheduleDayView[] = rows.rows.map((r) => ({
    employeeId: r.employee_id as string,
    date: isoDate(r.work_date),
    dayType: r.day_type as WorkDayType,
    shiftId: (r.shift_id as string | null) ?? null,
    shiftCode: (r.shift_code as string | null) ?? null,
    shiftName: (r.shift_name as string | null) ?? null,
    startTime: (r.start_time as string | null) ?? null,
    endTime: (r.end_time as string | null) ?? null,
    source: r.source as WorkDaySource,
    holidayId: null,
    note: null,
  }));
  const all = [...materialized, ...(await ruleDaysNotMaterialized(db, tenantId, ids, from, to, materialized))];
  const byEmployee = new Map(employees.rows.map((e) => [e.employee_id as string, e]));
  return all
    .map((d) => {
      const e = byEmployee.get(d.employeeId)!;
      const weekday = new Date(`${d.date}T00:00:00Z`).getUTCDay();
      return {
        employeeCode: e.employee_code as string,
        employeeName: e.full_name as string,
        unitName: (e.unit_name as string | null) ?? '',
        date: d.date,
        weekday: weekday === 0 ? 7 : weekday,
        dayType: d.dayType,
        shiftCode: d.shiftCode ?? '',
        shiftName: d.shiftName ?? '',
        startTime: d.startTime ?? '',
        endTime: d.endTime ?? '',
        source: d.source,
      };
    })
    .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode) || a.date.localeCompare(b.date));
}
