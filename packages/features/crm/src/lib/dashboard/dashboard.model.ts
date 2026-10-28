import type {
  CrmCapabilities,
  DashboardAttentionKind,
  DashboardGranularity,
  DashboardPeriod,
  DashboardQuery,
  DashboardScopeLevel,
  SalesDashboard,
} from '@enterprise-platform/contracts-crm';
import type { CrmView } from '../crm-nav.model';

/**
 * Phần thuần của dashboard Tổng quan: định dạng số trên thẻ chỉ số, so với kỳ
 * trước, trang mở khi bấm thẻ hoặc một mục "Cần chú ý". Số liệu đã lọc theo
 * phạm vi của người xem ở server.
 */

const BILLION = 1_000_000_000;
const MILLION = 1_000_000;
const THOUSAND = 1_000;
const ONE_DECIMAL = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const INTEGER = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });

/** `25500000000` → `25,5 tỷ`; `850000000` → `850 triệu`; dưới một nghìn: `950 ₫`. Số âm giữ dấu. */
export function formatVndCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const scaled = (amount: number, unit: string) => `${sign}${ONE_DECIMAL.format(amount)} ${unit}`;
  if (abs >= BILLION) return scaled(abs / BILLION, 'tỷ');
  if (abs >= MILLION) return scaled(abs / MILLION, 'triệu');
  if (abs >= THOUSAND) return scaled(abs / THOUSAND, 'nghìn');
  return `${sign}${INTEGER.format(abs)} ₫`;
}

/** `66.67` → `66,7%`; không có thì gạch ngang. */
export function formatRate(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${ONE_DECIMAL.format(value)}%`;
}

export function formatCount(value: number): string {
  return INTEGER.format(value);
}

export type DeltaTone = 'good' | 'bad' | 'flat';

export interface CardDelta {
  readonly text: string;
  readonly tone: DeltaTone;
}

/**
 * Dòng "so với kỳ trước": mũi tên, dấu, đơn vị (`%` thay đổi hoặc `điểm` cho
 * tỷ lệ). Xanh khi tốt, đỏ khi xấu theo `goodWhenUp`. Kỳ trước bằng 0 mà kỳ này
 * có số thì không so được (`change` rỗng): ghi "Kỳ trước chưa có số liệu".
 */
export function formatDelta(change: number | null, unit: '%' | ' điểm', goodWhenUp = true): CardDelta {
  if (change === null) return { text: 'Kỳ trước chưa có số liệu', tone: 'flat' };
  if (change === 0) return { text: '= Không đổi so với kỳ trước', tone: 'flat' };
  const up = change > 0;
  return {
    text: `${up ? '▲ +' : '▼ '}${ONE_DECIMAL.format(change)}${unit} so với kỳ trước`,
    tone: up === goodWhenUp ? 'good' : 'bad',
  };
}

export type DashboardCardKey =
  | 'revenue'
  | 'profit'
  | 'newOrders'
  | 'pipeline'
  | 'winRate'
  | 'receivables'
  | 'pendingQuotes';

export interface DashboardCard {
  readonly key: DashboardCardKey;
  readonly label: string;
  readonly value: string;
  /** Giá trị đầy đủ (tooltip) khi thẻ hiện số rút gọn. */
  readonly title?: string;
  readonly delta?: CardDelta;
  readonly hint?: string;
  readonly danger?: boolean;
  /** Trang mở khi bấm thẻ. */
  readonly view: CrmView;
}

const FULL_MONEY = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const fullMoney = (value: number) => `${FULL_MONEY.format(value)} ₫`;

/** Người xem được trang Báo cáo không (cùng điều kiện với menu). */
export function canOpenReports(capabilities: CrmCapabilities): boolean {
  return capabilities.isTenantAdmin || capabilities.canReadReport;
}

/** Thẻ chỉ số theo thứ tự hiển thị. Doanh thu, lợi nhuận mở Báo cáo; người không xem được báo cáo thì mở Đơn bán. */
export function dashboardCards(dashboard: SalesDashboard, capabilities: CrmCapabilities): DashboardCard[] {
  const { kpis } = dashboard;
  const salesView: CrmView = canOpenReports(capabilities) ? 'reports' : 'orders';
  const margin = kpis.marginPercent;
  return [
    {
      key: 'revenue',
      label: 'Doanh thu',
      value: formatVndCompact(kpis.revenue.value),
      title: fullMoney(kpis.revenue.value),
      delta: formatDelta(kpis.revenue.changePercent, '%'),
      hint: 'Sau chiết khấu, chưa VAT, theo ngày giao',
      view: salesView,
    },
    {
      key: 'profit',
      label: 'Lợi nhuận gộp',
      value: formatVndCompact(kpis.profit.value),
      title: fullMoney(kpis.profit.value),
      delta: formatDelta(kpis.profit.changePercent, '%'),
      hint:
        margin.value === null
          ? 'Biên lợi nhuận: chưa có doanh thu'
          : `Biên ${formatRate(margin.value)}${margin.changePoints === null || margin.changePoints === 0 ? '' : ` (${margin.changePoints > 0 ? '+' : ''}${ONE_DECIMAL.format(margin.changePoints)} điểm)`}`,
      danger: kpis.profit.value < 0,
      view: salesView,
    },
    {
      key: 'newOrders',
      label: 'Đơn bán mới',
      value: formatCount(kpis.newOrders.value),
      delta: formatDelta(kpis.newOrders.changePercent, '%'),
      hint: 'Tạo trong kỳ, trừ đơn nháp và đã huỷ',
      view: 'orders',
    },
    {
      key: 'pipeline',
      label: 'Cơ hội đang mở',
      value: formatVndCompact(kpis.pipeline.value),
      title: fullMoney(kpis.pipeline.value),
      hint: `${formatCount(kpis.pipeline.count)} cơ hội · theo xác suất ${formatVndCompact(kpis.pipeline.weightedValue)}`,
      view: 'opportunities',
    },
    {
      key: 'winRate',
      label: 'Tỷ lệ thắng',
      value: formatRate(kpis.winRate.value),
      delta:
        kpis.winRate.value === null
          ? undefined
          : kpis.winRate.previous === null
            ? formatDelta(null, ' điểm')
            : formatDelta(kpis.winRate.changePoints, ' điểm'),
      hint:
        kpis.winRate.won + kpis.winRate.lost
          ? `${formatCount(kpis.winRate.won)} thắng · ${formatCount(kpis.winRate.lost)} thua trong kỳ`
          : 'Chưa có cơ hội đóng trong kỳ',
      view: 'opportunities',
    },
    {
      key: 'receivables',
      label: 'Công nợ phải thu',
      value: formatVndCompact(kpis.receivables.balance),
      title: fullMoney(kpis.receivables.balance),
      hint: kpis.receivables.overdue
        ? `Quá hạn ${formatVndCompact(kpis.receivables.overdue)} · ${formatCount(kpis.receivables.overdueCustomers)} khách`
        : 'Không có khoản quá hạn',
      danger: kpis.receivables.overdue > 0,
      view: 'receivables',
    },
    {
      key: 'pendingQuotes',
      label: 'Báo giá chờ duyệt',
      value: formatCount(kpis.pendingQuotes.count),
      hint: kpis.pendingQuotes.count ? `Tổng ${formatVndCompact(kpis.pendingQuotes.value)} chưa VAT` : 'Không có báo giá chờ duyệt',
      view: 'quotes',
    },
  ];
}

/** Trang mở khi bấm một mục "Cần chú ý"; id của mục là đoạn hash thứ hai. */
export const ATTENTION_VIEWS: Readonly<Record<DashboardAttentionKind, CrmView>> = {
  lateDeliveries: 'orders',
  pendingQuotes: 'quotes',
  expiringContracts: 'contracts',
  activities: 'activities',
  overdueReceivables: 'receivables',
};

export const ATTENTION_EMPTY: Readonly<Record<DashboardAttentionKind, string>> = {
  lateDeliveries: 'Không có đơn giao trễ.',
  pendingQuotes: 'Không có báo giá chờ duyệt.',
  expiringContracts: 'Không có hợp đồng sắp hết hạn.',
  activities: 'Không có hoạt động quá hạn hay đến hạn hôm nay.',
  overdueReceivables: 'Không có công nợ quá hạn.',
};

export const SCOPE_TEXT: Readonly<Record<DashboardScopeLevel, string>> = {
  mine: 'Số liệu của riêng bạn',
  team: 'Số liệu của bạn và cấp dưới',
  all: 'Toàn bộ dữ liệu CRM',
};

/** `YYYY-MM-DD` → `dd/mm/yyyy`. */
export function formatDay(value: string | null | undefined): string {
  return value ? value.split('-').reverse().join('/') : '';
}

/** Nhãn ngắn của một mốc biểu đồ: ngày, tuần `21/10`; tháng `T10`. */
export function bucketLabel(start: string, granularity: DashboardGranularity): string {
  const [, month, day] = start.split('-');
  return granularity === 'month' ? `T${Number(month)}` : `${day}/${month}`;
}

/** Câu hỏi gửi API theo kỳ đang chọn; tuỳ chọn thiếu ngày thì chưa gọi (`undefined`). */
export function dashboardQuery(period: DashboardPeriod, custom: { from?: string; to?: string }): DashboardQuery | undefined {
  if (period !== 'custom') return { period };
  if (!custom.from || !custom.to) return undefined;
  return { period, from: custom.from, to: custom.to };
}
