import type {
  DependencyType,
  EventType,
  MyWorkBucket,
  ParticipantResponse,
  ProjectRole,
  ProjectStatus,
  WorkItemPriority,
  WorkItemStatus,
  WorkItemType,
} from '@enterprise-platform/contracts-workspace';

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

export const WORK_ITEM_STATUS_LABELS: Record<WorkItemStatus, string> = {
  todo: 'Chưa làm',
  in_progress: 'Đang làm',
  blocked: 'Vướng mắc',
  review: 'Chờ duyệt',
  done: 'Hoàn thành',
  cancelled: 'Đã huỷ',
};

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

export const ROLE_LABELS: Record<ProjectRole, string> = {
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

/** `2026-09-21` → `21/09/2026`. Chuỗi rỗng khi không có ngày. */
export function formatDate(value?: string | null): string {
  if (!value) return '';
  const [year, month, day] = value.slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : '';
}

/** Mốc thời gian đầy đủ cho nhật ký hoạt động. */
export function formatDateTime(value?: string | null): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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
