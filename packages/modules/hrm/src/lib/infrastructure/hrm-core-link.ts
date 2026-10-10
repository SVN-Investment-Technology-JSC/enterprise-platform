import { BadRequestException } from '@nestjs/common';
import type { PoolClient } from 'pg';

/**
 * Nhân sự Core (`core_schema.employees`) là dòng liên kết bắt buộc giữa tài khoản Core và mọi dữ liệu HRM.
 * Họ tên và email KHÔNG nhập ở HRM: dòng này chỉ SAO CHÉP từ tài khoản Core (`core_schema.users`) lúc khởi tạo
 * hồ sơ HRM; sau này bấm "Cập nhật từ Core" để đồng bộ lại khi Core đổi tên hoặc email.
 *
 * Chạy trong cùng giao dịch với việc tạo hồ sơ HRM nên lỗi thì không để lại dòng liên kết nào.
 * Trả về id nhân sự Core (dùng lại dòng cũ nếu tài khoản đã có).
 */
export async function ensureCoreEmployeeLink(
  db: Pick<PoolClient, 'query'>,
  tenantId: string,
  userId: string,
): Promise<string> {
  const existing = await db.query(
    `SELECT id FROM core_schema.employees WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NULL LIMIT 1`,
    [tenantId, userId],
  );
  if (existing.rows[0]) return existing.rows[0].id as string;
  // Giữ id = id tài khoản như dữ liệu cũ; nếu id đó đã bị một dòng khác dùng thì cấp id mới.
  const created = await db.query(
    `INSERT INTO core_schema.employees (id, tenant_id, user_id, full_name, work_email)
     SELECT CASE WHEN EXISTS (SELECT 1 FROM core_schema.employees x WHERE x.id = u.id) THEN gen_random_uuid() ELSE u.id END,
            $1, u.id, u.full_name, u.email
       FROM core_schema.users u
      WHERE u.id = $2 AND u.status = 'active' AND u.is_active = true
     RETURNING id`,
    [tenantId, userId],
  );
  if (!created.rows[0]) throw new BadRequestException('Tài khoản không tồn tại hoặc đã ngừng hoạt động.');
  return created.rows[0].id as string;
}

/**
 * Đồng bộ họ tên và email công việc của các nhân sự có tài khoản theo tài khoản Core hiện tại.
 * Chỉ đọc từ `core_schema.users`; nhân sự không có tài khoản không có nguồn Core nên không bị đụng tới.
 */
export async function refreshCoreEmployeeIdentity(
  db: Pick<PoolClient, 'query'>,
  tenantId: string,
): Promise<string[]> {
  const result = await db.query(
    `UPDATE core_schema.employees e
        SET full_name = u.full_name, work_email = u.email, updated_at = now()
       FROM core_schema.users u
      WHERE e.tenant_id = $1 AND e.user_id = u.id AND e.deleted_at IS NULL
        AND (e.full_name IS DISTINCT FROM u.full_name OR e.work_email IS DISTINCT FROM u.email)
      RETURNING e.id`,
    [tenantId],
  );
  return result.rows.map((row) => row.id as string);
}
