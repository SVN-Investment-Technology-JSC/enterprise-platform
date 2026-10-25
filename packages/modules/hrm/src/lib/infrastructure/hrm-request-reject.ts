import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';

export const REQUEST_NOT_PENDING = 'HRM_REQUEST_NOT_PENDING';

/**
 * Câu UPDATE từ chối không chạm dòng nào: đơn không tồn tại thì 404, đơn có nhưng không còn chờ duyệt (đã duyệt, từ chối,
 * hủy hoặc rút) thì 409. Tên bảng chỉ nhận từ hằng số của bên gọi, không từ dữ liệu người dùng.
 */
export async function throwWhyNotRejectable(
  db: Pick<PoolClient, 'query'>,
  table: 'ot_requests' | 'attendance_corrections' | 'shift_change_requests',
  tenantId: string,
  id: string,
  notFound: { code: string; message: string },
): Promise<never> {
  const found = await db.query(`SELECT status FROM hrm_schema.${table} WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  if (!found.rows[0]) throw new NotFoundException(notFound);
  throw new ConflictException({ code: REQUEST_NOT_PENDING, message: 'Đơn không còn chờ duyệt nên không thể từ chối.' });
}
