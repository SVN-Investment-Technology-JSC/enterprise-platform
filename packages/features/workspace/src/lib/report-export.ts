import { MAX_EXPORT_ROWS, type ReportBundle } from '@enterprise-platform/contracts-workspace';

/** Một bảng trong tệp xuất ra. */
export interface ExportSheet {
  readonly title: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly (string | number)[])[];
}

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

/**
 * Dựng các bảng từ dữ liệu báo cáo.
 *
 * Tách khỏi phần sinh tệp để kiểm được bằng unit test — phần sinh tệp cần
 * `Blob` và `URL.createObjectURL`, vốn không có ngoài trình duyệt.
 */
/** Đổi `userId` thành tên hiển thị; mặc định giữ nguyên để test khỏi cần danh bạ. */
export type NameOf = (userId: string) => string;

const keepId: NameOf = (userId) => userId;

export function buildExportSheets(bundle: ReportBundle, nameOf: NameOf = keepId): ExportSheet[] {
  const sheets: ExportSheet[] = [
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
        row.status,
        row.progressPercent,
        row.totalItems,
        row.closedItems,
        row.overdueItems,
        row.startDate ?? '',
        row.endDate ?? '',
      ]),
    },
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
    {
      title: 'Công việc quá hạn',
      headers: ['Mã việc', 'Tên việc', 'Dự án', 'Người phụ trách', 'Hạn', 'Số ngày trễ', 'Trạng thái'],
      rows: bundle.overdue.map((row) => [
        row.code,
        row.title,
        row.projectCode,
        row.assigneeUserId ? nameOf(row.assigneeUserId) : '',
        row.plannedEnd,
        row.daysLate,
        row.status,
      ]),
    },
  ];

  // Số tiền chỉ vào tệp khi server đã gửi nó xuống — tức người xuất được xem
  // tài chính. Không có trường `finance` thì không có bảng, không để trống.
  const finance = bundle.finance;
  if (finance) {
    sheets.push({
      title: 'Tài chính tổng hợp (VND)',
      headers: [
        'Số dự án',
        'Giá trị hợp đồng',
        'Ngân sách',
        'Chi phí thực tế',
        'Chi phí dự kiến',
        'Lợi nhuận dự kiến',
        'Biên lợi nhuận (%)',
      ],
      rows: [
        [
          finance.projectCount,
          finance.contractValue,
          finance.budget,
          finance.actualCost,
          finance.forecastCost,
          finance.profit,
          finance.profitMargin ?? '',
        ],
      ],
    });
  }
  return sheets;
}

/**
 * Dòng đầu tệp ghi lại bộ lọc và thời điểm xuất.
 *
 * Một tệp số liệu không ghi kèm phạm vi và thời điểm sẽ vô dụng sau vài ngày:
 * không ai nhớ nó được lọc theo gì.
 */
export function buildExportHeader(bundle: ReportBundle): string[] {
  const scopeLabel =
    bundle.scope.level === 'tenant'
      ? 'Toàn bộ tenant'
      : bundle.scope.level === 'managed'
        ? 'Các dự án tôi phụ trách'
        : 'Số liệu của riêng tôi';

  return [
    `Báo cáo Workspace — xuất lúc ${new Date(bundle.generatedAt).toLocaleString('vi-VN')}`,
    `Phạm vi: ${scopeLabel} · ${bundle.scope.projectCount} dự án`,
    `Kỳ báo cáo: ${bundle.from} đến ${bundle.to} (múi giờ ${bundle.timezone})`,
    ...(bundle.finance
      ? ['CẢNH BÁO: tệp có số liệu tài chính — không chuyển cho người không được xem tài chính dự án.']
      : []),
  ];
}

/** Tổng số dòng dữ liệu của cả bản xuất. */
export function countExportRows(sheets: readonly ExportSheet[]): number {
  return sheets.reduce((total, sheet) => total + sheet.rows.length, 0);
}

/**
 * Một ô CSV.
 *
 * Bọc mọi ô trong ngoặc kép và nhân đôi dấu nháy bên trong. Chuỗi bắt đầu
 * bằng `=`, `+`, `-` hoặc `@` được thêm một dấu nháy đơn ở đầu: Excel diễn
 * giải chúng thành công thức, và một ô dữ liệu bỗng chạy như mã là lỗ hổng
 * chèn công thức, không chỉ là hiển thị xấu.
 */
export function escapeCsvCell(value: string | number): string {
  const text = String(value ?? '');
  // Số thật (kể cả số âm như lợi nhuận lỗ) không phải công thức; thêm nháy đơn
  // sẽ biến nó thành chữ và Excel không cộng được nữa.
  const guarded =
    typeof value !== 'number' && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/**
 * Sinh nội dung CSV cho toàn bộ bản xuất.
 *
 * CSV chứ không phải `.xlsx`: sinh xlsx thật cần một thư viện, mà repo cố ý
 * không thêm dependency cho việc này. Excel mở CSV được ngay, và tệp còn nhẹ
 * hơn nhiều ở mức hàng chục nghìn dòng.
 */
export function buildCsv(bundle: ReportBundle, nameOf: NameOf = keepId): string {
  const sheets = buildExportSheets(bundle, nameOf);
  const rowCount = countExportRows(sheets);
  if (rowCount > MAX_EXPORT_ROWS) throw new ExportTooLargeError(rowCount);

  const lines: string[] = buildExportHeader(bundle).map((line) => escapeCsvCell(line));

  for (const sheet of sheets) {
    lines.push('');
    lines.push(escapeCsvCell(sheet.title));
    lines.push(sheet.headers.map(escapeCsvCell).join(','));
    for (const row of sheet.rows) lines.push(row.map(escapeCsvCell).join(','));
  }

  return lines.join('\r\n');
}

/** Tên tệp có ngày giờ, để nhiều lần xuất không đè lên nhau. */
export function exportFileName(bundle: ReportBundle): string {
  const stamp = bundle.generatedAt.slice(0, 19).replace(/[:T]/g, '-');
  return `bao-cao-workspace-${stamp}.csv`;
}
