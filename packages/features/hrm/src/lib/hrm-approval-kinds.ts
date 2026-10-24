import type { HrmAction } from '@enterprise-platform/contracts-identity';

/**
 * Các loại đơn xuất hiện ở "Đơn từ cần xử lý" và ở thẻ "Cần xử lý" của Bàn làm việc.
 * Dùng chung để hai nơi luôn khớp về endpoint, quyền và khóa `?type=`.
 */
export type ApprovalKind =
  | 'LEAVE'
  | 'OT'
  | 'BUSINESS_TRIP'
  | 'SHIFT_CHANGE'
  | 'ATTENDANCE'
  | 'PROFILE'
  | 'ADVANCE'
  | 'CUSTOM';

export type ApprovalSource = {
  kind: ApprovalKind;
  /** Khóa dùng cho `/approvals?type=<typeKey>`. */
  typeKey: string;
  label: string;
  path: string;
  /** Quyền duyệt (phạm vi cấp dưới). */
  permission: HrmAction;
  /** Quyền duyệt toàn bộ. */
  permissionAll: HrmAction;
  /** Quyền đọc toàn bộ danh sách của loại đơn này (ngoài quyền duyệt). */
  readPermissions: HrmAction[];
};

export const APPROVAL_SOURCES: readonly ApprovalSource[] = [
  {
    kind: 'LEAVE',
    typeKey: 'leave',
    label: 'Nghỉ phép',
    path: 'leave-requests',
    permission: 'hrm.request.approve',
    permissionAll: 'hrm.request.approve.all',
    readPermissions: ['hrm.request.read', 'hrm.request.manage'],
  },
  {
    kind: 'OT',
    typeKey: 'ot',
    label: 'Tăng ca',
    path: 'ot-requests',
    permission: 'hrm.request.approve',
    permissionAll: 'hrm.request.approve.all',
    readPermissions: ['hrm.request.read', 'hrm.request.manage'],
  },
  {
    kind: 'BUSINESS_TRIP',
    typeKey: 'business_trip',
    label: 'Công tác',
    path: 'business-trip-requests',
    permission: 'hrm.request.approve',
    permissionAll: 'hrm.request.approve.all',
    readPermissions: ['hrm.request.read', 'hrm.request.manage'],
  },
  {
    kind: 'SHIFT_CHANGE',
    typeKey: 'shift_change',
    label: 'Đổi ca',
    path: 'shift-change-requests',
    permission: 'hrm.request.approve',
    permissionAll: 'hrm.request.approve.all',
    readPermissions: ['hrm.request.read', 'hrm.request.manage'],
  },
  {
    kind: 'ATTENDANCE',
    typeKey: 'correction',
    label: 'Giải trình công',
    path: 'attendance-corrections',
    permission: 'hrm.request.approve',
    permissionAll: 'hrm.request.approve.all',
    readPermissions: ['hrm.request.read', 'hrm.request.manage'],
  },
  {
    kind: 'PROFILE',
    typeKey: 'profile_correction',
    label: 'Sửa hồ sơ',
    path: 'profile-corrections',
    permission: 'hrm.request.approve',
    permissionAll: 'hrm.request.approve.all',
    readPermissions: ['hrm.request.read', 'hrm.request.manage'],
  },
  {
    kind: 'ADVANCE',
    typeKey: 'advance',
    label: 'Tạm ứng',
    path: 'salary-advance-requests',
    permission: 'hrm.request.approve',
    permissionAll: 'hrm.request.approve.all',
    // Danh sách tạm ứng đọc bằng hrm.advance.read ở phía máy chủ.
    readPermissions: ['hrm.advance.read'],
  },
  {
    // Đơn của các loại đơn do quản trị tạo (engine GENERIC); tên loại cụ thể nằm ở từng đơn (`typeName`).
    kind: 'CUSTOM',
    typeKey: 'custom',
    label: 'Đơn tuỳ chỉnh',
    path: 'custom-requests',
    permission: 'hrm.request.approve',
    permissionAll: 'hrm.request.approve.all',
    readPermissions: ['hrm.request.read', 'hrm.request.manage'],
  },
];

/**
 * Loại đơn không dùng: ẩn khỏi giao diện (tạo đơn, bộ lọc, danh sách, duyệt, cấu hình duyệt).
 * Dữ liệu và API cũ giữ nguyên; muốn dùng lại chỉ cần bỏ khỏi danh sách này.
 */
export const HIDDEN_REQUEST_KINDS: readonly string[] = [
  'shift_change',
  'advance',
  'profile_correction',
];

export const isHiddenRequestKind = (kind: string | null | undefined): boolean =>
  HIDDEN_REQUEST_KINDS.includes(kind ?? '');

/** Trạng thái được tính là "đang chờ xử lý". */
export const PENDING_STATUSES: readonly string[] = ['PENDING', 'PEER_CONFIRMED'];

export function isPendingStatus(status: string | undefined | null): boolean {
  return PENDING_STATUSES.includes(status ?? '');
}

/** Đường dẫn danh sách quy trình (Procedure Engine); nằm ngoài basePath của HRM nên dùng thẻ a thường. */
export const PROCEDURE_INSTANCES_PATH = '/modules/procedure#workspace';

/** Đường dẫn tới một hồ sơ quy trình cụ thể (hoặc danh sách nếu chưa có instanceId). */
export function procedureInstanceHref(instanceId?: string | null): string {
  return instanceId
    ? `/modules/procedure#workspace/${encodeURIComponent(instanceId)}`
    : PROCEDURE_INSTANCES_PATH;
}

/** Các loại đơn người dùng được phép tải, theo tập quyền hiện có. */
export function approvalSourcesFor(
  actions: readonly string[],
): ApprovalSource[] {
  const has = new Set(actions);
  return APPROVAL_SOURCES.filter(
    (s) =>
      !isHiddenRequestKind(s.typeKey) &&
      (has.has(s.permission) ||
        has.has(s.permissionAll) ||
        s.readPermissions.some((p) => has.has(p))),
  );
}

/** Đường dẫn danh sách chờ duyệt: luôn kèm forApproval=1 để máy chủ chỉ trả đơn thuộc phạm vi duyệt. */
export function approvalListPath(
  source: Pick<ApprovalSource, 'path'>,
  extraQuery: string[] = [],
): string {
  return `/${source.path}?${['forApproval=1', ...extraQuery]
    .filter(Boolean)
    .join('&')}`;
}

const TYPE_ALIASES: Record<string, ApprovalKind> = {
  leave: 'LEAVE',
  ot: 'OT',
  overtime: 'OT',
  business_trip: 'BUSINESS_TRIP',
  'business-trip': 'BUSINESS_TRIP',
  trip: 'BUSINESS_TRIP',
  shift_change: 'SHIFT_CHANGE',
  'shift-change': 'SHIFT_CHANGE',
  shift: 'SHIFT_CHANGE',
  correction: 'ATTENDANCE',
  attendance: 'ATTENDANCE',
  profile_correction: 'PROFILE',
  'profile-correction': 'PROFILE',
  profile: 'PROFILE',
  advance: 'ADVANCE',
  custom: 'CUSTOM',
};

/** Đọc giá trị `?type=`; trả '' nếu không nhận ra. */
export function approvalKindFromType(
  value: string | null | undefined,
): ApprovalKind | '' {
  if (!value) return '';
  return TYPE_ALIASES[value.trim().toLowerCase()] ?? '';
}

export function approvalHref(source: Pick<ApprovalSource, 'typeKey'>): string {
  return `/approvals?type=${source.typeKey}`;
}

/** Tách nhãn "MÃ · Họ tên" của employee-options thành mã và tên. */
export function splitEmployeeLabel(label: string): {
  code: string;
  name: string;
} {
  const index = label.indexOf(' · ');
  if (index < 0) return { code: '', name: label };
  return { code: label.slice(0, index), name: label.slice(index + 3) };
}
