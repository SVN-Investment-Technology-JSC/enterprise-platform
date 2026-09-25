import {
  WORK_ITEM_PRIORITIES,
  type CalendarEvent,
  type MyWorkBucket,
  type MyWorkEvent,
  type MyWorkItem,
  type MyWorkSummary,
  type ParticipantResponse,
  type WorkItem,
} from '@enterprise-platform/contracts-workspace';
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

    const [assigned, completedThisWeek, myEvents, pendingInvitations, mentions, externalCards] =
      await Promise.all([
        this.store.myWork.assignedItems(actor.tenantId, actor.userId),
        this.store.myWork.completedCount(actor.tenantId, actor.userId, week.from, week.to),
        this.store.myWork.eventsForUser(actor.tenantId, actor.userId, today.from, today.to),
        this.store.myWork.pendingInvitations(actor.tenantId, actor.userId),
        this.store.myWork.mentions(actor.tenantId, actor.userId, MENTION_LIMIT),
        this.store.myWork.externalCards(actor.tenantId, actor.userId),
      ]);

    const items = bucketise(assigned, today.dateKey, week.dateKey, timezone, now);
    const todayEvents = await this.expandToday(actor, myEvents, today.from, today.to);

    return {
      counters: {
        openItems: items.length,
        overdueItems: items.filter((entry) => entry.bucket === 'overdue').length,
        dueToday: items.filter((entry) => entry.bucket === 'today').length,
        completedThisWeek,
      },
      items,
      todayEvents,
      pendingInvitations,
      mentions,
      externalCards,
      timezone,
      today: todayKey(timezone, now),
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

function bucketOf(item: WorkItem, todayDateKey: string, weekEndKey: string): MyWorkBucket {
  const due = item.plannedEnd?.slice(0, 10);
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
