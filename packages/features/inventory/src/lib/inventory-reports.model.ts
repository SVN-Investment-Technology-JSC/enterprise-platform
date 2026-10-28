import type {
  SerialStockState,
  StockApprovalReportRow,
  StockMovementCategory,
  StockMovementLine,
  StockMovementReport,
  StockReport,
} from '@enterprise-platform/contracts-inventory';
import * as XLSX from 'xlsx';
import { MATERIAL_CATEGORY_LABEL, QUALITY_STATUS_LABEL, formatDateTime } from './inventory-labels';
import { STOCK_DOCUMENT_STATUS_LABEL, STOCK_DOCUMENT_TYPE_LABEL } from './stock-document.model';

/**
 * Nhãn, cột xuất Excel và tiện ích tải hết trang cho màn Báo cáo kho (T7-09).
 * Tách khỏi component để bảng trên màn và tệp Excel dùng cùng nhãn.
 */

export const SERIAL_STOCK_STATE_LABEL: Readonly<Record<SerialStockState, string>> = {
  IN_STOCK: 'Trong kho',
  ISSUED: 'Đã xuất',
  IN_TRANSIT: 'Đang vận chuyển',
  SCRAPPED: 'Đã huỷ',
};

export const MOVEMENT_CATEGORY_LABEL: Readonly<Record<StockMovementCategory, string>> = {
  RECEIPT: 'Nhập kho',
  ISSUE: 'Xuất kho',
  TRANSFER: 'Điều chuyển',
  SALES_RETURN: 'Nhập trả hàng bán',
  ADJUSTMENT: 'Điều chỉnh',
  REVERSAL: 'Chứng từ đảo',
};

/** Tên bốn loại tồn, dùng chung cho cột bảng và tiêu đề Excel. */
export const STOCK_QUANTITY_LABEL = {
  onHand: 'Tồn thực tế',
  reserved: 'Đã giữ',
  blocked: 'Chờ kiểm định / không đạt',
  available: 'Khả dụng',
} as const;

/** Trần số dòng xuất Excel một lần, tránh treo trình duyệt. */
export const MAX_EXPORT_ROWS = 100_000;
const EXPORT_PAGE_SIZE = 1000;

/** Tải lần lượt mọi trang (1.000 dòng mỗi trang) tới khi đủ `total` hoặc chạm trần. */
export async function loadAllPages<TRow>(
  load: (paging: { limit: number; offset: number }) => Promise<{ rows: readonly TRow[]; total: number }>,
): Promise<{ rows: TRow[]; total: number; truncated: boolean }> {
  const rows: TRow[] = [];
  let total = 0;
  for (let offset = 0; offset < MAX_EXPORT_ROWS; offset += EXPORT_PAGE_SIZE) {
    const page = await load({ limit: EXPORT_PAGE_SIZE, offset });
    total = page.total;
    rows.push(...page.rows);
    if (page.rows.length < EXPORT_PAGE_SIZE || rows.length >= total) break;
  }
  return { rows, total, truncated: rows.length < total };
}

type Cell = string | number;

export interface ReportSheet {
  readonly name: string;
  /** Dòng giới thiệu ở đầu trang tính (bộ lọc, thời điểm). */
  readonly intro: readonly string[];
  readonly headers: readonly string[];
  readonly rows: readonly (readonly Cell[])[];
}

/** Ghi tệp .xlsx ở trình duyệt; ô chữ ghi dạng chữ nên không chạy như công thức. */
export function downloadReportSheets(fileName: string, sheets: readonly ReportSheet[]): void {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const aoa: Cell[][] = [...sheet.intro.map((line) => [line]), [], [...sheet.headers], ...sheet.rows.map((row) => [...row])];
    const worksheet = XLSX.utils.aoa_to_sheet(aoa);
    worksheet['!cols'] = sheet.headers.map((header, column) => ({
      wch: Math.min(
        48,
        Math.max(8, header.length + 2, ...sheet.rows.slice(0, 500).map((row) => String(row[column] ?? '').length + 2)),
      ),
    }));
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31));
  }
  XLSX.writeFile(workbook, fileName);
}

const categoryLabel = (category?: string) =>
  category ? (MATERIAL_CATEGORY_LABEL[category as keyof typeof MATERIAL_CATEGORY_LABEL] ?? category) : '';

/** Trang tính của báo cáo tồn theo kiểu đang xem, kèm dòng tổng. */
export function stockReportSheet(
  report: StockReport,
  rows: StockReport['rows'],
  intro: readonly string[],
): ReportSheet {
  if (report.groupBy === 'SERIAL') {
    const totals = report.totals;
    return {
      name: 'Tồn theo serial',
      intro: [
        ...intro,
        `Tổng ${totals.serials} serial; trong kho ${totals.inStock}; chờ kiểm định / không đạt ${totals.blocked}; khả dụng ${totals.available}`,
      ],
      headers: ['Mã vật tư', 'Tên vật tư', 'Nhóm', 'Serial', 'Kho', 'Trạng thái kho', 'Chất lượng', 'Cập nhật'],
      rows: (rows as Extract<StockReport, { groupBy: 'SERIAL' }>['rows']).map((row) => [
        row.materialCode,
        row.materialName,
        categoryLabel(row.category),
        row.serialNumber,
        row.warehouseCode ?? '',
        row.stockState ? SERIAL_STOCK_STATE_LABEL[row.stockState] : '',
        QUALITY_STATUS_LABEL[row.qualityStatus],
        formatDateTime(row.updatedAt),
      ]),
    };
  }
  const quantityHeaders = [
    STOCK_QUANTITY_LABEL.onHand,
    STOCK_QUANTITY_LABEL.reserved,
    STOCK_QUANTITY_LABEL.blocked,
    STOCK_QUANTITY_LABEL.available,
  ];
  const totals = report.totals;
  const totalCells: Cell[] = [totals.onHand, totals.reserved, totals.blocked, totals.available];
  if (report.groupBy === 'LOT') {
    return {
      name: 'Tồn theo lô',
      intro,
      headers: ['Mã vật tư', 'Tên vật tư', 'Đơn vị', 'Số lô', 'Kho', 'Hạn dùng', 'Còn (ngày)', 'Chất lượng', ...quantityHeaders],
      rows: [
        ...(rows as Extract<StockReport, { groupBy: 'LOT' }>['rows']).map((row) => [
          row.materialCode,
          row.materialName,
          row.unit ?? '',
          row.lotNo,
          row.warehouseCode,
          row.expiresOn ?? '',
          row.daysToExpiry ?? '',
          QUALITY_STATUS_LABEL[row.qualityStatus],
          row.onHand,
          row.reserved,
          row.blocked,
          row.available,
        ]),
        ['Tổng cộng', '', '', '', '', '', '', '', ...totalCells],
      ],
    };
  }
  return {
    name: 'Tồn theo kho',
    intro,
    headers: ['Kho', 'Tên kho', 'Mã vật tư', 'Tên vật tư', 'Nhóm', 'Đơn vị', ...quantityHeaders, 'Giá bình quân', 'Giá trị tồn'],
    rows: [
      ...(rows as Extract<StockReport, { groupBy: 'WAREHOUSE' }>['rows']).map((row) => [
        row.warehouseCode,
        row.warehouseName,
        row.materialCode,
        row.materialName,
        categoryLabel(row.category),
        row.unit ?? '',
        row.onHand,
        row.reserved,
        row.blocked,
        row.available,
        row.avgCost,
        row.stockValue,
      ]),
      ['Tổng cộng', '', '', '', '', '', ...totalCells, '', totals.stockValue ?? 0],
    ],
  };
}

const AMOUNT_HEADERS = ['SL nhập', 'SL xuất', 'Giá trị nhập', 'Giá trị xuất', 'Số bút toán'];

/** Ba trang tính của báo cáo nhập xuất: tổng theo nhóm, theo loại chứng từ và kho, bút toán. */
export function movementReportSheets(
  report: StockMovementReport,
  lines: readonly StockMovementLine[],
  intro: readonly string[],
): ReportSheet[] {
  const amounts = (row: StockMovementReport['totals']): Cell[] => [
    row.quantityIn,
    row.quantityOut,
    row.valueIn,
    row.valueOut,
    row.entries,
  ];
  return [
    {
      name: 'Tổng hợp',
      intro,
      headers: ['Nhóm', ...AMOUNT_HEADERS],
      rows: [
        ...report.summary.map((row) => [MOVEMENT_CATEGORY_LABEL[row.category], ...amounts(row)]),
        ['Tổng cộng', ...amounts(report.totals)],
      ],
    },
    {
      name: 'Theo loại và kho',
      intro,
      headers: ['Nhóm', 'Loại chứng từ', 'Kho', 'Tên kho', ...AMOUNT_HEADERS],
      rows: report.breakdown.map((row) => [
        MOVEMENT_CATEGORY_LABEL[row.category],
        row.docType ? STOCK_DOCUMENT_TYPE_LABEL[row.docType] : 'Không có chứng từ',
        row.warehouseCode,
        row.warehouseName,
        ...amounts(row),
      ]),
    },
    {
      name: 'Bút toán',
      intro,
      headers: [
        'Thời điểm ghi sổ',
        'Mã bút toán',
        'Chứng từ',
        'Loại chứng từ',
        'Nhóm',
        'Đảo chứng từ',
        'Kho',
        'Mã vật tư',
        'Tên vật tư',
        'Đơn vị',
        'Số lượng',
        'Đơn giá',
        'Giá trị',
        'Ghi chú',
      ],
      rows: lines.map((line) => [
        formatDateTime(line.postedAt),
        line.transactionCode,
        line.documentCode ?? '',
        line.docType ? STOCK_DOCUMENT_TYPE_LABEL[line.docType] : '',
        MOVEMENT_CATEGORY_LABEL[line.category],
        line.reversesDocumentCode ?? '',
        line.warehouseCode,
        line.materialCode,
        line.materialName,
        line.unit ?? '',
        line.quantity,
        line.unitCost,
        line.value,
        line.note ?? '',
      ]),
    },
  ];
}

/** Trang tính lịch sử duyệt; người thực hiện là id người dùng. */
export function approvalReportSheet(rows: readonly StockApprovalReportRow[], intro: readonly string[]): ReportSheet {
  return {
    name: 'Lịch sử duyệt',
    intro,
    headers: [
      'Chứng từ',
      'Loại',
      'Trạng thái',
      'Ngày chứng từ',
      'Kho',
      'Lý do',
      'Người lập',
      'Gửi duyệt lúc',
      'Người duyệt',
      'Duyệt lúc',
      'Người từ chối',
      'Từ chối lúc',
      'Lý do từ chối',
      'Ghi sổ lúc',
      'SL tăng',
      'SL giảm',
      'Giá trị',
    ],
    rows: rows.map((row) => [
      row.documentCode,
      STOCK_DOCUMENT_TYPE_LABEL[row.docType],
      STOCK_DOCUMENT_STATUS_LABEL[row.status],
      row.documentDate,
      row.warehouseCode,
      row.reason ?? '',
      row.createdBy,
      row.submittedAt ? formatDateTime(row.submittedAt) : '',
      row.approvedBy ?? '',
      row.approvedAt ? formatDateTime(row.approvedAt) : '',
      row.rejectedBy ?? '',
      row.rejectedAt ? formatDateTime(row.rejectedAt) : '',
      row.rejectReason ?? '',
      row.postedAt ? formatDateTime(row.postedAt) : '',
      row.quantityIn,
      row.quantityOut,
      row.value,
    ]),
  };
}

/** Hôm nay theo giờ Việt Nam (YYYY-MM-DD), cùng cách server tính kỳ báo cáo. */
export function todayInVietnam(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
