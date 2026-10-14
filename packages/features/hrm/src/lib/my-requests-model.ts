/** Hàm thuần cho màn Đơn từ của tôi: lọc theo tháng, nhóm trạng thái, số liệu thẻ tổng quan, nhãn trạng thái. */
import { shiftMonth } from './hrm-timesheet-format';

/** Phần tối thiểu của một dòng đơn mà bảng danh sách, thẻ tổng quan và bộ lọc cần. */
export interface MyRequestRow {
  id: string;
  code: string;
  kind: string;
  typeName: string;
  createdAt: string;
  rawCreatedAt?: string;
  effectiveDate: string;
  duration: string;
  reason: string;
  description: string;
  approver: string;
  workflowStatus: string;
  requestStatus: string;
  statusText: string;
}

export type RequestStatusGroup = 'PENDING' | 'APPROVED' | 'REJECTED';

export type RequestStatusFilter = 'ALL' | RequestStatusGroup | 'CANCELLED';

export function isPendingRow(
  row: Pick<MyRequestRow, 'workflowStatus' | 'requestStatus'>,
): boolean {
  if (row.requestStatus === 'CANCELLED') return false;
  return (
    row.workflowStatus === 'PENDING_APPROVAL' ||
    row.workflowStatus === 'PENDING_PEER' ||
    row.workflowStatus === 'SUBMITTED'
  );
}

export function isApprovedRow(
  row: Pick<MyRequestRow, 'workflowStatus' | 'requestStatus'>,
): boolean {
  return (
    row.workflowStatus === 'APPROVED' ||
    row.requestStatus === 'APPLIED' ||
    row.requestStatus === 'DISBURSED'
  );
}

export function isRejectedRow(
  row: Pick<MyRequestRow, 'workflowStatus' | 'requestStatus'>,
): boolean {
  return row.workflowStatus === 'REJECTED';
}

/** Đơn có thuộc nhóm trạng thái lọc không (đã rút/hủy chỉ có ở bộ lọc riêng và ở "Tất cả"). */
export function matchesStatusFilter(
  row: Pick<MyRequestRow, 'workflowStatus' | 'requestStatus'>,
  filter: RequestStatusFilter,
): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'PENDING') return isPendingRow(row);
  if (filter === 'APPROVED') return isApprovedRow(row);
  if (filter === 'REJECTED') return isRejectedRow(row);
  return row.requestStatus === 'CANCELLED';
}

/** Tháng (YYYY-MM, giờ Việt Nam) mà đơn được tạo; rỗng khi đơn không có ngày tạo. */
export function requestMonthOf(
  row: Pick<MyRequestRow, 'rawCreatedAt'>,
): string {
  if (!row.rawCreatedAt) return '';
  const ms = Date.parse(row.rawCreatedAt);
  if (Number.isNaN(ms)) return '';
  return new Date(ms + 7 * 3_600_000).toISOString().slice(0, 7);
}

/** Đơn thuộc tháng đã chọn (theo ngày tạo); `month` rỗng nghĩa là mọi tháng. */
export function inMonth(
  row: Pick<MyRequestRow, 'rawCreatedAt'>,
  month: string | null,
): boolean {
  return !month || requestMonthOf(row) === month;
}

export interface RequestMonthStats {
  readonly total: number;
  readonly pending: number;
  readonly approved: number;
  readonly rejected: number;
}

/** Số đơn của một tháng theo trạng thái (đơn đã rút/hủy chỉ nằm trong tổng). */
export function monthStats(
  rows: readonly MyRequestRow[],
  month: string,
): RequestMonthStats {
  const inScope = rows.filter((row) => inMonth(row, month));
  return {
    total: inScope.length,
    pending: inScope.filter(isPendingRow).length,
    approved: inScope.filter(isApprovedRow).length,
    rejected: inScope.filter(isRejectedRow).length,
  };
}

/** "Tháng 9" của tháng liền trước một tháng YYYY-MM. */
export function previousMonthLabel(month: string): string {
  return `tháng ${Number(shiftMonth(month, -1).slice(5, 7))}`;
}

export type StatusTone = 'amber' | 'indigo' | 'emerald' | 'rose' | 'slate';

export interface StatusMeta {
  readonly label: string;
  readonly tone: StatusTone;
}

export const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  amber: 'border-amber-200 bg-amber-50 text-amber-700',
  indigo: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  rose: 'border-rose-200 bg-rose-50 text-rose-700',
  slate: 'border-slate-200 bg-slate-50 text-slate-600',
};

/** Nhãn và màu trạng thái một dòng đơn trên danh sách. */
export function rowStatusMeta(
  row: Pick<MyRequestRow, 'workflowStatus' | 'requestStatus'>,
): StatusMeta {
  if (row.requestStatus === 'CANCELLED')
    return { label: 'Đã rút / hủy', tone: 'slate' };
  if (row.workflowStatus === 'APPROVED')
    return { label: 'Đã duyệt', tone: 'emerald' };
  if (row.workflowStatus === 'PENDING_PEER')
    return { label: 'Chờ đồng nghiệp', tone: 'indigo' };
  if (row.workflowStatus === 'REJECTED')
    return { label: 'Đã từ chối', tone: 'rose' };
  return { label: 'Chờ duyệt', tone: 'amber' };
}

/**
 * Trạng thái ở khung chi tiết: ưu tiên kết quả quy trình khi đã có (đã kết thúc/ từ chối), nếu không thì theo đơn.
 * Giữ đúng cách tính của ngăn kéo chi tiết cũ.
 */
export function detailStatusMeta(
  row: Pick<MyRequestRow, 'workflowStatus' | 'statusText'>,
  procedureStatus?: string | null,
): StatusMeta {
  const completed =
    procedureStatus === 'completed' || row.workflowStatus === 'APPROVED';
  const rejected =
    procedureStatus === 'rejected' || row.workflowStatus === 'REJECTED';
  if (completed) {
    return {
      label:
        !row.statusText || row.statusText === 'Chờ phê duyệt'
          ? 'Đã duyệt'
          : row.statusText,
      tone: 'emerald',
    };
  }
  if (rejected) return { label: 'Đã từ chối', tone: 'rose' };
  if (row.workflowStatus === 'PENDING_PEER')
    return { label: row.statusText || 'Chờ đồng nghiệp', tone: 'indigo' };
  return { label: row.statusText || 'Chờ phê duyệt', tone: 'amber' };
}

/** Đơn nào tự chọn lại khi danh sách đổi: giữ đơn đang chọn nếu còn, không thì đơn đầu tiên. */
export function pickSelectedId(
  rows: readonly Pick<MyRequestRow, 'id'>[],
  currentId: string | null,
): string | null {
  if (currentId && rows.some((row) => row.id === currentId)) return currentId;
  return rows[0]?.id ?? null;
}

/** Bốn loại đơn tạo nhanh theo thứ tự hiển thị: nghỉ, tăng ca, công tác, giải trình công. */
export const QUICK_CREATE_KINDS = [
  'leave',
  'ot',
  'business_trip',
  'correction',
] as const;
