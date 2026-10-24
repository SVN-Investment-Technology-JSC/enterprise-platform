import {
  DEFAULT_WORKSPACE_LABEL_SETTINGS,
  type WorkspaceLabelOption,
  type WorkspaceLabelSettings,
} from '@enterprise-platform/contracts-workspace';
import type {
  ContractStatus,
  DependencyType,
  DocumentAudience,
  EventType,
  MyWorkBucket,
  ParticipantResponse,
  StandaloneTask,
  StandaloneTaskProcedureStatus,
  StandaloneTaskRole,
  StandaloneTaskScope,
  SystemProjectRole,
  ProjectStatus,
  WorkItem,
  WorkItemPriority,
  WorkItemStatus,
  WorkItemType,
  ProjectRequestStatus,
} from '@enterprise-platform/contracts-workspace';
import {
  formatDate as formatSharedDate,
  formatDateTime as formatSharedDateTime,
} from '@enterprise-platform/shared-ui';

/**
 * Nhãn tiếng Việt cho các giá trị liệt kê.
 *
 * Gom một chỗ để bảng, cây, form và nhật ký gọi cùng một tên — nhìn thấy hai
 * cách gọi khác nhau cho một trạng thái là cách nhanh nhất làm người dùng
 * mất tin vào số liệu.
 */
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: 'Lập kế hoạch',
  active: 'Đang chạy',
  on_hold: 'Tạm dừng',
  completed: 'Hoàn thành',
  cancelled: 'Đã huỷ',
};

/** Nhãn tiếng Việt của phân loại tài liệu nội bộ/khách hàng. */
export const DOCUMENT_AUDIENCE_LABELS: Record<DocumentAudience, string> = {
  internal: 'Nội bộ',
  customer: 'Khách hàng',
};

/** Nhãn tiếng Việt của trạng thái hợp đồng. */
export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  draft: 'Nháp',
  active: 'Đang hiệu lực',
  completed: 'Hoàn thành',
  cancelled: 'Đã huỷ',
};

/** Màu huy hiệu trạng thái hợp đồng, cùng bảng màu với trạng thái dự án. */
export const CONTRACT_STATUS_TONE: Record<ContractStatus, { bg: string; fg: string }> = {
  draft: { bg: 'rgb(156 163 175 / 18%)', fg: '#4b5563' },
  active: { bg: 'rgb(59 130 246 / 15%)', fg: '#1d4ed8' },
  completed: { bg: 'rgb(16 185 129 / 15%)', fg: '#047857' },
  cancelled: { bg: '#f3f4f6', fg: '#6b7280' },
};

export const WORK_ITEM_STATUS_LABELS: Record<WorkItemStatus, string> = {
  todo: 'Chưa làm',
  in_progress: 'Đang làm',
  blocked: 'Vướng mắc',
  review: 'Chờ duyệt',
  done: 'Hoàn thành',
  cancelled: 'Đã huỷ',
};

/** Nhãn trạng thái của một công việc: việc huỷ hiệu lực vẫn là `cancelled` nhưng hiện riêng. */
export function workItemStatusLabel(item: Pick<WorkItem, 'status' | 'reversal'>): string {
  return item.reversal ? 'Đã huỷ hiệu lực' : WORK_ITEM_STATUS_LABELS[item.status];
}

export const PRIORITY_LABELS: Record<WorkItemPriority, string> = {
  low: 'Thấp',
  normal: 'Bình thường',
  high: 'Cao',
  urgent: 'Khẩn cấp',
};

export const ITEM_TYPE_LABELS: Record<WorkItemType, string> = {
  phase: 'Nhóm công việc',
  task: 'Công việc',
  milestone: 'Cột mốc',
};

export const ROLE_LABELS: Record<SystemProjectRole, string> = {
  owner: 'Chủ nhiệm',
  manager: 'Quản lý',
  member: 'Thành viên',
  viewer: 'Người xem',
};

/** Màu nền và màu chữ của huy hiệu trạng thái công việc. */
export const WORK_ITEM_STATUS_TONE: Record<WorkItemStatus, { bg: string; fg: string }> = {
  todo: { bg: 'rgb(156 163 175 / 18%)', fg: '#4b5563' },
  in_progress: { bg: 'rgb(59 130 246 / 15%)', fg: '#1d4ed8' },
  blocked: { bg: 'rgb(239 68 68 / 15%)', fg: '#b91c1c' },
  review: { bg: 'rgb(245 158 11 / 18%)', fg: '#92400e' },
  done: { bg: 'rgb(16 185 129 / 15%)', fg: '#047857' },
  cancelled: { bg: '#f3f4f6', fg: '#6b7280' },
};

/** Màu huy hiệu trạng thái dự án, cùng bảng với trạng thái công việc. */
export function workItemStatusTone(
  item: Pick<WorkItem, 'status' | 'reversal'>,
): { bg: string; fg: string } {
  return item.reversal ? { bg: '#fff7ed', fg: '#9a3412' } : WORK_ITEM_STATUS_TONE[item.status];
}

export const PROJECT_STATUS_TONE: Record<ProjectStatus, { bg: string; fg: string }> = {
  planning: { bg: 'rgb(156 163 175 / 18%)', fg: '#4b5563' },
  active: { bg: 'rgb(59 130 246 / 15%)', fg: '#1d4ed8' },
  on_hold: { bg: 'rgb(245 158 11 / 18%)', fg: '#92400e' },
  completed: { bg: 'rgb(16 185 129 / 15%)', fg: '#047857' },
  cancelled: { bg: '#f3f4f6', fg: '#6b7280' },
};

/** Màu huy hiệu độ ưu tiên: khẩn cấp đỏ, cao cam, bình thường xanh, thấp xám. */
export const PRIORITY_TONE: Record<WorkItemPriority, { bg: string; fg: string }> = {
  urgent: { bg: '#fee2e2', fg: '#991b1b' },
  high: { bg: '#ffedd5', fg: '#9a3412' },
  normal: { bg: '#dbeafe', fg: '#1d4ed8' },
  low: { bg: '#f1f5f9', fg: '#475569' },
};

/* -------------------------------------------------------------------------
   Tên, màu và thứ tự do tenant đặt ở Cài đặt > Trạng thái và ưu tiên.

   Các bảng nhãn ở trên là giá trị mặc định; `applyLabelSettings` ghi đè chúng tại chỗ khi Workspace nạp cài đặt,
   nên mọi màn hình đang đọc các bảng này tự hiện đúng tên và màu mà không phải truyền cài đặt xuống từng nơi.
   ------------------------------------------------------------------------- */

const DEFAULT_TONES = {
  workItemStatuses: { ...WORK_ITEM_STATUS_TONE } as Record<string, { bg: string; fg: string }>,
  projectStatuses: { ...PROJECT_STATUS_TONE } as Record<string, { bg: string; fg: string }>,
  priorities: { ...PRIORITY_TONE } as Record<string, { bg: string; fg: string }>,
};

let currentLabelSettings: WorkspaceLabelSettings = DEFAULT_WORKSPACE_LABEL_SETTINGS;

/** Huy hiệu từ một màu `#rrggbb`: chữ đúng màu đó, nền cùng màu nhạt. */
export function toneOfColor(color: string): { bg: string; fg: string } {
  return { bg: `${color}24`, fg: color };
}

function applyGroup(
  options: readonly WorkspaceLabelOption[],
  defaults: readonly WorkspaceLabelOption[],
  labels: Record<string, string>,
  tones: Record<string, { bg: string; fg: string }>,
  defaultTones: Record<string, { bg: string; fg: string }>,
) {
  for (const option of options) {
    labels[option.key] = option.label;
    const original = defaults.find((entry) => entry.key === option.key);
    // Màu chưa đổi thì giữ huy hiệu gốc (nền và chữ được chỉnh riêng), đổi rồi mới suy từ màu mới.
    const tone =
      original && original.color.toLowerCase() === option.color.toLowerCase()
        ? defaultTones[option.key]
        : undefined;
    tones[option.key] = tone ?? toneOfColor(option.color);
  }
}

/** Áp cài đặt của tenant vào các bảng nhãn dùng chung. */
export function applyLabelSettings(settings: WorkspaceLabelSettings): void {
  const defaults = DEFAULT_WORKSPACE_LABEL_SETTINGS;
  currentLabelSettings = settings;
  applyGroup(
    settings.workItemStatuses,
    defaults.workItemStatuses,
    WORK_ITEM_STATUS_LABELS,
    WORK_ITEM_STATUS_TONE,
    DEFAULT_TONES.workItemStatuses,
  );
  applyGroup(
    settings.projectStatuses,
    defaults.projectStatuses,
    PROJECT_STATUS_LABELS,
    PROJECT_STATUS_TONE,
    DEFAULT_TONES.projectStatuses,
  );
  applyGroup(
    settings.priorities,
    defaults.priorities,
    PRIORITY_LABELS,
    PRIORITY_TONE,
    DEFAULT_TONES.priorities,
  );
}

/** Cài đặt đang áp dụng (mặc định khi chưa nạp). */
export function labelSettings(): WorkspaceLabelSettings {
  return currentLabelSettings;
}

/** Các mức ưu tiên đang dùng, từ thấp tới cao. */
export function priorityKeys(): readonly WorkItemPriority[] {
  return currentLabelSettings.priorities.map((option) => option.key);
}

/** Trạng thái công việc theo thứ tự hiển thị ở Cài đặt. */
export function workItemStatusKeys(): readonly WorkItemStatus[] {
  return currentLabelSettings.workItemStatuses.map((option) => option.key as WorkItemStatus);
}

/** Trạng thái dự án theo thứ tự hiển thị ở Cài đặt. */
export function projectStatusKeys(): readonly ProjectStatus[] {
  return currentLabelSettings.projectStatuses.map((option) => option.key as ProjectStatus);
}

/** Tên mức ưu tiên; mức lạ (vd vừa bị xoá ở Cài đặt) thì hiện chính khoá. */
export function priorityLabel(priority: WorkItemPriority): string {
  return PRIORITY_LABELS[priority] ?? priority;
}

/** Huy hiệu mức ưu tiên; mức lạ dùng màu xám. */
export function priorityTone(priority: WorkItemPriority): { bg: string; fg: string } {
  return PRIORITY_TONE[priority] ?? { bg: '#f1f5f9', fg: '#475569' };
}

/** `2026-09-21` → `21/09/2026`. Chuỗi rỗng khi không có ngày. */
export function formatDate(value?: string | null): string {
  if (!value) return '';
  return formatSharedDate(value.slice(0, 10));
}

/** "2026-07-01" → "01/07": cho bảng chật, nơi năm đã rõ từ ngữ cảnh. */
export function formatShortDate(value?: string | null): string {
  if (!value) return '—';
  const [, month, day] = value.slice(0, 10).split('-');
  return month && day ? `${day}/${month}` : '—';
}

/**
 * Mốc thời gian (ISO, có giờ) → "21/09" theo giờ địa phương. Khác
 * `formatShortDate`: cắt chuỗi ISO lấy ngày UTC sẽ lệch một ngày sau 17 giờ.
 */
export function formatShortTimestamp(value?: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  // Tự ghép "dd/MM": `toLocaleDateString('vi-VN')` chỉ ngày-tháng trả "14-10".
  const day = String(parsed.getDate()).padStart(2, '0');
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}

/** Mốc thời gian đầy đủ cho nhật ký hoạt động. */
export function formatDateTime(value?: string | null): string {
  if (!value) return '';
  return formatSharedDateTime(value);
}

/**
 * Việc còn mở và đã trôi qua hạn.
 *
 * Cùng định nghĩa với `isOverdue` bên module: việc đóng muộn KHÔNG tính là
 * quá hạn. Hai nơi lệch nhau thì con số trên màn hình sẽ khác con số trong
 * báo cáo.
 */
export function isOverdue(item: {
  status: WorkItemStatus;
  plannedEnd?: string | null;
}): boolean {
  if (item.status === 'done' || item.status === 'cancelled') return false;
  if (!item.plannedEnd) return false;
  return item.plannedEnd.slice(0, 10) < new Date().toISOString().slice(0, 10);
}

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  meeting: 'Họp',
  activity: 'Sinh hoạt',
  other: 'Khác',
};

export const PARTICIPANT_RESPONSE_LABELS: Record<ParticipantResponse, string> = {
  needs_action: 'Chờ phản hồi',
  accepted: 'Tham dự',
  declined: 'Từ chối',
  tentative: 'Có thể',
};

export const MY_WORK_BUCKET_LABELS: Record<MyWorkBucket, string> = {
  overdue: 'Quá hạn',
  today: 'Đến hạn hôm nay',
  this_week: 'Trong tuần này',
  later: 'Sau này',
  no_due: 'Chưa đặt hạn',
};

/** Màu chấm đầu nhóm trên trang Công việc của tôi. */
export const MY_WORK_BUCKET_TONE: Record<MyWorkBucket, string> = {
  overdue: '#dc2626',
  today: '#d97706',
  this_week: '#2563eb',
  later: '#6b7280',
  no_due: '#9ca3af',
};

/** Chỉ `FS` chặn cứng việc hoàn thành; ba loại còn lại chỉ cảnh báo lịch. */
export const DEPENDENCY_TYPE_LABELS: Record<DependencyType, string> = {
  FS: 'Xong trước → mới bắt đầu (FS)',
  SS: 'Bắt đầu cùng lúc (SS)',
  FF: 'Xong cùng lúc (FF)',
  SF: 'Bắt đầu trước → mới xong (SF)',
};

/** Trạng thái đơn từ của dự án (tab "Đơn từ"). */
export const PROJECT_REQUEST_STATUS_LABELS: Record<ProjectRequestStatus, string> = {
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  CANCELLED: 'Đã huỷ',
  REVERSED: 'Đã huỷ hiệu lực',
};

export const PROJECT_REQUEST_STATUS_TONE: Record<ProjectRequestStatus, { bg: string; fg: string }> = {
  PENDING: { bg: 'rgb(245 158 11 / 18%)', fg: '#92400e' },
  APPROVED: { bg: 'rgb(16 185 129 / 15%)', fg: '#047857' },
  REJECTED: { bg: 'rgb(239 68 68 / 15%)', fg: '#b91c1c' },
  CANCELLED: { bg: '#f3f4f6', fg: '#6b7280' },
  REVERSED: { bg: '#fff7ed', fg: '#9a3412' },
};

/** Vai của người đang xem trên một việc ngoài dự án. */
export const STANDALONE_TASK_ROLE_LABELS: Record<StandaloneTaskRole, string> = {
  assigner: 'Người giao',
  assignee: 'Người phụ trách',
  participant: 'Người cùng thực hiện',
  follower: 'Người theo dõi',
  viewer: 'Người liên quan (xem qua việc cha/con)',
};

/** Trạng thái hồ sơ quy trình gắn với việc ngoài dự án. */
export const STANDALONE_TASK_PROCEDURE_STATUS_LABELS: Record<StandaloneTaskProcedureStatus, string> = {
  pending: 'Đang mở hồ sơ',
  started: 'Hồ sơ đang chạy',
  start_rejected: 'Không mở được hồ sơ',
  completed: 'Hồ sơ đã hoàn tất',
  rejected: 'Hồ sơ bị từ chối',
  cancelled: 'Hồ sơ đã huỷ',
};

/** Ba ngăn của trang "Công việc ngoài dự án". */
export const STANDALONE_TASK_SCOPE_LABELS: Record<StandaloneTaskScope, string> = {
  assigned_to_me: 'Giao cho tôi',
  assigned_by_me: 'Tôi giao',
  following: 'Tôi theo dõi',
};

/** Nhãn trạng thái việc ngoài dự án: việc huỷ hiệu lực vẫn là `cancelled` nhưng hiện riêng. */
export function standaloneTaskStatusLabel(task: Pick<StandaloneTask, 'status' | 'reversal'>): string {
  return task.reversal ? 'Đã huỷ hiệu lực' : WORK_ITEM_STATUS_LABELS[task.status];
}

/** Màu huy hiệu trạng thái việc ngoài dự án, cùng bảng với công việc dự án. */
export function standaloneTaskStatusTone(
  task: Pick<StandaloneTask, 'status' | 'reversal'>,
): { bg: string; fg: string } {
  return task.reversal ? { bg: '#fff7ed', fg: '#9a3412' } : WORK_ITEM_STATUS_TONE[task.status];
}
