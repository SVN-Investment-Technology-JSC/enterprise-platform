import type { HrmCareerHistoryItem } from '@enterprise-platform/contracts-hrm';
import type { Pool } from 'pg';

/**
 * Lịch sử công tác (các lần giữ chức danh trong sơ đồ tổ chức) của một nhân viên.
 * Trả `null` khi nhân viên không tồn tại trong tenant để nơi gọi trả 404. Lỗi truy vấn được ném ra
 * nguyên vẹn: không đổi lỗi DB thành danh sách rỗng.
 */
export async function loadCareerHistory(
  pool: Pick<Pool, 'query'>,
  tenantId: string,
  employeeId: string,
): Promise<HrmCareerHistoryItem[] | null> {
  // Bổ nhiệm có thể gắn theo employee_id hoặc user_id của tài khoản liên kết.
  const employee = await pool.query<{ user_id: string | null }>(
    `SELECT user_id FROM core_schema.employees WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL LIMIT 1`,
    [employeeId, tenantId],
  );
  if (!employee.rows[0]) return null;
  const linkedUserId = employee.rows[0].user_id || null;
  const result = await pool.query(
    `SELECT
       a.id AS assignment_id,
       a.node_id AS position_node_id,
       pos.name  AS position_name,
       pos.code  AS position_code,
       unit.id   AS unit_node_id,
       unit.name AS unit_name,
       a.is_primary,
       a.start_date,
       a.end_date,
       a.status,
       a.note,
       a.created_at
     FROM core_schema.organization_node_assignments a
     JOIN core_schema.organization_nodes pos ON pos.id = a.node_id AND pos.deleted_at IS NULL
     LEFT JOIN core_schema.organization_nodes unit ON unit.id = pos.parent_id AND unit.deleted_at IS NULL
     WHERE a.deleted_at IS NULL
       AND (
         a.employee_id = $1
         OR ($2::uuid IS NOT NULL AND a.user_id = $2::uuid)
       )
     ORDER BY a.start_date DESC NULLS LAST, a.created_at DESC`,
    [employeeId, linkedUserId],
  );
  return result.rows.map(
    (row): HrmCareerHistoryItem => ({
      assignmentId: row.assignment_id,
      positionNodeId: row.position_node_id,
      positionName: row.position_name,
      positionCode: row.position_code || '',
      unitNodeId: row.unit_node_id,
      unitName: row.unit_name || 'Hội đồng / Trực thuộc doanh nghiệp',
      isPrimary: Boolean(row.is_primary),
      startDate: row.start_date ? String(row.start_date).slice(0, 10) : null,
      endDate: row.end_date ? String(row.end_date).slice(0, 10) : null,
      status: row.status,
      note: row.note,
    }),
  );
}
