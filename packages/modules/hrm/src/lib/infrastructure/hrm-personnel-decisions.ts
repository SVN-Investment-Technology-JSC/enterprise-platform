import type {
  CreateHrmPersonnelDecisionPayload,
  HrmAppointmentContext,
  HrmPersonnelDecision,
  HrmReportingLine,
  HrmReportingOverview,
  HrmSubordinate,
  UpdateHrmPersonnelDecisionPayload,
} from '@enterprise-platform/contracts-hrm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import {
  DECISION_TYPES,
  type DecisionType,
  decisionShapeErrors,
  isAssigningType,
  needsCoreAction,
  nextDecisionNumber,
  previousDay,
  replacesPrimaryPosition,
  wouldCreateCycle,
} from '../domain/personnel-decision.js';
import { loadAllowSelfApproval, SELF_APPROVAL_FORBIDDEN } from './hrm-approval-policy.js';
import { lifecycleAudit } from './hrm-lifecycle.js';
import {
  type HrmOrgAppointmentPort,
  HrmOrgAppointmentError,
} from './hrm-org-appointment.js';
import { isoDate, lockEmployee } from './hrm-time.js';
import { hrmTransaction } from './hrm-transaction.js';
import { requireDate, requireText, requireUuid } from './hrm-validation.js';

type Queryable = Pick<PoolClient, 'query'>;
type Row = Record<string, any>;

const TODAY_SQL = `(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`;
const OPEN_STATUSES = ['DRAFT', 'APPROVED', 'APPLY_PENDING'];
const INACTIVE_EMPLOYMENT = ['RESIGNED', 'TERMINATED'];

/** Phân công chính đang hiệu lực của một tài khoản (đọc Core, không ghi). */
const PRIMARY_POSITION_LATERAL = `
  LEFT JOIN LATERAL (
    SELECT a.node_id FROM core_schema.organization_node_assignments a
     WHERE a.user_id = %USER% AND a.deleted_at IS NULL AND a.status = 'active'
       AND (a.start_date IS NULL OR a.start_date <= ${TODAY_SQL})
       AND (a.end_date IS NULL OR a.end_date >= ${TODAY_SQL})
     ORDER BY a.is_primary DESC, a.created_at LIMIT 1
  ) pa ON true
  LEFT JOIN core_schema.organization_nodes pos ON pos.id = pa.node_id AND pos.deleted_at IS NULL
  LEFT JOIN core_schema.organization_nodes unit ON unit.id = pos.parent_id AND unit.deleted_at IS NULL`;

const DECISION_SELECT = `
  SELECT d.*, e.full_name AS employee_name, ep.employee_code,
         fm.full_name AS from_manager_name, tm.full_name AS to_manager_name,
         st.full_name AS subordinate_target_name
    FROM hrm_schema.personnel_decisions d
    LEFT JOIN core_schema.employees e ON e.id = d.employee_id
    LEFT JOIN hrm_schema.employee_profiles ep ON ep.employee_id = d.employee_id AND ep.tenant_id = d.tenant_id
    LEFT JOIN core_schema.employees fm ON fm.id = d.from_manager_employee_id
    LEFT JOIN core_schema.employees tm ON tm.id = d.to_manager_employee_id
    LEFT JOIN core_schema.employees st ON st.id = d.subordinate_target_employee_id`;

const num = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

export function mapDecision(row: Row): HrmPersonnelDecision {
  return {
    id: row.id,
    decisionNo: row.decision_no,
    decisionType: row.decision_type,
    status: row.status,
    employeeId: row.employee_id,
    employeeName: row.employee_name ?? null,
    employeeCode: row.employee_code ?? null,
    effectiveDate: isoDate(row.effective_date),
    reason: row.reason,
    fromPositionName: row.from_position_name ?? null,
    fromUnitName: row.from_unit_name ?? null,
    fromManagerEmployeeId: row.from_manager_employee_id ?? null,
    fromManagerName: row.from_manager_name ?? null,
    fromSalaryGradeId: row.from_salary_grade_id ?? null,
    fromSalaryStepId: row.from_salary_step_id ?? null,
    fromBaseSalary: num(row.from_base_salary),
    toPositionNodeId: row.to_position_node_id ?? null,
    toPositionName: row.to_position_name ?? null,
    toUnitName: row.to_unit_name ?? null,
    managerMode: row.manager_mode,
    toManagerEmployeeId: row.to_manager_employee_id ?? null,
    toManagerName: row.to_manager_name ?? null,
    subordinateMode: row.subordinate_mode,
    subordinateTargetEmployeeId: row.subordinate_target_employee_id ?? null,
    subordinateTargetName: row.subordinate_target_name ?? null,
    salaryChanged: row.salary_changed === true,
    toSalaryGradeId: row.to_salary_grade_id ?? null,
    toSalaryStepId: row.to_salary_step_id ?? null,
    toSalaryType: row.to_salary_type ?? null,
    toBaseSalary: num(row.to_base_salary),
    attachmentId: row.attachment_id ?? null,
    createdBy: row.created_by ?? null,
    approvedBy: row.approved_by ?? null,
    approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null,
    rejectedReason: row.rejected_reason ?? null,
    appliedAt: row.applied_at ? new Date(row.applied_at).toISOString() : null,
    appliedSteps: (row.applied_steps ?? {}) as Record<string, boolean>,
    applyAttempts: Number(row.apply_attempts ?? 0),
    applyError: row.apply_error ?? null,
    version: Number(row.version),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function todayInVietnam(db: Queryable): Promise<string> {
  const result = await db.query(`SELECT ${TODAY_SQL}::text AS today`);
  return result.rows[0].today as string;
}

export async function loadDecision(
  db: Queryable,
  tenantId: string,
  id: string,
  lock = false,
): Promise<Row> {
  requireUuid(id, 'Quyết định');
  const result = await db.query(
    `${DECISION_SELECT} WHERE d.tenant_id = $1 AND d.id = $2${lock ? ' FOR UPDATE OF d' : ''}`,
    [tenantId, id],
  );
  if (!result.rows[0]) throw new NotFoundException('Không tìm thấy quyết định nhân sự');
  return result.rows[0];
}

export async function listDecisions(
  db: Queryable,
  tenantId: string,
  filter: { status?: string; type?: string; employeeId?: string },
): Promise<HrmPersonnelDecision[]> {
  const where = ['d.tenant_id = $1'];
  const values: unknown[] = [tenantId];
  if (filter.status) {
    values.push(filter.status);
    where.push(`d.status = $${values.length}`);
  }
  if (filter.type) {
    values.push(filter.type);
    where.push(`d.decision_type = $${values.length}`);
  }
  if (filter.employeeId) {
    values.push(requireUuid(filter.employeeId, 'Nhân viên'));
    where.push(`d.employee_id = $${values.length}`);
  }
  const result = await db.query(
    `${DECISION_SELECT} WHERE ${where.join(' AND ')} ORDER BY d.effective_date DESC, d.created_at DESC LIMIT 500`,
    values,
  );
  return result.rows.map(mapDecision);
}

// ---------------------------------------------------------------------------
// Dữ liệu tham chiếu
// ---------------------------------------------------------------------------

interface EmployeeRow {
  id: string;
  user_id: string | null;
  full_name: string;
  employment_status: string;
}

async function employeeRow(
  db: Queryable,
  tenantId: string,
  employeeId: string,
): Promise<EmployeeRow> {
  const result = await db.query(
    `SELECT e.id, e.user_id, e.full_name, ep.employment_status
       FROM core_schema.employees e
       JOIN hrm_schema.employee_profiles ep ON ep.employee_id = e.id AND ep.tenant_id = e.tenant_id
      WHERE e.tenant_id = $1 AND e.id = $2 AND e.deleted_at IS NULL AND ep.deleted_at IS NULL`,
    [tenantId, employeeId],
  );
  if (!result.rows[0]) throw new NotFoundException('Không tìm thấy hồ sơ nhân viên');
  return result.rows[0] as EmployeeRow;
}

async function assertActiveEmployee(
  db: Queryable,
  tenantId: string,
  employeeId: string,
  label: string,
): Promise<EmployeeRow> {
  const row = await employeeRow(db, tenantId, employeeId).catch((error) => {
    if (error instanceof NotFoundException)
      throw new BadRequestException(`${label} không tồn tại`);
    throw error;
  });
  if (INACTIVE_EMPLOYMENT.includes(row.employment_status))
    throw new BadRequestException(`${label} đã nghỉ việc`);
  return row;
}

async function positionInfo(
  db: Queryable,
  nodeId: string,
): Promise<{ name: string; unitName: string | null }> {
  const result = await db.query(
    `SELECT n.name, COALESCE(n.category, t.category) AS category, unit.name AS unit_name
       FROM core_schema.organization_nodes n
       LEFT JOIN core_schema.organization_node_types t ON t.id = n.node_type_id
       LEFT JOIN core_schema.organization_nodes unit ON unit.id = n.parent_id AND unit.deleted_at IS NULL
      WHERE n.id = $1 AND n.deleted_at IS NULL`,
    [nodeId],
  );
  const row = result.rows[0];
  if (!row || row.category !== 'position')
    throw new BadRequestException('Chức danh được chọn không tồn tại trên sơ đồ tổ chức');
  return { name: row.name, unitName: row.unit_name ?? null };
}

async function currentPosition(
  db: Queryable,
  userId: string | null,
): Promise<{ nodeId: string; name: string; unitName: string | null } | null> {
  if (!userId) return null;
  const result = await db.query(
    `SELECT pos.id AS node_id, pos.name, unit.name AS unit_name
       FROM (SELECT $1::uuid AS user_id) u
       ${PRIMARY_POSITION_LATERAL.replace('%USER%', 'u.user_id')}
      WHERE pos.id IS NOT NULL`,
    [userId],
  );
  const row = result.rows[0];
  return row ? { nodeId: row.node_id, name: row.name, unitName: row.unit_name ?? null } : null;
}

async function currentSalary(db: Queryable, tenantId: string, employeeId: string) {
  const result = await db.query(
    `SELECT salary_grade_id, salary_step_id, salary_type, base_salary
       FROM hrm_schema.employee_salary_profiles
      WHERE tenant_id = $1 AND employee_id = $2 AND status = 'ACTIVE'
        AND effective_from <= ${TODAY_SQL} AND (effective_to IS NULL OR effective_to >= ${TODAY_SQL})
      ORDER BY effective_from DESC LIMIT 1`,
    [tenantId, employeeId],
  );
  return result.rows[0] as Row | undefined;
}

// ---------------------------------------------------------------------------
// Quan hệ báo cáo
// ---------------------------------------------------------------------------

/** Quan hệ quản lý trực tiếp đang mở (nhân viên → người quản lý). */
async function openManagerMap(
  db: Queryable,
  tenantId: string,
): Promise<Map<string, string>> {
  const result = await db.query(
    `SELECT employee_id, manager_employee_id FROM hrm_schema.employee_reporting_lines
      WHERE tenant_id = $1 AND relation_type = 'DIRECT' AND effective_to IS NULL`,
    [tenantId],
  );
  return new Map(result.rows.map((row) => [row.employee_id, row.manager_employee_id]));
}

function mapLine(row: Row): HrmReportingLine {
  return {
    id: row.id,
    employeeId: row.employee_id,
    managerEmployeeId: row.manager_employee_id,
    managerName: row.manager_name ?? null,
    managerCode: row.manager_code ?? null,
    relationType: row.relation_type,
    effectiveFrom: isoDate(row.effective_from),
    effectiveTo: row.effective_to ? isoDate(row.effective_to) : null,
    decisionId: row.decision_id ?? null,
    decisionNo: row.decision_no ?? null,
    source: row.source,
    note: row.note ?? null,
  };
}

export async function loadReportingOverview(
  db: Queryable,
  tenantId: string,
  employeeId: string,
): Promise<HrmReportingOverview> {
  requireUuid(employeeId, 'Nhân viên');
  const result = await db.query(
    `SELECT l.*, m.full_name AS manager_name, mp.employee_code AS manager_code, d.decision_no
       FROM hrm_schema.employee_reporting_lines l
       LEFT JOIN core_schema.employees m ON m.id = l.manager_employee_id
       LEFT JOIN hrm_schema.employee_profiles mp ON mp.employee_id = l.manager_employee_id AND mp.tenant_id = l.tenant_id
       LEFT JOIN hrm_schema.personnel_decisions d ON d.id = l.decision_id
      WHERE l.tenant_id = $1 AND l.employee_id = $2 AND l.relation_type = 'DIRECT'
      ORDER BY l.effective_from DESC, l.created_at DESC`,
    [tenantId, employeeId],
  );
  const lines = result.rows.map(mapLine);
  const today = await todayInVietnam(db);
  const current =
    lines.find(
      (line) => line.effectiveFrom <= today && (!line.effectiveTo || line.effectiveTo >= today),
    ) ?? null;
  return { current, history: lines };
}

/** Người quản lý trực tiếp hiện tại để hiển thị trên hồ sơ (tên, chức danh, email). */
export async function loadDirectManager(
  db: Queryable,
  tenantId: string,
  employeeId: string,
): Promise<{ name: string; title: string | null; email: string | null } | null> {
  const result = await db.query(
    `SELECT m.full_name, m.work_email, pos.name AS position_name
       FROM hrm_schema.employee_reporting_lines l
       JOIN core_schema.employees m ON m.id = l.manager_employee_id AND m.deleted_at IS NULL
       ${PRIMARY_POSITION_LATERAL.replace('%USER%', 'm.user_id')}
      WHERE l.tenant_id = $1 AND l.employee_id = $2 AND l.relation_type = 'DIRECT'
        AND l.effective_from <= ${TODAY_SQL} AND (l.effective_to IS NULL OR l.effective_to >= ${TODAY_SQL})
      ORDER BY l.effective_from DESC LIMIT 1`,
    [tenantId, employeeId],
  );
  const row = result.rows[0];
  return row
    ? { name: row.full_name, title: row.position_name ?? null, email: row.work_email ?? null }
    : null;
}

/**
 * Chuỗi quản lý từ gần đến xa theo quan hệ báo cáo của HRM (tối đa `maxDepth`),
 * dừng khi hết hoặc gặp vòng lặp.
 */
export async function resolveManagerChain(
  db: Queryable,
  tenantId: string,
  employeeId: string,
  maxDepth = 20,
): Promise<string[]> {
  const managerOf = await openManagerMap(db, tenantId);
  const chain: string[] = [];
  const seen = new Set<string>([employeeId]);
  let cursor = managerOf.get(employeeId);
  while (cursor && !seen.has(cursor) && chain.length < maxDepth) {
    chain.push(cursor);
    seen.add(cursor);
    cursor = managerOf.get(cursor);
  }
  return chain;
}

export async function listSubordinates(
  db: Queryable,
  tenantId: string,
  employeeId: string,
): Promise<HrmSubordinate[]> {
  const result = await db.query(
    `SELECT l.employee_id, ep.employee_code, e.full_name, pos.name AS position_name, unit.name AS unit_name
       FROM hrm_schema.employee_reporting_lines l
       JOIN core_schema.employees e ON e.id = l.employee_id AND e.deleted_at IS NULL
       JOIN hrm_schema.employee_profiles ep ON ep.employee_id = l.employee_id AND ep.tenant_id = l.tenant_id AND ep.deleted_at IS NULL
       ${PRIMARY_POSITION_LATERAL.replace('%USER%', 'e.user_id')}
      WHERE l.tenant_id = $1 AND l.manager_employee_id = $2 AND l.relation_type = 'DIRECT'
        AND l.effective_to IS NULL AND ep.employment_status <> ALL($3::text[])
      ORDER BY e.full_name`,
    [tenantId, employeeId, INACTIVE_EMPLOYMENT],
  );
  return result.rows.map((row) => ({
    employeeId: row.employee_id,
    employeeCode: row.employee_code ?? null,
    fullName: row.full_name,
    positionName: row.position_name ?? null,
    unitName: row.unit_name ?? null,
  }));
}

export async function loadAppointmentContext(
  db: Queryable,
  tenantId: string,
  employeeId: string,
): Promise<HrmAppointmentContext> {
  requireUuid(employeeId, 'Nhân viên');
  const employee = await employeeRow(db, tenantId, employeeId);
  const [position, overview, salary, subordinates] = await Promise.all([
    currentPosition(db, employee.user_id),
    loadReportingOverview(db, tenantId, employeeId),
    currentSalary(db, tenantId, employeeId),
    listSubordinates(db, tenantId, employeeId),
  ]);
  const manager = overview.current
    ? {
        employeeId: overview.current.managerEmployeeId,
        fullName: overview.current.managerName ?? '',
        employeeCode: overview.current.managerCode ?? null,
      }
    : null;
  return {
    employeeId,
    positionNodeId: position?.nodeId ?? null,
    positionName: position?.name ?? null,
    unitName: position?.unitName ?? null,
    manager,
    salary: salary
      ? {
          salaryGradeId: salary.salary_grade_id ?? null,
          salaryStepId: salary.salary_step_id ?? null,
          salaryType: salary.salary_type,
          baseSalary: Number(salary.base_salary),
        }
      : null,
    subordinates,
    hasAccount: !!employee.user_id,
  };
}

// ---------------------------------------------------------------------------
// Tạo và sửa bản nháp
// ---------------------------------------------------------------------------

interface DecisionInput {
  decisionType: DecisionType;
  employeeId: string;
  effectiveDate: string;
  reason: string;
  decisionNo: string | null;
  toPositionNodeId: string | null;
  managerMode: 'KEEP' | 'SET' | 'CLEAR';
  toManagerEmployeeId: string | null;
  subordinateMode: 'KEEP' | 'REASSIGN';
  subordinateTargetEmployeeId: string | null;
  salaryChanged: boolean;
  toSalaryGradeId: string | null;
  toSalaryStepId: string | null;
  toSalaryType: 'GROSS' | 'NET' | null;
  toBaseSalary: number | null;
  attachmentId: string | null;
}

const optionalUuid = (value: unknown, field: string) =>
  value === null || value === undefined || value === ''
    ? null
    : requireUuid(value, field);

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T))
    throw new BadRequestException({
      code: 'HRM_INVALID_INPUT',
      message: `${field}: giá trị không hợp lệ`,
    });
  return value as T;
}

function normalizeInput(
  body: Partial<CreateHrmPersonnelDecisionPayload>,
  base?: DecisionInput,
): DecisionInput {
  const pick = <K extends keyof DecisionInput>(key: K, fallback: DecisionInput[K]) =>
    (body as Record<string, unknown>)[key] === undefined
      ? (base?.[key] ?? fallback)
      : ((body as Record<string, unknown>)[key] as DecisionInput[K]);
  const salaryChanged = pick('salaryChanged', false) === true;
  const rawNo = pick('decisionNo', null);
  const rawSalary = pick('toBaseSalary', null);
  return {
    decisionType: oneOf(pick('decisionType', 'APPOINT'), DECISION_TYPES, 'Loại quyết định'),
    employeeId: requireUuid(pick('employeeId', '' as string), 'Nhân viên'),
    effectiveDate: requireDate(pick('effectiveDate', '' as string), 'Ngày hiệu lực'),
    reason: requireText(pick('reason', '' as string), 'Lý do', 2000),
    decisionNo: rawNo ? requireText(rawNo, 'Số quyết định', 50) : null,
    toPositionNodeId: optionalUuid(pick('toPositionNodeId', null), 'Chức danh'),
    managerMode: oneOf(pick('managerMode', 'KEEP'), ['KEEP', 'SET', 'CLEAR'] as const, 'Chế độ quản lý'),
    toManagerEmployeeId: optionalUuid(pick('toManagerEmployeeId', null), 'Người quản lý'),
    subordinateMode: oneOf(pick('subordinateMode', 'KEEP'), ['KEEP', 'REASSIGN'] as const, 'Chế độ cấp dưới'),
    subordinateTargetEmployeeId: optionalUuid(
      pick('subordinateTargetEmployeeId', null),
      'Người nhận cấp dưới',
    ),
    salaryChanged,
    toSalaryGradeId: salaryChanged ? optionalUuid(pick('toSalaryGradeId', null), 'Ngạch lương') : null,
    toSalaryStepId: salaryChanged ? optionalUuid(pick('toSalaryStepId', null), 'Bậc lương') : null,
    toSalaryType: salaryChanged ? (pick('toSalaryType', null) as 'GROSS' | 'NET' | null) : null,
    toBaseSalary: salaryChanged && rawSalary !== null && rawSalary !== undefined ? Number(rawSalary) : null,
    attachmentId: optionalUuid(pick('attachmentId', null), 'Tệp đính kèm'),
  };
}

async function prepareDecision(
  db: PoolClient,
  tenantId: string,
  input: DecisionInput,
  excludeDecisionId?: string,
) {
  const errors = decisionShapeErrors(input);
  if (errors.length)
    throw new BadRequestException({ code: 'HRM_INVALID_INPUT', message: errors[0], errors });

  await lockEmployee(db, tenantId, input.employeeId);
  const employee = await employeeRow(db, tenantId, input.employeeId);
  if (INACTIVE_EMPLOYMENT.includes(employee.employment_status))
    throw new BadRequestException('Nhân viên đã nghỉ việc, không thể lập quyết định');
  if (needsCoreAction(input.decisionType) && !employee.user_id)
    throw new BadRequestException({
      code: 'HRM_EMPLOYEE_NO_ACCOUNT',
      message:
        'Nhân viên chưa liên kết tài khoản nên không thể cập nhật chức danh trên sơ đồ tổ chức. Liên kết tài khoản trước.',
    });

  const open = await db.query(
    `SELECT decision_no FROM hrm_schema.personnel_decisions
      WHERE tenant_id = $1 AND employee_id = $2 AND status = ANY($3::text[])
        AND ($4::uuid IS NULL OR id <> $4)
      LIMIT 1`,
    [tenantId, input.employeeId, OPEN_STATUSES, excludeDecisionId ?? null],
  );
  if (open.rows[0])
    throw new ConflictException({
      code: 'HRM_DECISION_OPEN_EXISTS',
      message: `Nhân viên đang có quyết định chưa hoàn tất (${open.rows[0].decision_no}). Hoàn tất hoặc hủy quyết định đó trước.`,
    });

  const position = await currentPosition(db, employee.user_id);
  if (input.decisionType === 'DISMISS' && !position)
    throw new BadRequestException('Nhân viên chưa giữ chức danh nào để miễn nhiệm');
  let target: { name: string; unitName: string | null } | null = null;
  if (isAssigningType(input.decisionType)) {
    target = await positionInfo(db, input.toPositionNodeId as string);
    if (position && position.nodeId === input.toPositionNodeId)
      throw new BadRequestException('Nhân viên đang giữ chức danh này');
  }

  const managerOf = await openManagerMap(db, tenantId);
  if (input.managerMode === 'SET') {
    const manager = input.toManagerEmployeeId as string;
    await assertActiveEmployee(db, tenantId, manager, 'Người quản lý');
    if (wouldCreateCycle(managerOf, input.employeeId, manager))
      throw new BadRequestException({
        code: 'HRM_REPORTING_CYCLE',
        message: 'Người quản lý được chọn đang báo cáo (trực tiếp hoặc gián tiếp) cho nhân viên này, sẽ tạo vòng lặp báo cáo',
      });
  }
  if (input.subordinateMode === 'REASSIGN')
    await assertActiveEmployee(db, tenantId, input.subordinateTargetEmployeeId as string, 'Người nhận cấp dưới');

  if (input.toSalaryGradeId) {
    const grade = await db.query(
      `SELECT 1 FROM hrm_schema.salary_grades WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL AND status = 'ACTIVE'`,
      [tenantId, input.toSalaryGradeId],
    );
    if (!grade.rowCount) throw new BadRequestException('Ngạch lương không thuộc tenant');
  }
  if (input.toSalaryStepId) {
    const step = await db.query(
      `SELECT 1 FROM hrm_schema.salary_grade_steps WHERE tenant_id = $1 AND id = $2 AND salary_grade_id = $3 AND deleted_at IS NULL AND status = 'ACTIVE'`,
      [tenantId, input.toSalaryStepId, input.toSalaryGradeId],
    );
    if (!step.rowCount) throw new BadRequestException('Bậc lương không khớp ngạch');
  }

  const overview = await loadReportingOverview(db, tenantId, input.employeeId);
  const salary = await currentSalary(db, tenantId, input.employeeId);
  return {
    employee,
    fromPositionNodeId: position?.nodeId ?? null,
    fromPositionName: position?.name ?? null,
    fromUnitName: position?.unitName ?? null,
    fromManagerEmployeeId: overview.current?.managerEmployeeId ?? null,
    fromSalary: salary,
    toPositionName: target?.name ?? null,
    toUnitName: target?.unitName ?? null,
  };
}

async function nextNumber(db: Queryable, tenantId: string, effectiveDate: string) {
  const year = Number(effectiveDate.slice(0, 4));
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    `hrm:decision-no:${tenantId}`,
  ]);
  const existing = await db.query(
    `SELECT decision_no FROM hrm_schema.personnel_decisions WHERE tenant_id = $1 AND decision_no LIKE $2`,
    [tenantId, `QDNS-${year}-%`],
  );
  return nextDecisionNumber(
    year,
    existing.rows.map((row) => row.decision_no as string),
  );
}

function translateUnique(error: unknown): never {
  if ((error as { code?: string }).code === '23505')
    throw new ConflictException({
      code: 'HRM_DECISION_NO_DUPLICATE',
      message: 'Số quyết định đã tồn tại',
    });
  throw error;
}

export async function createDecision(
  pool: Pool,
  tenantId: string,
  actorId: string,
  body: CreateHrmPersonnelDecisionPayload,
): Promise<HrmPersonnelDecision> {
  const input = normalizeInput(body);
  const id = await hrmTransaction(pool, async (db) => {
    const prepared = await prepareDecision(db, tenantId, input);
    const decisionNo = input.decisionNo ?? (await nextNumber(db, tenantId, input.effectiveDate));
    const inserted = await db
      .query(
        `INSERT INTO hrm_schema.personnel_decisions (
           tenant_id, decision_no, decision_type, employee_id, effective_date, reason,
           from_position_node_id, from_position_name, from_unit_name, from_manager_employee_id,
           from_salary_grade_id, from_salary_step_id, from_base_salary,
           to_position_node_id, to_position_name, to_unit_name,
           manager_mode, to_manager_employee_id, subordinate_mode, subordinate_target_employee_id,
           salary_changed, to_salary_grade_id, to_salary_step_id, to_salary_type, to_base_salary,
           attachment_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
         RETURNING id`,
        [
          tenantId, decisionNo, input.decisionType, input.employeeId, input.effectiveDate, input.reason,
          prepared.fromPositionNodeId, prepared.fromPositionName, prepared.fromUnitName, prepared.fromManagerEmployeeId,
          prepared.fromSalary?.salary_grade_id ?? null, prepared.fromSalary?.salary_step_id ?? null,
          prepared.fromSalary?.base_salary ?? null,
          input.toPositionNodeId, prepared.toPositionName, prepared.toUnitName,
          input.managerMode, input.toManagerEmployeeId, input.subordinateMode, input.subordinateTargetEmployeeId,
          input.salaryChanged, input.toSalaryGradeId, input.toSalaryStepId, input.toSalaryType, input.toBaseSalary,
          input.attachmentId, actorId,
        ],
      )
      .catch(translateUnique);
    const newId = inserted.rows[0].id as string;
    await lifecycleAudit(db, tenantId, actorId, 'PERSONNEL_DECISION_CREATED', newId, {
      decisionNo,
      type: input.decisionType,
      employeeId: input.employeeId,
      effectiveDate: input.effectiveDate,
    });
    return newId;
  });
  return mapDecision(await loadDecision(pool, tenantId, id));
}

function inputFromRow(row: Row): DecisionInput {
  return {
    decisionType: row.decision_type,
    employeeId: row.employee_id,
    effectiveDate: isoDate(row.effective_date),
    reason: row.reason,
    decisionNo: row.decision_no,
    toPositionNodeId: row.to_position_node_id ?? null,
    managerMode: row.manager_mode,
    toManagerEmployeeId: row.to_manager_employee_id ?? null,
    subordinateMode: row.subordinate_mode,
    subordinateTargetEmployeeId: row.subordinate_target_employee_id ?? null,
    salaryChanged: row.salary_changed === true,
    toSalaryGradeId: row.to_salary_grade_id ?? null,
    toSalaryStepId: row.to_salary_step_id ?? null,
    toSalaryType: row.to_salary_type ?? null,
    toBaseSalary: num(row.to_base_salary),
    attachmentId: row.attachment_id ?? null,
  };
}

export async function updateDraft(
  pool: Pool,
  tenantId: string,
  actorId: string,
  id: string,
  body: UpdateHrmPersonnelDecisionPayload,
): Promise<HrmPersonnelDecision> {
  await hrmTransaction(pool, async (db) => {
    const row = await loadDecision(db, tenantId, id, true);
    if (row.status !== 'DRAFT')
      throw new ConflictException('Chỉ sửa được quyết định ở trạng thái nháp');
    if (Number(row.version) !== Number(body.version))
      throw new ConflictException({
        code: 'HRM_STALE_VERSION',
        message: 'Quyết định đã được người khác thay đổi. Tải lại trước khi lưu.',
      });
    const input = normalizeInput(
      { ...(body as Partial<CreateHrmPersonnelDecisionPayload>), decisionNo: undefined },
      inputFromRow(row),
    );
    const prepared = await prepareDecision(db, tenantId, input, id);
    await db
      .query(
        `UPDATE hrm_schema.personnel_decisions SET
           effective_date=$3, reason=$4,
           from_position_node_id=$5, from_position_name=$6, from_unit_name=$7, from_manager_employee_id=$8,
           from_salary_grade_id=$9, from_salary_step_id=$10, from_base_salary=$11,
           to_position_node_id=$12, to_position_name=$13, to_unit_name=$14,
           manager_mode=$15, to_manager_employee_id=$16, subordinate_mode=$17, subordinate_target_employee_id=$18,
           salary_changed=$19, to_salary_grade_id=$20, to_salary_step_id=$21, to_salary_type=$22, to_base_salary=$23,
           attachment_id=$24, version=version+1, updated_at=now()
         WHERE tenant_id=$1 AND id=$2`,
        [
          tenantId, id, input.effectiveDate, input.reason,
          prepared.fromPositionNodeId, prepared.fromPositionName, prepared.fromUnitName, prepared.fromManagerEmployeeId,
          prepared.fromSalary?.salary_grade_id ?? null, prepared.fromSalary?.salary_step_id ?? null,
          prepared.fromSalary?.base_salary ?? null,
          input.toPositionNodeId, prepared.toPositionName, prepared.toUnitName,
          input.managerMode, input.toManagerEmployeeId, input.subordinateMode, input.subordinateTargetEmployeeId,
          input.salaryChanged, input.toSalaryGradeId, input.toSalaryStepId, input.toSalaryType, input.toBaseSalary,
          input.attachmentId,
        ],
      )
      .catch(translateUnique);
    await lifecycleAudit(db, tenantId, actorId, 'PERSONNEL_DECISION_UPDATED', id, {
      decisionNo: row.decision_no,
    });
  });
  return mapDecision(await loadDecision(pool, tenantId, id));
}

// ---------------------------------------------------------------------------
// Duyệt, từ chối, hủy
// ---------------------------------------------------------------------------

export async function approveDecision(
  pool: Pool,
  tenantId: string,
  actorId: string,
  id: string,
  deps: { org: HrmOrgAppointmentPort },
): Promise<HrmPersonnelDecision> {
  await hrmTransaction(pool, async (db) => {
    const row = await loadDecision(db, tenantId, id, true);
    if (row.status !== 'DRAFT')
      throw new ConflictException('Chỉ duyệt được quyết định ở trạng thái nháp');
    const subject = await db.query(
      `SELECT user_id FROM core_schema.employees WHERE id = $1`,
      [row.employee_id],
    );
    const involved = row.created_by === actorId || subject.rows[0]?.user_id === actorId;
    if (involved && !(await loadAllowSelfApproval(db, tenantId)))
      throw new ForbiddenException({
        code: SELF_APPROVAL_FORBIDDEN,
        message: 'Người lập quyết định hoặc người được bổ nhiệm không được tự duyệt quyết định.',
      });
    await db.query(
      `UPDATE hrm_schema.personnel_decisions
          SET status='APPROVED', approved_by=$3, approved_at=now(), version=version+1, updated_at=now()
        WHERE tenant_id=$1 AND id=$2`,
      [tenantId, id, actorId],
    );
    await lifecycleAudit(db, tenantId, actorId, 'PERSONNEL_DECISION_APPROVED', id, {
      decisionNo: row.decision_no,
    });
  });
  return applyDecision(pool, tenantId, id, deps);
}

export async function rejectDecision(
  pool: Pool,
  tenantId: string,
  actorId: string,
  id: string,
  reason: unknown,
): Promise<HrmPersonnelDecision> {
  const text = requireText(reason, 'Lý do từ chối', 1000);
  await hrmTransaction(pool, async (db) => {
    const row = await loadDecision(db, tenantId, id, true);
    if (row.status !== 'DRAFT')
      throw new ConflictException('Chỉ từ chối được quyết định ở trạng thái nháp');
    await db.query(
      `UPDATE hrm_schema.personnel_decisions
          SET status='REJECTED', rejected_reason=$3, version=version+1, updated_at=now()
        WHERE tenant_id=$1 AND id=$2`,
      [tenantId, id, text],
    );
    await lifecycleAudit(db, tenantId, actorId, 'PERSONNEL_DECISION_REJECTED', id, {
      decisionNo: row.decision_no,
      reason: text,
    });
  });
  return mapDecision(await loadDecision(pool, tenantId, id));
}

export async function cancelDecision(
  pool: Pool,
  tenantId: string,
  actorId: string,
  id: string,
): Promise<HrmPersonnelDecision> {
  await hrmTransaction(pool, async (db) => {
    const row = await loadDecision(db, tenantId, id, true);
    if (!OPEN_STATUSES.includes(row.status))
      throw new ConflictException('Quyết định đã hoàn tất hoặc đã đóng, không thể hủy');
    if (Object.values((row.applied_steps ?? {}) as Record<string, boolean>).some(Boolean))
      throw new ConflictException({
        code: 'HRM_DECISION_PARTIALLY_APPLIED',
        message:
          'Quyết định đã áp dụng một phần nên không thể hủy. Thử lại áp dụng để hoàn tất hoặc lập quyết định điều chỉnh.',
      });
    await db.query(
      `UPDATE hrm_schema.personnel_decisions
          SET status='CANCELLED', version=version+1, updated_at=now()
        WHERE tenant_id=$1 AND id=$2`,
      [tenantId, id],
    );
    await lifecycleAudit(db, tenantId, actorId, 'PERSONNEL_DECISION_CANCELLED', id, {
      decisionNo: row.decision_no,
    });
  });
  return mapDecision(await loadDecision(pool, tenantId, id));
}

// ---------------------------------------------------------------------------
// Áp dụng
// ---------------------------------------------------------------------------

async function saveProgress(
  db: Queryable,
  tenantId: string,
  id: string,
  steps: Record<string, boolean>,
  coreAssignmentId?: string | null,
) {
  await db.query(
    `UPDATE hrm_schema.personnel_decisions
        SET applied_steps = $3::jsonb,
            core_assignment_id = COALESCE($4::uuid, core_assignment_id),
            updated_at = now()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, JSON.stringify(steps), coreAssignmentId ?? null],
  );
}

/** Đóng dòng báo cáo đang mở đến hết ngày trước ngày hiệu lực. */
async function closeLine(db: Queryable, line: Row, effectiveDate: string) {
  if (isoDate(line.effective_from) >= effectiveDate)
    throw new BadRequestException(
      'Ngày hiệu lực phải sau ngày bắt đầu của quan hệ báo cáo hiện tại',
    );
  await db.query(
    `UPDATE hrm_schema.employee_reporting_lines SET effective_to = $2, updated_at = now() WHERE id = $1`,
    [line.id, previousDay(effectiveDate)],
  );
}

async function applyManagerStep(db: PoolClient, tenantId: string, d: Row) {
  const employeeId = d.employee_id as string;
  const effective = isoDate(d.effective_date);
  await lockEmployee(db, tenantId, employeeId);
  const done = await db.query(
    `SELECT 1 FROM hrm_schema.employee_reporting_lines WHERE decision_id = $1 AND employee_id = $2`,
    [d.id, employeeId],
  );
  if (done.rowCount) return;
  const open = (
    await db.query(
      `SELECT * FROM hrm_schema.employee_reporting_lines
        WHERE tenant_id = $1 AND employee_id = $2 AND relation_type = 'DIRECT' AND effective_to IS NULL
        FOR UPDATE`,
      [tenantId, employeeId],
    )
  ).rows[0];
  if (d.manager_mode === 'CLEAR') {
    if (open) await closeLine(db, open, effective);
    return;
  }
  const manager = d.to_manager_employee_id as string;
  await assertActiveEmployee(db, tenantId, manager, 'Người quản lý');
  if (open?.manager_employee_id === manager) return;
  if (wouldCreateCycle(await openManagerMap(db, tenantId), employeeId, manager))
    throw new BadRequestException({
      code: 'HRM_REPORTING_CYCLE',
      message: 'Người quản lý được chọn đang báo cáo cho nhân viên này, sẽ tạo vòng lặp báo cáo',
    });
  if (open) await closeLine(db, open, effective);
  await db.query(
    `INSERT INTO hrm_schema.employee_reporting_lines
       (tenant_id, employee_id, manager_employee_id, effective_from, decision_id, source, note)
     VALUES ($1,$2,$3,$4,$5,'DECISION',$6)`,
    [tenantId, employeeId, manager, effective, d.id, `Theo ${d.decision_no}`],
  );
}

async function applySubordinatesStep(db: PoolClient, tenantId: string, d: Row) {
  const employeeId = d.employee_id as string;
  const target = d.subordinate_target_employee_id as string;
  const effective = isoDate(d.effective_date);
  await lockEmployee(db, tenantId, employeeId);
  await assertActiveEmployee(db, tenantId, target, 'Người nhận cấp dưới');
  const lines = (
    await db.query(
      `SELECT * FROM hrm_schema.employee_reporting_lines
        WHERE tenant_id = $1 AND manager_employee_id = $2 AND relation_type = 'DIRECT' AND effective_to IS NULL
        ORDER BY employee_id FOR UPDATE`,
      [tenantId, employeeId],
    )
  ).rows;
  if (lines.some((line) => line.employee_id === target))
    throw new BadRequestException('Người nhận cấp dưới đang là cấp dưới của nhân viên, hãy chọn người khác');
  const managerOf = await openManagerMap(db, tenantId);
  for (const line of lines) {
    const sub = line.employee_id as string;
    const done = await db.query(
      `SELECT 1 FROM hrm_schema.employee_reporting_lines WHERE decision_id = $1 AND employee_id = $2`,
      [d.id, sub],
    );
    if (done.rowCount) continue;
    if (wouldCreateCycle(managerOf, sub, target))
      throw new BadRequestException({
        code: 'HRM_REPORTING_CYCLE',
        message: 'Chuyển cấp dưới sang người nhận sẽ tạo vòng lặp báo cáo',
      });
    await closeLine(db, line, effective);
    await db.query(
      `INSERT INTO hrm_schema.employee_reporting_lines
         (tenant_id, employee_id, manager_employee_id, effective_from, decision_id, source, note)
       VALUES ($1,$2,$3,$4,$5,'DECISION',$6)`,
      [tenantId, sub, target, effective, d.id, `Theo ${d.decision_no}`],
    );
    managerOf.set(sub, target);
  }
}

/**
 * Ghi hồ sơ lương mới theo quyết định. Cùng ràng buộc với POST salary-profiles:
 * không sửa trong kỳ lương đã chốt, ngày hiệu lực phải sau hồ sơ lương đã lưu.
 */
async function applySalaryStep(db: PoolClient, tenantId: string, d: Row) {
  const employeeId = d.employee_id as string;
  const effective = isoDate(d.effective_date);
  await lockEmployee(db, tenantId, employeeId);
  const periods = await db.query(
    `SELECT id, status FROM hrm_schema.payroll_periods WHERE tenant_id = $1 AND to_date >= $2::date ORDER BY id FOR UPDATE`,
    [tenantId, effective],
  );
  if (periods.rows.some((p) => ['LOCKED', 'PAID'].includes(p.status)))
    throw new BadRequestException('Không sửa mức lương trong kỳ lương đã chốt');
  await db.query(
    `UPDATE hrm_schema.payroll_runs SET status='DRAFT', calculated_at=NULL
      WHERE tenant_id = $1 AND payroll_period_id = ANY($2::uuid[]) AND status NOT IN ('FINALIZED','CANCELLED')`,
    [tenantId, periods.rows.map((p) => p.id)],
  );
  const newer = await db.query(
    `SELECT id FROM hrm_schema.employee_salary_profiles
      WHERE tenant_id = $1 AND employee_id = $2 AND effective_from >= $3::date AND status <> 'CANCELLED'`,
    [tenantId, employeeId, effective],
  );
  if (newer.rowCount)
    throw new BadRequestException('Ngày hiệu lực phải sau hồ sơ lương đã lưu');
  await db.query(
    `UPDATE hrm_schema.employee_salary_profiles
        SET status='SUPERSEDED', effective_to=$3::date - 1, updated_at=now()
      WHERE tenant_id = $1 AND employee_id = $2 AND (effective_to IS NULL OR effective_to >= $3::date) AND status = 'ACTIVE'`,
    [tenantId, employeeId, effective],
  );
  await db.query(
    `INSERT INTO hrm_schema.employee_salary_profiles
       (tenant_id, employee_id, salary_grade_id, salary_step_id, salary_type, base_salary,
        currency, change_reason, effective_from, status, approved_by)
     VALUES ($1,$2,$3,$4,$5,$6,'VND',$7,$8,'ACTIVE',$9)`,
    [
      tenantId,
      employeeId,
      d.to_salary_grade_id,
      d.to_salary_step_id,
      d.to_salary_type,
      d.to_base_salary,
      `Theo ${d.decision_no}: ${d.reason}`.slice(0, 2000),
      effective,
      d.approved_by,
    ],
  );
}

/**
 * Áp dụng quyết định đã duyệt: Core (chức danh) → người quản lý → cấp dưới →
 * lương. Mỗi bước ghi tiến độ vào `applied_steps` nên thử lại đi tiếp từ bước
 * lỗi. Không ném lỗi nghiệp vụ: lỗi được lưu vào `apply_error` và quyết định
 * chuyển `APPLY_PENDING` để HR thấy và thử lại.
 */
export async function applyDecision(
  pool: Pool,
  tenantId: string,
  id: string,
  deps: { org: HrmOrgAppointmentPort },
): Promise<HrmPersonnelDecision> {
  const lockKey = `hrm:decision-apply:${id}`;
  const client = await pool.connect();
  try {
    const lock = await client.query(
      `SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS ok`,
      [lockKey],
    );
    if (!lock.rows[0].ok)
      throw new ConflictException({
        code: 'HRM_DECISION_APPLY_IN_PROGRESS',
        message: 'Quyết định đang được áp dụng, thử lại sau ít giây',
      });
    try {
      return await runApply(pool, tenantId, id, deps);
    } finally {
      await client.query(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`, [lockKey]);
    }
  } finally {
    client.release();
  }
}

async function runApply(
  pool: Pool,
  tenantId: string,
  id: string,
  deps: { org: HrmOrgAppointmentPort },
): Promise<HrmPersonnelDecision> {
  const d = await loadDecision(pool, tenantId, id);
  if (!['APPROVED', 'APPLY_PENDING'].includes(d.status)) return mapDecision(d);
  if (isoDate(d.effective_date) > (await todayInVietnam(pool))) return mapDecision(d);

  const steps: Record<string, boolean> = { ...(d.applied_steps ?? {}) };
  await pool.query(
    `UPDATE hrm_schema.personnel_decisions SET apply_attempts = apply_attempts + 1 WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  const type = d.decision_type as DecisionType;
  try {
    if (needsCoreAction(type) && !steps['core']) {
      const employee = await employeeRow(pool, tenantId, d.employee_id);
      if (!employee.user_id)
        throw new BadRequestException('Nhân viên chưa liên kết tài khoản');
      const result = await deps.org.apply(tenantId, {
        decisionId: d.id,
        action: type === 'DISMISS' ? 'END' : 'ASSIGN',
        userId: employee.user_id,
        nodeId: type === 'DISMISS' ? d.from_position_node_id : d.to_position_node_id,
        effectiveDate: isoDate(d.effective_date),
        isPrimary: replacesPrimaryPosition(type),
        endCurrent: replacesPrimaryPosition(type),
        note: `Theo ${d.decision_no}: ${d.reason}`.slice(0, 500),
      });
      steps['core'] = true;
      await saveProgress(pool, tenantId, id, steps, result.assignmentId);
    }
    if (d.manager_mode !== 'KEEP' && !steps['manager']) {
      await hrmTransaction(pool, async (db) => {
        await applyManagerStep(db, tenantId, d);
        await saveProgress(db, tenantId, id, { ...steps, manager: true });
      });
      steps['manager'] = true;
    }
    if (d.subordinate_mode === 'REASSIGN' && !steps['subordinates']) {
      await hrmTransaction(pool, async (db) => {
        await applySubordinatesStep(db, tenantId, d);
        await saveProgress(db, tenantId, id, { ...steps, subordinates: true });
      });
      steps['subordinates'] = true;
    }
    if (d.salary_changed === true && !steps['salary']) {
      await hrmTransaction(pool, async (db) => {
        await applySalaryStep(db, tenantId, d);
        await saveProgress(db, tenantId, id, { ...steps, salary: true });
      });
      steps['salary'] = true;
    }
    await hrmTransaction(pool, async (db) => {
      await db.query(
        `UPDATE hrm_schema.personnel_decisions
            SET status='APPLIED', applied_at=now(), apply_error=NULL, version=version+1, updated_at=now()
          WHERE tenant_id=$1 AND id=$2`,
        [tenantId, id],
      );
      await lifecycleAudit(db, tenantId, d.approved_by ?? d.created_by ?? id, 'PERSONNEL_DECISION_APPLIED', id, {
        decisionNo: d.decision_no,
        steps,
      });
    });
  } catch (error) {
    const message =
      error instanceof HrmOrgAppointmentError || error instanceof Error
        ? (error as Error).message
        : 'Lỗi không xác định khi áp dụng quyết định';
    const detail = (error as { getResponse?: () => unknown }).getResponse?.();
    const text =
      detail && typeof detail === 'object' && 'message' in detail
        ? String((detail as { message: unknown }).message)
        : message;
    await pool.query(
      `UPDATE hrm_schema.personnel_decisions
          SET status='APPLY_PENDING', apply_error=$3, applied_steps=$4::jsonb, version=version+1, updated_at=now()
        WHERE tenant_id=$1 AND id=$2`,
      [tenantId, id, text.slice(0, 1000), JSON.stringify(steps)],
    );
  }
  return mapDecision(await loadDecision(pool, tenantId, id));
}

/** Worker gọi mỗi ngày: áp dụng các quyết định đã duyệt đến hạn hoặc đang chờ thử lại. */
export async function applyDueDecisions(
  pool: Pool,
  tenantId: string,
  deps: { org: HrmOrgAppointmentPort },
): Promise<{ applied: number; pending: number }> {
  // Tenant chưa chạy migration 0032 thì không có gì để áp dụng.
  const ready = await pool.query(
    `SELECT to_regclass('hrm_schema.personnel_decisions') IS NOT NULL AS ready`,
  );
  if (ready.rows[0]?.ready !== true) return { applied: 0, pending: 0 };
  const due = await pool.query(
    `SELECT id FROM hrm_schema.personnel_decisions
      WHERE tenant_id = $1 AND status IN ('APPROVED','APPLY_PENDING') AND effective_date <= ${TODAY_SQL}
      ORDER BY effective_date, created_at LIMIT 100`,
    [tenantId],
  );
  let applied = 0;
  let pending = 0;
  for (const row of due.rows) {
    try {
      const result = await applyDecision(pool, tenantId, row.id, deps);
      if (result.status === 'APPLIED') applied++;
      else pending++;
    } catch {
      pending++; // đang áp dụng ở nơi khác; lượt chạy sau sẽ xử lý
    }
  }
  return { applied, pending };
}
