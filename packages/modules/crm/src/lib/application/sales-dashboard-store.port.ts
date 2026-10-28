import type {
  DashboardAttentionList,
  DashboardRange,
  DashboardStageRow,
  DashboardTopCustomer,
  DashboardTopProduct,
} from '@enterprise-platform/contracts-crm';
import type { DailyFigure } from '../domain/dashboard.js';
import type { CrmDataScope } from './data-scope.js';

export const CRM_SALES_DASHBOARD_STORE = Symbol('CRM_SALES_DASHBOARD_STORE');

/** Số liệu thô của một kỳ. */
export interface DashboardPeriodFigures {
  readonly revenue: number;
  readonly costAmount: number;
  readonly newOrders: number;
  readonly won: number;
  readonly lost: number;
}

/** Số liệu tại hôm nay, không theo kỳ. */
export interface DashboardSnapshot {
  readonly receivableBalance: number;
  readonly receivableOverdue: number;
  readonly overdueCustomers: number;
  readonly pendingQuotes: number;
  readonly pendingQuoteValue: number;
}

/** Ai đang xem danh sách "Cần chú ý": báo giá chờ duyệt lọc theo người gửi / người duyệt. */
export interface DashboardViewer {
  readonly userId: string;
  readonly canApproveQuote: boolean;
}

export interface DashboardAttentionFilter {
  readonly today: string;
  readonly expiringUntil: string;
  readonly limit: number;
}

/**
 * Đọc số liệu dashboard Tổng quan. Mọi hàm lọc theo phạm vi dữ liệu `scope`
 * (doanh thu theo người phụ trách đơn lúc giao, công nợ theo người phụ trách
 * khách, còn lại theo người phụ trách của chính bản ghi); hoạt động chỉ lấy
 * việc giao cho chính người xem.
 */
export interface SalesDashboardStore {
  /** Số liệu của hai kỳ (hiện tại, so sánh) trong một lượt đọc mỗi bảng. */
  periodFigures(
    tenantId: string,
    scope: CrmDataScope,
    current: DashboardRange,
    previous: DashboardRange,
  ): Promise<{ current: DashboardPeriodFigures; previous: DashboardPeriodFigures }>;
  /** Doanh thu theo ngày giao và số đơn mới theo ngày tạo; chỉ các ngày có số liệu. */
  dailyFigures(tenantId: string, scope: CrmDataScope, range: DashboardRange): Promise<DailyFigure[]>;
  /** Cơ hội đang mở theo giai đoạn (chỉ giai đoạn có cơ hội). */
  pipeline(tenantId: string, scope: CrmDataScope): Promise<DashboardStageRow[]>;
  topCustomers(tenantId: string, scope: CrmDataScope, range: DashboardRange, limit: number): Promise<DashboardTopCustomer[]>;
  topProducts(tenantId: string, scope: CrmDataScope, range: DashboardRange, limit: number): Promise<DashboardTopProduct[]>;
  snapshot(tenantId: string, scope: CrmDataScope, today: string): Promise<DashboardSnapshot>;
  lateDeliveries(tenantId: string, scope: CrmDataScope, filter: DashboardAttentionFilter): Promise<DashboardAttentionList>;
  pendingQuotes(
    tenantId: string,
    scope: CrmDataScope,
    viewer: DashboardViewer,
    filter: DashboardAttentionFilter,
  ): Promise<DashboardAttentionList>;
  expiringContracts(tenantId: string, scope: CrmDataScope, filter: DashboardAttentionFilter): Promise<DashboardAttentionList>;
  /** Hoạt động đang mở giao cho `assigneeUserId`, hạn trước hết ngày `today`. */
  dueActivities(tenantId: string, assigneeUserId: string, filter: DashboardAttentionFilter): Promise<DashboardAttentionList>;
  overdueReceivables(tenantId: string, scope: CrmDataScope, filter: DashboardAttentionFilter): Promise<DashboardAttentionList>;
}
