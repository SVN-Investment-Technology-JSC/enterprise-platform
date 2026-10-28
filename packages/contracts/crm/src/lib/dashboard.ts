import type { OpportunityStage } from './opportunities.js';

/**
 * Dashboard Tổng quan của Bán hàng (`GET v1/dashboard`): chỉ cần `crm.read`.
 * Mọi con số chỉ gồm dữ liệu trong phạm vi của người xem (của tôi, cấp dưới,
 * toàn bộ) như các danh sách khác; không bao giờ có số ngoài phạm vi.
 */

/** Kỳ chọn nhanh. `custom` dùng `from`, `to` của câu hỏi. */
export const DASHBOARD_PERIODS = ['month', 'quarter', 'year', 'custom'] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

export const DASHBOARD_PERIOD_LABELS: Readonly<Record<DashboardPeriod, string>> = {
  month: 'Tháng này',
  quarter: 'Quý này',
  year: 'Năm nay',
  custom: 'Tuỳ chọn',
};

export interface DashboardQuery {
  /** Mặc định `month`. */
  readonly period?: DashboardPeriod;
  /** Chỉ dùng với `custom`: `YYYY-MM-DD` theo giờ Việt Nam, gồm cả hai mốc. */
  readonly from?: string;
  readonly to?: string;
}

/** Khoảng ngày `[from, to]`, gồm cả hai mốc. */
export interface DashboardRange {
  readonly from: string;
  readonly to: string;
}

/** `mine`: chỉ của tôi; `team`: tôi và cấp dưới; `all`: toàn bộ. */
export type DashboardScopeLevel = 'mine' | 'team' | 'all';

/** Một chỉ số so với kỳ trước. */
export interface DashboardMetric {
  readonly value: number;
  readonly previous: number;
  /** Thay đổi (%) so với kỳ trước, 1 chữ số; kỳ trước bằng 0 mà kỳ này khác 0 thì `null`. */
  readonly changePercent: number | null;
}

/** Tỷ lệ (%) so với kỳ trước; không có mẫu thì `null`. */
export interface DashboardRate {
  readonly value: number | null;
  readonly previous: number | null;
  /** Chênh lệch điểm phần trăm; một trong hai kỳ không có tỷ lệ thì `null`. */
  readonly changePoints: number | null;
}

export interface DashboardKpis {
  /** Doanh thu sau chiết khấu, chưa VAT, theo ngày giao (`sales_facts`). */
  readonly revenue: DashboardMetric;
  /** Lợi nhuận gộp = doanh thu − giá vốn thực tế. */
  readonly profit: DashboardMetric;
  readonly marginPercent: DashboardRate;
  /** Đơn bán tạo trong kỳ, trừ Nháp và Đã huỷ. */
  readonly newOrders: DashboardMetric;
  /** Thắng / (thắng + thua) của cơ hội đóng trong kỳ. */
  readonly winRate: DashboardRate & { readonly won: number; readonly lost: number };
  /** Cơ hội đang mở tại hôm nay (không theo kỳ). */
  readonly pipeline: { readonly count: number; readonly value: number; readonly weightedValue: number };
  /** Công nợ phải thu của khách trong phạm vi tại hôm nay. */
  readonly receivables: { readonly balance: number; readonly overdue: number; readonly overdueCustomers: number };
  /** Báo giá đang chờ duyệt trong phạm vi tại hôm nay; giá trị là tổng tiền sau chiết khấu chưa VAT. */
  readonly pendingQuotes: { readonly count: number; readonly value: number };
}

export type DashboardGranularity = 'day' | 'week' | 'month';

export interface DashboardTrendBucket {
  /** Ngày đầu của mốc (tuần bắt đầu thứ Hai; mốc đầu, cuối có thể bị cắt theo kỳ). */
  readonly start: string;
  readonly end: string;
  readonly revenue: number;
  readonly orders: number;
}

export interface DashboardTrend {
  readonly granularity: DashboardGranularity;
  readonly buckets: readonly DashboardTrendBucket[];
}

export interface DashboardStageRow {
  readonly stage: OpportunityStage;
  readonly count: number;
  readonly value: number;
  /** Giá trị nhân xác suất thắng. */
  readonly weightedValue: number;
}

export interface DashboardTopCustomer {
  readonly customerId: string;
  readonly code: string;
  readonly name: string;
  readonly revenue: number;
  readonly profit: number;
  readonly orderCount: number;
}

export interface DashboardTopProduct {
  readonly materialId: string;
  readonly code: string;
  readonly name: string;
  readonly quantity: number;
  readonly revenue: number;
  readonly profit: number;
}

export const DASHBOARD_ATTENTION_KINDS = [
  'lateDeliveries',
  'pendingQuotes',
  'expiringContracts',
  'activities',
  'overdueReceivables',
] as const;
export type DashboardAttentionKind = (typeof DASHBOARD_ATTENTION_KINDS)[number];

export const DASHBOARD_ATTENTION_LABELS: Readonly<Record<DashboardAttentionKind, string>> = {
  lateDeliveries: 'Đơn giao trễ',
  pendingQuotes: 'Báo giá chờ duyệt',
  expiringContracts: 'Hợp đồng sắp hết hạn',
  activities: 'Hoạt động quá hạn, đến hạn hôm nay',
  overdueReceivables: 'Công nợ quá hạn',
};

/** Số mục nhiều nhất của mỗi danh sách "Cần chú ý" và mỗi bảng xếp hạng. */
export const DASHBOARD_LIST_LIMIT = 5;

export interface DashboardAttentionItem {
  /** Id của đơn, báo giá, hợp đồng, hoạt động; công nợ là id khách hàng. */
  readonly id: string;
  /** Mã chứng từ hoặc mã khách; hoạt động là tiêu đề. */
  readonly title: string;
  /** Khách hàng hoặc đối tượng gắn kèm. */
  readonly subtitle: string;
  /** Ngày chính của mục (hạn giao, ngày gửi duyệt, ngày hết hạn, hạn hoạt động, hạn nợ cũ nhất). */
  readonly date: string | null;
  /** Số ngày trễ / đã chờ (dương) hoặc còn lại (hợp đồng). */
  readonly days: number;
  readonly amount: number | null;
  /** Câu ngắn tiếng Việt mô tả tình trạng. */
  readonly note: string;
  readonly deepLink: string;
}

export interface DashboardAttentionList {
  /** Tổng số mục khớp (danh sách chỉ trả tối đa `DASHBOARD_LIST_LIMIT`). */
  readonly total: number;
  readonly items: readonly DashboardAttentionItem[];
}

export interface SalesDashboard {
  readonly period: DashboardPeriod;
  readonly range: DashboardRange;
  /** Kỳ so sánh: cùng độ dài, liền trước (tháng, quý, năm: cùng số ngày từ đầu kỳ trước). */
  readonly previous: DashboardRange;
  /** Hôm nay theo giờ Việt Nam: mốc tính công nợ, cơ hội đang mở, cần chú ý. */
  readonly asOf: string;
  readonly scope: DashboardScopeLevel;
  readonly kpis: DashboardKpis;
  readonly trend: DashboardTrend;
  readonly pipeline: readonly DashboardStageRow[];
  readonly topCustomers: readonly DashboardTopCustomer[];
  readonly topProducts: readonly DashboardTopProduct[];
  readonly attention: Readonly<Record<DashboardAttentionKind, DashboardAttentionList>>;
  /** Số ngày trước hạn coi là hợp đồng sắp hết hạn (cấu hình). */
  readonly contractExpiringDays: number;
}

/** Hoạt động mở bằng `#activities/<id>`. */
export function activityDeepLink(activityId: string): string {
  return `/modules/crm#activities/${encodeURIComponent(activityId)}`;
}
