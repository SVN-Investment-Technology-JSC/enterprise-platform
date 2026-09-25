import {
  MAX_REPORT_RANGE_DAYS,
  type ReportBundle,
  type ReportScope,
} from '@enterprise-platform/contracts-workspace';
import { aggregateFinance, computeFinance } from '../domain/finance.rules.js';
import { dayWindow, timezoneOf, todayKey, weekWindow } from '../domain/tenant-time.js';
import {
  ProjectForbiddenError,
  RangeTooWideError,
  ReportTimeoutError,
  WorkspaceValidationError,
} from '../domain/workspace.error.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { ReportScopeFilter, WorkspaceStore } from './workspace-store.port.js';

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

export class ReportService {
  constructor(private readonly store: WorkspaceStore) {}

  /**
   * Ba báo cáo cộng khối "Của tôi".
   *
   * Phạm vi được dịch từ vai trò sang điều kiện SQL và nhúng thẳng vào truy
   * vấn — **không** lấy hết dữ liệu về rồi lọc. Một nhánh lọc bị sót ở tầng
   * ứng dụng nghĩa là rò rỉ số liệu sang dự án người dùng không được xem.
   */
  async bundle(
    actor: WorkspaceActor,
    query: { from?: string; to?: string; projectIds?: string },
  ): Promise<ReportBundle> {
    const timezone = timezoneOf(actor.tenantId);
    const { from, to } = this.parseRange(query, timezone);
    const today = todayKey(timezone);
    const weekEnd = todayKey(timezone, weekWindow(timezone).to);

    const requested = parseIdList(query.projectIds);
    const scope = await this.resolveScope(actor, requested);
    const projectIds = await this.store.report.scopedProjectIds(actor.tenantId, scope);

    // Người gọi chỉ đích danh vài dự án mà không dự án nào lọt qua hàng rào
    // phạm vi: đó là truy cập trái phép, trả 403 chứ KHÔNG trả mảng rỗng —
    // mảng rỗng khiến họ tưởng dự án không có dữ liệu.
    if (requested.length > 0 && projectIds.length === 0) {
      throw new ProjectForbiddenError();
    }

    // `member` và `viewer` chỉ thấy số liệu của chính mình trong hai bảng
    // chi tiết; báo cáo tiến độ dự án vẫn là tổng quan cả dự án họ tham gia.
    const selfOnly = scope.level === 'self' ? actor.userId : undefined;

    const canSeeFinance = scope.level !== 'self';

    const [mine, projectProgress, workload, overdue, financeInputs] = await this.withTimeout([
      this.store.report.myBlock(actor.tenantId, actor.userId, from, to, today),
      this.store.report.projectProgress(actor.tenantId, projectIds, today),
      this.store.report.workload(actor.tenantId, projectIds, today, weekEnd, selfOnly),
      this.store.report.overdue(actor.tenantId, projectIds, today, selfOnly, OVERDUE_LIMIT),
      // Mức `self` KHÔNG truy vấn tài chính chút nào — không phải truy vấn rồi
      // bỏ đi. Số tiền không được rời cơ sở dữ liệu nếu không ai được xem nó.
      canSeeFinance
        ? this.store.finance.inputs(actor.tenantId, projectIds)
        : Promise.resolve(undefined),
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
      projectProgress,
      workload,
      overdue,
      ...(financeInputs
        ? { finance: aggregateFinance([...financeInputs.values()].map(computeFinance)) }
        : {}),
      from: from.toISOString(),
      to: to.toISOString(),
      timezone,
      generatedAt: new Date().toISOString(),
    };
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
