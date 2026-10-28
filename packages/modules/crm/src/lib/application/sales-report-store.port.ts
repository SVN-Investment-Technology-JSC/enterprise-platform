import type {
  ConversionStage,
  OverdueOrderRow,
  ReceivableReportCustomerRow,
  SalesAlert,
  SalesAlertKind,
  SalesReportDimension,
} from '@enterprise-platform/contracts-crm';
import type { RawFigures } from '../domain/sales-report.js';
import type { CrmDataScope } from './data-scope.js';

export const CRM_SALES_REPORT_STORE = Symbol('CRM_SALES_REPORT_STORE');

/** Bộ lọc đã kiểm của báo cáo doanh thu. */
export interface SalesFactFilter {
  readonly from: string;
  readonly to: string;
  readonly ownerUserId?: string;
  readonly customerGroupId?: string;
  readonly region?: string;
}

export interface SalesGroupRow {
  readonly key: string | null;
  readonly code: string | null;
  readonly label: string | null;
  readonly figures: RawFigures;
}

export interface SalesGroupResult {
  readonly rows: readonly SalesGroupRow[];
  readonly truncated: boolean;
  readonly totals: RawFigures;
}

export type ConversionCounts = Readonly<Record<ConversionStage, number>>;

export interface ReceivableReportFilter {
  readonly today: string;
  readonly ownerUserId?: string;
  readonly customerGroupId?: string;
  readonly region?: string;
}

/** Đọc số liệu báo cáo Bán hàng; mọi hàm lọc theo phạm vi dữ liệu `scope`. */
export interface SalesReportStore {
  salesByDimension(
    tenantId: string,
    scope: CrmDataScope,
    groupBy: SalesReportDimension,
    filter: SalesFactFilter,
    maxRows: number,
  ): Promise<SalesGroupResult>;
  /** Số cơ hội, báo giá, hợp đồng, đơn tạo trong kỳ theo người phụ trách. */
  conversionCounts(
    tenantId: string,
    scope: CrmDataScope,
    filter: Pick<SalesFactFilter, 'from' | 'to' | 'ownerUserId'>,
  ): Promise<readonly { readonly ownerUserId: string; readonly counts: ConversionCounts }[]>;
  alerts(
    tenantId: string,
    scope: CrmDataScope,
    filter: { readonly today: string; readonly expiringUntil: string; readonly ownerUserId?: string; readonly kind?: SalesAlertKind },
  ): Promise<SalesAlert[]>;
  receivables(
    tenantId: string,
    scope: CrmDataScope,
    filter: ReceivableReportFilter,
  ): Promise<{ customers: ReceivableReportCustomerRow[]; overdueOrders: OverdueOrderRow[] }>;
}
