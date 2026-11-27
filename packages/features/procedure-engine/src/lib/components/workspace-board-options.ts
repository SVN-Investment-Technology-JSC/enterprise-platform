import type { ProcedureInstance, ProcedureRaciRole } from '@enterprise-platform/contracts-procedure-engine';

/**
 * Nhãn và lựa chọn của màn "Hồ sơ xử lý", dùng chung cho giao diện cũ và giao diện A (`case-layout-a`), để hai giao
 * diện lọc, sắp xếp và hiện trạng thái giống hệt nhau.
 */

export const STATUS_LABEL: Record<ProcedureInstance['status'], string> = {
  running: 'Đang xử lý',
  completed: 'Hoàn thành',
  rejected: 'Từ chối',
  cancelled: 'Đã huỷ',
  reversed: 'Đã huỷ hiệu lực',
};

export const STEP_STATUS_LABEL: Record<string, string> = {
  pending: 'Chờ xử lý',
  running: 'Đang thực hiện',
  completed: 'Hoàn thành',
  rejected: 'Từ chối',
  returned: 'Trả lại',
  skipped: 'Nhánh không đi',
  cancelled: 'Đã huỷ',
};

/**
 * Tên vai bằng lời cho người xem (chip "Bạn · Khởi tạo" ở cửa sổ hồ sơ), cùng cách gọi với thẻ "Việc cần làm" của
 * Dashboard (S · Khởi tạo, R · Xem xét, E · Thực thi, C · Kiểm soát, A · Phê duyệt); I gọi là "Theo dõi".
 */
export const ROLE_HUMAN_LABEL: Record<ProcedureRaciRole, string> = {
  S: 'Khởi tạo',
  R: 'Xem xét',
  E: 'Thực thi',
  C: 'Kiểm soát',
  A: 'Phê duyệt',
  I: 'Theo dõi',
};

export const SLA_FILTER_OPTIONS = [
  { value: 'all', label: 'SLA: Tất cả' },
  { value: 'breached', label: 'Quá hạn' },
  { value: 'warning', label: 'Sắp đến hạn' },
  { value: 'ok', label: 'Còn hạn' },
  { value: 'none', label: 'Không cài' },
];

export const SOURCE_FILTER_OPTIONS = [
  { value: 'all', label: 'Nguồn: Tất cả' },
  { value: 'manual', label: 'Thủ công' },
  { value: 'maintenance_occurrence', label: 'Bảo trì' },
  { value: 'auto_from_parent', label: 'Tự động' },
];

export const DATE_SORT_OPTIONS = [
  { value: 'newest', label: 'Mới nhất' },
  { value: 'oldest', label: 'Cũ nhất' },
];

export const PAGE_SIZE_OPTIONS = [15, 30, 45, 60].map((size) => ({ value: String(size), label: `${size} / trang` }));
