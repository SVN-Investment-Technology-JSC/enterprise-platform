import * as XLSX from 'xlsx-js-style';

const BORDER = {
  top: { style: 'thin', color: { rgb: '9CA3AF' } },
  bottom: { style: 'thin', color: { rgb: '9CA3AF' } },
  left: { style: 'thin', color: { rgb: '9CA3AF' } },
  right: { style: 'thin', color: { rgb: '9CA3AF' } },
};

/**
 * Tải tệp Excel (.xlsx) ở phía trình duyệt: một trang tính, dòng đầu là tiêu đề (in đậm, có nền), mỗi giá trị một ô riêng
 * có viền. Độ rộng cột tự khớp nội dung (không vượt `maxWidth` ký tự) và tiêu đề có bộ lọc.
 */
export function downloadXlsx(
  fileName: string,
  rows: readonly (readonly unknown[])[],
  sheetName = 'Du lieu',
  maxWidth = 45,
): void {
  const aoa = rows.map((row) => row.map((cell) => (cell === null || cell === undefined ? '' : cell)));
  const ws = XLSX.utils.aoa_to_sheet(aoa as unknown[][]);
  const columns = Math.max(0, ...aoa.map((row) => row.length));
  for (let r = 0; r < aoa.length; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (!ws[ref]) ws[ref] = { t: 's', v: '' };
      const header = r === 0;
      ws[ref].s = {
        border: BORDER,
        font: { bold: header },
        fill: header ? { patternType: 'solid', fgColor: { rgb: 'DCE6F4' } } : undefined,
        alignment: { horizontal: header ? 'center' : 'left', vertical: 'center', wrapText: header },
      };
    }
  }
  ws['!cols'] = Array.from({ length: columns }, (_, col) => ({
    wch: Math.min(maxWidth, Math.max(5, ...aoa.map((row) => String(row[col] ?? '').length)) + 2),
  }));
  if (aoa.length > 0 && columns > 0) {
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: columns - 1 } }),
    };
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`);
}

/** Cấu trúc một bảng có tiêu đề hai tầng (xem `buildBoardSheet`). */
export interface StyledSheetInput {
  readonly rows: readonly (readonly unknown[])[];
  readonly merges: readonly { s: { r: number; c: number }; e: { r: number; c: number } }[];
  readonly infoColumns: number;
  readonly offColumns: readonly number[];
  readonly headerRows?: number;
}

/**
 * Tải tệp Excel có định dạng theo mẫu bảng chấm công: dòng 1 là tiêu đề gộp ô, các dòng tiêu đề in đậm có nền,
 * mọi ô có viền; cột thông tin căn trái, các cột còn lại căn giữa; ngày nghỉ hằng tuần/lễ có nền khác.
 */
export function downloadStyledXlsx(fileName: string, sheet: StyledSheetInput, sheetName = 'Du lieu'): void {
  const headerRows = sheet.headerRows ?? 3;
  const aoa = sheet.rows.map((row) => row.map((cell) => (cell === null || cell === undefined ? '' : cell)));
  const ws = XLSX.utils.aoa_to_sheet(aoa as unknown[][]);
  const columns = Math.max(0, ...aoa.map((row) => row.length));
  ws['!merges'] = sheet.merges.map((m) => ({ s: { ...m.s }, e: { ...m.e } }));
  const off = new Set(sheet.offColumns);

  for (let r = 0; r < aoa.length; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (!ws[ref]) ws[ref] = { t: 's', v: '' };
      const isTitle = r === 0;
      const isHeader = r > 0 && r < headerRows;
      ws[ref].s = {
        border: isTitle ? undefined : BORDER,
        font: { bold: isTitle || isHeader, sz: isTitle ? 14 : 11 },
        fill: isHeader
          ? { patternType: 'solid', fgColor: { rgb: off.has(c) ? 'FDE68A' : 'DCE6F4' } }
          : !isTitle && off.has(c)
            ? { patternType: 'solid', fgColor: { rgb: 'FEF9E7' } }
            : undefined,
        alignment: {
          horizontal: isTitle || isHeader || c >= sheet.infoColumns ? 'center' : 'left',
          vertical: 'center',
          wrapText: true,
        },
      };
    }
  }

  const widths = Array.from({ length: columns }, (_, c) => {
    if (c >= sheet.infoColumns) {
      const longest = Math.max(
        ...aoa.slice(1, headerRows).map((row) => String(row[c] ?? '').length),
        5,
      );
      return { wch: Math.max(7, longest + 2) };
    }
    const longest = Math.max(...aoa.slice(1).map((row) => String(row[c] ?? '').length), 8);
    return { wch: Math.min(45, longest + 2) };
  });
  ws['!cols'] = widths;
  ws['!rows'] = [{ hpt: 28 }, { hpt: 22 }, { hpt: 22 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`);
}
