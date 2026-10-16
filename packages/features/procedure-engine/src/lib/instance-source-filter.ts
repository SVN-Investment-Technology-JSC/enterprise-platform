/**
 * Bộ lọc "Nguồn" ở Hồ sơ xử lý: lọc ngay trên danh sách hồ sơ đã tải theo `sourceType` của hồ sơ.
 * Nhãn khớp với cách khung chi tiết hồ sơ gọi tên nguồn ("Đơn HRM", "Phiếu tài chính"...).
 */
import type { ProcedureInstanceSourceType } from '@enterprise-platform/contracts-procedure-engine';

export type InstanceSourceFilter =
  | 'all'
  | Extract<
      ProcedureInstanceSourceType,
      'manual' | 'maintenance_occurrence' | 'auto_from_parent' | 'hrm_request' | 'finance_voucher'
    >;

export const INSTANCE_SOURCE_FILTER_OPTIONS: readonly { value: InstanceSourceFilter; label: string }[] = [
  { value: 'all', label: 'Nguồn: Tất cả' },
  { value: 'manual', label: 'Thủ công' },
  { value: 'maintenance_occurrence', label: 'Bảo trì' },
  { value: 'auto_from_parent', label: 'Tự động' },
  { value: 'hrm_request', label: 'Đơn HRM' },
  { value: 'finance_voucher', label: 'Phiếu tài chính' },
];

/** Hồ sơ cũ không ghi nguồn được coi là tạo thủ công. */
export function matchesInstanceSource(
  sourceType: ProcedureInstanceSourceType | undefined,
  filter: InstanceSourceFilter,
): boolean {
  return filter === 'all' || (sourceType ?? 'manual') === filter;
}
