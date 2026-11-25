/**
 * Hợp đồng báo cáo HRM (trang Báo cáo): máy chủ trả toàn bộ cột có thể xuất, giao diện chọn cột rồi tạo file Excel.
 * Chỉ kiểu dữ liệu: web và API dùng chung.
 */

/** Loại báo cáo do máy chủ dựng. Bảng chấm công dùng lại `/timesheet-board`, không nằm ở đây. */
export type HrmReportKind = 'requests' | 'leave-usage' | 'leave' | 'overtime' | 'business-trips';

export const HRM_REPORT_KINDS: readonly HrmReportKind[] = ['requests', 'leave-usage', 'leave', 'overtime', 'business-trips'];

/** Loại đơn dùng để lọc báo cáo tổng hợp đơn từ. */
export type HrmReportRequestKind = 'leave' | 'ot' | 'business_trip' | 'shift_change' | 'correction';

export const HRM_REPORT_REQUEST_KINDS: readonly HrmReportRequestKind[] = [
  'leave',
  'ot',
  'business_trip',
  'shift_change',
  'correction',
];

export interface HrmReportColumn {
  readonly key: string;
  readonly label: string;
  /** Cột được chọn sẵn khi mở báo cáo. */
  readonly defaultOn: boolean;
  /** Kiểu giá trị để canh lề và định dạng ô Excel. */
  readonly type: 'text' | 'number' | 'date';
}

export type HrmReportCell = string | number | null;

export interface HrmReportResult {
  readonly kind: HrmReportKind;
  readonly columns: readonly HrmReportColumn[];
  readonly rows: readonly Record<string, HrmReportCell>[];
  /** Số dòng thật sự khớp bộ lọc; lớn hơn `rows.length` khi bị cắt ở giới hạn. */
  readonly total: number;
  readonly truncated: boolean;
}

/** Bộ lọc dùng chung; mỗi báo cáo chỉ đọc phần nó cần. Ngày dạng yyyy-mm-dd. */
export interface HrmReportFilters {
  readonly from: string;
  readonly to: string;
  readonly departmentIds?: readonly string[];
  readonly employeeIds?: readonly string[];
  /** Trạng thái đơn (PENDING, APPROVED, REJECTED, CANCELLED...). Trống: mọi trạng thái. */
  readonly statuses?: readonly string[];
  /** Chỉ cho báo cáo tổng hợp đơn từ. */
  readonly requestKinds?: readonly HrmReportRequestKind[];
  /** Chỉ cho báo cáo nghỉ phép: lọc theo loại phép. */
  readonly leaveTypeIds?: readonly string[];
}

/** Giới hạn số dòng một lần tải để không giữ cả tenant trong bộ nhớ. */
export const HRM_REPORT_MAX_ROWS = 20000;

/** Danh sách lựa chọn cho bộ lọc của trang Báo cáo (một lần tải). */
export interface HrmReportOptions {
  readonly departments: readonly { readonly id: string; readonly name: string }[];
  readonly employees: readonly {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly departmentId: string | null;
  }[];
  readonly leaveTypes: readonly { readonly id: string; readonly name: string }[];
}
