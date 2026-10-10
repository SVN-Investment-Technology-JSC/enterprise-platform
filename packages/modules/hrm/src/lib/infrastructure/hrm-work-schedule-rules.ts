import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  dayBefore,
  normalizePattern,
  patternShiftIds,
  planRuleReplacement,
  type ConflictMode,
  type RuleReplacement,
  type RuleScopeType,
  type WeekdayRule,
} from '../domain/work-schedule.js';
import { lifecycleAudit } from './hrm-lifecycle.js';
import { assertOpenRange, isoDate } from './hrm-time.js';
import { requireDate, requireUuid } from './hrm-validation.js';
import {
  assertWorkScheduleReady,
  guard,
  loadShifts,
  requireConflictMode,
  validateScope,
  type ApplyScheduleInput,
  type ScheduleScope,
} from './hrm-work-schedule.js';
import { ruleTableExists } from './hrm-work-schedule-resolve.js';

type Db = Pick<PoolClient, 'query'>;

export async function assertRulesReady(db: Db, tenantId: string) {
  await assertWorkScheduleReady(db, tenantId);
  if (!(await ruleTableExists(db, tenantId)))
    throw new ConflictException({
      code: 'HRM_SCHEDULE_RULES_NOT_MIGRATED',
      message: 'Lịch định kỳ chưa được khởi tạo cho tenant này (cần chạy migration HRM 0036). Có thể gán theo khoảng ngày thay thế.',
    });
}

function badInput(message: string): never {
  throw new BadRequestException({ code: 'HRM_INVALID_INPUT', message });
}

/** Gán không có ngày kết thúc: bỏ trống toDate. */
export function isOpenEnded(input: { toDate?: string | null }): boolean {
  return input.toDate === undefined || input.toDate === null || input.toDate === '';
}

interface RuleTarget {
  scopeType: RuleScopeType;
  employeeId: string | null;
  unitId: string | null;
  label: string;
}

export interface RuleChangeView {
  id: string;
  from: string;
  to: string | null;
  templateName: string | null;
  action: 'TRUNCATE' | 'CANCEL';
  newTo: string | null;
}

export interface RulePreviewItem {
  scopeType: RuleScopeType;
  scopeLabel: string;
  changes: RuleChangeView[];
}

interface RulePlan {
  from: string;
  mode: ConflictMode;
  pattern: WeekdayRule[];
  templateId: string | null;
  templateName: string | null;
  scope: ScheduleScope;
  targets: RuleTarget[];
  perTarget: { target: RuleTarget; replacement: RuleReplacement; existing: RuleChangeView[] }[];
}

async function resolveTemplate(db: Db, tenantId: string, input: ApplyScheduleInput) {
  if (input.templateId) {
    requireUuid(input.templateId, 'templateId');
    const t = await db.query(
      `SELECT t.id, t.name, t.status, d.weekday, d.day_type, d.shift_id
         FROM hrm_schema.work_schedule_templates t
         LEFT JOIN hrm_schema.work_schedule_template_days d ON d.template_id = t.id
        WHERE t.tenant_id = $1 AND t.id = $2`,
      [tenantId, input.templateId],
    );
    if (!t.rows.length) throw new NotFoundException('Không tìm thấy mẫu lịch');
    if (t.rows[0].status !== 'ACTIVE') badInput('Mẫu lịch đã ngừng sử dụng');
    return {
      templateId: input.templateId,
      templateName: t.rows[0].name as string,
      pattern: t.rows
        .filter((r) => r.weekday)
        .map((r) => ({ weekday: Number(r.weekday), dayType: r.day_type, shiftId: r.shift_id ?? null })) as WeekdayRule[],
    };
  }
  if (!Array.isArray(input.pattern) || !input.pattern.length) badInput('Cần chọn mẫu lịch hoặc thiết lập lịch tuần');
  return { templateId: null, templateName: null, pattern: input.pattern as WeekdayRule[] };
}

async function buildRulePlan(db: Db, tenantId: string, input: ApplyScheduleInput): Promise<RulePlan> {
  await assertRulesReady(db, tenantId);
  if (!isOpenEnded(input)) badInput('Lịch định kỳ không có ngày kết thúc');
  if (input.kind === 'EXCEPTION') badInput('Ngoại lệ phải có khoảng ngày cụ thể (cần ngày kết thúc)');
  const from = requireDate(input.fromDate, 'fromDate');
  const scope = validateScope(input.scope);
  if (scope.excludeEmployeeIds?.length)
    badInput('Loại trừ nhân viên chỉ dùng được khi gán có ngày kết thúc; với lịch không kết thúc hãy tạo ngoại lệ hoặc lịch riêng cho nhân viên đó');
  const mode = requireConflictMode(input.conflictMode);
  const tpl = await resolveTemplate(db, tenantId, input);
  guard(() => normalizePattern(tpl.pattern));
  await loadShifts(db, tenantId, patternShiftIds(tpl.pattern));

  let targets: RuleTarget[];
  if (scope.type === 'COMPANY') {
    targets = [{ scopeType: 'COMPANY', employeeId: null, unitId: null, label: 'Toàn công ty' }];
  } else if (scope.type === 'UNIT') {
    const units = await db.query(
      `SELECT id, name FROM core_schema.organization_nodes WHERE id = ANY($1::uuid[]) AND category <> 'position' AND deleted_at IS NULL`,
      [scope.unitIds],
    );
    if (units.rows.length !== scope.unitIds!.length) badInput('Có phòng ban không tồn tại hoặc không phải đơn vị tổ chức');
    targets = units.rows.map((u) => ({ scopeType: 'UNIT' as const, employeeId: null, unitId: u.id as string, label: `Phòng ban ${u.name}` }));
  } else {
    const emps = await db.query(
      `SELECT p.employee_id, p.employee_code, e.full_name FROM hrm_schema.employee_profiles p
         JOIN core_schema.employees e ON e.id = p.employee_id AND e.tenant_id = p.tenant_id AND e.deleted_at IS NULL
        WHERE p.tenant_id = $1 AND p.deleted_at IS NULL AND p.employee_id = ANY($2::uuid[]) ORDER BY p.employee_code`,
      [tenantId, scope.employeeIds],
    );
    if (emps.rows.length !== scope.employeeIds!.length) badInput('Có nhân viên không tồn tại hoặc đã bị xoá');
    targets = emps.rows.map((e) => ({
      scopeType: 'EMPLOYEE' as const,
      employeeId: e.employee_id as string,
      unitId: null,
      label: `${e.employee_code} - ${e.full_name}`,
    }));
  }

  const perTarget: RulePlan['perTarget'] = [];
  for (const target of targets) {
    const existing = await db.query(
      `SELECT id, effective_from, effective_to, template_name FROM hrm_schema.work_schedule_rules
        WHERE tenant_id = $1 AND status = 'ACTIVE' AND scope_type = $2
          AND employee_id IS NOT DISTINCT FROM $3::uuid AND unit_id IS NOT DISTINCT FROM $4::uuid
          AND (effective_to IS NULL OR effective_to >= $5::date)
        ORDER BY effective_from`,
      [tenantId, target.scopeType, target.employeeId, target.unitId, from],
    );
    const rows = existing.rows.map((r) => ({
      id: r.id as string,
      from: isoDate(r.effective_from),
      to: r.effective_to ? isoDate(r.effective_to) : null,
      templateName: (r.template_name as string | null) ?? null,
    }));
    const replacement = planRuleReplacement(rows, from);
    const truncate = new Map(replacement.truncate.map((t) => [t.id, t.newTo]));
    perTarget.push({
      target,
      replacement,
      existing: rows.map((r) => ({
        ...r,
        action: truncate.has(r.id) ? ('TRUNCATE' as const) : ('CANCEL' as const),
        newTo: truncate.get(r.id) ?? null,
      })),
    });
  }
  return { from, mode, pattern: tpl.pattern, templateId: tpl.templateId, templateName: tpl.templateName, scope, targets, perTarget };
}

function changedCount(plan: RulePlan) {
  return plan.perTarget.reduce((n, p) => n + p.existing.length, 0);
}

function confirmReasons(plan: RulePlan): string[] {
  const reasons: string[] = [];
  const changed = changedCount(plan);
  if (changed > 0 && plan.mode !== 'SKIP_EXISTING') reasons.push(`Thay ${changed} lịch định kỳ đang áp dụng (cắt hoặc huỷ từ ${plan.from})`);
  if (plan.scope.type === 'COMPANY') reasons.push('Áp dụng cho toàn công ty');
  return reasons;
}

async function countCovered(db: Db, tenantId: string, plan: RulePlan): Promise<number> {
  if (plan.scope.type === 'EMPLOYEE' || plan.scope.type === 'EMPLOYEES') return plan.targets.length;
  const params: unknown[] = [tenantId, plan.from];
  let filter = '';
  if (plan.scope.type === 'UNIT') {
    const sub = await db.query(
      `WITH RECURSIVE sub AS (
         SELECT id, 0 AS depth FROM core_schema.organization_nodes WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
         UNION ALL SELECT n.id, s.depth + 1 FROM core_schema.organization_nodes n JOIN sub s ON n.parent_id = s.id WHERE n.deleted_at IS NULL AND s.depth < 20
       ) SELECT DISTINCT id FROM sub`,
      [plan.scope.unitIds],
    );
    params.push(sub.rows.map((r) => r.id as string));
    filter = `AND EXISTS (
      SELECT 1 FROM core_schema.organization_node_assignments a
        JOIN core_schema.organization_nodes n ON n.id = a.node_id AND n.deleted_at IS NULL
       WHERE a.deleted_at IS NULL AND a.status = 'active' AND (a.employee_id = e.id OR a.user_id = e.user_id)
         AND CASE WHEN n.category = 'position' THEN n.parent_id ELSE n.id END = ANY($3::uuid[]))`;
  }
  const r = await db.query(
    `SELECT count(*)::int AS n FROM hrm_schema.employee_profiles p
       JOIN core_schema.employees e ON e.id = p.employee_id AND e.tenant_id = p.tenant_id AND e.deleted_at IS NULL
      WHERE p.tenant_id = $1 AND p.deleted_at IS NULL AND (p.inactive_from IS NULL OR p.inactive_from > $2::date) ${filter}`,
    params,
  );
  return r.rows[0].n as number;
}

export interface RulePreviewResult {
  rules: RulePreviewItem[];
  ruleCount: number;
  changedRules: number;
  employeeCount: number;
  conflictTotal: number;
  skippedTargets: number;
  requiresConfirmation: boolean;
  confirmReasons: string[];
  lockedPeriods: string[];
}

export async function previewRule(db: Db, tenantId: string, input: ApplyScheduleInput): Promise<RulePreviewResult> {
  const plan = await buildRulePlan(db, tenantId, input);
  const locked = await db.query(
    `SELECT period_code FROM hrm_schema.timesheet_periods WHERE tenant_id = $1 AND status = 'LOCKED' AND to_date >= $2::date ORDER BY from_date`,
    [tenantId, plan.from],
  );
  const conflicts = plan.mode === 'REPORT' ? plan.perTarget.filter((p) => p.existing.length).length : 0;
  const skipped = plan.mode === 'SKIP_EXISTING' ? plan.perTarget.filter((p) => p.existing.length).length : 0;
  const reasons = confirmReasons(plan);
  return {
    rules: plan.perTarget.map((p) => ({ scopeType: p.target.scopeType, scopeLabel: p.target.label, changes: p.existing })),
    ruleCount: plan.targets.length - skipped,
    changedRules: plan.mode === 'SKIP_EXISTING' ? 0 : changedCount(plan),
    employeeCount: await countCovered(db, tenantId, plan),
    conflictTotal: conflicts,
    skippedTargets: skipped,
    requiresConfirmation: reasons.length > 0,
    confirmReasons: reasons,
    lockedPeriods: locked.rows.map((r) => String(r.period_code)),
  };
}

export interface RuleApplyResult {
  batchId: string;
  ruleCount: number;
  changedRules: number;
  skippedTargets: number;
  employeeCount: number;
}

/** Chạy trong transaction của controller. Tạo lịch định kỳ, cắt/huỷ lịch cũ cùng phạm vi, ghi nhật ký. */
export async function applyRule(db: Db, tenantId: string, actorId: string, input: ApplyScheduleInput): Promise<RuleApplyResult> {
  await assertRulesReady(db, tenantId);
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`hrm:work-schedule:${tenantId}`]);
  const plan = await buildRulePlan(db, tenantId, input);
  // Lịch mới có hiệu lực từ ngày bắt đầu trở đi: không được chạm kỳ công đã khoá nằm trong khoảng đó.
  await assertOpenRange(db as PoolClient, tenantId, plan.from, null);
  const withExisting = plan.perTarget.filter((p) => p.existing.length);
  if (plan.mode === 'REPORT' && withExisting.length)
    throw new ConflictException({
      code: 'HRM_SCHEDULE_RULE_CONFLICT',
      message: `Có ${withExisting.length} phạm vi đã có lịch định kỳ còn hiệu lực từ ${plan.from}; chọn cách xử lý (bỏ qua hoặc ghi đè) rồi thử lại.`,
      rules: plan.perTarget.map((p) => ({ scopeType: p.target.scopeType, scopeLabel: p.target.label, changes: p.existing })),
      conflictTotal: withExisting.length,
    });
  const reasons = confirmReasons(plan);
  if (reasons.length && input.confirm !== true)
    throw new ConflictException({
      code: 'HRM_SCHEDULE_CONFIRM_REQUIRED',
      message: `Cần xác nhận trước khi áp dụng: ${reasons.join('; ')}.`,
      confirmReasons: reasons,
    });

  const skip = plan.mode === 'SKIP_EXISTING';
  const active = plan.perTarget.filter((p) => !(skip && p.existing.length));
  const batch = await db.query(
    `INSERT INTO hrm_schema.work_schedule_batches (tenant_id, kind, scope_type, scope, template_id, pattern_snapshot, from_date, to_date, conflict_mode, employee_count, day_count, reason, created_by)
     VALUES ($1,'ASSIGN',$2,$3,$4,$5,$6,$6,$7,$8,0,$9,$10) RETURNING id`,
    [
      tenantId,
      plan.scope.type,
      JSON.stringify({ ...plan.scope, openEnded: true }),
      plan.templateId,
      JSON.stringify(plan.pattern),
      plan.from,
      plan.mode,
      active.length,
      input.reason ?? null,
      actorId,
    ],
  );
  const batchId = batch.rows[0].id as string;
  const days = plan.pattern.filter((p) => p.dayType !== 'SKIP');
  let changed = 0;
  for (const { target, replacement, existing } of active) {
    for (const t of replacement.truncate) {
      await db.query(`UPDATE hrm_schema.work_schedule_rules SET effective_to = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`, [tenantId, t.id, t.newTo]);
      changed++;
    }
    if (replacement.cancel.length) {
      await db.query(`UPDATE hrm_schema.work_schedule_rules SET status = 'CANCELLED', updated_at = now() WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, replacement.cancel]);
      changed += replacement.cancel.length;
    }
    const created = await db.query(
      `INSERT INTO hrm_schema.work_schedule_rules (tenant_id, scope_type, employee_id, unit_id, effective_from, template_id, template_name, batch_id, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [tenantId, target.scopeType, target.employeeId, target.unitId, plan.from, plan.templateId, plan.templateName, batchId, input.reason ?? null, actorId],
    );
    const ruleId = created.rows[0].id as string;
    await db.query(
      `INSERT INTO hrm_schema.work_schedule_rule_days (rule_id, tenant_id, weekday, day_type, shift_id)
       SELECT $1, $2, u.weekday, u.day_type, u.shift_id FROM unnest($3::smallint[], $4::text[], $5::uuid[]) AS u(weekday, day_type, shift_id)`,
      [ruleId, tenantId, days.map((d) => d.weekday), days.map((d) => d.dayType), days.map((d) => d.shiftId ?? null)],
    );
    await db.query(
      `INSERT INTO hrm_schema.work_schedule_audit (tenant_id, batch_id, action, actor_id, employee_id, unit_id, from_date, to_date, before, after, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,$10)`,
      [
        tenantId,
        batchId,
        existing.length ? 'RULE_REPLACE' : 'RULE_CREATE',
        actorId,
        target.employeeId,
        target.unitId,
        plan.from,
        JSON.stringify(existing),
        JSON.stringify({ ruleId, scope: target.label, from: plan.from, to: null, template: plan.templateName, days }),
        input.reason ?? null,
      ],
    );
  }
  const employeeCount = await countCovered(db, tenantId, plan);
  await lifecycleAudit(db, tenantId, actorId, 'WORK_SCHEDULE_RULE_APPLIED', batchId, {
    scope: plan.scope,
    from: plan.from,
    mode: plan.mode,
    created: active.length,
    changed,
    reason: input.reason ?? null,
  });
  return { batchId, ruleCount: active.length, changedRules: changed, skippedTargets: plan.perTarget.length - active.length, employeeCount };
}

async function lockRule(db: Db, tenantId: string, id: string) {
  requireUuid(id, 'id');
  const r = await db.query(`SELECT * FROM hrm_schema.work_schedule_rules WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, id]);
  const rule = r.rows[0];
  if (!rule) throw new NotFoundException('Không tìm thấy lịch định kỳ');
  if (rule.status !== 'ACTIVE') throw new ConflictException('Lịch định kỳ đã được huỷ trước đó');
  return rule;
}

/** Đặt ngày kết thúc cho lịch định kỳ; từ ngày hôm sau lịch này không còn hiệu lực. */
export async function endRule(db: Db, tenantId: string, actorId: string, id: string, endDate: string, reason: string | null) {
  await assertRulesReady(db, tenantId);
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`hrm:work-schedule:${tenantId}`]);
  const end = requireDate(endDate, 'endDate');
  const rule = await lockRule(db, tenantId, id);
  const from = isoDate(rule.effective_from);
  const oldTo = rule.effective_to ? isoDate(rule.effective_to) : null;
  if (end < from) badInput('Ngày kết thúc phải từ ngày bắt đầu của lịch; muốn bỏ hẳn hãy huỷ lịch');
  if (oldTo && end >= oldTo) badInput('Ngày kết thúc mới phải sớm hơn ngày kết thúc hiện tại');
  const affectedFrom = new Date(Date.parse(`${end}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  await assertOpenRange(db as PoolClient, tenantId, affectedFrom, oldTo);
  await db.query(`UPDATE hrm_schema.work_schedule_rules SET effective_to = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`, [tenantId, id, end]);
  await db.query(
    `INSERT INTO hrm_schema.work_schedule_audit (tenant_id, action, actor_id, employee_id, unit_id, from_date, to_date, before, after, reason)
     VALUES ($1,'RULE_END',$2,$3,$4,$5,$6,$7,$8,$9)`,
    [tenantId, actorId, rule.employee_id, rule.unit_id, from, end, JSON.stringify({ ruleId: id, from, to: oldTo }), JSON.stringify({ ruleId: id, from, to: end }), reason],
  );
  await lifecycleAudit(db, tenantId, actorId, 'WORK_SCHEDULE_RULE_ENDED', id, { from, oldTo, end, reason });
  return { id, effectiveFrom: from, effectiveTo: end };
}

/** Huỷ hẳn lịch định kỳ (không xoá cứng). Chỉ cho phép khi không chạm kỳ công đã khoá. */
export async function cancelRule(db: Db, tenantId: string, actorId: string, id: string, reason: string | null) {
  await assertRulesReady(db, tenantId);
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`hrm:work-schedule:${tenantId}`]);
  const rule = await lockRule(db, tenantId, id);
  const from = isoDate(rule.effective_from);
  const to = rule.effective_to ? isoDate(rule.effective_to) : null;
  await assertOpenRange(db as PoolClient, tenantId, from, to);
  await db.query(`UPDATE hrm_schema.work_schedule_rules SET status = 'CANCELLED', updated_at = now() WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  await db.query(
    `INSERT INTO hrm_schema.work_schedule_audit (tenant_id, action, actor_id, employee_id, unit_id, from_date, to_date, before, after, reason)
     VALUES ($1,'RULE_CANCEL',$2,$3,$4,$5,$6,$7,$8,$9)`,
    [tenantId, actorId, rule.employee_id, rule.unit_id, from, to, JSON.stringify({ ruleId: id, from, to }), JSON.stringify({ cancelled: true }), reason],
  );
  await lifecycleAudit(db, tenantId, actorId, 'WORK_SCHEDULE_RULE_CANCELLED', id, { from, to, reason });
  return { id };
}

export interface RuleView {
  id: string;
  scopeType: RuleScopeType;
  scopeLabel: string;
  employeeId: string | null;
  unitId: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  templateName: string | null;
  status: 'ACTIVE' | 'CANCELLED';
  days: { weekday: number; dayType: 'SHIFT' | 'OFF'; shiftId: string | null; shiftCode: string | null }[];
  createdAt: string;
}

export async function listRules(
  db: Db,
  tenantId: string,
  filter: { status?: string | null; scopeType?: string | null; unitId?: string | null; employeeId?: string | null; activeOn?: string | null },
): Promise<RuleView[]> {
  await assertRulesReady(db, tenantId);
  const params: unknown[] = [tenantId];
  let where = '';
  if (filter.status === 'ACTIVE' || filter.status === 'CANCELLED') {
    params.push(filter.status);
    where += ` AND r.status = $${params.length}`;
  }
  if (filter.scopeType === 'EMPLOYEE' || filter.scopeType === 'UNIT' || filter.scopeType === 'COMPANY') {
    params.push(filter.scopeType);
    where += ` AND r.scope_type = $${params.length}`;
  }
  if (filter.unitId) {
    params.push(requireUuid(filter.unitId, 'unitId'));
    where += ` AND r.unit_id = $${params.length}`;
  }
  if (filter.employeeId) {
    params.push(requireUuid(filter.employeeId, 'employeeId'));
    where += ` AND r.employee_id = $${params.length}`;
  }
  if (filter.activeOn) {
    params.push(requireDate(filter.activeOn, 'activeOn'));
    where += ` AND r.effective_from <= $${params.length}::date AND (r.effective_to IS NULL OR r.effective_to >= $${params.length}::date)`;
  }
  const rules = await db.query(
    `SELECT r.*, n.name AS unit_name, p.employee_code, e.full_name
       FROM hrm_schema.work_schedule_rules r
       LEFT JOIN core_schema.organization_nodes n ON n.id = r.unit_id
       LEFT JOIN hrm_schema.employee_profiles p ON p.employee_id = r.employee_id AND p.tenant_id = r.tenant_id
       LEFT JOIN core_schema.employees e ON e.id = r.employee_id
      WHERE r.tenant_id = $1${where} ORDER BY r.status, r.effective_from DESC LIMIT 500`,
    params,
  );
  const ids = rules.rows.map((r) => r.id as string);
  const days = ids.length
    ? await db.query(
        `SELECT d.rule_id, d.weekday, d.day_type, d.shift_id, s.code AS shift_code FROM hrm_schema.work_schedule_rule_days d
           LEFT JOIN hrm_schema.shift_definitions s ON s.id = d.shift_id WHERE d.rule_id = ANY($1::uuid[]) ORDER BY d.weekday`,
        [ids],
      )
    : { rows: [] };
  return rules.rows.map((r) => ({
    id: r.id as string,
    scopeType: r.scope_type as RuleScopeType,
    scopeLabel:
      r.scope_type === 'COMPANY' ? 'Toàn công ty' : r.scope_type === 'UNIT' ? `Phòng ban ${r.unit_name ?? ''}`.trim() : `${r.employee_code ?? ''} - ${r.full_name ?? ''}`.replace(/^ - $/, ''),
    employeeId: (r.employee_id as string | null) ?? null,
    unitId: (r.unit_id as string | null) ?? null,
    effectiveFrom: isoDate(r.effective_from),
    effectiveTo: r.effective_to ? isoDate(r.effective_to) : null,
    templateName: (r.template_name as string | null) ?? null,
    status: r.status as 'ACTIVE' | 'CANCELLED',
    days: days.rows
      .filter((d) => d.rule_id === r.id)
      .map((d) => ({ weekday: Number(d.weekday), dayType: d.day_type as 'SHIFT' | 'OFF', shiftId: (d.shift_id as string | null) ?? null, shiftCode: (d.shift_code as string | null) ?? null })),
    createdAt: new Date(r.created_at as string).toISOString(),
  }));
}

export { dayBefore };
