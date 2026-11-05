import {
  MY_WORK_BUCKETS,
  MY_WORK_DEFAULT_PAGE_SIZE,
  MY_WORK_SORTS,
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_STATUSES,
  type CalendarEvent,
  type MyWorkBucket,
  type MyWorkCounters,
  type MyWorkEvent,
  type MyWorkFilterOptions,
  type MyWorkGroupCounts,
  type MyWorkGroupSummary,
  type MyWorkItem,
  type MyWorkItemsPage,
  type MyWorkOverview,
  type MyWorkSortKey,
  type MyWorkStandalonePage,
  type MyWorkStandaloneTask,
  type MyWorkSummary,
  type StandaloneTask,
  type ParticipantResponse,
  type WorkItem,
  type WorkItemPriority,
  type WorkItemStatus,
} from '@enterprise-platform/contracts-workspace';
import { standaloneTaskRoleOf } from '../domain/standalone-task.rules.js';
import { WorkspaceValidationError } from '../domain/workspace.error.js';
import { dayWindow, timezoneOf, todayKey, weekWindow } from '../domain/tenant-time.js';
import { buildOccurrences } from './calendar.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { MyWorkAssignedRow, WorkspaceStore } from './workspace-store.port.js';

const MENTION_LIMIT = 20;

/**
 * Thứ tự ưu tiên khi sắp xếp, từ khẩn nhất xuống.
 *
 * Suy từ `WORK_ITEM_PRIORITIES` thay vì gõ tay: thêm một mức ưu tiên mới mà
 * quên cập nhật ở đây sẽ khiến nó rơi xuống cuối danh sách không rõ lý do.
 */
const PRIORITY_RANK = new Map<string, number>(
  [...WORK_ITEM_PRIORITIES].reverse().map((priority, index) => [priority, index]),
);

/** Thứ tự hiển thị các nhóm. Quá hạn luôn đứng đầu. */
const BUCKET_RANK: Record<MyWorkBucket, number> = {
  overdue: 0,
  today: 1,
  this_week: 2,
  later: 3,
  no_due: 4,
};

/**
 * Trang "Công việc của tôi".
 *
 * **Không có bảng dữ liệu riêng** — đây là lớp truy vấn tổng hợp trên dữ liệu
 * đã có. Bảng tổng hợp sẵn sẽ cần đồng bộ, và đồng bộ thì có độ trễ: đổi
 * trạng thái một việc rồi quay lại màn này mà chưa thấy cập nhật là lỗi trải
 * nghiệm nghiêm trọng.
 *
 * **Ràng buộc bảo mật tuyệt đối:** mọi truy vấn lọc theo `actor.userId` do
 * guard gắn vào request. Service này KHÔNG có tham số `userId` ở bất kỳ
 * phương thức nào, nên không có đường nào để một id từ client lọt vào. Kể cả
 * `tenant-admin` cũng chỉ thấy việc của chính mình — đây là ngoại lệ duy
 * nhất của cơ chế override toàn tenant.
 */
export class MyWorkService {
  constructor(private readonly store: WorkspaceStore) {}

  async summary(actor: WorkspaceActor, now: Date = new Date()): Promise<MyWorkSummary> {
    const timezone = timezoneOf(actor.tenantId);
    const today = dayWindow(now, timezone);
    const week = weekWindow(timezone, now);

    const [
      assigned,
      completedThisWeek,
      myEvents,
      pendingInvitations,
      mentions,
      externalCards,
      tasks,
    ] = await Promise.all([
      this.store.myWork.assignedItems(actor.tenantId, actor.userId),
      this.store.myWork.completedCount(actor.tenantId, actor.userId, week.from, week.to),
      this.store.myWork.eventsForUser(actor.tenantId, actor.userId, today.from, today.to),
      this.store.myWork.pendingInvitations(actor.tenantId, actor.userId),
      this.store.myWork.mentions(actor.tenantId, actor.userId, MENTION_LIMIT),
      this.store.myWork.externalCards(actor.tenantId, actor.userId),
      this.store.standaloneTask.forMyWork(actor.tenantId, actor.userId),
    ]);

    const items = bucketise(assigned, today.dateKey, week.dateKey, timezone, now);
    const standaloneTasks = bucketiseTasks(
      tasks,
      actor.userId,
      today.dateKey,
      week.dateKey,
      timezone,
      now,
    );
    const todayEvents = await this.expandToday(actor, myEvents, today.from, today.to);

    return {
      counters: countersOf(items, standaloneTasks, completedThisWeek),
      items,
      todayEvents,
      pendingInvitations,
      mentions,
      externalCards,
      standaloneTasks,
      timezone,
      today: todayKey(timezone, now),
    };
  }

  /**
   * Tổng quan trang "Công việc của tôi": số liệu, tóm tắt từng nhóm dự án, nhắc tên, thẻ module khác.
   *
   * Không có dòng việc nào trong kết quả; dòng việc lấy theo trang ở `groupItems` và `standalonePage`, để
   * dự án có hàng trăm việc không làm phình phản hồi. Số liệu đầu trang và `filterOptions` KHÔNG chịu bộ lọc.
   */
  async overview(
    actor: WorkspaceActor,
    rawFilter: RawMyWorkFilter = {},
    rawSort?: string,
    now: Date = new Date(),
  ): Promise<MyWorkOverview> {
    const timezone = timezoneOf(actor.tenantId);
    const today = dayWindow(now, timezone);
    const week = weekWindow(timezone, now);

    const [assigned, completedThisWeek, myEvents, pendingInvitations, mentions, externalCards, tasks] =
      await Promise.all([
        this.store.myWork.assignedItems(actor.tenantId, actor.userId),
        this.store.myWork.completedCount(actor.tenantId, actor.userId, week.from, week.to),
        this.store.myWork.eventsForUser(actor.tenantId, actor.userId, today.from, today.to),
        this.store.myWork.pendingInvitations(actor.tenantId, actor.userId),
        this.store.myWork.mentions(actor.tenantId, actor.userId, MENTION_LIMIT),
        this.store.myWork.externalCards(actor.tenantId, actor.userId),
        this.store.standaloneTask.forMyWork(actor.tenantId, actor.userId),
      ]);

    const filter = parseFilter(rawFilter);
    const sort = parseSort(rawSort);

    const items = bucketise(assigned, today.dateKey, week.dateKey, timezone, now);
    const standaloneTasks = bucketiseTasks(
      tasks,
      actor.userId,
      today.dateKey,
      week.dateKey,
      timezone,
      now,
    );
    const todayEvents = await this.expandToday(actor, myEvents, today.from, today.to);

    const matching = items.filter((entry) => matchesFilter(entry, filter));

    return {
      counters: countersOf(items, standaloneTasks, completedThisWeek),
      groups: summarizeGroups(matching, sort),
      standalone: {
        total: standaloneTasks.length,
        counts: countsOf(standaloneTasks, (entry) => entry.task.status, (entry) => entry.bucket),
      },
      filterOptions: filterOptionsOf(assigned),
      todayEvents,
      pendingInvitations,
      mentions,
      externalCards,
      timezone,
      today: todayKey(timezone, now),
    };
  }

  /**
   * Một trang dòng việc của MỘT dự án trong số việc của chính tôi.
   *
   * `projectId` chỉ là bộ lọc trên tập việc của tôi, không phải khoá truy cập: dự án mà tôi không có việc
   * thì ra trang rỗng, không lỗi và không lộ dự án đó có tồn tại hay không.
   */
  async groupItems(
    actor: WorkspaceActor,
    projectId: string,
    rawFilter: RawMyWorkFilter = {},
    rawSort?: string,
    rawPage?: unknown,
    rawPageSize?: unknown,
    now: Date = new Date(),
  ): Promise<MyWorkItemsPage> {
    const timezone = timezoneOf(actor.tenantId);
    const today = dayWindow(now, timezone);
    const week = weekWindow(timezone, now);

    const assigned = await this.store.myWork.assignedItems(actor.tenantId, actor.userId);
    const filter = parseFilter(rawFilter);
    const sort = parseSort(rawSort);
    const page = parsePage(rawPage);
    const pageSize = parsePageSize(rawPageSize);

    // Lọc theo dự án và bộ lọc trước khi xếp: chỉ xếp phần cần dùng.
    const mine = assigned.filter(
      (row) =>
        row.item.projectId === projectId &&
        (!filter.status || row.item.status === filter.status) &&
        (!filter.priority || row.item.priority === filter.priority),
    );
    // Cách xếp khác `due` hoà nhau thì xếp tiếp theo id: phân trang bằng offset cần thứ tự xác định, nếu không hai lần gọi
    // có thể trả cùng một dòng ở hai trang hoặc bỏ sót dòng.
    const rows = bucketise(mine, today.dateKey, week.dateKey, timezone, now).sort(
      sort === 'due'
        ? ITEM_ORDER.due
        : (left, right) => ITEM_ORDER[sort](left, right) || left.item.id.localeCompare(right.item.id),
    );

    return {
      items: rows.slice((page - 1) * pageSize, page * pageSize),
      total: rows.length,
      page,
      pageSize,
    };
  }

  /** Một trang việc ngoài dự án của tôi, xếp theo cùng cách với việc dự án. */
  async standalonePage(
    actor: WorkspaceActor,
    rawSort?: string,
    rawPage?: unknown,
    rawPageSize?: unknown,
    now: Date = new Date(),
  ): Promise<MyWorkStandalonePage> {
    const timezone = timezoneOf(actor.tenantId);
    const today = dayWindow(now, timezone);
    const week = weekWindow(timezone, now);

    const sort = parseSort(rawSort);
    const page = parsePage(rawPage);
    const pageSize = parsePageSize(rawPageSize);

    const tasks = await this.store.standaloneTask.forMyWork(actor.tenantId, actor.userId);
    const rows = bucketiseTasks(tasks, actor.userId, today.dateKey, week.dateKey, timezone, now);
    // `due` giữ thứ tự của bucketiseTasks (nhóm hạn, chờ duyệt, ưu tiên, hạn).
    if (sort !== 'due') {
      rows.sort((left, right) => TASK_ORDER[sort](left, right) || left.task.id.localeCompare(right.task.id));
    }

    return {
      items: rows.slice((page - 1) * pageSize, page * pageSize),
      total: rows.length,
      page,
      pageSize,
    };
  }

  /**
   * Khai triển sự kiện của tôi thành các buổi rơi vào hôm nay.
   *
   * Dùng đúng `buildOccurrences` của tab Lịch biểu, để hai màn không bao giờ
   * nói hai điều khác nhau về cùng một ngày: chuỗi lặp ra đúng buổi, buổi bị
   * huỷ riêng thì biến mất, buổi bị dời thì hiện ở giờ mới.
   */
  private async expandToday(
    actor: WorkspaceActor,
    rows: readonly { readonly event: CalendarEvent; readonly responseStatus: ParticipantResponse }[],
    from: Date,
    to: Date,
  ): Promise<MyWorkEvent[]> {
    if (rows.length === 0) return [];
    const responseOf = new Map(rows.map((row) => [row.event.id, row.responseStatus]));
    const seriesIds = [
      ...new Set(rows.map((row) => row.event.seriesId).filter(Boolean) as string[]),
    ];
    const exceptions =
      seriesIds.length > 0
        ? await this.store.calendar.listExceptions(actor.tenantId, seriesIds)
        : [];

    return buildOccurrences(
      rows.map((row) => row.event),
      exceptions,
      from,
      to,
    ).map((occurrence) => ({
      eventId: occurrence.eventId,
      title: occurrence.title,
      startAt: occurrence.startAt,
      endAt: occurrence.endAt,
      allDay: occurrence.allDay,
      location: occurrence.location,
      projectId: occurrence.projectId,
      responseStatus: responseOf.get(occurrence.eventId) ?? 'needs_action',
    }));
  }
}

/**
 * Xếp việc vào nhóm theo hạn, rồi sắp trong nhóm.
 *
 * Nhóm theo hạn chứ không theo dự án: người dùng mở màn này để biết "hôm nay
 * làm gì", nên trục thời gian mới là thứ đáng chia nhóm.
 *
 * Trong cùng một nhóm, ưu tiên cao đứng trước; cùng mức ưu tiên thì hạn gần
 * hơn đứng trước. Ngược lại sẽ có chuyện việc khẩn cấp nằm dưới một việc
 * thường chỉ vì hạn sớm hơn một ngày.
 */
export function bucketise(
  rows: readonly MyWorkAssignedRow[],
  todayDateKey: string,
  weekStartKey: string,
  timezone: string,
  now: Date,
): MyWorkItem[] {
  // Cuối tuần tính theo cùng múi giờ với "hôm nay", nếu không ranh giới
  // "tuần này" và "sau này" sẽ lệch nhau vài tiếng.
  const weekEndKey = dayWindow(now, timezone, 6 - daysSince(weekStartKey, todayDateKey)).dateKey;

  const entries = rows.map<MyWorkItem>((row) => ({
    item: row.item,
    projectCode: row.projectCode,
    projectName: row.projectName,
    bucket: bucketOf(row.item, todayDateKey, weekEndKey),
  }));

  return entries.sort((left, right) => {
    const byBucket = BUCKET_RANK[left.bucket] - BUCKET_RANK[right.bucket];
    if (byBucket !== 0) return byBucket;

    const byPriority =
      (PRIORITY_RANK.get(left.item.priority) ?? 99) - (PRIORITY_RANK.get(right.item.priority) ?? 99);
    if (byPriority !== 0) return byPriority;

    // Việc không có hạn xếp cuối cùng trong nhóm của nó.
    return (left.item.plannedEnd ?? '9999-12-31').localeCompare(
      right.item.plannedEnd ?? '9999-12-31',
    );
  });
}

/**
 * Việc ngoài dự án cho trang "Công việc của tôi": cùng cách chia nhóm theo hạn
 * như việc dự án. Việc chờ tôi duyệt đứng đầu nhóm của nó — nó đang chặn
 * người khác.
 */
export function bucketiseTasks(
  tasks: readonly StandaloneTask[],
  userId: string,
  todayDateKey: string,
  weekStartKey: string,
  timezone: string,
  now: Date,
): MyWorkStandaloneTask[] {
  const weekEndKey = dayWindow(now, timezone, 6 - daysSince(weekStartKey, todayDateKey)).dateKey;

  const entries = tasks.map<MyWorkStandaloneTask>((task) => {
    const myRole = standaloneTaskRoleOf(task, userId) ?? 'follower';
    return {
      task,
      myRole,
      awaitingMyApproval:
        myRole === 'assigner' && task.status === 'review' && task.assigneeUserId !== userId,
      bucket: bucketOfDue(task.dueDate, todayDateKey, weekEndKey),
    };
  });

  return entries.sort((left, right) => {
    const byBucket = BUCKET_RANK[left.bucket] - BUCKET_RANK[right.bucket];
    if (byBucket !== 0) return byBucket;
    if (left.awaitingMyApproval !== right.awaitingMyApproval) {
      return left.awaitingMyApproval ? -1 : 1;
    }
    const byPriority =
      (PRIORITY_RANK.get(left.task.priority) ?? 99) - (PRIORITY_RANK.get(right.task.priority) ?? 99);
    if (byPriority !== 0) return byPriority;
    return (left.task.dueDate ?? '9999-12-31').localeCompare(right.task.dueDate ?? '9999-12-31');
  });
}

function bucketOf(item: WorkItem, todayDateKey: string, weekEndKey: string): MyWorkBucket {
  return bucketOfDue(item.plannedEnd, todayDateKey, weekEndKey);
}

function bucketOfDue(
  dueDate: string | undefined,
  todayDateKey: string,
  weekEndKey: string,
): MyWorkBucket {
  const due = dueDate?.slice(0, 10);
  if (!due) return 'no_due';
  if (due < todayDateKey) return 'overdue';
  if (due === todayDateKey) return 'today';
  return due <= weekEndKey ? 'this_week' : 'later';
}

/** Số ngày giữa hai khoá `YYYY-MM-DD`; cả hai đều là ngày lịch, không giờ. */
function daysSince(fromKey: string, toKey: string): number {
  const parse = (key: string) => {
    const [year, month, day] = key.split('-').map(Number);
    return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);
  };
  return Math.round((parse(toKey) - parse(fromKey)) / 86_400_000);
}

/* -------------------------------------------------------------------------
   Trang "Công việc của tôi" theo trang: bộ lọc, thứ tự, tóm tắt nhóm
   ------------------------------------------------------------------------- */

/** Bộ lọc thô từ query string; service tự kiểm giá trị. */
export interface RawMyWorkFilter {
  readonly status?: unknown;
  readonly priority?: unknown;
  readonly projectId?: unknown;
}

interface ParsedFilter {
  status?: WorkItemStatus;
  priority?: WorkItemPriority;
  projectId?: string;
}

const MAX_PAGE_SIZE = 100;
const CLOSED_STATUSES = new Set<string>(['done', 'cancelled']);
const ACTIVE_STATUSES = new Set<string>(['in_progress', 'blocked', 'review']);

const byCode = (left: string, right: string) => left.localeCompare(right, 'vi', { numeric: true });
const bucketRank = (entry: { readonly bucket: MyWorkBucket }) => MY_WORK_BUCKETS.indexOf(entry.bucket);

/**
 * Thứ tự dòng việc trong một nhóm, theo cách xếp. `Array.sort` ổn định nên `due` giữ thứ tự của `bucketise`
 * (nhóm hạn, ưu tiên, hạn) và các cách xếp còn lại hoà nhau theo thứ tự đó.
 */
const ITEM_ORDER: Record<MyWorkSortKey, (left: MyWorkItem, right: MyWorkItem) => number> = {
  due: (left, right) => bucketRank(left) - bucketRank(right),
  name: (left, right) => left.item.title.localeCompare(right.item.title, 'vi'),
  code: (left, right) => byCode(left.item.code, right.item.code),
  updated: (left, right) => right.item.updatedAt.localeCompare(left.item.updatedAt),
};

const TASK_ORDER: Record<
  MyWorkSortKey,
  (left: MyWorkStandaloneTask, right: MyWorkStandaloneTask) => number
> = {
  due: (left, right) => bucketRank(left) - bucketRank(right),
  name: (left, right) => left.task.title.localeCompare(right.task.title, 'vi'),
  code: (left, right) => byCode(left.task.code, right.task.code),
  updated: (left, right) => right.task.updatedAt.localeCompare(left.task.updatedAt),
};

/** Chuỗi query rỗng hoặc vắng đều nghĩa là "không đặt". */
function textOf(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new WorkspaceValidationError(`${label} không hợp lệ.`);
  return value.trim() || undefined;
}

function parseSort(raw: unknown): MyWorkSortKey {
  const value = textOf(raw, 'Cách sắp xếp');
  if (value === undefined) return 'due';
  if (!(MY_WORK_SORTS as readonly string[]).includes(value)) {
    throw new WorkspaceValidationError('Cách sắp xếp không hợp lệ.');
  }
  return value as MyWorkSortKey;
}

function parseFilter(raw: RawMyWorkFilter): ParsedFilter {
  const status = textOf(raw.status, 'Trạng thái');
  if (status !== undefined && !(WORK_ITEM_STATUSES as readonly string[]).includes(status)) {
    throw new WorkspaceValidationError('Trạng thái lọc không hợp lệ.');
  }
  const priority = textOf(raw.priority, 'Mức ưu tiên');
  // Mức ưu tiên lọc không có trong danh mục (đã bị xoá, hoặc người dùng không còn việc mức đó) thì chỉ cho kết quả rỗng: ném
  // lỗi sẽ làm kẹt trang khi giao diện còn nhớ bộ lọc cũ trong bộ nhớ đệm.
  return {
    status: status as WorkItemStatus | undefined,
    priority,
    projectId: textOf(raw.projectId, 'Dự án'),
  };
}

/** Số nguyên từ query; không phải số hữu hạn thì `undefined`. */
function integerOf(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.floor(value) : undefined;
}

/** Trang tính từ 1; thiếu, sai hoặc nhỏ hơn 1 thì về trang 1. */
function parsePage(raw: unknown): number {
  return Math.max(1, integerOf(raw) ?? 1);
}

/** Thiếu, sai hoặc nhỏ hơn 1 thì dùng cỡ mặc định (không phải 1: sẽ bắt giao diện gọi từng dòng); lớn quá thì kẹp. */
function parsePageSize(raw: unknown): number {
  const value = integerOf(raw);
  return Math.min(MAX_PAGE_SIZE, value === undefined || value < 1 ? MY_WORK_DEFAULT_PAGE_SIZE : value);
}

function matchesFilter(entry: MyWorkItem, filter: ParsedFilter): boolean {
  return (
    (!filter.status || entry.item.status === filter.status) &&
    (!filter.priority || entry.item.priority === filter.priority) &&
    (!filter.projectId || entry.item.projectId === filter.projectId)
  );
}

/** Bốn con số đầu trang. Đếm việc tôi phải LÀM; việc chờ tôi duyệt không tính. */
function countersOf(
  items: readonly MyWorkItem[],
  standaloneTasks: readonly MyWorkStandaloneTask[],
  completedThisWeek: number,
): MyWorkCounters {
  const buckets = [
    ...items.map((entry) => entry.bucket),
    ...standaloneTasks.filter((entry) => !entry.awaitingMyApproval).map((entry) => entry.bucket),
  ];
  return {
    openItems: buckets.length,
    overdueItems: buckets.filter((bucket) => bucket === 'overdue').length,
    dueToday: buckets.filter((bucket) => bucket === 'today').length,
    completedThisWeek,
  };
}

/** Đếm bốn loại trên dòng tóm tắt, một lượt trên mảng. */
function countsOf<T>(
  rows: readonly T[],
  statusOf: (row: T) => string,
  bucketOf: (row: T) => MyWorkBucket,
): MyWorkGroupCounts {
  let overdue = 0;
  let notStarted = 0;
  let active = 0;
  let finished = 0;
  for (const row of rows) {
    const status = statusOf(row);
    if (bucketOf(row) === 'overdue') overdue += 1;
    if (status === 'todo') notStarted += 1;
    else if (ACTIVE_STATUSES.has(status)) active += 1;
    else if (status === 'done') finished += 1;
  }
  return { overdue, notStarted, active, finished };
}

/** Mức ưu tiên càng cao càng lớn; mức tenant tự thêm (ngoài danh mục gốc) thấp hơn mọi mức có sẵn. */
const priorityWeight = (priority: string) =>
  (WORK_ITEM_PRIORITIES as readonly string[]).indexOf(priority);

interface GroupAccumulator {
  projectId: string;
  projectCode: string;
  projectName: string;
  total: number;
  overdue: number;
  notStarted: number;
  active: number;
  finished: number;
  topPriority?: WorkItemPriority;
  topWeight: number;
  topCount: number;
  nextDue?: string;
  progressSum: number;
  latestUpdate: string;
}

/**
 * Tóm tắt từng nhóm dự án trong MỘT lượt trên mảng đã lọc, rồi xếp nhóm.
 *
 * Mức ưu tiên cao nhất, số việc cùng mức và hạn gần nhất chỉ tính trên việc còn mở (không `done`, không
 * `cancelled`); tiến độ là trung bình mọi việc khớp bộ lọc, làm tròn. Cách tính giống `summarizeGroup` ở giao diện.
 */
function summarizeGroups(
  matching: readonly MyWorkItem[],
  sort: MyWorkSortKey,
): MyWorkGroupSummary[] {
  const groups = new Map<string, GroupAccumulator>();
  for (const entry of matching) {
    const { item } = entry;
    let group = groups.get(item.projectId);
    if (!group) {
      group = {
        projectId: item.projectId,
        projectCode: entry.projectCode,
        projectName: entry.projectName,
        total: 0,
        overdue: 0,
        notStarted: 0,
        active: 0,
        finished: 0,
        topWeight: -2,
        topCount: 0,
        progressSum: 0,
        latestUpdate: '',
      };
      groups.set(item.projectId, group);
    }
    group.total += 1;
    group.progressSum += item.progressPercent ?? 0;
    if (item.updatedAt > group.latestUpdate) group.latestUpdate = item.updatedAt;
    if (entry.bucket === 'overdue') group.overdue += 1;
    if (item.status === 'todo') group.notStarted += 1;
    else if (ACTIVE_STATUSES.has(item.status)) group.active += 1;
    else if (item.status === 'done') group.finished += 1;

    if (CLOSED_STATUSES.has(item.status)) continue;
    const weight = priorityWeight(item.priority);
    if (weight > group.topWeight) {
      group.topPriority = item.priority;
      group.topWeight = weight;
      group.topCount = 1;
    } else if (item.priority === group.topPriority) {
      group.topCount += 1;
    }
    if (item.plannedEnd && (!group.nextDue || item.plannedEnd < group.nextDue)) {
      group.nextDue = item.plannedEnd;
    }
  }

  const order: Record<MyWorkSortKey, (left: GroupAccumulator, right: GroupAccumulator) => number> = {
    due: (left, right) =>
      Number(right.overdue > 0) - Number(left.overdue > 0) || byCode(left.projectCode, right.projectCode),
    name: (left, right) => left.projectName.localeCompare(right.projectName, 'vi'),
    code: (left, right) => byCode(left.projectCode, right.projectCode),
    updated: (left, right) => right.latestUpdate.localeCompare(left.latestUpdate),
  };

  return [...groups.values()].sort(order[sort]).map((group) => ({
    projectId: group.projectId,
    projectCode: group.projectCode,
    projectName: group.projectName,
    total: group.total,
    counts: {
      overdue: group.overdue,
      notStarted: group.notStarted,
      active: group.active,
      finished: group.finished,
    },
    topPriority: group.topPriority,
    topPriorityCount: group.topCount,
    nextDue: group.nextDue,
    progress: group.total ? Math.round(group.progressSum / group.total) : 0,
  }));
}

/** Lựa chọn cho các ô lọc, rút từ MỌI việc của tôi (không phụ thuộc bộ lọc đang bật). */
function filterOptionsOf(assigned: readonly MyWorkAssignedRow[]): MyWorkFilterOptions {
  const statuses = new Set<string>();
  const priorities = new Set<string>();
  const projects = new Map<string, { id: string; code: string; name: string }>();
  for (const row of assigned) {
    statuses.add(row.item.status);
    priorities.add(row.item.priority);
    if (!projects.has(row.item.projectId)) {
      projects.set(row.item.projectId, {
        id: row.item.projectId,
        code: row.projectCode,
        name: row.projectName,
      });
    }
  }
  // Trạng thái và mức có sẵn theo thứ tự danh mục; mức tenant tự thêm đứng sau, theo thứ tự gặp.
  const customPriorities = [...priorities].filter(
    (priority) => !(WORK_ITEM_PRIORITIES as readonly string[]).includes(priority),
  );
  return {
    statuses: WORK_ITEM_STATUSES.filter((status) => statuses.has(status)),
    priorities: [
      ...WORK_ITEM_PRIORITIES.filter((priority) => priorities.has(priority)),
      ...customPriorities,
    ],
    projects: [...projects.values()].sort((left, right) => byCode(left.code, right.code)),
  };
}
