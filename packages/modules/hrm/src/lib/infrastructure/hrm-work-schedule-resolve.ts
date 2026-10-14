import type { PoolClient } from 'pg';

type Db = Pick<PoolClient, 'query'>;

export interface RuleDay {
  employeeId: string;
  date: string;
  dayType: 'SHIFT' | 'OFF';
  shiftId: string | null;
  ruleId: string;
  scopeType: 'EMPLOYEE' | 'UNIT' | 'COMPANY';
  autoAttendance: boolean;
}

/** Bảng được thêm, không bị xoá, nên chỉ cache kết quả dương (cùng cách với bảng lịch từng ngày). */
const rulesReady = new Set<string>();
export async function ruleTableExists(db: Db, tenantId: string): Promise<boolean> {
  if (rulesReady.has(tenantId)) return true;
  const r = await db.query(`SELECT to_regclass('hrm_schema.work_schedule_rules') IS NOT NULL AS ready`);
  const ready = r.rows[0]?.ready === true;
  if (ready) rulesReady.add(tenantId);
  return ready;
}

/** Cột auto_attendance (migration 0053) đã có chưa; chỉ cache kết quả dương như các bảng khác. */
const autoReady = new Set<string>();
export async function autoAttendanceReady(db: Db, tenantId: string): Promise<boolean> {
  if (autoReady.has(tenantId)) return true;
  const r = await db.query(
    `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='hrm_schema' AND column_name='auto_attendance' AND table_name IN ('employee_work_days','work_schedule_rule_days')`,
  );
  const ready = r.rows[0]?.n === 2;
  if (ready) autoReady.add(tenantId);
  return ready;
}

/**
 * Lịch định kỳ hiệu lực cho từng (nhân viên, ngày) trong [from, to]:
 * lịch của nhân viên > lịch của phòng ban gần nhất (đi dần lên đơn vị cha) > lịch toàn công ty.
 * Thứ trong tuần mà lịch của lớp trên không phủ thì rơi xuống lớp dưới. Phòng ban của nhân viên lấy theo
 * phân công tổ chức hiệu lực tại ngày `from` (cùng cách với việc tra ca đơn vị).
 * Chỉ trả những ngày có lịch định kỳ; ngày không có thì không có dòng. Ngày trước khi vào làm hoặc từ ngày nghỉ việc
 * không có lịch (cùng quy tắc với lịch từng ngày).
 */
export async function resolveRuleDays(
  db: Db,
  tenantId: string,
  employeeIds: string[],
  from: string,
  to: string,
): Promise<RuleDay[]> {
  if (!employeeIds.length || !(await ruleTableExists(db, tenantId))) return [];
  const autoCol = (await autoAttendanceReady(db, tenantId)) ? 'rd.auto_attendance' : 'false';
  const res = await db.query(
    `WITH RECURSIVE emp AS (
       SELECT DISTINCT unnest($2::uuid[]) AS employee_id
     ), start_unit AS (
       SELECT e.employee_id, au.unit_id
         FROM emp e
         JOIN core_schema.employees ce ON ce.id = e.employee_id
         CROSS JOIN LATERAL (
           SELECT CASE WHEN n.category = 'position' THEN n.parent_id ELSE n.id END AS unit_id
             FROM core_schema.organization_node_assignments a
             JOIN core_schema.organization_nodes n ON n.id = a.node_id AND n.deleted_at IS NULL
            WHERE a.deleted_at IS NULL AND a.status = 'active'
              AND (a.employee_id = ce.id OR a.user_id = ce.user_id)
              AND (a.start_date IS NULL OR a.start_date <= $3::date)
              AND (a.end_date IS NULL OR a.end_date >= $3::date)
            ORDER BY a.is_primary DESC, a.created_at
            LIMIT 1
         ) au
        WHERE au.unit_id IS NOT NULL
     ), chain AS (
       SELECT employee_id, unit_id, 0 AS depth FROM start_unit
       UNION ALL
       SELECT c.employee_id, n.parent_id, c.depth + 1
         FROM chain c JOIN core_schema.organization_nodes n ON n.id = c.unit_id
        WHERE n.parent_id IS NOT NULL AND c.depth < 20
     ), days AS (
       SELECT d::date AS work_date, extract(isodow FROM d)::int AS wd
         FROM generate_series($3::date, $4::date, '1 day') d
     ), cand AS (
       SELECT e.employee_id, dy.work_date, 0 AS layer, 0 AS depth, r.effective_from, r.id AS rule_id,
              r.scope_type, rd.day_type, rd.shift_id, ${autoCol} AS auto_attendance
         FROM emp e CROSS JOIN days dy
         JOIN hrm_schema.work_schedule_rules r
           ON r.tenant_id = $1 AND r.status = 'ACTIVE' AND r.scope_type = 'EMPLOYEE' AND r.employee_id = e.employee_id
          AND dy.work_date >= r.effective_from AND (r.effective_to IS NULL OR dy.work_date <= r.effective_to)
         JOIN hrm_schema.work_schedule_rule_days rd ON rd.rule_id = r.id AND rd.weekday = dy.wd
       UNION ALL
       SELECT c.employee_id, dy.work_date, 1, c.depth, r.effective_from, r.id, r.scope_type, rd.day_type, rd.shift_id, ${autoCol} AS auto_attendance
         FROM chain c CROSS JOIN days dy
         JOIN hrm_schema.work_schedule_rules r
           ON r.tenant_id = $1 AND r.status = 'ACTIVE' AND r.scope_type = 'UNIT' AND r.unit_id = c.unit_id
          AND dy.work_date >= r.effective_from AND (r.effective_to IS NULL OR dy.work_date <= r.effective_to)
         JOIN hrm_schema.work_schedule_rule_days rd ON rd.rule_id = r.id AND rd.weekday = dy.wd
       UNION ALL
       SELECT e.employee_id, dy.work_date, 2, 0, r.effective_from, r.id, r.scope_type, rd.day_type, rd.shift_id, ${autoCol} AS auto_attendance
         FROM emp e CROSS JOIN days dy
         JOIN hrm_schema.work_schedule_rules r
           ON r.tenant_id = $1 AND r.status = 'ACTIVE' AND r.scope_type = 'COMPANY'
          AND dy.work_date >= r.effective_from AND (r.effective_to IS NULL OR dy.work_date <= r.effective_to)
         JOIN hrm_schema.work_schedule_rule_days rd ON rd.rule_id = r.id AND rd.weekday = dy.wd
     )
     SELECT DISTINCT ON (cand.employee_id, cand.work_date)
            cand.employee_id, to_char(cand.work_date, 'YYYY-MM-DD') AS date, cand.day_type, cand.shift_id, cand.rule_id, cand.scope_type, cand.auto_attendance
       FROM cand
       JOIN hrm_schema.employee_profiles p ON p.tenant_id = $1 AND p.employee_id = cand.employee_id
      WHERE cand.work_date >= p.join_date AND (p.inactive_from IS NULL OR cand.work_date < p.inactive_from)
      ORDER BY cand.employee_id, cand.work_date, cand.layer, cand.depth, cand.effective_from DESC, cand.rule_id`,
    [tenantId, employeeIds, from, to],
  );
  return res.rows.map((r) => ({
    employeeId: r.employee_id as string,
    date: r.date as string,
    dayType: r.day_type as 'SHIFT' | 'OFF',
    shiftId: (r.shift_id as string | null) ?? null,
    ruleId: r.rule_id as string,
    scopeType: r.scope_type as RuleDay['scopeType'],
    autoAttendance: r.auto_attendance === true,
  }));
}
