import { buildCsv, downloadCsv } from './hrm-csv';

/** Số dòng mỗi trang của lịch sử đơn từ. */
export const REQUEST_HISTORY_PAGE_SIZE = 20;

/** Phần tối thiểu của một dòng lịch sử đơn mà màn hình Đơn từ của tôi cần để xuất file. */
export interface RequestHistoryRow {
  code: string;
  typeName: string;
  category: string;
  createdAt: string;
  effectiveDate: string;
  duration: string;
  reason: string;
  approver: string;
  workflowStatus: string;
  requestStatus: string;
}

export function workflowStatusLabel(row: {
  workflowStatus: string;
  requestStatus: string;
}): string {
  if (row.requestStatus === 'CANCELLED') return 'Đã rút / hủy';
  if (row.workflowStatus === 'APPROVED') return 'Đã duyệt';
  if (row.workflowStatus === 'PENDING_PEER') return 'Chờ đồng nghiệp';
  if (row.workflowStatus === 'REJECTED') return 'Đã từ chối';
  return 'Chờ duyệt';
}

export function postProcessLabel(row: { requestStatus: string }): string {
  if (row.requestStatus === 'APPLIED') return 'Đã cập nhật công';
  if (row.requestStatus === 'DISBURSED') return 'Đã giải ngân';
  if (row.requestStatus === 'REPAID') return 'Đã thu hồi đủ';
  return ['CANCELLED', 'REJECTED'].includes(row.requestStatus)
    ? 'Không áp dụng'
    : 'Chưa áp dụng';
}

export const REQUEST_HISTORY_CSV_HEADER = [
  'Mã đơn',
  'Loại yêu cầu',
  'Nhóm',
  'Ngày tạo',
  'Thời gian hiệu lực',
  'Thời lượng / Giá trị',
  'Lý do',
  'Người duyệt',
  'Trạng thái quy trình',
  'Kết quả hậu xử lý',
] as const;

/** Dựng nội dung CSV (UTF-8 có BOM, ô bắt đầu bằng = + - @ được vô hiệu hóa công thức). */
export function buildRequestHistoryCsv<T extends RequestHistoryRow>(
  rows: readonly T[],
  approverOf: (row: T) => string = (row) => row.approver,
): string {
  return buildCsv([
    REQUEST_HISTORY_CSV_HEADER,
    ...rows.map((row) => [
      row.code,
      row.typeName,
      row.category,
      row.createdAt,
      row.effectiveDate,
      row.duration,
      row.reason,
      approverOf(row),
      workflowStatusLabel(row),
      postProcessLabel(row),
    ]),
  ]);
}

export function exportRequestHistory<T extends RequestHistoryRow>(
  rows: readonly T[],
  approverOf?: (row: T) => string,
  now: Date = new Date(),
): void {
  downloadCsv(
    `lich-su-don-tu-${now.toISOString().slice(0, 10)}`,
    buildRequestHistoryCsv(rows, approverOf),
  );
}

export interface PageSlice<T> {
  items: T[];
  page: number;
  pageCount: number;
  /** Chỉ số bắt đầu tính từ 1; bằng 0 khi danh sách rỗng. */
  from: number;
  to: number;
  total: number;
}

export function paginate<T>(
  rows: readonly T[],
  page: number,
  pageSize: number = REQUEST_HISTORY_PAGE_SIZE,
): PageSlice<T> {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (current - 1) * pageSize;
  const items = rows.slice(start, start + pageSize);
  return {
    items,
    page: current,
    pageCount,
    from: total === 0 ? 0 : start + 1,
    to: start + items.length,
    total,
  };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Nhãn người duyệt hiển thị. Máy chủ trả mã người dùng (UUID) khi đơn đã được xử lý nên không hiển thị
 * trực tiếp; đơn chưa xử lý ghi nhận theo luồng phê duyệt đã cấu hình thay vì một chức danh cố định.
 */
export function approverFallbackLabel(
  approvedBy: unknown,
  pending: boolean,
): string {
  const text = typeof approvedBy === 'string' ? approvedBy.trim() : '';
  if (text && !UUID_PATTERN.test(text)) return text;
  if (text) return 'Đã có người xử lý';
  return pending ? 'Theo luồng phê duyệt' : '----';
}
