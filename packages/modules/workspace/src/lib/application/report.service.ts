import {
  MAX_REPORT_RANGE_DAYS,
  REPORT_ITEM_KINDS,
  REPORT_NO_GROUP,
  type ReportBundle,
  type ReportItemKind,
  type ReportItemList,
  type ReportScope,
} from '@enterprise-platform/contracts-workspace';
import { aggregateFinance, computeFinance } from '../domain/finance.rules.js';
import { granularityFor, previousWindow } from '../domain/report-period.js';
import { dayWindow, timezoneOf, todayKey, weekWindow } from '../domain/tenant-time.js';
import {
  ProjectForbiddenError,
  RangeTooWideError,
  ReportTimeoutError,
  WorkspaceValidationError,
} from '../domain/workspace.error.js';
import type { WorkspaceActor } from './workspace.application.js';
import type {
  ReportAnalyticsQuery,
  ReportScopeFilter,
  WorkspaceStore,
} from './workspace-store.port.js';

/**
 * Trần thời gian cho một lượt dựng báo cáo.
 *
 * Các truy vấn chạy song song; nếu tổng vượt ngưỡng này thì trả
 * `REPORT_TIMEOUT` thay vì để request treo.
 */
const REPORT_TIMEOUT_SECONDS = 5;

/** Số dòng tối đa của bảng quá hạn. Dài hơn thì bảng không ai đọc nổi. */
const OVERDUE_LIMIT = 500;

const MS_PER_DAY = 86_400_000;

/** Số dòng tối đa của danh sách chi tiết khi bấm một con số. */
const ITEM_LIST_LIMIT = 500;

/** Tham số truy vấn báo cáo, đọc thẳng từ query string. */
export interface ReportQuery {
  readonly from?: string;
  readonly to?: string;
  readonly projectIds?: string;
  /** Tên nhóm dự án, cách nhau dấu phẩy; `REPORT_NO_GROUP` là "Chưa phân nhóm". */
  readonly groups?: string;
  readonly tagIds?: string;
  /** Người phụ trách hoặc cùng làm. */
  readonly userId?: string;
}

/** Danh sách chi tiết khi bấm một con số: thêm loại danh sách và vài điều kiện của ô được bấm. */
export interface ReportItemsRequest extends ReportQuery {
  readonly kind?: string;
  readonly assigneeUserId?: string;
  readonly status?: string;
  readonly priority?: string;
}

export class ReportService {
  constructor(private readonly store: WorkspaceStore) {}

  /**
   * Ba báo cáo cộng khối "Của tôi".
   *
   * Phạm vi được dịch từ vai trò sang điều kiện SQL và nhúng thẳng vào truy
   * vấn — **không** lấy hết dữ liệu về rồi lọc. Một nhánh lọc bị sót ở tầng
   * ứng dụng nghĩa là rò rỉ số liệu sang dự án người dùng không được xem.
   */
  async bundle(actor: WorkspaceActor, query: ReportQuery): Promise<ReportBundle> {
    const context = await this.prepare(actor, query);
    const { scope, projectIds, today, weekEnd, analytics } = context;

    // `member` và `viewer` chỉ thấy số liệu của chính mình trong hai bảng
    // chi tiết; báo cáo tiến độ dự án vẫn là tổng quan cả dự án họ tham gia.
    // Bộ lọc người của quản lý cũng thu hẹp hai bảng này về người đó.
    const personOnly = analytics.userId;

    const canSeeFinance = scope.level !== 'self';

    const [mine, projectProgress, workload, overdue, financeInputs, numbers, performance, groups] =
      await this.withTimeout([
        this.store.report.myBlock(actor.tenantId, actor.userId, context.from, context.to, today),
        this.store.report.projectProgress(actor.tenantId, projectIds, today),
        this.store.report.workload(actor.tenantId, projectIds, today, weekEnd, personOnly),
        this.store.report.overdue(actor.tenantId, projectIds, today, personOnly, OVERDUE_LIMIT),
        // Mức `self` KHÔNG truy vấn tài chính chút nào — không phải truy vấn rồi
        // bỏ đi. Số tiền không được rời cơ sở dữ liệu nếu không ai được xem nó.
        canSeeFinance
          ? this.store.finance.inputs(actor.tenantId, projectIds)
          : Promise.resolve(undefined),
        this.store.report.analytics(actor.tenantId, analytics),
        this.store.report.performance(actor.tenantId, analytics),
        this.store.report.groups(actor.tenantId, analytics),
      ] as const);

    return {
      scope: {
        level: scope.level,
        projectCount: projectIds.length,
        // Giao diện dựa vào cờ này để ẩn hẳn khối tài chính, khỏi phải tự
        // suy ra vai trò lần nữa.
        canSeeFinance,
      } satisfies ReportScope,
      mine,
      kpis: numbers.kpis,
      previous: {
        ...numbers.previous,
        from: context.previous.from.toISOString(),
        to: context.previous.to.toISOString(),
      },
      trend: { granularity: analytics.granularity, buckets: numbers.trend },
      statusBreakdown: numbers.statusBreakdown,
      priorityBreakdown: numbers.priorityBreakdown,
      performance,
      byGroup: groups.byGroup,
      byTag: groups.byTag,
      ...(analytics.userId ? { userId: analytics.userId } : {}),
      projectProgress,
      workload,
      overdue,
      ...(financeInputs
        ? { finance: aggregateFinance([...financeInputs.values()].map(computeFinance)) }
        : {}),
      from: context.from.toISOString(),
      to: context.to.toISOString(),
      timezone: context.timezone,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Danh sách việc đứng sau một con số trên báo cáo (bấm để xem chi tiết). Cùng phạm vi, kỳ và bộ lọc như báo cáo,
   * nên con số và danh sách luôn khớp nhau; mức `self` vẫn chỉ thấy việc của chính mình.
   */
  async items(actor: WorkspaceActor, query: ReportItemsRequest): Promise<ReportItemList> {
    const kind = query.kind as ReportItemKind | undefined;
    if (!kind || !REPORT_ITEM_KINDS.includes(kind)) {
      throw new WorkspaceValidationError('Loại danh sách báo cáo không hợp lệ.');
    }
    const context = await this.prepare(actor, query);
    // Mức `self` không xem được việc của người khác, kể cả khi bấm từ bảng theo người.
    const assigneeUserId =
      context.scope.level === 'self' ? undefined : query.assigneeUserId?.trim() || undefined;
    const [list] = await this.withTimeout([
      this.store.report.items(actor.tenantId, {
        projectIds: context.projectIds,
        timezone: context.timezone,
        kind,
        fromDay: context.analytics.fromDay,
        toDay: context.analytics.toDay,
        today: context.today,
        weekEnd: context.weekEnd,
        ...(context.analytics.userId ? { userId: context.analytics.userId } : {}),
        ...(assigneeUserId ? { assigneeUserId } : {}),
        ...(query.status?.trim() ? { status: query.status.trim() } : {}),
        ...(query.priority?.trim() ? { priority: query.priority.trim() } : {}),
        limit: ITEM_LIST_LIMIT,
      }),
    ] as const);
    return list;
  }

  /**
   * Phần chung của báo cáo và danh sách chi tiết: kỳ, phạm vi theo vai trò, các bộ lọc dự án / nhóm / nhãn / người.
   */
  private async prepare(actor: WorkspaceActor, query: ReportQuery) {
    const timezone = timezoneOf(actor.tenantId);
    const { from, to } = this.parseRange(query, timezone);
    const today = todayKey(timezone);
    const weekEnd = todayKey(timezone, weekWindow(timezone).to);
    const previous = previousWindow(from, to);

    const requested = parseIdList(query.projectIds);
    const scope = await this.resolveScope(actor, requested);
    let projectIds = await this.store.report.scopedProjectIds(actor.tenantId, scope);

    // Người gọi chỉ đích danh vài dự án mà không dự án nào lọt qua hàng rào
    // phạm vi: đó là truy cập trái phép, trả 403 chứ KHÔNG trả mảng rỗng —
    // mảng rỗng khiến họ tưởng dự án không có dữ liệu.
    if (requested.length > 0 && projectIds.length === 0) {
      throw new ProjectForbiddenError();
    }

    // Nhóm và nhãn chỉ thu hẹp tiếp danh sách đã qua hàng rào phạm vi. Lọc ra rỗng là "không có dữ liệu", không
    // phải 403, nên kiểm sau bước trên.
    const groups = parseIdList(query.groups).map((group) => (group === REPORT_NO_GROUP ? '' : group));
    const tagIds = parseIdList(query.tagIds);
    if ((groups.length > 0 || tagIds.length > 0) && projectIds.length > 0) {
      projectIds = await this.store.report.scopedProjectIds(actor.tenantId, {
        ...scope,
        projectIds,
        ...(groups.length > 0 ? { groups } : {}),
        ...(tagIds.length > 0 ? { tagIds } : {}),
      });
    }

    // Mức `self` luôn kẹp về chính người gọi; bộ lọc người của họ không mở rộng được ra người khác.
    const userId = scope.level === 'self' ? actor.userId : query.userId?.trim() || undefined;
    const analytics: ReportAnalyticsQuery = {
      projectIds,
      timezone,
      fromDay: todayKey(timezone, from),
      toDay: todayKey(timezone, to),
      previousFromDay: todayKey(timezone, previous.from),
      previousToDay: todayKey(timezone, previous.to),
      today,
      granularity: granularityFor(from, to),
      ...(userId ? { userId } : {}),
    };
    return { timezone, from, to, previous, today, weekEnd, scope, projectIds, analytics };
  }

  /* ------------------------------------------------------------ nội bộ */

  /**
   * Dịch vai trò sang phạm vi truy vấn.
   *
   * `tenant-admin` thấy toàn tenant. Ai đang là `owner` hoặc `manager` ở ít
   * nhất một dự án thì được mức `managed`. Còn lại là `self`.
   */
  private async resolveScope(
    actor: WorkspaceActor,
    requested: readonly string[],
  ): Promise<ReportScopeFilter> {
    if (actor.isTenantAdmin) {
      return { level: 'tenant', userId: actor.userId, projectIds: requested };
    }

    const managed = await this.store.report.scopedProjectIds(actor.tenantId, {
      level: 'managed',
      userId: actor.userId,
    });
    return {
      level: managed.length > 0 ? 'managed' : 'self',
      userId: actor.userId,
      projectIds: requested,
    };
  }

  private parseRange(
    query: { from?: string; to?: string },
    timezone: string,
  ): { from: Date; to: Date } {
    // Mặc định là tuần hiện tại, cắt theo múi giờ tenant — cùng mốc với
    // trang "Công việc của tôi", để hai màn không nói hai con số khác nhau.
    if (!query.from && !query.to) {
      const week = weekWindow(timezone);
      return { from: week.from, to: week.to };
    }

    const from = query.from
      ? parseInstant(query.from, 'from')
      : dayWindow(new Date(), timezone).from;
    const to = query.to ? parseInstant(query.to, 'to') : dayWindow(new Date(), timezone).to;

    if (to.getTime() < from.getTime()) {
      throw new WorkspaceValidationError('Mốc kết thúc phải sau mốc bắt đầu.');
    }
    if ((to.getTime() - from.getTime()) / MS_PER_DAY > MAX_REPORT_RANGE_DAYS) {
      throw new RangeTooWideError(MAX_REPORT_RANGE_DAYS);
    }
    return { from, to };
  }

  /**
   * Chạy các truy vấn với trần thời gian chung.
   *
   * `Promise.race` chỉ bỏ qua kết quả chậm chứ không huỷ được truy vấn đang
   * chạy dưới Postgres — muốn huỷ thật thì phải đặt `statement_timeout` trên
   * chính kết nối. Ở đây mục tiêu là trả lời người dùng đúng hạn; nếu truy
   * vấn nặng trở thành vấn đề vận hành thì đó là dấu hiệu cần
   * `report_snapshots`, chứ không phải cần sửa chỗ này.
   */
  private async withTimeout<TValues extends readonly Promise<unknown>[]>(
    work: TValues,
  ): Promise<{ -readonly [K in keyof TValues]: Awaited<TValues[K]> }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const guard = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new ReportTimeoutError(REPORT_TIMEOUT_SECONDS)),
        REPORT_TIMEOUT_SECONDS * 1000,
      );
    });

    try {
      return (await Promise.race([Promise.all(work), guard])) as {
        -readonly [K in keyof TValues]: Awaited<TValues[K]>;
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

function parseIdList(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean))];
}

function parseInstant(value: unknown, field: string): Date {
  const parsed = new Date(String(value ?? ''));
  if (Number.isNaN(parsed.getTime())) {
    throw new WorkspaceValidationError(`Trường "${field}" không phải mốc thời gian hợp lệ.`);
  }
  return parsed;
}
