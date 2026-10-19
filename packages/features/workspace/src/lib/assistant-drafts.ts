import {
  EVENT_TYPES,
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_TYPES,
  type CreateEventRequest,
  type CreateStandaloneTaskRequest,
  type CreateWorkItemRequest,
  type EventType,
  type WorkItemPriority,
  type WorkItemType,
} from '@enterprise-platform/contracts-workspace';
import type { WorkspaceStatus } from './workspace-api';

/**
 * Đổi bản nháp của Trợ lý (theo tên trường của request API) thành giá trị ô của form tạo sẵn có.
 *
 * Chỉ trả những ô có trong bản nháp và hợp lệ; giá trị sai kiểu bị bỏ qua để form kiểm như khi người dùng tự nhập.
 * Form đang mở gộp kết quả vào trạng thái hiện tại, nên ô không có ở đây giữ nguyên những gì người dùng đã sửa.
 */

export type AssistantDraft<TRequest> = { readonly [K in keyof TRequest]?: unknown };

/** Ô của form sự kiện (`EventForm`). */
export interface EventPrefill {
  title?: string;
  description?: string;
  location?: string;
  eventType?: EventType;
  date?: string;
  startTime?: string;
  endTime?: string;
  allDay?: boolean;
  participantUserIds?: string[];
}

/** Ô của form công việc dự án (`WorkItemForm`, tạo mới). */
export interface WorkItemPrefill {
  projectId?: string;
  title?: string;
  description?: string;
  itemType?: WorkItemType;
  priority?: WorkItemPriority;
  assigneeUserId?: string;
  participantUserIds?: string[];
  plannedStart?: string;
  plannedEnd?: string;
  estimateHours?: string;
}

/** Ô của form giao việc ngoài dự án (`StandaloneTaskForm`, tạo mới). */
export interface StandaloneTaskPrefill {
  title?: string;
  description?: string;
  priority?: WorkItemPriority;
  assigneeUserId?: string;
  participantUserIds?: string[];
  followerUserIds?: string[];
  plannedStart?: string;
  dueDate?: string;
}

/** Bản gộp ô mới vào form đang mở; `seq` tăng mỗi lần Trợ lý gửi bản nháp. */
export interface FormPrefill<TValues> {
  readonly values: TValues;
  readonly seq: number;
}

const DEFAULT_EVENT_MINUTES = 60;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function oneOf<T extends string>(values: readonly T[], value: unknown): T | undefined {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** Mảng mã không rỗng, bỏ trùng; vắng hoặc sai kiểu là `undefined`. */
export function idList(value: unknown, exclude: readonly string[] = []): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = value.filter(
    (id): id is string => typeof id === 'string' && id.trim() !== '' && !exclude.includes(id),
  );
  return [...new Set(ids)];
}

function instant(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Ngày `YYYY-MM-DD` theo giờ trình duyệt, như ô ngày của form. */
export function localDate(value: Date): string {
  return `${String(value.getFullYear()).padStart(4, '0')}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function localTime(value: Date): string {
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

/** `YYYY-MM-DD`, hoặc mốc ISO đổi về ngày theo giờ trình duyệt. */
function dateValue(value: unknown): string | undefined {
  if (typeof value === 'string' && DATE_ONLY.test(value)) {
    return Number.isFinite(Date.parse(`${value}T00:00:00`)) ? value : undefined;
  }
  const parsed = instant(value);
  return parsed ? localDate(parsed) : undefined;
}

export function eventDraftToForm(
  draft: AssistantDraft<CreateEventRequest>,
  options: { readonly organizerUserId?: string } = {},
): EventPrefill {
  const values: EventPrefill = {};
  const title = text(draft.title);
  if (title) values.title = title;
  const description = text(draft.description);
  if (description) values.description = description;
  const location = text(draft.location);
  if (location) values.location = location;
  const eventType = oneOf(EVENT_TYPES, draft.eventType);
  if (eventType) values.eventType = eventType;
  if (typeof draft.allDay === 'boolean') values.allDay = draft.allDay;

  const start = instant(draft.startAt);
  const end = instant(draft.endAt);
  if (start) {
    values.date = localDate(start);
    values.startTime = localTime(start);
    // Không nói giờ kết thúc: một tiếng sau giờ bắt đầu, không vượt qua nửa đêm (form chỉ có một ngày).
    const fallback = new Date(start.getTime() + DEFAULT_EVENT_MINUTES * 60_000);
    const until = end && end > start ? end : fallback;
    values.endTime = localDate(until) === values.date ? localTime(until) : '23:59';
  } else if (end) {
    values.endTime = localTime(end);
  }

  const participants = idList(
    draft.participantUserIds,
    options.organizerUserId ? [options.organizerUserId] : [],
  );
  if (participants) values.participantUserIds = participants;
  return values;
}

export function workItemDraftToForm(
  draft: AssistantDraft<CreateWorkItemRequest>,
  options: { readonly defaultAssigneeUserId?: string } = {},
): WorkItemPrefill {
  const values: WorkItemPrefill = {};
  const projectId = text(draft.projectId);
  if (projectId) values.projectId = projectId;
  const title = text(draft.title);
  if (title) values.title = title;
  const description = text(draft.description);
  if (description) values.description = description;
  const itemType = oneOf(WORK_ITEM_TYPES, draft.itemType);
  if (itemType) values.itemType = itemType;
  const priority = oneOf(WORK_ITEM_PRIORITIES, draft.priority);
  if (priority) values.priority = priority;
  const assignee = text(draft.assigneeUserId) ?? options.defaultAssigneeUserId;
  if (assignee) values.assigneeUserId = assignee;
  const participants = idList(draft.participantUserIds, assignee ? [assignee] : []);
  if (participants) values.participantUserIds = participants;
  const plannedStart = dateValue(draft.plannedStart);
  if (plannedStart) values.plannedStart = plannedStart;
  const plannedEnd = dateValue(draft.plannedEnd);
  if (plannedEnd) values.plannedEnd = plannedEnd;
  const hours = typeof draft.estimateHours === 'string' ? Number(draft.estimateHours) : draft.estimateHours;
  if (typeof hours === 'number' && Number.isFinite(hours) && hours >= 0) {
    values.estimateHours = String(hours);
  }
  return values;
}

export function standaloneTaskDraftToForm(
  draft: AssistantDraft<CreateStandaloneTaskRequest>,
  options: { readonly defaultAssigneeUserId?: string } = {},
): StandaloneTaskPrefill {
  const values: StandaloneTaskPrefill = {};
  const title = text(draft.title);
  if (title) values.title = title;
  const description = text(draft.description);
  if (description) values.description = description;
  const priority = oneOf(WORK_ITEM_PRIORITIES, draft.priority);
  if (priority) values.priority = priority;
  const assignee = text(draft.assigneeUserId) ?? options.defaultAssigneeUserId;
  if (assignee) values.assigneeUserId = assignee;
  // Một người chỉ giữ một vai, như khi chọn trên form.
  const participants = idList(draft.participantUserIds, assignee ? [assignee] : []);
  if (participants) values.participantUserIds = participants;
  const followers = idList(draft.followerUserIds, [
    ...(assignee ? [assignee] : []),
    ...(participants ?? []),
  ]);
  if (followers) values.followerUserIds = followers;
  const plannedStart = dateValue(draft.plannedStart);
  if (plannedStart) values.plannedStart = plannedStart;
  const dueDate = dateValue(draft.dueDate);
  if (dueDate) values.dueDate = dueDate;
  return values;
}

/**
 * Lý do người dùng chưa tạo được gì ở Workspace, báo về card Trợ lý thay vì mở form: dữ liệu của tenant đang khởi
 * tạo, hoặc thiếu quyền ghi dự án và công việc. Chưa biết trạng thái thì không chặn, server vẫn kiểm khi lưu.
 */
export function assistantUnavailableReason(
  status: WorkspaceStatus | undefined,
): string | undefined {
  if (!status) return undefined;
  if (!status.tablesReady) {
    return 'Dữ liệu Không gian làm việc đang được khởi tạo, chưa tạo được bản ghi.';
  }
  const capabilities = status.capabilities;
  if (capabilities && !capabilities.canWriteTasks && !capabilities.isTenantAdmin) {
    return 'Bạn không có quyền ghi dự án và công việc.';
  }
  return undefined;
}

/** Đường dẫn trong ERP mở bản ghi vừa tạo, cùng dạng với link trong thông báo. */
export const workspaceHref = {
  event: (eventId: string, projectId?: string) =>
    projectId
      ? `/modules/workspace?project=${encodeURIComponent(projectId)}#projects/calendar/${eventId}`
      : // Sự kiện cá nhân không có trang riêng; nó hiện ở lịch hôm nay của "Công việc của tôi".
        '/modules/workspace#my-work',
  workItem: (workItemId: string, projectId: string) =>
    `/modules/workspace?project=${encodeURIComponent(projectId)}#projects/work-item/${workItemId}`,
  standaloneTask: (taskId: string) => `/modules/workspace#tasks/${taskId}`,
};
