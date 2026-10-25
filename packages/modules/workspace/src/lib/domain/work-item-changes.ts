import {
  STANDALONE_TASK_LOGGED_FIELDS,
  WORK_ITEM_LOGGED_FIELDS,
  type StandaloneTask,
  type StandaloneTaskFieldChange,
  type StandaloneTaskLoggedField,
  type WorkItem,
  type WorkItemFieldChange,
  type WorkItemLoggedField,
} from '@enterprise-platform/contracts-workspace';

type ChangeValue = WorkItemFieldChange['from'];

/** Phần chung của công việc dự án và việc ngoài dự án mà cách ghi tiến độ cần tới. */
interface ProgressLike {
  readonly progressPercent: number;
  readonly autoProgressPercent?: number;
  readonly progressManual?: boolean;
}

const LIST_FIELDS = new Set<string>(['participantUserIds', 'followerUserIds', 'tagIds']);

/** Giá trị của một trường để so và ghi nhật ký; danh sách được sắp xếp để đổi thứ tự không bị coi là sửa. */
function valueOf(item: ProgressLike & Record<string, unknown>, field: string): ChangeValue {
  if (LIST_FIELDS.has(field)) return [...((item[field] as readonly string[] | undefined) ?? [])].sort();
  if (field === 'manualProgressPercent') return item.progressManual ? item.progressPercent : null;
  // Có tiến độ nhập tay: cột tự tính do hệ thống ghi, không phải người sửa.
  if (field === 'progressPercent') return item.autoProgressPercent ?? item.progressPercent;
  const value = item[field];
  return value === undefined || value === '' ? null : (value as ChangeValue);
}

function same(left: ChangeValue, right: ChangeValue): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }
  return left === right;
}

function diff<TField extends string>(
  before: ProgressLike,
  after: ProgressLike,
  fields: readonly TField[],
): { field: TField; from: ChangeValue; to: ChangeValue }[] {
  const changes: { field: TField; from: ChangeValue; to: ChangeValue }[] = [];
  for (const field of fields) {
    const from = valueOf(before as ProgressLike & Record<string, unknown>, field);
    const to = valueOf(after as ProgressLike & Record<string, unknown>, field);
    if (!same(from, to)) changes.push({ field, from, to });
  }
  return changes;
}

/** Các trường người dùng vừa sửa trên một công việc, theo thứ tự `WORK_ITEM_LOGGED_FIELDS`. */
export function workItemChanges(before: WorkItem, after: WorkItem): WorkItemFieldChange[] {
  return diff<WorkItemLoggedField>(before, after, WORK_ITEM_LOGGED_FIELDS);
}

/** Các trường người dùng vừa sửa trên một việc ngoài dự án, theo thứ tự `STANDALONE_TASK_LOGGED_FIELDS`. */
export function standaloneTaskChanges(
  before: StandaloneTask,
  after: StandaloneTask,
): StandaloneTaskFieldChange[] {
  return diff<StandaloneTaskLoggedField>(before, after, STANDALONE_TASK_LOGGED_FIELDS);
}
