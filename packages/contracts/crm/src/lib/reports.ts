/**
 * Báo cáo Bán hàng (GĐ7): doanh thu, sản lượng, lợi nhuận theo chiều (RPT-01),
 * tỷ lệ chuyển đổi (RPT-02), danh sách cảnh báo (RPT-03), công nợ phải thu
 * (RPT-07). Mọi báo cáo áp phạm vi dữ liệu của người xem (Q11) và cần
 * `crm.report.read` (hoặc quản trị tenant).
 */

// ---------------------------------------------------------------------------
// Doanh thu, sản lượng, lợi nhuận (T7-02)
// ---------------------------------------------------------------------------

/** Chiều nhóm của báo cáo doanh thu. */
export const SALES_REPORT_DIMENSIONS = ['owner', 'customer', 'material', 'category', 'region', 'customerGroup'] as const;
export type SalesReportDimension = (typeof SALES_REPORT_DIMENSIONS)[number];

export const SALES_REPORT_DIMENSION_LABELS: Readonly<Record<SalesReportDimension, string>> = {
  owner: 'Nhân viên',
  customer: 'Khách hàng',
  material: 'Sản phẩm',
  category: 'Nhóm hàng',
  region: 'Khu vực',
  customerGroup: 'Nhóm khách',
};

/** Kỳ báo cáo dài nhất (ngày), để một lần gọi không quét quá nhiều năm. */
export const SALES_REPORT_MAX_DAYS = 1_100;

/** Số nhóm nhiều nhất một báo cáo doanh thu trả về (xếp theo doanh thu giảm dần). */
export const SALES_REPORT_MAX_ROWS = 2_000;

/** Bộ lọc chung của các báo cáo theo kỳ. Ngày `YYYY-MM-DD` theo giờ Việt Nam, gồm cả hai mốc. */
export interface ReportPeriodQuery {
  /** Mặc định: ngày đầu tháng hiện tại. */
  readonly from?: string;
  /** Mặc định: hôm nay. */
  readonly to?: string;
  readonly ownerUserId?: string;
  readonly customerGroupId?: string;
  readonly region?: string;
}

export interface SalesReportQuery extends ReportPeriodQuery {
  /** Mặc định `owner`. */
  readonly groupBy?: SalesReportDimension;
}

/** Số liệu cộng dồn của một nhóm (hoặc tổng). Tiền làm tròn đến đồng. */
export interface SalesFigures {
  /** Sản lượng: tổng số lượng đã giao (trừ phần bị đảo). */
  readonly quantity: number;
  /** Doanh thu sau chiết khấu, chưa VAT. */
  readonly revenue: number;
  readonly vatAmount: number;
  /** Giá vốn thực tế theo chứng từ xuất kho. */
  readonly costAmount: number;
  /** Lợi nhuận gộp = doanh thu − giá vốn thực tế. */
  readonly profit: number;
  /** Biên lợi nhuận (%), 2 chữ số; doanh thu 0 thì `null`. */
  readonly marginPercent: number | null;
  /** Số đơn có dòng giao trong nhóm. */
  readonly orderCount: number;
}

export interface SalesReportRow extends SalesFigures {
  /** Id của nhóm (người, khách, mặt hàng, nhóm khách) hoặc giá trị (nhóm hàng, khu vực); rỗng là "chưa phân loại". */
  readonly key: string | null;
  /** Mã khách, mã mặt hàng, mã nhóm khách; chiều khác rỗng. */
  readonly code: string | null;
  /** Tên hiển thị; chiều nhân viên trả id, giao diện đổi sang tên. */
  readonly label: string;
}

export interface SalesReport {
  readonly from: string;
  readonly to: string;
  readonly groupBy: SalesReportDimension;
  readonly rows: readonly SalesReportRow[];
  /** Có nhiều nhóm hơn `SALES_REPORT_MAX_ROWS`: chỉ trả các nhóm doanh thu cao nhất; tổng vẫn đủ. */
  readonly truncated: boolean;
  readonly totals: SalesFigures;
}

// ---------------------------------------------------------------------------
// Tỷ lệ chuyển đổi (T7-03)
// ---------------------------------------------------------------------------

export const CONVERSION_STAGES = ['OPPORTUNITY', 'QUOTE', 'CONTRACT', 'ORDER'] as const;
export type ConversionStage = (typeof CONVERSION_STAGES)[number];

export const CONVERSION_STAGE_LABELS: Readonly<Record<ConversionStage, string>> = {
  OPPORTUNITY: 'Cơ hội',
  QUOTE: 'Báo giá',
  CONTRACT: 'Hợp đồng',
  ORDER: 'Đơn bán',
};

export interface ConversionStep {
  readonly stage: ConversionStage;
  readonly count: number;
  /** Tỷ lệ so với bước trước (%), 2 chữ số; bước đầu hoặc bước trước bằng 0 thì `null`. */
  readonly stepPercent: number | null;
  /** Tỷ lệ so với số cơ hội (%), 2 chữ số; không có cơ hội thì `null`. */
  readonly overallPercent: number | null;
}

export interface ConversionOwnerRow {
  readonly ownerUserId: string;
  readonly steps: readonly ConversionStep[];
}

/**
 * Đếm theo kỳ tạo: cơ hội, báo giá, hợp đồng (trừ Đã huỷ), đơn bán (trừ Đã huỷ)
 * tạo trong kỳ, của người phụ trách trong phạm vi.
 */
export interface ConversionReport {
  readonly from: string;
  readonly to: string;
  readonly steps: readonly ConversionStep[];
  readonly byOwner: readonly ConversionOwnerRow[];
}

export type ConversionReportQuery = Pick<ReportPeriodQuery, 'from' | 'to' | 'ownerUserId'>;

// ---------------------------------------------------------------------------
// Cảnh báo (T7-04)
// ---------------------------------------------------------------------------

export const SALES_ALERT_KINDS = ['QUOTE_PENDING', 'CONTRACT_EXPIRING', 'DELIVERY_LATE'] as const;
export type SalesAlertKind = (typeof SALES_ALERT_KINDS)[number];

export const SALES_ALERT_KIND_LABELS: Readonly<Record<SalesAlertKind, string>> = {
  QUOTE_PENDING: 'Báo giá chờ duyệt',
  CONTRACT_EXPIRING: 'Hợp đồng sắp hết hạn',
  DELIVERY_LATE: 'Đơn giao trễ',
};

export interface SalesAlert {
  readonly kind: SalesAlertKind;
  /** Id báo giá, hợp đồng hoặc đơn bán. */
  readonly id: string;
  readonly code: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly ownerUserId: string;
  /** Ngày gửi duyệt, ngày hết hạn hợp đồng, ngày giao dự kiến sớm nhất còn trễ. */
  readonly date: string | null;
  /** Hợp đồng: số ngày còn lại; đơn trễ: số ngày trễ; báo giá: số ngày đã chờ. */
  readonly days: number;
  readonly summary: string;
  readonly deepLink: string;
}

export interface SalesAlertList {
  readonly items: readonly SalesAlert[];
  /** Số ngày trước hạn coi là "sắp hết hạn" (cấu hình hợp đồng). */
  readonly contractExpiringDays: number;
}

export type SalesAlertQuery = Pick<ReportPeriodQuery, 'ownerUserId'> & { readonly kind?: SalesAlertKind };

// ---------------------------------------------------------------------------
// Công nợ phải thu (T7-05)
// ---------------------------------------------------------------------------

export type ReceivableReportQuery = Pick<ReportPeriodQuery, 'ownerUserId' | 'customerGroupId' | 'region'>;

export interface ReceivableReportCustomerRow {
  readonly customerId: string;
  readonly customerCode: string;
  readonly customerName: string;
  readonly ownerUserId: string;
  readonly customerGroupName: string | null;
  readonly region: string | null;
  /** Doanh thu đã ghi nợ (gồm VAT): tổng phát sinh nợ. */
  readonly revenue: number;
  /** Tiền đã thu (phiếu thu đã ghi sổ, trừ phiếu bị đảo), gồm cả phần chưa phân bổ. */
  readonly collected: number;
  /** Điều chỉnh, bút đảo giao hàng, huỷ đợt (có dấu). */
  readonly adjusted: number;
  /** Dư nợ hiện tại theo sổ. */
  readonly balance: number;
  /** Doanh thu chưa thu = doanh thu − tiền thu đã phân bổ vào khoản nợ. */
  readonly uncollectedRevenue: number;
  /** Phần còn nợ đã đến hạn hoặc quá hạn. */
  readonly overdueAmount: number;
  /** Hạn gần nhất của khoản còn nợ chưa đến hạn. */
  readonly nextDueDate: string | null;
  /** Hạn cũ nhất của khoản còn nợ đã quá hạn. */
  readonly oldestOverdueDate: string | null;
  readonly overdueOrderCount: number;
}

export interface OverdueOrderRow {
  readonly orderId: string;
  readonly orderCode: string;
  readonly customerId: string;
  readonly customerCode: string;
  readonly customerName: string;
  readonly ownerUserId: string;
  /** Hạn cũ nhất của khoản còn nợ quá hạn của đơn. */
  readonly dueDate: string;
  readonly daysOverdue: number;
  /** Tổng phần còn nợ đã quá hạn của đơn. */
  readonly overdueAmount: number;
}

export interface ReceivableReportTotals {
  readonly revenue: number;
  readonly collected: number;
  readonly adjusted: number;
  readonly balance: number;
  readonly uncollectedRevenue: number;
  readonly overdueAmount: number;
}

export interface ReceivableReport {
  /** Ngày tính quá hạn (hôm nay, giờ Việt Nam). */
  readonly asOf: string;
  readonly customers: readonly ReceivableReportCustomerRow[];
  readonly overdueOrders: readonly OverdueOrderRow[];
  readonly totals: ReceivableReportTotals;
}
