import type { Pool, PoolClient } from 'pg';

type Db = Pick<PoolClient, 'query'> | Pool;

export interface AttendanceSiteRow {
  id: string;
  tenant_id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  active: boolean;
  /** IP/CIDR của địa điểm; rỗng là không kiểm IP. Có khi phải đạt cả vị trí lẫn IP. */
  allowed_ips?: string[] | null;
  created_by?: string | null;
  updated_at?: Date | string;
}

/**
 * Phân giải danh sách địa điểm chấm công GPS được phép cho một nhân viên.
 * 
 * Quy tắc ưu tiên theo cây tổ chức:
 * 1. Nếu tenant chưa có bất kỳ cấu hình phân công nào: fallback toàn bộ các site active (tương thích ngược 100%).
 * 2. Nếu đã có cấu hình phân công:
 *    - Toàn công ty (COMPANY): Áp dụng cho mọi nhân viên, trừ đơn vị bị loại trừ.
 *    - Ngoại lệ cá nhân (EMPLOYEE): Nhân viên được gán trực tiếp.
 *    - Chức danh (POSITION): Nhân viên đang giữ chức danh được gán.
 *    - Phòng ban / Đơn vị (UNIT): kế thừa xuống mọi đơn vị con; một đơn vị con có thể là ngoại lệ (UNIT_EXCLUDE).
 *      Mỗi đơn vị có hiệu lực theo dấu gần nhất khi đi từ chính nó lên các đơn vị cha; không có dấu thì theo COMPANY.
 */
export async function resolveAllowedAttendanceSites(
  db: Db,
  tenantId: string,
  employeeId: string,
): Promise<AttendanceSiteRow[]> {
  // 1. Kiểm tra tenant có cấu hình phân công địa điểm nào chưa
  const hasAssignments = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM hrm_schema.attendance_site_assignments WHERE tenant_id = $1`,
    [tenantId],
  );

  if (Number(hasAssignments.rows[0]?.count ?? 0) === 0) {
    // Chưa có cấu hình: Cho phép mọi địa điểm đang active
    const allActive = await db.query<AttendanceSiteRow>(
      `SELECT * FROM hrm_schema.attendance_sites WHERE tenant_id = $1 AND active = true ORDER BY name`,
      [tenantId],
    );
    return allActive.rows;
  }

  // 2. Đã có cấu hình: Phân giải theo cây tổ chức (UNIT chain), chức danh (POSITION), cá nhân (EMPLOYEE) và COMPANY
  const query = `
    WITH RECURSIVE
    emp AS (
      SELECT ce.id AS employee_id, ce.user_id
      FROM core_schema.employees ce
      WHERE ce.id = $2
    ),
    -- Các chức danh và đơn vị trực tiếp của nhân viên
    emp_nodes AS (
      SELECT CASE WHEN n.category = 'position' THEN n.id ELSE NULL END AS position_id,
             CASE WHEN n.category = 'position' THEN n.parent_id ELSE n.id END AS unit_id
      FROM emp e
      JOIN core_schema.organization_node_assignments a
        ON (a.employee_id = e.employee_id OR a.user_id = e.user_id)
       AND a.deleted_at IS NULL AND a.status = 'active'
      JOIN core_schema.organization_nodes n
        ON n.id = a.node_id AND n.deleted_at IS NULL
    ),
    emp_starts AS (
      SELECT DISTINCT unit_id AS start_id FROM emp_nodes WHERE unit_id IS NOT NULL
    ),
    -- Leo cây tổ chức từ từng đơn vị của nhân viên lên các đơn vị cha, kèm độ sâu (0 là chính đơn vị đó)
    unit_chain AS (
      SELECT start_id, start_id AS unit_id, 0 AS depth FROM emp_starts
      UNION ALL
      SELECT c.start_id, n.parent_id, c.depth + 1
      FROM unit_chain c
      JOIN core_schema.organization_nodes n ON n.id = c.unit_id
      WHERE n.parent_id IS NOT NULL AND c.depth < 20
    ),
    -- Dấu gần nhất (gán UNIT hoặc loại trừ UNIT_EXCLUDE) của từng địa điểm cho từng đơn vị của nhân viên
    nearest AS (
      SELECT DISTINCT ON (uc.start_id, sa.site_id) uc.start_id, sa.site_id, sa.scope_type
      FROM unit_chain uc
      JOIN hrm_schema.attendance_site_assignments sa
        ON sa.tenant_id = $1 AND sa.scope_id = uc.unit_id AND sa.scope_type IN ('UNIT', 'UNIT_EXCLUDE')
      ORDER BY uc.start_id, sa.site_id, uc.depth
    )
    SELECT s.*
    FROM hrm_schema.attendance_sites s
    WHERE s.tenant_id = $1 AND s.active = true
      AND (
        -- Chỉ định riêng: nhân viên hoặc chức danh
        EXISTS (
          SELECT 1 FROM hrm_schema.attendance_site_assignments sa
          WHERE sa.tenant_id = s.tenant_id AND sa.site_id = s.id
            AND (
              (sa.scope_type = 'EMPLOYEE' AND sa.scope_id IN (SELECT employee_id FROM emp))
              OR (sa.scope_type = 'POSITION' AND sa.scope_id IN (SELECT position_id FROM emp_nodes WHERE position_id IS NOT NULL))
            )
        )
        -- Đơn vị được gán (kế thừa), trừ khi đơn vị gần hơn bị loại trừ
        OR EXISTS (SELECT 1 FROM nearest n WHERE n.site_id = s.id AND n.scope_type = 'UNIT')
        -- Toàn công ty: áp dụng cho đơn vị không có dấu nào (hoặc nhân viên chưa thuộc đơn vị nào)
        OR (
          EXISTS (
            SELECT 1 FROM hrm_schema.attendance_site_assignments sa
            WHERE sa.tenant_id = s.tenant_id AND sa.site_id = s.id AND sa.scope_type = 'COMPANY'
          )
          AND (
            NOT EXISTS (SELECT 1 FROM emp_starts)
            OR EXISTS (
              SELECT 1 FROM emp_starts es
              WHERE NOT EXISTS (SELECT 1 FROM nearest n WHERE n.site_id = s.id AND n.start_id = es.start_id)
            )
          )
        )
      )
    ORDER BY s.name
  `;

  const result = await db.query<AttendanceSiteRow>(query, [tenantId, employeeId]);
  return result.rows;
}
