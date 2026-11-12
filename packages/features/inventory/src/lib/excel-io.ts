import ExcelJS from 'exceljs';

export interface ParsedWorkbookData {
  readonly sheetNames: string[];
  readonly sheets: Record<string, unknown[][]>;
}

function normalizeCellValue(val: ExcelJS.CellValue): unknown {
  if (val === null || val === undefined) return '';
  if (val instanceof Date) return val;
  if (typeof val === 'object') {
    if ('result' in val && val.result !== undefined) return val.result;
    if ('text' in val && typeof val.text === 'string') return val.text;
    if ('richText' in val && Array.isArray(val.richText)) {
      return val.richText.map((part) => part.text).join('');
    }
    if ('hyperlink' in val && typeof val.text === 'string') return val.text;
    return String(val);
  }
  return val;
}

function parseCsvRows(text: string): unknown[][] {
  const clean = text.replace(/^\uFEFF/, '');
  const rows: unknown[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && clean[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else if (ch === '\n' || ch === '\r') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Đọc workbook Excel (.xlsx) hoặc CSV từ ArrayBuffer bằng exceljs (không dùng xlsx có CVE). */
export async function parseExcelBuffer(
  buffer: ArrayBuffer,
  fileName = '',
): Promise<ParsedWorkbookData> {
  if (fileName.toLowerCase().endsWith('.csv')) {
    const text = new TextDecoder('utf-8').decode(buffer);
    return {
      sheetNames: ['Sheet1'],
      sheets: { Sheet1: parseCsvRows(text) },
    };
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheetNames: string[] = [];
  const sheets: Record<string, unknown[][]> = {};

  workbook.eachSheet((worksheet) => {
    sheetNames.push(worksheet.name);
    const rows: unknown[][] = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push(values.map((cell) => normalizeCellValue(cell as ExcelJS.CellValue)));
    });
    sheets[worksheet.name] = rows;
  });

  return { sheetNames, sheets };
}

/**
 * Parse tệp Excel/CSV trong Web Worker để không làm đơ giao diện khi xem trước tệp lớn.
 * Tự động fallback về main thread trong môi trường không có Worker (SSR/Jest).
 */
export async function parseExcelFileInWorker(file: File): Promise<ParsedWorkbookData> {
  const buffer = await file.arrayBuffer();
  if (typeof Worker === 'undefined') {
    return parseExcelBuffer(buffer, file.name);
  }

  return new Promise<ParsedWorkbookData>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./excel-parse.worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch {
      void parseExcelBuffer(buffer, file.name).then(resolve, reject);
      return;
    }

    const cleanup = () => worker.terminate();
    worker.onmessage = (event: MessageEvent<{ ok: boolean; data?: ParsedWorkbookData; error?: string }>) => {
      cleanup();
      if (event.data?.ok && event.data.data) {
        resolve(event.data.data);
      } else {
        reject(new Error(event.data?.error || 'Không thể đọc file Excel.'));
      }
    };
    worker.onerror = () => {
      cleanup();
      void parseExcelBuffer(buffer, file.name).then(resolve, reject);
    };
    worker.postMessage({ buffer, fileName: file.name }, [buffer]);
  });
}

/** Chuyển mảng 2 chiều (dòng 0 là tiêu đề) sang mảng object giống `sheet_to_json({ defval: '' })`. */
export function sheetRowsToRecords(rows: readonly unknown[][]): Record<string, unknown>[] {
  if (rows.length === 0) return [];
  const headers = (rows[0] ?? []).map((h, idx) => String(h ?? '').trim() || `__EMPTY_${idx}`);
  const result: Record<string, unknown>[] = [];
  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r] ?? [];
    const record: Record<string, unknown> = {};
    let hasValue = false;
    for (let c = 0; c < headers.length; c += 1) {
      const val = row[c] ?? '';
      if (val !== '' && val !== null && val !== undefined) hasValue = true;
      record[headers[c]] = val;
    }
    if (hasValue) result.push(record);
  }
  return result;
}

export interface ExportSheetSpec {
  readonly name: string;
  readonly rows: readonly (readonly unknown[])[];
  readonly colWidths?: readonly number[];
}

/** Ghi và tải xuống tệp `.xlsx` bằng exceljs. */
export async function downloadXlsxWorkbook(
  fileName: string,
  sheets: readonly ExportSheetSpec[],
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name.slice(0, 31) || 'Sheet1');
    for (const row of sheet.rows) {
      ws.addRow([...row]);
    }
    if (sheet.colWidths?.length) {
      ws.columns = sheet.colWidths.map((width) => ({ width }));
    } else if (sheet.rows.length > 0) {
      const colCount = Math.max(...sheet.rows.map((r) => r.length));
      ws.columns = Array.from({ length: colCount }, (_, colIdx) => {
        const maxLen = sheet.rows.reduce(
          (best, r) => Math.max(best, String(r[colIdx] ?? '').length),
          10,
        );
        return { width: Math.min(maxLen + 3, 45) };
      });
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Xuất nhanh 1 hoặc nhiều sheet từ mảng object. */
export function recordsToSheetRows(
  records: readonly Record<string, unknown>[],
  explicitHeaders?: readonly string[],
): unknown[][] {
  const headers =
    explicitHeaders && explicitHeaders.length > 0
      ? [...explicitHeaders]
      : records.length > 0
        ? Object.keys(records[0])
        : [];
  if (headers.length === 0) return [];
  return [
    headers,
    ...records.map((rec) => headers.map((h) => rec[h] ?? '')),
  ];
}

