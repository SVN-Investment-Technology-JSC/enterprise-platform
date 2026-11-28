import type {
  HrmBusinessTripRequest,
  HrmCustomRequest,
  HrmLeaveRequest,
  HrmOtRequest,
  HrmPersonnelDecision,
} from '@enterprise-platform/contracts-hrm';
import type {
  LinkableCandidate,
  LinkableField,
  LinkableKind,
  LinkableObject,
} from '@enterprise-platform/contracts-integration';

/**
 * Nhân sự công bố hồ sơ của mình cho module khác gắn vào (hợp đồng `LinkableObject` ở `contracts-integration`).
 *
 * Chỉ chuyển dạng dữ liệu mà route danh sách sẵn có đã trả (đã lọc theo quyền và phạm vi của người xem); không đọc
 * thêm gì. Không công bố dữ liệu lương, bảng lương, phiếu lương, người phụ thuộc hay dữ liệu chấm công thô:
 * - `label` chỉ gồm loại đơn, ngày và họ tên người đề nghị (quyết định nhân sự: số quyết định và loại), không số tiền,
 *   không loại nghỉ (có thể lộ thông tin sức khỏe), không lý do tự do: bên gắn lưu nhãn này và ai trong dự án cũng thấy.
 * - `fields` không có hệ số làm thêm, có lương hay không, công tác phí, lương trước/sau quyết định, trường động của đơn
 *   khác (quản trị tự đặt, có thể chứa số tiền); mô tả tự do bị cắt ngắn.
 */
export const HRM_LINKABLE_KINDS = {
  ot: 'hrm.ot-request',
  leave: 'hrm.leave-request',
  trip: 'hrm.business-trip',
  custom: 'hrm.custom-request',
  decision: 'hrm.personnel-decision',
} as const;

export type HrmLinkableKind = (typeof HRM_LINKABLE_KINDS)[keyof typeof HRM_LINKABLE_KINDS];
export type HrmLinkableRequestKind = Exclude<HrmLinkableKind, typeof HRM_LINKABLE_KINDS.decision>;

const MODULE_LABEL = 'Nhân sự';

const KIND_LABELS: Record<HrmLinkableKind, string> = {
  'hrm.ot-request': 'Đơn làm thêm',
  'hrm.leave-request': 'Đơn nghỉ phép',
  'hrm.business-trip': 'Đơn công tác',
  'hrm.custom-request': 'Đơn khác',
  'hrm.personnel-decision': 'Quyết định nhân sự',
};

export const HRM_LINKABLE_KIND_LIST: readonly LinkableKind[] = (
  Object.keys(KIND_LABELS) as HrmLinkableKind[]
).map((key) => ({ key, moduleLabel: MODULE_LABEL, label: KIND_LABELS[key], prefill: false }));

export function isHrmLinkableKind(value: unknown): value is HrmLinkableKind {
  return HRM_LINKABLE_KIND_LIST.some((kind) => kind.key === value);
}

/** Loại đơn HRM tương ứng (khoá quyền duyệt `approverPermissions` và `?type=` của màn Duyệt đơn). */
export const HRM_LINKABLE_REQUEST_TYPES = {
  'hrm.ot-request': 'ot',
  'hrm.leave-request': 'leave',
  'hrm.business-trip': 'business_trip',
  'hrm.custom-request': 'custom',
} as const satisfies Record<HrmLinkableRequestKind, string>;

/**
 * Đường dẫn mở hồ sơ trong giao diện Nhân sự.
 *
 * Đơn: màn Duyệt đơn mở đúng đơn theo `?request=` (người duyệt, nhân sự); người không có quyền duyệt loại đơn nào thì
 * màn đó tự chuyển sang "Đơn từ của tôi" (`/requests?request=`), nên chủ đơn cũng mở được. Workspace lưu đường dẫn này
 * cho mọi thành viên dự án, vì vậy không chọn theo người đang xem.
 * Quyết định nhân sự: chưa có đường dẫn mở một quyết định, nên mở danh sách quyết định.
 */
export function hrmLaunchUrl(kind: HrmLinkableKind, id: string): string {
  if (kind === HRM_LINKABLE_KINDS.decision) return '/modules/hrm/employees?view=decisions';
  return `/modules/hrm/approvals?type=${HRM_LINKABLE_REQUEST_TYPES[kind]}&request=${encodeURIComponent(id)}`;
}

/* ------------------------------------------------------------------ Người đề nghị, người duyệt */

/** Một dòng của `GET employee-options`: mã, họ tên, đơn vị (không có dữ liệu nhạy cảm). */
export interface HrmLinkablePerson {
  readonly employeeId: string;
  readonly employeeCode?: string | null;
  readonly fullName?: string | null;
  readonly department?: string | null;
  readonly userId?: string | null;
}

export interface HrmLinkablePeople {
  employee(employeeId: string | null | undefined): HrmLinkablePerson | undefined;
  user(userId: string | null | undefined): HrmLinkablePerson | undefined;
}

export function hrmLinkablePeople(list: readonly HrmLinkablePerson[]): HrmLinkablePeople {
  const byEmployee = new Map(list.map((person) => [person.employeeId, person]));
  const byUser = new Map(
    list.filter((person) => person.userId).map((person) => [person.userId as string, person]),
  );
  return {
    employee: (employeeId) => (employeeId ? byEmployee.get(employeeId) : undefined),
    user: (userId) => (userId ? byUser.get(userId) : undefined),
  };
}

export const NO_PEOPLE: HrmLinkablePeople = hrmLinkablePeople([]);

/* ------------------------------------------------------------------ Tiện ích định dạng */

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  CANCELLED: 'Đã hủy',
};

const DECISION_TYPE_LABELS: Record<string, string> = {
  APPOINT: 'Bổ nhiệm',
  PROMOTE: 'Thăng chức',
  TRANSFER: 'Điều chuyển',
  CONCURRENT: 'Kiêm nhiệm',
  DISMISS: 'Miễn nhiệm',
  REVOKE: 'Bãi nhiệm',
  CHANGE_MANAGER: 'Đổi quản lý trực tiếp',
};

const DECISION_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Nháp',
  APPROVED: 'Đã duyệt',
  APPLY_PENDING: 'Chờ áp dụng',
  APPLIED: 'Đã áp dụng',
  REJECTED: 'Từ chối',
  CANCELLED: 'Đã hủy',
  RECORDED: 'Đã ghi nhận',
};

const TRIP_TYPE_LABELS: Record<string, string> = {
  DOMESTIC: 'Trong nước',
  OVERSEAS: 'Nước ngoài',
  INTERSITE: 'Giữa các đơn vị',
};

const TRANSPORT_LABELS: Record<string, string> = {
  COMPANY_VEHICLE: 'Xe công ty',
  EXTERNAL: 'Tự sắp xếp',
};

const joined = (separator: string, ...parts: readonly (string | null | undefined)[]) =>
  parts.filter((part): part is string => Boolean(part && part.trim())).join(separator);
const text = (key: string, label: string, value: string | number | null | undefined): LinkableField => ({
  key,
  label,
  type: 'text',
  value: value == null || value === '' ? null : String(value),
});
const date = (key: string, label: string, value: string | null | undefined): LinkableField => ({
  key,
  label,
  type: 'date',
  value: value ? value.slice(0, 10) : null,
});
const shorten = (value: string | null | undefined, max: number) => {
  const flat = (value ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat || null;
};

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
/** Ngày `YYYY-MM-DD` theo giờ Việt Nam của một mốc thời gian ISO. */
export function vnDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time + VN_OFFSET_MS).toISOString().slice(0, 10) : null;
}
/** `YYYY-MM-DD` → `DD/MM/YYYY`. */
function dmy(value: string | null | undefined): string | null {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
}
function dateRange(from: string | null | undefined, to: string | null | undefined): string | null {
  const start = dmy(from);
  const end = dmy(to);
  if (!start) return end;
  return !end || end === start ? start : `${start} – ${end}`;
}
const decimal = (value: number) => String(Math.round(value * 100) / 100).replace('.', ',');
const hours = (minutes: number | null | undefined) =>
  minutes == null || !Number.isFinite(minutes) || minutes <= 0 ? null : `${decimal(minutes / 60)} giờ`;
const days = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) || value <= 0 ? null : `${decimal(value)} ngày`;
const hhmm = (value: string | null | undefined) => (value ? value.slice(0, 5) : null);
const personText = (person: HrmLinkablePerson | undefined) =>
  person ? joined(' · ', person.employeeCode, person.fullName) || null : null;

/** Đơn nhiều khoảng: khoảng bổ sung nằm trong khoảng chính, không chọn riêng. */
export function isGroupFollower(row: { readonly id: string; readonly groupId?: string | null }): boolean {
  return Boolean(row.groupId && row.groupId !== row.id);
}

/** Bỏ dấu, chữ thường, để tìm kiếm không phân biệt dấu. */
export function foldLinkableText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .trim();
}

/** Mọi từ trong `query` (đã bỏ dấu) đều có trong mã, nhãn, trạng thái hoặc dòng phụ. */
export function matchesLinkableQuery(candidate: LinkableCandidate, query: string): boolean {
  const words = foldLinkableText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = foldLinkableText(
    [candidate.code, candidate.label, candidate.status, candidate.hint].filter(Boolean).join(' '),
  );
  return words.every((word) => haystack.includes(word));
}

/* ------------------------------------------------------------------ Phần chung của các loại đơn */

interface RequestCommon {
  readonly id: string;
  readonly employeeId: string;
  readonly status: string;
  readonly reasonName: string | null;
  readonly description: string | null;
  readonly approvedBy?: string | null;
  readonly approvedAt?: string | null;
  readonly createdAt: string;
  readonly currentStepName?: string | null;
  readonly currentAssigneeName?: string | null;
  readonly createdOnBehalf?: boolean;
  readonly onBehalfByName?: string | null;
}

function requestCandidate(
  kind: HrmLinkableRequestKind,
  row: RequestCommon,
  people: HrmLinkablePeople,
  title: string,
): LinkableCandidate {
  const person = people.employee(row.employeeId);
  return {
    kind,
    id: row.id,
    label: joined(' — ', title, person?.fullName),
    status: STATUS_LABELS[row.status] ?? row.status,
    hint: joined(' — ', person?.employeeCode, person?.department, row.reasonName) || undefined,
  };
}

function requestHeadFields(row: RequestCommon, people: HrmLinkablePeople): LinkableField[] {
  const person = people.employee(row.employeeId);
  return [
    text('requester', 'Người đề nghị', personText(person)),
    text('department', 'Đơn vị', person?.department),
  ];
}

function requestTailFields(row: RequestCommon, people: HrmLinkablePeople): LinkableField[] {
  const pending = row.status === 'PENDING';
  return [
    text('reason', 'Lý do', row.reasonName),
    text('description', 'Mô tả', shorten(row.description, 200)),
    text('status', 'Trạng thái', STATUS_LABELS[row.status] ?? row.status),
    text('currentStep', 'Bước đang xử lý', pending ? row.currentStepName : null),
    text('currentAssignee', 'Người đang xử lý', pending ? row.currentAssigneeName : null),
    text('approvedBy', 'Người duyệt', personText(people.user(row.approvedBy))),
    date('approvedAt', 'Ngày duyệt', vnDate(row.approvedAt)),
    text('onBehalfBy', 'Người tạo hộ', row.createdOnBehalf ? row.onBehalfByName : null),
    date('createdAt', 'Ngày tạo', vnDate(row.createdAt)),
  ];
}

function requestObject(
  candidate: LinkableCandidate,
  row: RequestCommon,
  people: HrmLinkablePeople,
  own: readonly LinkableField[],
): LinkableObject {
  const kind = candidate.kind as HrmLinkableRequestKind;
  return {
    ...candidate,
    launchUrl: hrmLaunchUrl(kind, row.id),
    fields: [...requestHeadFields(row, people), ...own, ...requestTailFields(row, people)],
    upstream: [],
  };
}

/* ------------------------------------------------------------------ Đơn làm thêm */

function otSpan(row: HrmOtRequest) {
  const ranges = row.groupRanges?.length ? row.groupRanges : null;
  if (!ranges) {
    return {
      from: row.workDate,
      to: row.workDate,
      minutes: row.plannedMinutes,
      time: joined('–', hhmm(row.startTime), hhmm(row.endTime)) || null,
    };
  }
  const dates = ranges.map((range) => range.workDate).sort();
  return {
    from: dates[0],
    to: dates[dates.length - 1],
    minutes: ranges.reduce((sum, range) => sum + (Number(range.plannedMinutes) || 0), 0),
    time: `${ranges.length} khoảng`,
  };
}

export function otCandidate(row: HrmOtRequest, people: HrmLinkablePeople): LinkableCandidate {
  const span = otSpan(row);
  return requestCandidate(
    HRM_LINKABLE_KINDS.ot,
    row,
    people,
    joined(' ', KIND_LABELS['hrm.ot-request'], dateRange(span.from, span.to)),
  );
}

export function otObject(row: HrmOtRequest, people: HrmLinkablePeople): LinkableObject {
  const span = otSpan(row);
  return requestObject(otCandidate(row, people), row, people, [
    date('fromDate', 'Từ ngày', span.from),
    date('toDate', 'Đến ngày', span.to),
    text('time', 'Thời gian', span.time),
    text('plannedHours', 'Số giờ đăng ký', hours(span.minutes)),
    text('approvedHours', 'Số giờ được duyệt', row.status === 'APPROVED' ? hours(row.approvedMinutes) : null),
  ]);
}

/* ------------------------------------------------------------------ Đơn nghỉ phép */

function leaveSpan(row: HrmLeaveRequest) {
  const ranges = row.groupRanges?.length ? row.groupRanges : null;
  if (!ranges) return { from: row.fromDate, to: row.toDate, days: row.duration };
  return {
    from: ranges.map((range) => range.fromDate).sort()[0],
    to: ranges.map((range) => range.toDate).sort()[ranges.length - 1],
    days: ranges.reduce((sum, range) => sum + (Number(range.duration) || 0), 0),
  };
}

export function leaveCandidate(row: HrmLeaveRequest, people: HrmLinkablePeople): LinkableCandidate {
  const span = leaveSpan(row);
  // Lý do của đơn nghỉ là loại nghỉ: không đưa vào dòng phụ hay nhãn, chỉ hiện ở `fields` (đọc trực tiếp có kiểm quyền).
  return requestCandidate(
    HRM_LINKABLE_KINDS.leave,
    { ...row, reasonName: null },
    people,
    joined(' ', KIND_LABELS['hrm.leave-request'], dateRange(span.from, span.to)),
  );
}

export function leaveObject(row: HrmLeaveRequest, people: HrmLinkablePeople): LinkableObject {
  const span = leaveSpan(row);
  const fields = requestObject(leaveCandidate(row, people), { ...row, reasonName: null }, people, [
    text('leaveType', 'Loại nghỉ', row.leaveTypeName ?? row.reasonName),
    date('fromDate', 'Từ ngày', span.from),
    date('toDate', 'Đến ngày', span.to),
    text('days', 'Số ngày', days(span.days)),
  ]);
  return { ...fields, fields: fields.fields.filter((field) => field.key !== 'reason') };
}

/* ------------------------------------------------------------------ Đơn công tác */

export function tripCandidate(row: HrmBusinessTripRequest, people: HrmLinkablePeople): LinkableCandidate {
  return requestCandidate(
    HRM_LINKABLE_KINDS.trip,
    row,
    people,
    joined(' ', KIND_LABELS['hrm.business-trip'], shorten(row.destination, 60), dateRange(row.fromDate, row.toDate)),
  );
}

export function tripObject(row: HrmBusinessTripRequest, people: HrmLinkablePeople): LinkableObject {
  return requestObject(tripCandidate(row, people), row, people, [
    text('tripType', 'Loại công tác', TRIP_TYPE_LABELS[row.businessTripType] ?? row.businessTripType),
    text('destination', 'Nơi công tác', row.destination),
    date('fromDate', 'Từ ngày', row.fromDate),
    date('toDate', 'Đến ngày', row.toDate),
    text('days', 'Số ngày', days(row.daysCount)),
    text('project', 'Dự án', row.projectLink?.projectName ?? row.projectName),
    text('transport', 'Phương tiện', row.transportMode ? (TRANSPORT_LABELS[row.transportMode] ?? null) : null),
  ]);
}

/* ------------------------------------------------------------------ Đơn khác (loại do quản trị tạo) */

type CustomRow = HrmCustomRequest & {
  readonly currentStepName?: string | null;
  readonly currentAssigneeName?: string | null;
};

export function customCandidate(row: CustomRow, people: HrmLinkablePeople): LinkableCandidate {
  const from = vnDate(row.fromAt) ?? vnDate(row.createdAt);
  return requestCandidate(
    HRM_LINKABLE_KINDS.custom,
    row,
    people,
    joined(' ', shorten(row.typeName, 80) ?? KIND_LABELS['hrm.custom-request'], dateRange(from, vnDate(row.toAt))),
  );
}

export function customObject(row: CustomRow, people: HrmLinkablePeople): LinkableObject {
  return requestObject(customCandidate(row, people), row, people, [
    text('type', 'Loại đơn', row.typeName),
    date('fromDate', 'Từ ngày', vnDate(row.fromAt)),
    date('toDate', 'Đến ngày', vnDate(row.toAt)),
    text('duration', 'Thời lượng', hours(row.durationMinutes)),
  ]);
}

/* ------------------------------------------------------------------ Quyết định nhân sự */

export function decisionCandidate(row: HrmPersonnelDecision): LinkableCandidate {
  return {
    kind: HRM_LINKABLE_KINDS.decision,
    id: row.id,
    code: row.decisionNo,
    // Không đưa họ tên vào nhãn: quyết định (nhất là miễn nhiệm, bản nháp) là thông tin nhân sự nội bộ.
    label: joined(' — ', row.decisionNo, DECISION_TYPE_LABELS[row.decisionType] ?? row.decisionType),
    status: DECISION_STATUS_LABELS[row.status] ?? row.status,
    hint: joined(' — ', joined(' · ', row.employeeCode, row.employeeName), dmy(row.effectiveDate)) || undefined,
  };
}

export function decisionObject(row: HrmPersonnelDecision, people: HrmLinkablePeople): LinkableObject {
  return {
    ...decisionCandidate(row),
    launchUrl: hrmLaunchUrl(HRM_LINKABLE_KINDS.decision, row.id),
    fields: [
      text('decisionNo', 'Số quyết định', row.decisionNo),
      text('type', 'Loại quyết định', DECISION_TYPE_LABELS[row.decisionType] ?? row.decisionType),
      text('employee', 'Nhân viên', joined(' · ', row.employeeCode, row.employeeName) || null),
      date('effectiveDate', 'Ngày hiệu lực', row.effectiveDate),
      text('fromPosition', 'Chức danh cũ', joined(' — ', row.fromPositionName, row.fromUnitName) || null),
      text('toPosition', 'Chức danh mới', joined(' — ', row.toPositionName, row.toUnitName) || null),
      text('reason', 'Lý do', shorten(row.reason, 200)),
      text('status', 'Trạng thái', DECISION_STATUS_LABELS[row.status] ?? row.status),
      text('approvedBy', 'Người duyệt', personText(people.user(row.approvedBy))),
      date('approvedAt', 'Ngày duyệt', vnDate(row.approvedAt)),
    ],
    upstream: [],
  };
}
