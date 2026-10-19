/**
 * Bản nháp đơn do Trợ lý Savina gửi (theo tên trường của request API, xem `HRM_ASSISTANT_ACTIONS`) thành các giá trị
 * của form tạo đơn ở trang Đơn từ. Giá trị sai định dạng hoặc không có trong danh mục bị bỏ qua: form vẫn mở và người
 * dùng tự nhập phần còn thiếu.
 */
import type {
  HrmBusinessTripType,
  HrmRequestType,
  HrmRequestTypeField,
} from '@enterprise-platform/contracts-hrm';

export type AssistantRequestKind = 'leave' | 'ot' | 'business_trip' | 'custom';

/** Các ô form được điền; ô vắng mặt giữ nguyên giá trị đang có. */
export interface RequestFormPatch {
  fromDate?: string;
  toDate?: string;
  /** Giờ bắt đầu và kết thúc 'HH:mm' của khoảng chính (nghỉ, làm thêm giờ, công tác). */
  startTime?: string;
  endTime?: string;
  reasonId?: string;
  description?: string;
  destination?: string;
  tripType?: HrmBusinessTripType;
  allowOt?: boolean;
  project?: { id: string; code: string; name: string };
  customFromAt?: string;
  customToAt?: string;
  /** Trường động đã đổi của loại đơn tuỳ chỉnh; gộp vào giá trị đang có. */
  customValues?: Record<string, unknown>;
}

export interface RequestDraftContext {
  /** Form đang mở khi Trợ lý gửi tiếp bản nháp cùng yêu cầu; null khi vừa mở form mới. */
  current: { toDate: string; customToAt: string } | null;
  /** Loại nghỉ người dùng chọn được. */
  leaveTypeIds?: readonly string[];
  /** Dự án Workspace người dùng gắn được vào đơn. */
  projects?: readonly { id: string; code: string; name: string }[];
  /** Loại đơn tuỳ chỉnh đang mở. */
  customType?: Pick<HrmRequestType, 'timeMode' | 'fields'> | null;
}

const MAX_DESCRIPTION = 2000;
const MAX_TEXT = 500;
const TRIP_TYPES: readonly HrmBusinessTripType[] = ['DOMESTIC', 'OVERSEAS', 'INTERSITE'];

const pad = (value: number) => String(value).padStart(2, '0');

/** 'YYYY-MM-DD' có thật trên lịch, hoặc null. */
export function draftDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return date.getUTCMonth() === +m[2] - 1 && date.getUTCDate() === +m[3] ? m[0] : null;
}

/**
 * Ngày giờ theo giờ địa phương: 'YYYY-MM-DDTHH:mm' (có thể kèm giây) giữ nguyên; chuỗi ISO có múi giờ thì đổi sang
 * giờ của trình duyệt như ô nhập của form.
 */
export function draftDateTime(value: unknown): { date: string; time: string } | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(text);
  if (!m || !draftDate(m[1]) || +m[2] > 23 || +m[3] > 59) return null;
  if (!m[4]) return { date: m[1], time: `${m[2]}:${m[3]}` };
  const at = new Date(text.replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  if (Number.isNaN(at.getTime())) return null;
  return {
    date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
    time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
  };
}

function draftText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

function draftId(value: unknown): string | null {
  return typeof value === 'string' && /^[^\s]{1,200}$/.test(value) ? value : null;
}

function draftBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 'false') return value === 'true';
  return null;
}

/** Ngày của chuỗi ngày hoặc ngày giờ. */
function dayOf(value: unknown): string | null {
  return draftDate(value) ?? draftDateTime(value)?.date ?? null;
}

/**
 * Khoảng thời gian của đơn nghỉ, làm thêm giờ, công tác. Có `fromAt`/`toAt` thì lấy cả giờ; không thì lấy
 * `fromDate`/`toDate` (giờ theo mặc định của form). Thiếu ngày kết thúc thì kết thúc cùng ngày bắt đầu.
 */
function timeRangePatch(
  draft: Record<string, unknown>,
  current: RequestDraftContext['current'],
  allowDates: boolean,
): RequestFormPatch {
  const patch: RequestFormPatch = {};
  const from = draftDateTime(draft['fromAt']);
  const to = draftDateTime(draft['toAt']);
  if (from) {
    patch.fromDate = from.date;
    patch.startTime = from.time;
  } else if (allowDates) {
    const date = draftDate(draft['fromDate']);
    if (date) patch.fromDate = date;
  }
  if (to) {
    patch.toDate = to.date;
    patch.endTime = to.time;
  } else if (allowDates) {
    const date = draftDate(draft['toDate']);
    if (date) patch.toDate = date;
  }
  if (patch.fromDate && patch.toDate && patch.toDate < patch.fromDate) {
    delete patch.toDate;
    delete patch.endTime;
  }
  if (patch.fromDate && patch.toDate === undefined && (!current || current.toDate < patch.fromDate))
    patch.toDate = patch.fromDate;
  return patch;
}

/** Giá trị của một trường động theo kiểu khai báo trong loại đơn; null khi không hợp lệ. */
export function customFieldValue(field: HrmRequestTypeField, value: unknown): unknown {
  switch (field.type) {
    case 'text':
      return draftText(value, MAX_TEXT);
    case 'textarea':
      return draftText(value, MAX_DESCRIPTION);
    case 'number': {
      const n =
        typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
      return Number.isFinite(n) ? n : null;
    }
    case 'date':
      return dayOf(value);
    case 'datetime': {
      const at = draftDateTime(value);
      return at ? `${at.date}T${at.time}` : null;
    }
    case 'select': {
      if (typeof value !== 'string') return null;
      const wanted = value.trim().toLocaleLowerCase('vi');
      return (field.options ?? []).find((o) => o.toLocaleLowerCase('vi') === wanted) ?? null;
    }
    case 'checkbox':
      return draftBoolean(value);
    default:
      return null;
  }
}

function customPatch(
  draft: Record<string, unknown>,
  type: Pick<HrmRequestType, 'timeMode' | 'fields'>,
  current: RequestDraftContext['current'],
): RequestFormPatch {
  const patch: RequestFormPatch = {};
  if (type.timeMode === 'RANGE_DATETIME') {
    const from = draftDateTime(draft['fromAt']);
    const to = draftDateTime(draft['toAt']);
    if (from) patch.customFromAt = `${from.date}T${from.time}`;
    if (to) patch.customToAt = `${to.date}T${to.time}`;
    if (patch.customFromAt && patch.customToAt && patch.customToAt <= patch.customFromAt)
      delete patch.customToAt;
  } else if (type.timeMode === 'DATE_RANGE') {
    const from = dayOf(draft['fromAt']);
    const to = dayOf(draft['toAt']);
    if (from) patch.customFromAt = from;
    if (to && (!from || to >= from)) patch.customToAt = to;
    if (from && patch.customToAt === undefined && (!current || current.customToAt < from))
      patch.customToAt = from;
  } else if (type.timeMode === 'SINGLE_DATE') {
    const day = dayOf(draft['fromAt']);
    if (day) {
      patch.customFromAt = day;
      patch.customToAt = day;
    }
  }
  const fields = draft['fields'];
  if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
    const values: Record<string, unknown> = {};
    for (const field of type.fields) {
      if (!Object.prototype.hasOwnProperty.call(fields, field.key)) continue;
      const value = customFieldValue(field, (fields as Record<string, unknown>)[field.key]);
      if (value !== null) values[field.key] = value;
    }
    if (Object.keys(values).length) patch.customValues = values;
  }
  return patch;
}

/** Các ô form cần đặt theo bản nháp của Trợ lý. */
export function assistantRequestPatch(
  kind: AssistantRequestKind,
  draft: Record<string, unknown>,
  context: RequestDraftContext,
): RequestFormPatch {
  const patch: RequestFormPatch =
    kind === 'custom'
      ? context.customType
        ? customPatch(draft, context.customType, context.current)
        : {}
      : timeRangePatch(draft, context.current, kind !== 'ot');

  if (kind === 'leave') {
    const leaveTypeId = draftId(draft['leaveTypeId']);
    if (leaveTypeId && context.leaveTypeIds?.includes(leaveTypeId)) patch.reasonId = leaveTypeId;
  } else {
    const reasonId = draftId(draft['reasonId']);
    if (reasonId) patch.reasonId = reasonId;
  }
  const description = draftText(draft['description'], MAX_DESCRIPTION);
  if (description) patch.description = description;

  if (kind === 'business_trip') {
    const destination = draftText(draft['destination'], MAX_TEXT);
    if (destination) patch.destination = destination;
    const tripType = draft['businessTripType'];
    if (TRIP_TYPES.includes(tripType as HrmBusinessTripType))
      patch.tripType = tripType as HrmBusinessTripType;
    const allowOt = draftBoolean(draft['allowOt']);
    if (allowOt !== null) patch.allowOt = allowOt;
    const projectId = draftId(draft['projectId']);
    const project = projectId ? context.projects?.find((p) => p.id === projectId) : undefined;
    if (project) patch.project = { id: project.id, code: project.code, name: project.name };
  }
  return patch;
}
