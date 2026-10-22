import { MAX_EXPORT_ROWS, type ReportBundle } from '@enterprise-platform/contracts-workspace';
import { formatDate, formatDateTime } from '@enterprise-platform/shared-ui';
import { localDay, percent } from './report-period';
import {
  PRIORITY_LABELS,
  PROJECT_STATUS_LABELS,
  WORK_ITEM_STATUS_LABELS,
} from './workspace-labels';

/** Một bảng trong tệp xuất ra. */
export interface ExportTable {
  readonly title: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly (string | number)[])[];
}

/** Một trang tính: vài dòng giới thiệu ở đầu rồi lần lượt các bảng. */
export interface ExportSheet {
  /** Tên trang tính, tối đa 31 ký tự theo giới hạn của Excel. */
  readonly name: string;
  readonly intro?: readonly string[];
  readonly tables: readonly ExportTable[];
}

/** Các phần người dùng chọn được khi xuất, theo thứ tự trên trang. */
export const REPORT_SECTIONS = [
  { id: 'dashboard', label: 'Tổng quan (dashboard)' },
  { id: 'trend', label: 'Xu hướng theo thời gian' },
  { id: 'performance', label: 'Hiệu suất theo người' },
  { id: 'groups', label: 'Theo nhóm dự án' },
  { id: 'tags', label: 'Theo nhãn dự án' },
  { id: 'progress', label: 'Tiến độ dự án' },
  { id: 'workload', label: 'Tải công việc' },
  { id: 'overdue', label: 'Công việc quá hạn' },
  { id: 'finance', label: 'Tài chính tổng hợp' },
] as const;
export type ReportSectionId = (typeof REPORT_SECTIONS)[number]['id'];

/** Lỗi ném ra khi vượt trần số dòng; giao diện hiện nguyên thông điệp. */
export class ExportTooLargeError extends Error {
  readonly code = 'EXPORT_TOO_LARGE';

  constructor(rowCount: number) {
    super(
      `Bản xuất có ${rowCount.toLocaleString('vi-VN')} dòng, vượt trần ` +
        `${MAX_EXPORT_ROWS.toLocaleString('vi-VN')}. Hãy thu hẹp khoảng thời gian hoặc ` +
        'số dự án rồi xuất lại.',
    );
    Object.setPrototypeOf(this, ExportTooLargeError.prototype);
  }
}

/** Đổi `userId` thành tên hiển thị; mặc định giữ nguyên để test khỏi cần danh bạ. */
export type NameOf = (userId: string) => string;

const keepId: NameOf = (userId) => userId;

/** Thanh ngang bằng ký tự, cho "biểu đồ" trong ô Excel: dài nhất là `width` ô vuông. */
export function textBar(value: number, max: number, width = 20): string {
  if (value <= 0 || max <= 0) return '';
  return '■'.repeat(Math.max(1, Math.round((value / max) * width)));
}

/** Chênh lệch có dấu: "+3", "-2", "0". */
export function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/** Tỉ lệ dạng chữ; không có mẫu thì để trống. */
const rate = (part: number, whole: number) => {
  const value = percent(part, whole);
  return value === undefined ? '' : `${value}%`;
};

/** Tên nhóm dự án để hiện; khoá rỗng là dự án chưa thuộc nhóm nào. */
export const groupLabel = (key: string) => key || 'Chưa phân nhóm';

/**
 * Dòng đầu tệp ghi lại bộ lọc và thời điểm xuất.
 *
 * Một tệp số liệu không ghi kèm phạm vi và thời điểm sẽ vô dụng sau vài ngày:
 * không ai nhớ nó được lọc theo gì.
 */
export function buildExportHeader(bundle: ReportBundle, filters: readonly string[] = []): string[] {
  const scopeLabel =
    bundle.scope.level === 'tenant'
      ? 'Toàn bộ tenant'
      : bundle.scope.level === 'managed'
        ? 'Các dự án tôi phụ trách'
        : 'Số liệu của riêng tôi';

  return [
    `Báo cáo Workspace — xuất lúc ${formatDateTime(bundle.generatedAt)}`,
    `Phạm vi: ${scopeLabel} · ${bundle.scope.projectCount} dự án`,
    `Kỳ báo cáo: ${formatDate(localDay(bundle.from))} đến ${formatDate(localDay(bundle.to))} (múi giờ ${bundle.timezone})`,
    `So với kỳ trước: ${formatDate(localDay(bundle.previous.from))} đến ${formatDate(localDay(bundle.previous.to))}`,
    ...(filters.length > 0 ? [`Bộ lọc: ${filters.join(' · ')}`] : []),
    ...(bundle.finance
      ? ['CẢNH BÁO: tệp có số liệu tài chính — không chuyển cho người không được xem tài chính dự án.']
      : []),
  ];
}

/**
 * Dựng các trang tính từ dữ liệu báo cáo, chỉ những phần được chọn, theo thứ tự trên trang.
 *
 * Tách khỏi phần sinh tệp để kiểm được bằng unit test — phần sinh tệp cần trình duyệt.
 */
export function buildExportSheets(
  bundle: ReportBundle,
  nameOf: NameOf = keepId,
  sections: readonly ReportSectionId[] = REPORT_SECTIONS.map((section) => section.id),
  filters: readonly string[] = [],
): ExportSheet[] {
  const wanted = new Set(sections);
  const sheets: ExportSheet[] = [];
  const { kpis, previous } = bundle;

  if (wanted.has('dashboard')) {
    // Thứ tự cố định như trên trang (trạng thái theo tiến trình, ưu tiên từ cao xuống thấp), không theo thứ tự CSDL.
    const statusOrder = Object.keys(WORK_ITEM_STATUS_LABELS);
    const priorityOrder = Object.keys(PRIORITY_LABELS).reverse();
    const statusRows = [...bundle.statusBreakdown].sort(
      (left, right) => statusOrder.indexOf(left.key) - statusOrder.indexOf(right.key),
    );
    const priorityRows = [...bundle.priorityBreakdown].sort(
      (left, right) => priorityOrder.indexOf(left.key) - priorityOrder.indexOf(right.key),
    );
    const statusMax = Math.max(0, ...bundle.statusBreakdown.map((row) => row.count));
    const statusTotal = bundle.statusBreakdown.reduce((sum, row) => sum + row.count, 0);
    const priorityMax = Math.max(0, ...bundle.priorityBreakdown.map((row) => row.count));
    sheets.push({
      name: 'Tổng quan',
      intro: buildExportHeader(bundle, filters),
      tables: [
        {
          title: 'Chỉ số chính',
          headers: ['Chỉ số', 'Kỳ này', 'Kỳ trước', 'Chênh lệch'],
          rows: [
            ['Việc tạo mới', kpis.createdItems, previous.createdItems, signed(kpis.createdItems - previous.createdItems)],
            [
              'Việc hoàn thành',
              kpis.completedItems,
              previous.completedItems,
              signed(kpis.completedItems - previous.completedItems),
            ],
            ['Hoàn thành đúng hạn', kpis.completedOnTime, previous.completedOnTime, ''],
            ['Hoàn thành trễ hạn', kpis.completedLate, previous.completedLate, ''],
            [
              'Tỉ lệ đúng hạn',
              rate(kpis.completedOnTime, kpis.completedItems),
              rate(previous.completedOnTime, previous.completedItems),
              '',
            ],
            ['Giờ ước lượng đã hoàn thành', kpis.completedHours, '', ''],
            ['Việc đang mở (hôm nay)', kpis.openItems, '', ''],
            ['Việc quá hạn (hôm nay)', kpis.overdueItems, '', ''],
          ],
        },
        {
          title: 'Công việc theo trạng thái',
          headers: ['Trạng thái', 'Số việc', 'Tỉ lệ', 'Biểu đồ'],
          rows: statusRows.map((row) => [
            WORK_ITEM_STATUS_LABELS[row.key as keyof typeof WORK_ITEM_STATUS_LABELS] ?? row.key,
            row.count,
            rate(row.count, statusTotal),
            textBar(row.count, statusMax),
          ]),
        },
        {
          title: 'Việc đang mở theo độ ưu tiên',
          headers: ['Độ ưu tiên', 'Số việc', 'Biểu đồ'],
          rows: priorityRows.map((row) => [
            PRIORITY_LABELS[row.key as keyof typeof PRIORITY_LABELS] ?? row.key,
            row.count,
            textBar(row.count, priorityMax),
          ]),
        },
      ],
    });
  }

  if (wanted.has('trend')) {
    const max = Math.max(0, ...bundle.trend.buckets.map((row) => Math.max(row.created, row.completed)));
    sheets.push({
      name: 'Xu hướng',
      tables: [
        {
          title: `Xu hướng theo ${bundle.trend.granularity === 'day' ? 'ngày' : bundle.trend.granularity === 'week' ? 'tuần' : 'tháng'}`,
          headers: ['Từ ngày', 'Tạo mới', 'Hoàn thành', 'Lỡ hạn', 'Hoàn thành (biểu đồ)'],
          rows: bundle.trend.buckets.map((row) => [
            formatDate(row.start),
            row.created,
            row.completed,
            row.missedDeadline,
            textBar(row.completed, max),
          ]),
        },
      ],
    });
  }

  if (wanted.has('performance')) {
    sheets.push({
      name: 'Hiệu suất theo người',
      tables: [
        {
          title: 'Hiệu suất theo người phụ trách',
          headers: [
            'Người phụ trách',
            'Hoàn thành',
            'Đúng hạn',
            'Trễ hạn',
            'Tỉ lệ đúng hạn',
            'Trễ TB (ngày)',
            'Giờ đã xong',
            'Đang mở',
            'Quá hạn',
          ],
          rows: bundle.performance.map((row) => [
            nameOf(row.userId),
            row.completedItems,
            row.completedOnTime,
            row.completedLate,
            rate(row.completedOnTime, row.completedItems),
            row.averageDaysLate,
            row.completedHours,
            row.openItems,
            row.overdueItems,
          ]),
        },
      ],
    });
  }

  const groupTable = (title: string, rows: ReportBundle['byGroup'], label: (key: string, name: string) => string) => ({
    title,
    headers: ['Tên', 'Số dự án', 'Tiến độ TB (%)', 'Tổng việc', 'Đã đóng', 'Đang mở', 'Quá hạn', 'Xong trong kỳ'],
    rows: rows.map((row) => [
      label(row.key, row.label),
      row.projectCount,
      row.progressPercent,
      row.totalItems,
      row.closedItems,
      row.openItems,
      row.overdueItems,
      row.completedInPeriod,
    ]),
  });
  if (wanted.has('groups')) {
    sheets.push({
      name: 'Theo nhóm dự án',
      tables: [groupTable('Theo nhóm dự án', bundle.byGroup, (key) => groupLabel(key))],
    });
  }
  if (wanted.has('tags')) {
    sheets.push({
      name: 'Theo nhãn',
      tables: [groupTable('Theo nhãn dự án', bundle.byTag, (_key, name) => name)],
    });
  }

  if (wanted.has('progress')) {
    sheets.push({
      name: 'Tiến độ dự án',
      tables: [
        {
          title: 'Tiến độ dự án',
          headers: [
            'Mã dự án',
            'Tên dự án',
            'Trạng thái',
            'Tiến độ (%)',
            'Tổng việc',
            'Đã đóng',
            'Quá hạn',
            'Bắt đầu',
            'Kết thúc',
          ],
          rows: bundle.projectProgress.map((row) => [
            row.projectCode,
            row.projectName,
            PROJECT_STATUS_LABELS[row.status] ?? row.status,
            row.progressPercent,
            row.totalItems,
            row.closedItems,
            row.overdueItems,
            formatDate(row.startDate),
            formatDate(row.endDate),
          ]),
        },
      ],
    });
  }

  if (wanted.has('workload')) {
    sheets.push({
      name: 'Tải công việc',
      tables: [
        {
          title: 'Tải công việc',
          headers: ['Người phụ trách', 'Việc đang mở', 'Quá hạn', 'Đến hạn trong tuần', 'Giờ ước lượng'],
          rows: bundle.workload.map((row) => [
            nameOf(row.userId),
            row.openItems,
            row.overdueItems,
            row.dueThisWeek,
            row.estimatedHours,
          ]),
        },
      ],
    });
  }

  if (wanted.has('overdue')) {
    sheets.push({
      name: 'Công việc quá hạn',
      tables: [
        {
          title: 'Công việc quá hạn',
          headers: ['Mã việc', 'Tên việc', 'Dự án', 'Người phụ trách', 'Hạn', 'Số ngày trễ', 'Trạng thái'],
          rows: bundle.overdue.map((row) => [
            row.code,
            row.title,
            row.projectCode,
            row.assigneeUserId ? nameOf(row.assigneeUserId) : '',
            formatDate(row.plannedEnd.slice(0, 10)),
            row.daysLate,
            WORK_ITEM_STATUS_LABELS[row.status] ?? row.status,
          ]),
        },
      ],
    });
  }

  // Số tiền chỉ vào tệp khi server đã gửi nó xuống — tức người xuất được xem
  // tài chính. Không có trường `finance` thì không có bảng, không để trống.
  const finance = bundle.finance;
  if (finance && wanted.has('finance')) {
    sheets.push({
      name: 'Tài chính',
      tables: [
        {
          title: 'Tài chính tổng hợp (VND)',
          headers: ['Số dự án', 'Giá trị hợp đồng'],
          rows: [[finance.projectCount, finance.contractValue]],
        },
      ],
    });
  }
  return sheets;
}

/** Tổng số dòng dữ liệu của cả bản xuất. */
export function countExportRows(sheets: readonly ExportSheet[]): number {
  return sheets.reduce(
    (total, sheet) => total + sheet.tables.reduce((sum, table) => sum + table.rows.length, 0),
    0,
  );
}

/** Tên tệp có ngày giờ, để nhiều lần xuất không đè lên nhau. */
export function exportFileName(bundle: ReportBundle): string {
  const stamp = bundle.generatedAt.slice(0, 19).replace(/[:T]/g, '-');
  return `bao-cao-workspace-${stamp}.xlsx`;
}
