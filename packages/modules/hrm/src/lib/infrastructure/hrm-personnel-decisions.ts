import type {
  CreateHrmPersonnelDecisionPayload,
  HrmAppointmentContext,
  HrmCareerEvent,
  HrmPersonnelDecision,
  HrmReportingOverview,
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
  replacesPrimaryPosition,
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
const DECISION_TITLES: Record<string, string> = {
  APPOINT: 'Bổ nhiệm',
  PROMOTE: 'Thăng chức',
  TRANSFER: 'Điều chuyển',
  CONCURRENT: 'Kiêm nhiệm',
  DISMISS: 'Miễn nhiệm',
  CHANGE_MANAGER: 'Đổi quản lý trực tiếp',
};

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

const CONTRACT_TITLES: Record<string, string> = {
  PROBATION: 'Hợp đồng thử việc',
  DEFINITE: 'Hợp đồng xác định thời hạn',
  INDEFINITE: 'Hợp đồng không xác định thời hạn',
  AMENDMENT: 'Phụ lục / gia hạn hợp đồng',
};

/**
 * Lịch sử bổ nhiệm và công tác của một nhân viên: các quyết định đã ghi nhận (chỉ lưu lịch sử) cùng các mốc
 * hợp đồng đã phát hành (dữ liệu chuẩn của HĐ). Chỉ đọc; không đụng Core hay luồng gán chức danh.
 */
export async function listCareerEvents(
  db: Queryable,
  tenantId: string,
  employeeId: string,
): Promise<HrmCareerEvent[]> {
  requireUuid(employeeId, 'Nhân viên');
  const decisions = await db.query(
    `SELECT id, decision_no, decision_type, effective_date, reason, to_position_name, to_unit_name,
            from_position_name, from_unit_name
       FROM hrm_schema.personnel_decisions
      WHERE tenant_id = $1 AND employee_id = $2 AND status = 'RECORDED'`,
    [tenantId, employeeId],
  );
  const contracts = await db.query(
    `SELECT id, contract_code, contract_type, effective_from, effective_to, terminated_on, note
       FROM hrm_schema.employment_contracts
      WHERE tenant_id = $1 AND employee_id = $2 AND deleted_at IS NULL AND status <> 'DRAFT'`,
    [tenantId, employeeId],
  );
  const events: HrmCareerEvent[] = [
    ...decisions.rows.map((r): HrmCareerEvent => ({
      id: r.id,
      source: 'DECISION',
      kind: r.decision_type,
      title: DECISION_TITLES[r.decision_type as string] ?? 'Quyết định nhân sự',
      effectiveDate: isoDate(r.effective_date),
      endDate: null,
      positionName: r.to_position_name ?? r.from_position_name ?? null,
      unitName: r.to_unit_name ?? r.from_unit_name ?? null,
      reference: r.decision_no,
      note: r.reason ?? null,
    })),
    ...contracts.rows.map((r): HrmCareerEvent => ({
      id: r.id,
      source: 'CONTRACT',
      kind: r.contract_type,
      title: CONTRACT_TITLES[r.contract_type as string] ?? 'Hợp đồng lao động',
      effectiveDate: isoDate(r.effective_from),
      endDate: r.terminated_on ? isoDate(r.terminated_on) : r.effective_to ? isoDate(r.effective_to) : null,
      positionName: null,
      unitName: null,
      reference: r.contract_code,
      note: r.note ?? null,
    })),
  ];
  return events.sort(
    (a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || a.source.localeCompare(b.source),
  );
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
// Quản lý trực tiếp
// ---------------------------------------------------------------------------

export async function loadReportingOverview(
  db: Queryable,
  tenantId: string,
  employeeId: string,
): Promise<HrmReportingOverview> {
  requireUuid(employeeId, 'Nhân viên');
  const resolved = await loadDirectManagerRef(db, tenantId, employeeId);
  return {
    manager: resolved
      ? {
          employeeId: resolved.employeeId,
          name: resolved.name,
          code: resolved.code ?? null,
          title: resolved.title,
          email: resolved.email,
          source: resolved.source ?? 'CORE_POSITION',
        }
      : null,
  };
}

/** Người quản lý trực tiếp hiện tại kèm mã nhân viên (dùng cho màn hình cách duyệt đơn). */
export interface HrmDirectManagerRef {
  employeeId: string;
  name: string;
  title: string | null;
  email: string | null;
  /** Mã nhân viên của người quản lý (nếu có hồ sơ HRM). */
  code?: string | null;
  source?: 'CORE_POSITION' | 'CHIEF_FALLBACK';
}

/** Người quản lý trực tiếp hiện tại để hiển thị trên hồ sơ (tên, chức danh, email). */
export async function loadDirectManager(
  db: Queryable,
  tenantId: string,
  employeeId: string,
): Promise<{ name: string; title: string | null; email: string | null } | null> {
  const manager = await loadDirectManagerRef(db, tenantId, employeeId);
  return manager
    ? { name: manager.name, title: manager.title, email: manager.email }
    : null;
}

/**
 * Quản lý trực tiếp theo sơ đồ tổ chức của Core: lấy chức danh đang giữ của nhân viên (chức danh chính, không có thì
 * chức danh sớm nhất), đi theo "Báo cáo cho" (ô ghi đè trên phân công thắng giá trị của chức danh) rồi lấy người đang
 * giữ chức danh đó. Chức danh trống hoặc người giữ đã nghỉ việc/là chính nhân viên thì leo tiếp lên cấp trên.
 * Trả null khi chưa khai báo "Báo cáo cho" hoặc không có ai giữ các chức danh phía trên.
 */
async function managerFromCorePositions(
  db: Queryable,
  tenantId: string,
  employeeId: string,
): Promise<HrmDirectManagerRef | null> {
  const column = await db.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'core_schema' AND table_name = 'organization_nodes' AND column_name = 'reports_to_position_id'`,
  );
  if (!column.rows.length) return null;
  const active = `a.deleted_at IS NULL AND a.status = 'active'
      AND (a.start_date IS NULL OR a.start_date <= ${TODAY_SQL})
      AND (a.end_date IS NULL OR a.end_date >= ${TODAY_SQL})`;
  const own = await db.query(
    `SELECT COALESCE(a.reports_to_position_override_id, n.reports_to_position_id) AS start_position_id
       FROM core_schema.employees e
       JOIN core_schema.organization_node_assignments a ON a.user_id = e.user_id AND ${active}
       JOIN core_schema.organization_nodes n ON n.id = a.node_id AND n.deleted_at IS NULL AND n.category = 'position'
      WHERE e.tenant_id = $1 AND e.id = $2 AND e.deleted_at IS NULL
      ORDER BY a.is_primary DESC, a.created_at LIMIT 1`,
    [tenantId, employeeId],
  );
  const start = own.rows[0]?.start_position_id as string | null | undefined;
  if (!start) return null;
  const result = await db.query(
    `WITH RECURSIVE chain AS (
       SELECT n.id, n.name, n.reports_to_position_id AS next_id, 1 AS lvl, ARRAY[n.id] AS seen
         FROM core_schema.organization_nodes n
        WHERE n.id = $3::uuid AND n.deleted_at IS NULL AND n.category = 'position'
       UNION ALL
       SELECT p.id, p.name, p.reports_to_position_id, c.lvl + 1, c.seen || p.id
         FROM chain c
         JOIN core_schema.organization_nodes p ON p.id = c.next_id AND p.deleted_at IS NULL AND p.category = 'position'
        WHERE NOT p.id = ANY(c.seen) AND c.lvl < 50
     )
     SELECT e.id AS manager_employee_id, e.full_name, e.work_email, c.name AS position_name, ep.employee_code
       FROM chain c
       JOIN core_schema.organization_node_assignments a ON a.node_id = c.id AND ${active}
       JOIN core_schema.users u ON u.id = a.user_id AND u.status = 'active' AND u.is_active = true
       JOIN core_schema.employees e ON e.user_id = a.user_id AND e.tenant_id = $1 AND e.deleted_at IS NULL AND e.id <> $2
       LEFT JOIN hrm_schema.employee_profiles ep ON ep.employee_id = e.id AND ep.tenant_id = $1 AND ep.deleted_at IS NULL
      WHERE ep.employment_status IS NULL OR ep.employment_status <> ALL($4::text[])
      ORDER BY c.lvl, a.is_primary DESC, a.created_at
      LIMIT 1`,
    [tenantId, employeeId, start, INACTIVE_EMPLOYMENT],
  );
  const row = result.rows[0];
  return row
    ? {
        employeeId: row.manager_employee_id,
        name: row.full_name,
        title: row.position_name ?? null,
        email: row.work_email ?? null,
        code: row.employee_code ?? null,
        source: 'CORE_POSITION',
      }
    : null;
}

/**
 * Như `loadDirectManager` nhưng trả thêm mã nhân viên của người quản lý.
 * Lấy theo chuỗi "Báo cáo cho" của chức danh trong sơ đồ tổ chức Core.
 * Nếu không có quản lý trực tiếp, trả về null để luồng duyệt chuyển sang chức danh dự phòng hoặc người có quyền duyệt toàn bộ.
 */
export async function loadDirectManagerRef(
  db: Queryable,
  tenantId: string,
  employeeId: string,
): Promise<HrmDirectManagerRef | null> {
  return managerFromCorePositions(db, tenantId, employeeId);
}

export async function loadAppointmentContext(
  db: Queryable,
  tenantId: string,
  employeeId: string,
): Promise<HrmAppointmentContext> {
  requireUuid(employeeId, 'Nhân viên');
  const employee = await employeeRow(db, tenantId, employeeId);
  const [position, overview, salary] = await Promise.all([
    currentPosition(db, employee.user_id),
    loadReportingOverview(db, tenantId, employeeId),
    currentSalary(db, tenantId, employeeId),
  ]);
  const manager = overview.manager
    ? {
        employeeId: overview.manager.employeeId,
        fullName: overview.manager.name,
        employeeCode: overview.manager.code,
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

/** Các trường gán quản lý trực tiếp đã bị gỡ khỏi quyết định; từ chối rõ ràng thay vì lặng lẽ bỏ qua. */
function assertNoManagerFields(body: Record<string, unknown>) {
  const used = (key: string) => body[key] !== undefined && body[key] !== null && body[key] !== 'KEEP';
  if (['managerMode', 'toManagerEmployeeId', 'subordinateMode', 'subordinateTargetEmployeeId'].some(used))
    throw new BadRequestException({
      code: 'HRM_DECISION_MANAGER_REMOVED',
      message:
        'Quyết định nhân sự không còn gán quản lý trực tiếp hay chuyển cấp dưới. Đổi "Báo cáo cho" của chức danh ở Cấu trúc tổ chức.',
    });
}

function normalizeInput(
  body: Partial<CreateHrmPersonnelDecisionPayload>,
  base?: DecisionInput,
): DecisionInput {
  assertNoManagerFields(body as Record<string, unknown>);
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
  /** Chế độ ghi nhận lịch sử: không áp dụng sang Core/lương nên bỏ các rào chắn của việc áp dụng. */
  record = false,
) {
  const errors = decisionShapeErrors(input);
  if (errors.length)
    throw new BadRequestException({ code: 'HRM_INVALID_INPUT', message: errors[0], errors });

  await lockEmployee(db, tenantId, input.employeeId);
  const employee = await employeeRow(db, tenantId, input.employeeId);
  if (INACTIVE_EMPLOYMENT.includes(employee.employment_status))
    throw new BadRequestException('Nhân viên đã nghỉ việc, không thể lập quyết định');
  if (!record && needsCoreAction(input.decisionType) && !employee.user_id)
    throw new BadRequestException({
      code: 'HRM_EMPLOYEE_NO_ACCOUNT',
      message:
        'Nhân viên chưa liên kết tài khoản nên không thể cập nhật chức danh trên sơ đồ tổ chức. Liên kết tài khoản trước.',
    });

  const open = record
    ? { rows: [] as Row[] }
    : await db.query(
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
  if (!record && input.decisionType === 'DISMISS' && !position)
    throw new BadRequestException('Nhân viên chưa giữ chức danh nào để miễn nhiệm');
  let target: { name: string; unitName: string | null } | null = null;
  if (isAssigningType(input.decisionType)) {
    target = await positionInfo(db, input.toPositionNodeId as string);
    if (!record && position && position.nodeId === input.toPositionNodeId)
      throw new BadRequestException('Nhân viên đang giữ chức danh này');
  }

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
    fromManagerEmployeeId: overview.manager?.employeeId ?? null,
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
  /** `record`: chỉ ghi lịch sử công tác (RECORDED), không đi vào luồng duyệt/áp dụng. */
  record = false,
): Promise<HrmPersonnelDecision> {
  const input = normalizeInput(body);
  const id = await hrmTransaction(pool, async (db) => {
    const prepared = await prepareDecision(db, tenantId, input, undefined, record);
    const decisionNo = input.decisionNo ?? (await nextNumber(db, tenantId, input.effectiveDate));
    const inserted = await db
      .query(
        `INSERT INTO hrm_schema.personnel_decisions (
           tenant_id, decision_no, decision_type, employee_id, effective_date, reason,
           from_position_node_id, from_position_name, from_unit_name, from_manager_employee_id,
           from_salary_grade_id, from_salary_step_id, from_base_salary,
           to_position_node_id, to_position_name, to_unit_name,
           salary_changed, to_salary_grade_id, to_salary_step_id, to_salary_type, to_base_salary,
           attachment_id, created_by, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
         RETURNING id`,
        [
          tenantId, decisionNo, input.decisionType, input.employeeId, input.effectiveDate, input.reason,
          prepared.fromPositionNodeId, prepared.fromPositionName, prepared.fromUnitName, prepared.fromManagerEmployeeId,
          prepared.fromSalary?.salary_grade_id ?? null, prepared.fromSalary?.salary_step_id ?? null,
          prepared.fromSalary?.base_salary ?? null,
          input.toPositionNodeId, prepared.toPositionName, prepared.toUnitName,
          input.salaryChanged, input.toSalaryGradeId, input.toSalaryStepId, input.toSalaryType, input.toBaseSalary,
          input.attachmentId, actorId, record ? 'RECORDED' : 'DRAFT',
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
    const record = row.status === 'RECORDED';
    if (row.status !== 'DRAFT' && !record)
      throw new ConflictException('Chỉ sửa được quyết định ở trạng thái nháp hoặc đã ghi nhận');
    if (Number(row.version) !== Number(body.version))
      throw new ConflictException({
        code: 'HRM_STALE_VERSION',
        message: 'Quyết định đã được người khác thay đổi. Tải lại trước khi lưu.',
      });
    const input = normalizeInput(
      { ...(body as Partial<CreateHrmPersonnelDecisionPayload>), decisionNo: undefined },
      inputFromRow(row),
    );
    const prepared = await prepareDecision(db, tenantId, input, id, record);
    await db
      .query(
        `UPDATE hrm_schema.personnel_decisions SET
           effective_date=$3, reason=$4,
           from_position_node_id=$5, from_position_name=$6, from_unit_name=$7, from_manager_employee_id=$8,
           from_salary_grade_id=$9, from_salary_step_id=$10, from_base_salary=$11,
           to_position_node_id=$12, to_position_name=$13, to_unit_name=$14,
           salary_changed=$15, to_salary_grade_id=$16, to_salary_step_id=$17, to_salary_type=$18, to_base_salary=$19,
           attachment_id=$20, version=version+1, updated_at=now()
         WHERE tenant_id=$1 AND id=$2`,
        [
          tenantId, id, input.effectiveDate, input.reason,
          prepared.fromPositionNodeId, prepared.fromPositionName, prepared.fromUnitName, prepared.fromManagerEmployeeId,
          prepared.fromSalary?.salary_grade_id ?? null, prepared.fromSalary?.salary_step_id ?? null,
          prepared.fromSalary?.base_salary ?? null,
          input.toPositionNodeId, prepared.toPositionName, prepared.toUnitName,
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

/**
 * Quyết định cũ (lập trước khi gỡ tính năng) có thể còn bước gán quản lý hoặc chuyển cấp dưới chưa áp dụng.
 * Không còn nơi ghi quan hệ báo cáo nên không duyệt/áp dụng tiếp, tránh báo "đã áp dụng" mà không đổi gì.
 */
function assertNoLegacyManagerStep(d: Row, steps: Record<string, boolean>) {
  const pendingManager = d.manager_mode !== 'KEEP' && !steps['manager'];
  const pendingSubordinates = d.subordinate_mode === 'REASSIGN' && !steps['subordinates'];
  if (pendingManager || pendingSubordinates || d.decision_type === 'CHANGE_MANAGER')
    throw new ConflictException({
      code: 'HRM_DECISION_MANAGER_REMOVED',
      message:
        'Quyết định này có bước gán quản lý trực tiếp hoặc chuyển cấp dưới, tính năng đã được gỡ. Hủy quyết định và đổi "Báo cáo cho" của chức danh ở Cấu trúc tổ chức.',
    });
}

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
    assertNoLegacyManagerStep(row, {});
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

/**
 * Gán chức danh nhanh từ Drawer "Sửa" của hồ sơ nhân sự: tạo một quyết định APPOINT rồi tự áp dụng ngay bởi
 * chính người thao tác, không qua `approveDecision` nên không bị chặn "không tự duyệt quyết định của mình"
 * (chắn đó dành cho quyết định đầy đủ cần người khác duyệt: thăng chức, điều chuyển, miễn nhiệm qua màn
 * Quyết định nhân sự). Vẫn đi qua mọi rào chắn của `createDecision` (đã giữ chức danh này, chưa liên kết tài
 * khoản, đang có quyết định khác dở dang...) và vẫn gọi Core qua `HrmOrgAppointmentPort` như mọi quyết định
 * khác — không ghi trực tiếp `core_schema`. Controller phải tự kiểm tra người gọi có cả hai quyền
 * `hrm.appointment.manage` và `hrm.appointment.approve` trước khi gọi hàm này.
 */
export async function quickAssignPosition(
  pool: Pool,
  tenantId: string,
  actorId: string,
  input: {
    employeeId: string;
    toPositionNodeId: string;
    reason: string;
    effectiveDate?: string;
    /** REPLACE (mặc định): thay chức danh chính (Bổ nhiệm). CONCURRENT: giữ chức danh cũ, thêm chức danh kiêm nhiệm. */
    mode?: 'REPLACE' | 'CONCURRENT';
  },
  deps: { org: HrmOrgAppointmentPort },
): Promise<HrmPersonnelDecision> {
  const effectiveDate = input.effectiveDate ?? (await todayInVietnam(pool));
  const created = await createDecision(pool, tenantId, actorId, {
    decisionType: input.mode === 'CONCURRENT' ? 'CONCURRENT' : 'APPOINT',
    employeeId: input.employeeId,
    toPositionNodeId: input.toPositionNodeId,
    effectiveDate,
    reason: input.reason,
  } as CreateHrmPersonnelDecisionPayload);
  await hrmTransaction(pool, async (db) => {
    await db.query(
      `UPDATE hrm_schema.personnel_decisions
          SET status='APPROVED', approved_by=$3, approved_at=now(), version=version+1, updated_at=now()
        WHERE tenant_id=$1 AND id=$2`,
      [tenantId, created.id, actorId],
    );
    await lifecycleAudit(db, tenantId, actorId, 'PERSONNEL_DECISION_SELF_APPLIED', created.id, {
      decisionNo: created.decisionNo,
      note: 'Gán chức danh nhanh từ hồ sơ nhân sự: tự áp dụng, không qua người duyệt khác',
    });
  });
  return applyDecision(pool, tenantId, created.id, deps);
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
    if (!OPEN_STATUSES.includes(row.status) && row.status !== 'RECORDED')
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
 * Áp dụng quyết định đã duyệt: Core (chức danh) → lương. Mỗi bước ghi tiến độ vào `applied_steps` nên thử lại đi tiếp từ bước
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
    assertNoLegacyManagerStep(d, steps);
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
