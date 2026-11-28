import * as XLSX from 'xlsx-js-style';
import type { ProjectExportCell } from './project-export';
import type { ProjectReportCellKind, ProjectReportSheet } from './project-report-export';

/**
 * Ghi tệp `.xlsx` một trang tính: hàng tiêu đề đậm ở dòng 1, mỗi dòng dữ liệu một dự án. Ô chữ luôn
 * ghi dạng chữ, kể cả khi bắt đầu bằng `=`, `+`, `-`, `@`, nên nội dung nhập từ người dùng không bao giờ chạy như công thức.
 */
export function downloadProjectsXlsx(
  fileName: string,
  headers: readonly string[],
  rows: readonly (readonly ProjectExportCell[])[],
): void {
  const sheet = XLSX.utils.aoa_to_sheet([[...headers], ...rows.map((row) => [...row])]);
  // aoa_to_sheet đã ghi chữ thành ô kiểu chuỗi; đặt lại tường minh cho chắc, rồi kẻ tiêu đề.
  headers.forEach((_, c) => {
    const ref = XLSX.utils.encode_cell({ r: 0, c });
    const cell = sheet[ref];
    if (cell) {
      cell.s = {
        font: { bold: true },
        fill: { patternType: 'solid', fgColor: { rgb: 'DCE6F4' } },
        alignment: { vertical: 'center', wrapText: true },
      };
    }
  });
  rows.forEach((row, r) => {
    row.forEach((value, c) => {
      const cell = sheet[XLSX.utils.encode_cell({ r: r + 1, c })];
      if (!cell) return;
      if (typeof value === 'number') {
        cell.t = 'n';
        cell.z = '#,##0';
      } else {
        cell.t = 's';
        cell.v = String(value);
        cell.s = { alignment: { vertical: 'top', wrapText: String(value).length > 60 } };
      }
    });
  });
  sheet['!cols'] = headers.map((header, c) => ({
    wch: Math.min(
      60,
      Math.max(header.length + 2, 10, ...rows.slice(0, 200).map((row) => Math.min(60, String(row[c] ?? '').length + 2))),
    ),
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
  XLSX.writeFile(workbook, fileName);
}

const THIN = { style: 'thin', color: { rgb: '808080' } };
const BORDER = { top: THIN, bottom: THIN, left: THIN, right: THIN };

/** Kiểu trình bày theo loại ô của báo cáo doanh thu theo lĩnh vực (giống mẫu Excel của người dùng). */
const REPORT_STYLES: Record<ProjectReportCellKind, Record<string, unknown>> = {
  title: { font: { bold: true, sz: 14 }, alignment: { vertical: 'center', horizontal: 'left' } },
  date: { font: { italic: true }, alignment: { vertical: 'center', horizontal: 'right' } },
  header: {
    font: { bold: true },
    fill: { patternType: 'solid', fgColor: { rgb: 'DCE6F4' } },
    alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
    border: BORDER,
  },
  totalLabel: {
    font: { bold: true },
    fill: { patternType: 'solid', fgColor: { rgb: 'FFF2CC' } },
    alignment: { vertical: 'center', horizontal: 'center' },
    border: BORDER,
  },
  total: {
    font: { bold: true },
    fill: { patternType: 'solid', fgColor: { rgb: 'FFF2CC' } },
    alignment: { vertical: 'center', horizontal: 'right' },
    border: BORDER,
  },
  index: { alignment: { vertical: 'top', horizontal: 'center' }, border: BORDER },
  text: { alignment: { vertical: 'top' }, border: BORDER },
  wrap: { alignment: { vertical: 'top', wrapText: true }, border: BORDER },
  number: { alignment: { vertical: 'top', horizontal: 'right' }, border: BORDER },
  year: { alignment: { vertical: 'top', horizontal: 'center' }, border: BORDER },
};

/**
 * Ghi tệp báo cáo doanh thu theo lĩnh vực từ ma trận ô đã dựng sẵn (`buildProjectReportSheet`). Ô chữ luôn ghi dạng
 * chữ; chỉ dòng tổng có công thức (SUBTOTAL do mình dựng, không lấy từ dữ liệu người dùng), kèm giá trị đã tính.
 * xlsx-js-style chưa ghi được cố định dòng tiêu đề nên không có phần đó.
 */
export function downloadProjectReportXlsx(fileName: string, report: ProjectReportSheet): void {
  const sheet: XLSX.WorkSheet = {};
  report.rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      const ref = XLSX.utils.encode_cell({ r, c });
      // Bản sao riêng cho từng ô: thư viện ghi thêm định dạng số vào chính đối tượng kiểu khi ghi tệp.
      const s = { ...REPORT_STYLES[cell.kind] };
      if (cell.formula !== undefined) {
        sheet[ref] = { t: 'n', f: cell.formula, v: typeof cell.value === 'number' ? cell.value : 0, z: '#,##0', s };
      } else if (typeof cell.value === 'number') {
        // Năm và STT không có dấu phân cách hàng nghìn.
        const plain = cell.kind === 'year' || cell.kind === 'index';
        sheet[ref] = plain ? { t: 'n', v: cell.value, s } : { t: 'n', v: cell.value, z: '#,##0', s };
      } else {
        // Ô trống vẫn ghi (chuỗi rỗng) để có viền và nền như mẫu.
        sheet[ref] = { t: 's', v: cell.value ?? '', s };
      }
    });
  });
  const width = report.rows[0]?.length ?? 1;
  sheet['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: Math.max(report.rows.length - 1, 0), c: width - 1 },
  });
  sheet['!merges'] = report.merges.map((range) => ({ s: { ...range.s }, e: { ...range.e } }));
  sheet['!cols'] = report.columnWidths.map((wch) => ({ wch }));
  sheet['!rows'] = [{ hpt: 26 }, { hpt: 22 }, { hpt: 34 }, { hpt: 20 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Doanh thu theo lĩnh vực');
  XLSX.writeFile(workbook, fileName);
}
