import { ConflictException } from '@nestjs/common';
import type { PoolClient } from 'pg';

/**
 * Tra ca của một nhân viên tại một ngày (dùng chung cho tính công, đơn nghỉ, roster, dashboard).
 * Thứ tự ưu tiên: ngoại lệ cá nhân > ca của đơn vị trực tiếp > ca của đơn vị cha (đi dần lên).
 */
export type ShiftSource = 'EMPLOYEE' | 'UNIT' | 'PARENT_UNIT';

export interface UnitShiftCandidate<T> {
  /** 0 = đơn vị trực tiếp, 1 = đơn vị cha, ... */
  depth: number;
  unitId: string;
  row: T;
}

export interface PickedShift<T> {
  source: ShiftSource;
  row: T;
  unitId: string | null;
  depth: number | null;
}

export function pickShiftAssignment<T>(
  personal: readonly T[],
  inherited: readonly UnitShiftCandidate<T>[],
): PickedShift<T> | null {
  if (personal.length > 1)
    throw new ConflictException(
      'Lịch phân ca bị trùng; cần điều chỉnh trước khi tính công',
    );
  if (personal.length === 1)
    return { source: 'EMPLOYEE', row: personal[0], unitId: null, depth: null };
  if (!inherited.length) return null;
  const nearest = Math.min(...inherited.map((c) => c.depth));
  const tier = inherited.filter((c) => c.depth === nearest);
  if (tier.length > 1)
    throw new ConflictException(
      'Đơn vị có nhiều ca chuẩn cùng hiệu lực; cần điều chỉnh gán ca đơn vị',
    );
  return {
    source: nearest === 0 ? 'UNIT' : 'PARENT_UNIT',
    row: tier[0].row,
    unitId: tier[0].unitId,
    depth: nearest,
  };
}

const SHIFT_COLUMNS = (assignment: string) => `s.*, ${assignment},
    (($3::date + s.start_time) AT TIME ZONE $4) AS starts_at,
    (($3::date + s.end_time + CASE WHEN s.cross_midnight THEN interval '1 day' ELSE interval '0 days' END) AT TIME ZONE $4) AS ends_at,
    (($3::date + s.break_start_time + CASE WHEN s.cross_midnight AND s.break_start_time<s.start_time THEN interval '1 day' ELSE interval '0 days' END) AT TIME ZONE $4) AS break_starts_at,
    (($3::date + s.break_end_time + CASE WHEN s.cross_midnight AND s.break_end_time<=s.start_time THEN interval '1 day' ELSE interval '0 days' END) AT TIME ZONE $4) AS break_ends_at`;

/** Chuỗi đơn vị (trực tiếp -> cha -> ...) của nhân viên theo phân công tổ chức hiệu lực tại ngày $3. */
const UNIT_CHAIN_SQL = `
  WITH RECURSIVE start_unit AS (
    SELECT CASE WHEN n.category = 'position' THEN n.parent_id ELSE n.id END AS unit_id
      FROM core_schema.organization_node_assignments a
      JOIN core_schema.organization_nodes n ON n.id = a.node_id AND n.deleted_at IS NULL
     WHERE a.deleted_at IS NULL AND a.status = 'active'
       AND (a.employee_id = $2 OR a.user_id = (SELECT e.user_id FROM core_schema.employees e WHERE e.tenant_id = $1 AND e.id = $2))
       AND (a.start_date IS NULL OR a.start_date <= $3::date)
       AND (a.end_date IS NULL OR a.end_date >= $3::date)
     ORDER BY a.is_primary DESC, a.created_at
     LIMIT 1
  ), chain AS (
    SELECT unit_id, 0 AS depth FROM start_unit WHERE unit_id IS NOT NULL
    UNION ALL
    SELECT n.parent_id, c.depth + 1
      FROM chain c JOIN core_schema.organization_nodes n ON n.id = c.unit_id
     WHERE n.parent_id IS NOT NULL AND c.depth < 20
  )`;

export async function unitShiftTableExists(db: Pick<PoolClient, 'query'>) {
  const r = await db.query(
    `SELECT to_regclass('hrm_schema.unit_shift_assignments') IS NOT NULL AS ready`,
  );
  return r.rows[0]?.ready === true;
}

export interface ResolvedShiftRow {
  [column: string]: unknown;
  assignment_id: string | null;
}

/**
 * Trả về ca hiệu lực (cùng cột thời gian đã quy đổi theo múi giờ) kèm nguồn kế thừa;
 * null nếu không có ca nào. Ném 409 khi trùng ca cùng cấp.
 */
export async function resolveShiftRow(
  db: Pick<PoolClient, 'query'>,
  tenantId: string,
  employeeId: string,
  date: string,
  timezone: string,
): Promise<PickedShift<ResolvedShiftRow> | null> {
  const personal = await db.query(
    `SELECT ${SHIFT_COLUMNS('a.id AS assignment_id')}
    FROM hrm_schema.shift_assignments a JOIN hrm_schema.shift_definitions s ON s.id=a.shift_id AND s.tenant_id=a.tenant_id
    WHERE a.tenant_id=$1 AND a.employee_id=$2 AND a.status='ACTIVE' AND $3::date>=a.effective_from AND (a.effective_to IS NULL OR $3::date<=a.effective_to)`,
    [tenantId, employeeId, date, timezone],
  );
  if (personal.rows.length)
    return pickShiftAssignment<ResolvedShiftRow>(personal.rows, []);
  if (!(await unitShiftTableExists(db))) return null;
  const inherited = await db.query(
    `${UNIT_CHAIN_SQL}
    SELECT ${SHIFT_COLUMNS('NULL::uuid AS assignment_id')}, c.depth, c.unit_id
      FROM chain c
      JOIN hrm_schema.unit_shift_assignments u ON u.unit_id = c.unit_id AND u.tenant_id = $1 AND u.status = 'ACTIVE'
       AND $3::date >= u.effective_from AND (u.effective_to IS NULL OR $3::date <= u.effective_to)
      JOIN hrm_schema.shift_definitions s ON s.id = u.shift_id AND s.tenant_id = u.tenant_id`,
    [tenantId, employeeId, date, timezone],
  );
  return pickShiftAssignment<ResolvedShiftRow>(
    [],
    inherited.rows.map((r) => ({
      depth: Number(r.depth),
      unitId: String(r.unit_id),
      row: r as ResolvedShiftRow,
    })),
  );
}
