import type {
  ApprovalRoutePreview,
  HrmRequestReason,
  HrmRequestReasonKind,
} from '@enterprise-platform/contracts-hrm';

/**
 * Lý do và mô tả của đơn từ (nghỉ, làm thêm giờ, công tác, giải trình công, đổi ca).
 * - LÝ DO: chọn từ danh mục cấu hình (đơn nghỉ: loại nghỉ; 4 loại còn lại: request_reasons theo loại đơn), luôn bắt buộc.
 * - MÔ TẢ: văn bản tự do bổ sung, chỉ bắt buộc khi lý do đã chọn được cấu hình "cần mô tả".
 */

/** Năm loại đơn có lý do chọn từ danh mục (khóa trùng `kind` của GET /approval-route). */
export type ReasonedRequestKind =
  | 'leave'
  | 'ot'
  | 'business_trip'
  | 'shift_change'
  | 'correction';

const CATALOG_KIND: Record<string, HrmRequestReasonKind> = {
  ot: 'OVERTIME',
  business_trip: 'BUSINESS_TRIP',
  shift_change: 'SHIFT_CHANGE',
  correction: 'ATTENDANCE_CORRECTION',
};

export function isReasonedRequestKind(
  kind: string,
): kind is ReasonedRequestKind {
  return kind === 'leave' || kind in CATALOG_KIND;
}

/** Loại danh mục `request_reasons` của loại đơn; đơn nghỉ và các đơn không có lý do trả undefined. */
export function reasonCatalogKindOf(
  kind: string,
): HrmRequestReasonKind | undefined {
  return CATALOG_KIND[kind];
}

/** Một lý do có thể chọn, chuẩn hóa từ loại nghỉ hoặc từ danh mục lý do. */
export interface RequestReasonChoice {
  id: string;
  code: string;
  name: string;
  /** Diễn giải cho người chọn (danh mục lý do); loại nghỉ không có. */
  description: string | null;
  paid: boolean;
  requiresDescription: boolean;
  /** Chỉ lý do nghỉ phép năm trừ quỹ phép. */
  deductBalance: boolean;
}

export function choiceFromCatalogReason(
  reason: HrmRequestReason,
): RequestReasonChoice {
  return {
    id: reason.id,
    code: reason.code,
    name: reason.name,
    description: reason.description?.trim() ? reason.description.trim() : null,
    paid: reason.paid !== false,
    requiresDescription: reason.requiresDescription === true,
    deductBalance: false,
  };
}

/** Phần tối thiểu của loại nghỉ (lý do nghỉ) mà form tạo đơn cần. */
export interface LeaveTypeLike {
  id: string;
  code: string;
  name: string;
  paid?: boolean;
  deductBalance?: boolean;
  isAnnual?: boolean;
  requiresDescription?: boolean;
}

export function choiceFromLeaveType(type: LeaveTypeLike): RequestReasonChoice {
  return {
    id: type.id,
    code: type.code,
    name: type.name,
    description: null,
    paid: type.paid !== false,
    requiresDescription: type.requiresDescription === true,
    deductBalance: type.deductBalance ?? type.isAnnual === true,
  };
}

/** Mô tả bắt buộc khi lý do đã chọn được cấu hình "cần mô tả". */
export function descriptionRequired(
  choice: RequestReasonChoice | undefined | null,
): boolean {
  return choice?.requiresDescription === true;
}

/** Thông báo khi danh mục lý do của loại đơn còn trống (quản trị viên cần cấu hình trước). */
export function emptyReasonCatalogMessage(kind: ReasonedRequestKind): string {
  return kind === 'leave'
    ? 'Chưa có lý do nào cho loại đơn này. Quản trị viên cần cấu hình tại Cấu hình, Phép năm và lý do nghỉ.'
    : 'Chưa có lý do nào cho loại đơn này. Quản trị viên cần cấu hình tại Cấu hình, Lý do đơn từ.';
}

export interface ReasonValidationInput {
  kind: ReasonedRequestKind;
  choices: readonly RequestReasonChoice[];
  reasonId: string;
  description: string;
  /** Danh mục lý do đang tải. */
  loading?: boolean;
  /** Thông điệp lỗi khi không tải được danh mục lý do. */
  error?: string;
}

/**
 * Lý do chặn gửi đơn (tiếng Việt) hoặc null nếu hợp lệ:
 * danh mục đang tải / lỗi / rỗng, chưa chọn lý do, hoặc lý do cần mô tả mà mô tả còn trống.
 */
export function reasonBlockMessage(
  input: ReasonValidationInput,
): string | null {
  if (input.loading) return 'Đang tải danh sách lý do.';
  if (input.error) return `Không tải được danh sách lý do: ${input.error}`;
  if (input.choices.length === 0) return emptyReasonCatalogMessage(input.kind);
  const choice = input.choices.find((item) => item.id === input.reasonId);
  if (!choice) return 'Vui lòng chọn lý do.';
  if (descriptionRequired(choice) && !input.description.trim())
    return `Lý do "${choice.name}" yêu cầu nhập mô tả.`;
  return null;
}

/**
 * Phần lý do và mô tả của payload tạo đơn: đơn nghỉ gửi `leaveTypeId` (lý do) + `description`;
 * các đơn còn lại gửi `reasonId` + `description`. Không gửi `reason` (bí danh đã bỏ).
 */
export function reasonPayload(
  kind: ReasonedRequestKind,
  reasonId: string,
  description: string,
): { leaveTypeId: string; description?: string } | {
  reasonId: string;
  description?: string;
} {
  const text = description.trim();
  const optional = text ? { description: text } : {};
  return kind === 'leave'
    ? { leaveTypeId: reasonId, ...optional }
    : { reasonId, ...optional };
}

/**
 * Đọc lý do/mô tả từ payload bản nháp. Nháp mới lưu `reasonId` + `description`; nháp cũ chỉ có `reason`
 * (bí danh của mô tả) thì dùng làm mô tả và để trống lý do.
 */
export function draftReasonFields(
  kind: ReasonedRequestKind,
  payload: Record<string, unknown> | null | undefined,
): { reasonId: string; description: string } {
  const data = payload ?? {};
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  const idKey = kind === 'leave' ? 'leaveTypeId' : 'reasonId';
  return {
    reasonId: text(data[idKey]),
    description: text(data.description) || text(data.reason),
  };
}

/** Chuỗi hiển thị cho một ô lý do hoặc mô tả; rỗng hoặc thiếu thì "—". */
export function reasonCell(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '—';
}

/**
 * Cặp lý do và mô tả hiển thị của một đơn từ phản hồi API.
 * Lý do là `reasonName` (đơn cũ chưa có thì "—"); mô tả là `description`, đơn cũ chỉ có `reason` thì dùng nội dung đó.
 */
export function requestReasonView(row: {
  reasonName?: unknown;
  description?: unknown;
  reason?: unknown;
}): { reason: string; description: string } {
  const description =
    typeof row.description === 'string'
      ? row.description
      : typeof row.reason === 'string'
        ? row.reason
        : '';
  return {
    reason: reasonCell(row.reasonName),
    description: reasonCell(description),
  };
}

/** Đường dẫn GET /approval-route; bỏ `reasonId` khi chưa chọn lý do. */
export function approvalRoutePath(input: {
  kind: string;
  employeeId: string;
  reasonId?: string;
}): string {
  const query = new URLSearchParams({
    kind: input.kind,
    employeeId: input.employeeId,
  });
  if (input.reasonId) query.set('reasonId', input.reasonId);
  return `/approval-route?${query.toString()}`;
}

/** Phản hồi hợp lệ của GET /approval-route (loại bỏ phản hồi rỗng hoặc sai hình dạng). */
export function isApprovalRoutePreview(
  value: unknown,
): value is ApprovalRoutePreview {
  const mode = (value as { mode?: unknown } | null | undefined)?.mode;
  return mode === 'DIRECT' || mode === 'PROCEDURE';
}

export interface ApproverLine {
  /** Cách duyệt: "Quản lý trực tiếp" hoặc "Duyệt theo quy trình". */
  method: string;
  /** Chi tiết đi kèm: họ tên và chức danh quản lý, hoặc tên quy trình. */
  detail: string;
  /** Ghi chú của máy chủ (ví dụ chưa có quản lý trực tiếp). */
  note: string;
}

/** Nội dung dòng "Người duyệt" cho người làm đơn biết trước. */
export function approverLine(preview: ApprovalRoutePreview): ApproverLine {
  const note = preview.note?.trim() ?? '';
  if (preview.mode === 'PROCEDURE') {
    return {
      method: 'Duyệt theo quy trình',
      detail: preview.procedureName?.trim() ?? '',
      note,
    };
  }
  const manager = preview.directManager;
  const detail = manager
    ? [manager.fullName, manager.positionName?.trim()]
        .filter((part): part is string => Boolean(part))
        .join(', ')
    : '';
  return { method: 'Quản lý trực tiếp', detail, note };
}
