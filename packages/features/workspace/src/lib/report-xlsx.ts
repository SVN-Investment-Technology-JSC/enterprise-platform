import * as XLSX from 'xlsx-js-style';
import type { ExportSheet } from './report-export';

const BORDER = {
  top: { style: 'thin', color: { rgb: 'CBD5E1' } },
  bottom: { style: 'thin', color: { rgb: 'CBD5E1' } },
  left: { style: 'thin', color: { rgb: 'CBD5E1' } },
  right: { style: 'thin', color: { rgb: 'CBD5E1' } },
};

type Cell = string | number;

/**
 * Sinh tệp `.xlsx` ở trình duyệt, mỗi `ExportSheet` một trang tính: các dòng giới thiệu in nghiêng, rồi từng bảng
 * với tên bảng in đậm, hàng tiêu đề có nền, ô có viền; giữa hai bảng cách một dòng trống. Ô chữ luôn ghi dạng chữ
 * (kể cả khi bắt đầu bằng `=`), nên dữ liệu không bao giờ chạy như công thức.
 */
export function downloadReportXlsx(fileName: string, sheets: readonly ExportSheet[]): void {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const rows: Cell[][] = [];
    /** Kiểu của từng dòng, để tô sau khi dựng trang tính. */
    const kinds: ('intro' | 'title' | 'header' | 'body' | 'blank')[] = [];
    for (const line of sheet.intro ?? []) {
      rows.push([line]);
      kinds.push('intro');
    }
    for (const table of sheet.tables) {
      if (rows.length > 0) {
        rows.push([]);
        kinds.push('blank');
      }
      rows.push([table.title]);
      kinds.push('title');
      rows.push([...table.headers]);
      kinds.push('header');
      for (const row of table.rows) {
        rows.push([...row]);
        kinds.push('body');
      }
      if (table.rows.length === 0) {
        rows.push(['Không có dữ liệu']);
        kinds.push('body');
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const columns = Math.max(1, ...sheet.tables.map((table) => table.headers.length));
    rows.forEach((row, r) => {
      const kind = kinds[r];
      if (kind === 'blank') return;
      // Dòng giới thiệu và tên bảng chỉ một ô; hàng tiêu đề và dữ liệu thì đủ số cột của bảng.
      const width = kind === 'intro' || kind === 'title' ? 1 : Math.max(row.length, 1);
      for (let c = 0; c < width; c += 1) {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (!ws[ref]) ws[ref] = { t: 's', v: '' };
        ws[ref].s =
          kind === 'intro'
            ? { font: { italic: true, color: { rgb: '475569' } } }
            : kind === 'title'
              ? { font: { bold: true, sz: 13, color: { rgb: '1E3A8A' } } }
              : kind === 'header'
                ? {
                    border: BORDER,
                    font: { bold: true },
                    fill: { patternType: 'solid', fgColor: { rgb: 'DCE6F4' } },
                    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
                  }
                : {
                    border: BORDER,
                    // "Biểu đồ" bằng ký tự ■: tô xanh cho dễ nhìn.
                    font: typeof row[c] === 'string' && /^■+$/.test(String(row[c])) ? { color: { rgb: '2563EB' } } : {},
                    alignment: { horizontal: typeof row[c] === 'number' ? 'right' : 'left', vertical: 'center' },
                  };
      }
    });
    // Độ rộng cột khớp nội dung của bảng (bỏ qua dòng giới thiệu, vốn dài cả câu và chỉ nằm ở cột A).
    ws['!cols'] = Array.from({ length: columns }, (_, c) => ({
      wch: Math.min(
        48,
        Math.max(
          8,
          ...rows
            .filter((_row, r) => kinds[r] === 'header' || kinds[r] === 'body')
            .map((row) => String(row[c] ?? '').length + 2),
        ),
      ),
    }));
    XLSX.utils.book_append_sheet(workbook, ws, sheet.name.slice(0, 31));
  }
  XLSX.writeFile(workbook, fileName);
}
