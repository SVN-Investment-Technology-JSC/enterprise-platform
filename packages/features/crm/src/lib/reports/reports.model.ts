import {
  CONVERSION_STAGE_LABELS,
  SALES_ALERT_KIND_LABELS,
  SALES_REPORT_DIMENSION_LABELS,
  type ConversionReport,
  type ReceivableReport,
  type SalesAlertList,
  type SalesReport,
  type SalesReportDimension,
} from '@enterprise-platform/contracts-crm';

/**
 * Phần thuần của màn Báo cáo (T7-08): kỳ chọn nhanh, nhãn dòng, bảng xuất
 * Excel. Bảng xuất dựng từ đúng dữ liệu API đã trả (đã lọc phạm vi ở server),
 * nên file không bao giờ chứa dữ liệu ngoài phạm vi của người xem (TC-SEC-07).
 */

export type ReportTab = 'sales' | 'conversion' | 'alerts' | 'receivables';

export const REPORT_TABS: readonly { readonly id: ReportTab; readonly label: string }[] = [
  { id: 'sales', label: 'Doanh thu, lợi nhuận' },
  { id: 'conversion', label: 'Tỷ lệ chuyển đổi' },
  { id: 'alerts', label: 'Cảnh báo' },
  { id: 'receivables', label: 'Công nợ phải thu' },
];

/** Ngày hôm nay theo giờ Việt Nam, `YYYY-MM-DD`. */
export function vietnamToday(now = new Date()): string {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function shiftMonths(date: string, months: number): string {
  const [year, month] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1 + months, 1));
  return value.toISOString().slice(0, 10);
}

function lastDayOfMonth(firstDay: string): string {
  const next = new Date(`${shiftMonths(firstDay, 1)}T00:00:00Z`);
  next.setUTCDate(0);
  return next.toISOString().slice(0, 10);
}

export interface PeriodPreset {
  readonly id: string;
  readonly label: string;
  readonly from: string;
  readonly to: string;
}

/** Kỳ chọn nhanh tính từ hôm nay. */
export function periodPresets(today: string): PeriodPreset[] {
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthStart = shiftMonths(monthStart, -1);
  const quarterMonth = Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1;
  return [
    { id: 'month', label: 'Tháng này', from: monthStart, to: today },
    { id: 'last-month', label: 'Tháng trước', from: lastMonthStart, to: lastDayOfMonth(lastMonthStart) },
    { id: 'quarter', label: 'Quý này', from: `${today.slice(0, 5)}${String(quarterMonth).padStart(2, '0')}-01`, to: today },
    { id: 'year', label: 'Năm nay', from: `${today.slice(0, 4)}-01-01`, to: today },
    { id: '12-months', label: '12 tháng gần nhất', from: shiftMonths(monthStart, -11), to: today },
  ];
}

/** Nhãn dòng của báo cáo doanh thu; chiều nhân viên đổi id sang tên. */
export function salesRowLabel(
  groupBy: SalesReportDimension,
  row: { readonly key: string | null; readonly label: string },
  personName: (userId: string) => string,
): string {
  if (groupBy === 'owner') return row.key ? personName(row.key) : 'Không rõ';
  if (row.label) return row.label;
  return groupBy === 'region' ? 'Chưa có khu vực' : 'Chưa phân nhóm';
}

/** Độ dài thanh so sánh (%), theo giá trị lớn nhất; âm hoặc không có thì 0. */
export function barPercent(value: number, max: number): number {
  if (!(max > 0) || !(value > 0)) return 0;
  return Math.min(100, Math.round((value / max) * 1000) / 10);
}

const day = (value: string | null | undefined) => (value ? value.split('-').reverse().join('/') : '');

export interface Sheet {
  readonly name: string;
  readonly rows: readonly (readonly (string | number | null)[])[];
}

export function salesSheet(report: SalesReport, personName: (userId: string) => string): Sheet {
  const dimension = SALES_REPORT_DIMENSION_LABELS[report.groupBy];
  return {
    name: 'Doanh thu',
    rows: [
      [`Doanh thu, lợi nhuận theo ${dimension.toLowerCase()} từ ${day(report.from)} đến ${day(report.to)}`],
      [dimension, 'Mã', 'Sản lượng', 'Doanh thu (chưa VAT)', 'VAT', 'Giá vốn thực tế', 'Lợi nhuận gộp', 'Biên lợi nhuận (%)', 'Số đơn'],
      ...report.rows.map((row) => [
        salesRowLabel(report.groupBy, row, personName),
        row.code,
        row.quantity,
        row.revenue,
        row.vatAmount,
        row.costAmount,
        row.profit,
        row.marginPercent,
        row.orderCount,
      ]),
      [
        'Tổng cộng',
        null,
        report.totals.quantity,
        report.totals.revenue,
        report.totals.vatAmount,
        report.totals.costAmount,
        report.totals.profit,
        report.totals.marginPercent,
        report.totals.orderCount,
      ],
    ],
  };
}

export function conversionSheet(report: ConversionReport, personName: (userId: string) => string): Sheet {
  const header = report.steps.flatMap((step) => [CONVERSION_STAGE_LABELS[step.stage], `${CONVERSION_STAGE_LABELS[step.stage]} (%)`]);
  const cells = (steps: ConversionReport['steps']) => steps.flatMap((step) => [step.count, step.stepPercent]);
  return {
    name: 'Chuyển đổi',
    rows: [
      [`Tỷ lệ chuyển đổi từ ${day(report.from)} đến ${day(report.to)} (% so với bước trước)`],
      ['Nhân viên', ...header, 'Tổng (%)'],
      ...report.byOwner.map((owner) => [personName(owner.ownerUserId), ...cells(owner.steps), owner.steps[owner.steps.length - 1]?.overallPercent ?? null]),
      ['Tổng cộng', ...cells(report.steps), report.steps[report.steps.length - 1]?.overallPercent ?? null],
    ],
  };
}

export function alertsSheet(list: SalesAlertList, personName: (userId: string) => string): Sheet {
  return {
    name: 'Cảnh báo',
    rows: [
      ['Loại', 'Mã', 'Khách hàng', 'Ngày', 'Số ngày', 'Nội dung', 'Người phụ trách'],
      ...list.items.map((item) => [
        SALES_ALERT_KIND_LABELS[item.kind],
        item.code,
        item.customerName,
        day(item.date),
        item.days,
        item.summary,
        personName(item.ownerUserId),
      ]),
    ],
  };
}

export function receivableSheets(report: ReceivableReport, personName: (userId: string) => string): Sheet[] {
  return [
    {
      name: 'Công nợ theo khách',
      rows: [
        [`Công nợ phải thu đến ngày ${day(report.asOf)}`],
        [
          'Mã khách',
          'Khách hàng',
          'Nhóm khách',
          'Khu vực',
          'Doanh thu ghi nợ',
          'Đã thu',
          'Điều chỉnh',
          'Dư nợ',
          'Doanh thu chưa thu',
          'Đến hạn, quá hạn',
          'Hạn quá hạn cũ nhất',
          'Hạn kế tiếp',
          'Số đơn quá hạn',
          'Người phụ trách',
        ],
        ...report.customers.map((row) => [
          row.customerCode,
          row.customerName,
          row.customerGroupName,
          row.region,
          row.revenue,
          row.collected,
          row.adjusted,
          row.balance,
          row.uncollectedRevenue,
          row.overdueAmount,
          day(row.oldestOverdueDate),
          day(row.nextDueDate),
          row.overdueOrderCount,
          personName(row.ownerUserId),
        ]),
        [
          'Tổng cộng',
          null,
          null,
          null,
          report.totals.revenue,
          report.totals.collected,
          report.totals.adjusted,
          report.totals.balance,
          report.totals.uncollectedRevenue,
          report.totals.overdueAmount,
        ],
      ],
    },
    {
      name: 'Đơn quá hạn',
      rows: [
        ['Mã đơn', 'Mã khách', 'Khách hàng', 'Hạn thanh toán', 'Số ngày quá hạn', 'Số tiền quá hạn', 'Người phụ trách'],
        ...report.overdueOrders.map((row) => [
          row.orderCode,
          row.customerCode,
          row.customerName,
          day(row.dueDate),
          row.daysOverdue,
          row.overdueAmount,
          personName(row.ownerUserId),
        ]),
      ],
    },
  ];
}

/** Tên file xuất: chỉ chữ không dấu, số, gạch ngang. */
export function exportFileName(prefix: string, today: string): string {
  return `${prefix}-${today}.xlsx`;
}
