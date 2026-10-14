/** Kiểu dữ liệu và hàm thuần cho màn Đơn từ cần xử lý: phân loại tab, chỉ số, nhãn, lọc, phân trang. */
import { isPendingStatus, type ApprovalSource } from '../../hrm-approval-kinds';
import { reasonCell, requestReasonView } from '../../request-reason-form';
import { procedureFieldsOf } from '../../procedure-progress-view';

export type Source = ApprovalSource;
export type Raw = {
  id: string;
  employeeId?: string;
  employee_id?: string;
  status: string;
  /** Lý do chọn từ danh mục (đơn cũ chưa có thì null); tách khỏi `description` (mô tả tự do). */
  reasonName?: string | null;
  description?: string | null;
  /** @deprecated Bí danh cũ của `description`; ứng lương và đính chính hồ sơ vẫn dùng làm lý do nhập tự do. */
  reason?: string;
  createdAt?: string;
  created_at?: string;
  fromDate?: string;
  toDate?: string;
  workDate?: string;
  requestDate?: string;
  duration?: number;
  plannedMinutes?: number;
  requestedAmount?: number;
  attachmentFileId?: string;
  changes?: Record<string, unknown>;
  [key: string]: unknown;
};
export type Link = {
  id: string;
  request_kind: string;
  request_id: string;
  instance_code: string;
  status: string;
  last_error: string;
  instance_id?: string;
  revision?: number;
};
export type Row = Raw & {
  key: string;
  /** Lý do huỷ hiệu lực, khi đơn đã duyệt bị huỷ hiệu lực. */
  reversalReason?: string;
  source: Source;
  employeeName: string;
  employeeCode: string;
  /** Phòng ban của người gửi (lấy từ danh bạ nhân viên) nếu có. */
  department: string;
  created: string;
  period: string;
  /** Lý do hiển thị ("—" với đơn cũ chưa có lý do danh mục). */
  reasonLabel: string;
  /** Mô tả tự do hiển thị ("—" khi trống). */
  descriptionText: string;
  link?: Link;
};

/** Ứng lương và đính chính hồ sơ không có danh mục lý do: nội dung nhập tự do chính là lý do. */
const FREE_TEXT_REASON_KINDS: readonly string[] = ['ADVANCE', 'PROFILE'];
export function reasonColumns(kind: string, raw: Raw) {
  if (FREE_TEXT_REASON_KINDS.includes(kind)) return { reasonLabel: reasonCell(raw.reason), descriptionText: '—' };
  const view = requestReasonView(raw);
  return { reasonLabel: view.reason, descriptionText: view.description };
}

/** Đơn làm thêm giờ có lý do không lương: không sinh công và tiền OT. */
export const isUnpaidOt = (r: Row) => r.source.kind === 'OT' && r.paid === false;

/** Tên loại đơn hiển thị: đơn của loại tự tạo dùng tên loại (`typeName`), các loại khác dùng nhãn nguồn. */
export const rowKindLabel = (r: { source: { kind: string; label: string }; typeName?: unknown }) =>
  r.source.kind === 'CUSTOM' && typeof r.typeName === 'string' && r.typeName ? r.typeName : r.source.label;

export const detailFields: Record<string, string> = {
  typeName: 'Loại đơn',
  durationMinutes: 'Thời lượng đăng ký',
  fields: 'Thông tin bổ sung',
  duration: 'Số lượng nghỉ',
  startTime: 'Bắt đầu',
  endTime: 'Kết thúc',
  plannedMinutes: 'Phút OT đăng ký',
  approvedMinutes: 'Phút OT được duyệt',
  destination: 'Địa điểm công tác',
  allowOt: 'Cho phép OT',
  daysCount: 'Số ngày công tác',
  workReference: 'Đầu việc liên kết',
  requestedAmount: 'Tạm ứng đề nghị',
  approvedAmount: 'Tạm ứng được duyệt',
  numberOfInstallments: 'Số kỳ thu hồi',
  currentShiftId: 'Mã ca hiện tại',
  requestedShiftId: 'Mã ca đề nghị',
  swapWithEmployeeId: 'Mã người đổi cùng',
  correctedSessions: 'Các phiên công đề nghị',
  newCheckInAt: 'Giờ vào đề nghị',
  newCheckOutAt: 'Giờ ra đề nghị',
};

export const states: Record<string, string> = {
  PENDING: 'Chờ duyệt',
  PEER_CONFIRMED: 'Đã xác nhận đổi ca',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  CANCELLED: 'Đã rút / hủy',
  REVERSED: 'Đã hủy hiệu lực',
  DISBURSED: 'Đã giải ngân',
  REPAID: 'Đã thu hồi',
};

export const statusTone = (s: string): string => {
  switch (s) {
    case 'APPROVED':
      return 'bg-emerald-50 text-emerald-700';
    case 'REJECTED':
      return 'bg-rose-50 text-rose-700';
    case 'CANCELLED':
      return 'bg-slate-100 text-slate-600';
    case 'REVERSED':
      return 'bg-orange-50 text-orange-800';
    case 'PENDING':
      return 'bg-orange-50 text-orange-600';
    case 'PEER_CONFIRMED':
      return 'bg-sky-50 text-sky-700';
    case 'DISBURSED':
      return 'bg-indigo-50 text-indigo-700';
    case 'REPAID':
      return 'bg-teal-50 text-teal-700';
    default:
      return 'bg-slate-50 text-slate-700';
  }
};

/** Màu chip loại đơn trong bảng (nghỉ cam, tăng ca tím, công tác xanh lá, giải trình xanh dương...). */
export const kindChip = (kind: string): string => {
  switch (kind) {
    case 'LEAVE':
      return 'bg-orange-50 text-orange-600';
    case 'OT':
      return 'bg-violet-50 text-violet-600';
    case 'BUSINESS_TRIP':
      return 'bg-emerald-50 text-emerald-700';
    case 'ATTENDANCE':
      return 'bg-blue-50 text-[#2563eb]';
    case 'SHIFT_CHANGE':
      return 'bg-teal-50 text-teal-700';
    case 'ADVANCE':
      return 'bg-amber-50 text-amber-700';
    case 'PROFILE':
      return 'bg-slate-100 text-slate-700';
    default:
      return 'bg-slate-100 text-slate-600';
  }
};

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();

/** Đơn chờ quá 2 ngày kể từ lúc gửi tính là quá hạn xử lý (không có SLA riêng cho duyệt trực tiếp). */
export const OVERDUE_HOURS = 48;

/** OVERDUE và DONE_MONTH không có tab riêng: chỉ đến từ việc bấm thẻ tổng quan "Quá hạn" và "Đã xử lý tháng này". */
export type ApprovalTab = 'ALL' | 'MINE' | 'PROCESSING' | 'DONE' | 'OVERDUE' | 'DONE_MONTH';

export interface ActionAbility {
  /** Đơn duyệt trực tiếp mà người dùng được duyệt. */
  eligible: (r: Row) => boolean;
  /** Đơn đang chạy qua quy trình mà người dùng được thao tác. */
  procedureActionable: (r: Row) => boolean;
}

/** Đơn đang chờ và đến lượt người dùng xử lý. */
export const isMine = (r: Row, a: ActionAbility) => isPendingStatus(r.status) && (a.eligible(r) || a.procedureActionable(r));
/** Đơn đang chờ nhưng chưa đến lượt người dùng (đang ở bước của người khác hoặc không có quyền xử lý). */
export const isProcessing = (r: Row, a: ActionAbility) => isPendingStatus(r.status) && !isMine(r, a);
export const isDone = (r: Row) => !isPendingStatus(r.status);

export function isOverdue(r: Row, now: Date = new Date()): boolean {
  if (!isPendingStatus(r.status) || !r.created) return false;
  const at = Date.parse(r.created);
  return Number.isFinite(at) && now.getTime() - at > OVERDUE_HOURS * 3_600_000;
}

/** Ngày đơn được xử lý xong (duyệt, từ chối...) nếu có. */
export function decidedAt(r: Row): string {
  const v = (r.approvedAt ?? r.approved_at ?? r.reviewedAt ?? r.reviewed_at ?? r.updatedAt ?? r.updated_at ?? '') as unknown;
  return typeof v === 'string' ? v : '';
}

export interface ApprovalCounts {
  all: number;
  mine: number;
  processing: number;
  overdue: number;
  doneThisMonth: number;
  done: number;
}

export function approvalCounts(rows: readonly Row[], a: ActionAbility, now: Date = new Date()): ApprovalCounts {
  const month = now.toISOString().slice(0, 7);
  return {
    all: rows.length,
    mine: rows.filter((r) => isMine(r, a)).length,
    processing: rows.filter((r) => isProcessing(r, a)).length,
    overdue: rows.filter((r) => isOverdue(r, now)).length,
    done: rows.filter(isDone).length,
    doneThisMonth: rows.filter((r) => isDone(r) && decidedAt(r).slice(0, 7) === month).length,
  };
}

export interface ApprovalFilter {
  tab: ApprovalTab;
  kind: string;
  department: string;
  status: string;
  search: string;
  from: string;
  to: string;
}

export function filterApprovals(rows: readonly Row[], f: ApprovalFilter, a: ActionAbility, now: Date = new Date()): Row[] {
  const needle = fold(f.search);
  return rows.filter((r) => {
    if (f.tab === 'MINE' && !isMine(r, a)) return false;
    if (f.tab === 'PROCESSING' && !isProcessing(r, a)) return false;
    if (f.tab === 'DONE' && !isDone(r)) return false;
    if (f.tab === 'OVERDUE' && !isOverdue(r, now)) return false;
    if (f.tab === 'DONE_MONTH' && !(isDone(r) && decidedAt(r).slice(0, 7) === now.toISOString().slice(0, 7))) return false;
    if (f.kind && r.source.kind !== f.kind) return false;
    if (f.department && r.department !== f.department) return false;
    if (f.status && (f.status === 'PENDING' ? !isPendingStatus(r.status) : r.status !== f.status)) return false;
    const day = r.created.slice(0, 10);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    if (!needle) return true;
    return fold(`${r.employeeName} ${r.employeeCode} ${r.reasonLabel} ${r.descriptionText} ${r.id} ${rowKindLabel(r)}`).includes(needle);
  });
}

export function pageOf<T>(items: readonly T[], page: number, size: number): { items: T[]; from: number; to: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(Math.max(1, page), pages);
  const start = (p - 1) * size;
  const slice = items.slice(start, start + size);
  return { items: slice, from: items.length ? start + 1 : 0, to: start + slice.length, pages };
}

export interface FlowStep {
  key: string;
  label: string;
  sub: string;
  state: 'done' | 'current' | 'todo' | 'rejected';
}

function dmHm(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d)
    .reduce<Record<string, string>>((acc, x) => ({ ...acc, [x.type]: x.value }), {});
  return `${p.day}/${p.month} ${p.hour}:${p.minute}`;
}

/**
 * Các bước của quy trình phê duyệt: người gửi, rồi từng bước duyệt. Đơn đi qua Procedure Engine lấy danh sách bước thật
 * từ tiến độ; đơn duyệt trực tiếp chỉ có hai bước (người gửi, người duyệt) vì không có chuỗi bước nào khác để bịa ra.
 */
export function flowSteps(
  row: Row,
  progress: { status?: string; currentStepId?: string; steps: { id: string; name: string; status: string; order: number; completedAt?: string; roleTitle?: string }[] } | null,
): FlowStep[] {
  const submitted: FlowStep = { key: 'submit', label: 'Người gửi', sub: dmHm(row.created), state: 'done' };
  if (progress?.steps?.length) {
    const rejected = progress.status === 'rejected';
    const steps = [...progress.steps].sort((a, b) => a.order - b.order);
    return [
      submitted,
      ...steps.map((s): FlowStep => {
        const done = ['completed', 'approved', 'done'].includes(s.status);
        const current = s.id === progress.currentStepId || ['active', 'in_progress', 'pending', 'running'].includes(s.status);
        const failed = ['rejected', 'returned'].includes(s.status) || (rejected && current);
        return {
          key: s.id,
          label: s.name,
          sub: done ? dmHm(s.completedAt) : failed ? 'Từ chối' : current ? 'Đang chờ duyệt' : 'Chưa xử lý',
          state: failed ? 'rejected' : done ? 'done' : current ? 'current' : 'todo',
        };
      }),
    ];
  }
  const f = procedureFieldsOf(row);
  const finished = !isPendingStatus(row.status);
  const rejected = row.status === 'REJECTED';
  const stepName = f.currentStepName || 'Người duyệt';
  return [
    submitted,
    {
      key: 'approve',
      label: stepName,
      sub: finished ? (rejected ? 'Từ chối' : row.status === 'CANCELLED' ? 'Đã rút' : dmHm(decidedAt(row)) || 'Đã duyệt') : f.currentAssigneeName ? `Chờ ${f.currentAssigneeName}` : 'Đang chờ duyệt',
      state: rejected ? 'rejected' : finished ? 'done' : 'current',
    },
  ];
}
