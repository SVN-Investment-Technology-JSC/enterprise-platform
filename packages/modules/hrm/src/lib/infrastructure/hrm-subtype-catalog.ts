import type { Pool } from 'pg';

export interface HrmSubtypeOption {
  readonly value: string;
  readonly label: string;
}

/** Loại tăng ca (ràng buộc CHECK ot_requests.ot_type). */
export const HRM_OT_SUBTYPES: readonly HrmSubtypeOption[] = [
  { value: 'WEEKDAY', label: 'Ngày thường' },
  { value: 'WEEKEND', label: 'Cuối tuần' },
  { value: 'HOLIDAY', label: 'Ngày lễ' },
  { value: 'NIGHT', label: 'Ca đêm' },
];

/** Loại công tác (ràng buộc CHECK business_trip_requests.business_trip_type). */
export const HRM_BUSINESS_TRIP_SUBTYPES: readonly HrmSubtypeOption[] = [
  { value: 'DOMESTIC', label: 'Trong nước' },
  { value: 'OVERSEAS', label: 'Nước ngoài' },
  { value: 'INTERSITE', label: 'Giữa các cơ sở' },
];

/**
 * Danh mục mã loại con để gắn quy trình, khóa theo mã loại đơn của màn cấu hình.
 * Loại phép lấy từ danh mục loại phép của tenant; OT và công tác là tập cố định của schema.
 */
export async function loadSubtypeCatalog(
  pool: Pick<Pool, 'query'>,
  tenantId: string,
): Promise<Record<string, HrmSubtypeOption[]>> {
  const leave = await pool.query(
    `SELECT code,name FROM hrm_schema.leave_types WHERE tenant_id=$1 AND deleted_at IS NULL AND active ORDER BY code`,
    [tenantId],
  );
  return {
    LEAVE: leave.rows.map((row: { code: string; name: string }) => ({
      value: row.code,
      label: `${row.code} · ${row.name}`,
    })),
    OT: [...HRM_OT_SUBTYPES],
    BUSINESS_TRIP: [...HRM_BUSINESS_TRIP_SUBTYPES],
  };
}
