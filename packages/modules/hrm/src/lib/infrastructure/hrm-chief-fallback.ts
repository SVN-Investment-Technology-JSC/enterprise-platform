import type { PoolClient } from 'pg';

type Queryable = Pick<PoolClient, 'query'>;

const TODAY_SQL = `(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`;
const INACTIVE_EMPLOYMENT = ['RESIGNED', 'TERMINATED'];
const MAX_CHAIN = 50;

/**
 * Bậc dự phòng cuối của "quản lý trực tiếp": nhân viên không có "Báo cáo cho" nào dẫn tới người đang giữ chức danh
 * (Core) thì Tổng giám đốc duyệt. HRM không gán quản lý nên không còn lớp nào nằm giữa.
 * Tổng giám đốc là người đang giữ chức danh có tên chứa "Tổng giám đốc" (không tính "Phó Tổng giám đốc").
 */

export interface OrgPosition {
  id: string;
  name: string;
  reportsToId: string | null;
}

/** Một người đang giữ một chức danh (phân công đang hiệu lực, tài khoản đang hoạt động). */
export interface OrgHolder {
  positionId: string;
  isPrimary: boolean;
  overrideId: string | null;
  employeeId: string;
  userId: string;
  name: string;
  email: string | null;
  code: string | null;
  inactive: boolean;
}

export interface OrgEmployee {
  employeeId: string;
  userId: string | null;
  inactive: boolean;
}

export interface OrgFacts {
  positions: OrgPosition[];
  /** Đã xếp chức danh chính trước. */
  holders: OrgHolder[];
  employees: OrgEmployee[];
}

export interface ChiefApprover {
  employeeId: string;
  userId: string;
  name: string;
  title: string | null;
  email: string | null;
  code: string | null;
}

export function isChiefPositionName(name: string): boolean {
  const normalized = name.normalize('NFC').toLocaleLowerCase('vi');
  return /tổng giám đốc/.test(normalized) && !/phó\s+tổng giám đốc/.test(normalized);
}

export function findChiefs(facts: OrgFacts): ChiefApprover[] {
  const names = new Map(facts.positions.map((p) => [p.id, p.name]));
  const seen = new Set<string>();
  const chiefs: ChiefApprover[] = [];
  for (const holder of facts.holders) {
    const title = names.get(holder.positionId);
    if (!title || holder.inactive || !isChiefPositionName(title) || seen.has(holder.employeeId)) continue;
    seen.add(holder.employeeId);
    chiefs.push({
      employeeId: holder.employeeId,
      userId: holder.userId,
      name: holder.name,
      title,
      email: holder.email,
      code: holder.code,
    });
  }
  return chiefs;
}

/** Cùng quy tắc với managerFromCorePositions: leo theo "Báo cáo cho" tới chức danh đầu tiên còn người giữ. */
function hasCoreManager(facts: OrgFacts, employee: OrgEmployee): boolean {
  if (!employee.userId) return false;
  const own = facts.holders.find((h) => h.userId === employee.userId);
  if (!own) return false;
  const reportsTo = new Map(facts.positions.map((p) => [p.id, p.reportsToId]));
  const holdersOf = new Map<string, OrgHolder[]>();
  for (const holder of facts.holders)
    holdersOf.set(holder.positionId, [...(holdersOf.get(holder.positionId) ?? []), holder]);
  const seen = new Set<string>([own.positionId]);
  let cursor = own.overrideId ?? reportsTo.get(own.positionId) ?? null;
  for (let level = 0; cursor && !seen.has(cursor) && level < MAX_CHAIN; level += 1) {
    if (!reportsTo.has(cursor)) return false;
    const eligible = (holdersOf.get(cursor) ?? []).some(
      (h) => h.employeeId !== employee.employeeId && !h.inactive,
    );
    if (eligible) return true;
    seen.add(cursor);
    cursor = reportsTo.get(cursor) ?? null;
  }
  return false;
}

/** Nhân viên đang làm việc không có quản lý theo Core. */
export function employeesWithoutManager(facts: OrgFacts): OrgEmployee[] {
  return facts.employees.filter(
    (employee) =>
      !employee.inactive && !hasCoreManager(facts, employee),
  );
}

/** Người duyệt dự phòng của một nhân viên: Tổng giám đốc đầu tiên không phải chính nhân viên đó. */
export function chiefFor(facts: OrgFacts, employeeId: string): ChiefApprover | null {
  return findChiefs(facts).find((c) => c.employeeId !== employeeId) ?? null;
}

const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

/** Đọc Core và HRM; dòng không đúng hình dạng bị bỏ qua để lỗi dữ liệu không làm hỏng luồng duyệt. */
export async function loadOrgFacts(db: Queryable, tenantId: string): Promise<OrgFacts> {
  const tableCheck = await db.query(
    `SELECT to_regclass('core_schema.organization_nodes') IS NOT NULL AND to_regclass('core_schema.organization_node_assignments') IS NOT NULL AS ready`,
  );
  if (tableCheck.rows[0]?.ready !== true) return { positions: [], holders: [], employees: [] };

  const column = await db.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'core_schema' AND table_name = 'organization_nodes' AND column_name = 'reports_to_position_id'`,
  );
  const hasReportsTo = (column.rows?.length ?? 0) > 0;
  const reportsTo = hasReportsTo ? 'n.reports_to_position_id' : 'NULL::uuid';
  const override = hasReportsTo ? 'a.reports_to_position_override_id' : 'NULL::uuid';
  const [positions, holders, employees] = await Promise.all([
    db.query(
      `SELECT n.id, n.name, ${reportsTo} AS reports_to_id
         FROM core_schema.organization_nodes n
        WHERE n.deleted_at IS NULL AND n.category = 'position'`,
    ),
    db.query(
      `SELECT a.node_id, a.is_primary, ${override} AS override_id,
              e.id AS employee_id, e.user_id, e.full_name, e.work_email, ep.employee_code, ep.employment_status
         FROM core_schema.organization_node_assignments a
         JOIN core_schema.users u ON u.id = a.user_id AND u.status = 'active' AND u.is_active = true
         JOIN core_schema.employees e ON e.user_id = a.user_id AND e.tenant_id = $1 AND e.deleted_at IS NULL
         LEFT JOIN hrm_schema.employee_profiles ep ON ep.employee_id = e.id AND ep.tenant_id = $1 AND ep.deleted_at IS NULL
        WHERE a.deleted_at IS NULL AND a.status = 'active'
          AND (a.start_date IS NULL OR a.start_date <= ${TODAY_SQL})
          AND (a.end_date IS NULL OR a.end_date >= ${TODAY_SQL})
        ORDER BY a.is_primary DESC, a.created_at`,
      [tenantId],
    ),
    db.query(
      `SELECT e.id AS employee_id, e.user_id, ep.employment_status
         FROM core_schema.employees e
         LEFT JOIN hrm_schema.employee_profiles ep ON ep.employee_id = e.id AND ep.tenant_id = e.tenant_id AND ep.deleted_at IS NULL
        WHERE e.tenant_id = $1 AND e.deleted_at IS NULL`,
      [tenantId],
    ),
  ]);
  const inactive = (status: unknown) => typeof status === 'string' && INACTIVE_EMPLOYMENT.includes(status);
  return {
    positions: (positions.rows ?? []).flatMap((row: Record<string, unknown>) =>
      text(row['id']) && text(row['name'])
        ? [{ id: row['id'] as string, name: row['name'] as string, reportsToId: text(row['reports_to_id']) }]
        : [],
    ),
    holders: (holders.rows ?? []).flatMap((row: Record<string, unknown>) =>
      text(row['node_id']) && text(row['employee_id']) && text(row['user_id'])
        ? [
            {
              positionId: row['node_id'] as string,
              isPrimary: row['is_primary'] === true,
              overrideId: text(row['override_id']),
              employeeId: row['employee_id'] as string,
              userId: row['user_id'] as string,
              name: text(row['full_name']) ?? '',
              email: text(row['work_email']),
              code: text(row['employee_code']),
              inactive: inactive(row['employment_status']),
            },
          ]
        : [],
    ),
    employees: (employees.rows ?? []).flatMap((row: Record<string, unknown>) =>
      text(row['employee_id'])
        ? [
            {
              employeeId: row['employee_id'] as string,
              userId: text(row['user_id']),
              inactive: inactive(row['employment_status']),
            },
          ]
        : [],
    ),
  };
}

/** Người duyệt dự phòng (Tổng giám đốc) của một nhân viên đã biết là không có quản lý theo Core. */
export async function loadChiefFor(
  db: Queryable,
  tenantId: string,
  employeeId: string,
): Promise<ChiefApprover | null> {
  return chiefFor(await loadOrgFacts(db, tenantId), employeeId);
}

/**
 * User id của những người mà `actorUserId` được duyệt thay Tổng giám đốc; rỗng nếu actor không phải Tổng giám đốc.
 * Chỉ bổ sung phạm vi nên lỗi đọc dữ liệu được coi là không có phạm vi thêm (không bao giờ mở rộng quyền).
 */
export async function chiefFallbackUserIds(
  db: Queryable,
  tenantId: string,
  actorUserId: string,
): Promise<ReadonlySet<string>> {
  try {
    const facts = await loadOrgFacts(db, tenantId);
    if (!findChiefs(facts).some((c) => c.userId === actorUserId)) return new Set();
    return new Set(
      employeesWithoutManager(facts).flatMap((e) => (e.userId && e.userId !== actorUserId ? [e.userId] : [])),
    );
  } catch {
    return new Set();
  }
}
