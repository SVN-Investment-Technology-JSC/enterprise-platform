/**
 * Tiện ích xuất CSV phía trình duyệt: UTF-8 có BOM (Excel đọc đúng tiếng Việt),
 * escape dấu nháy/dấu phẩy và vô hiệu hóa công thức khi ô bắt đầu bằng = + - @.
 */
const UTF8_BOM = String.fromCharCode(0xfeff);

export function csvCell(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildCsv(rows: readonly (readonly unknown[])[]): string {
  return `${UTF8_BOM}${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}

export function safeFileName(name: string, fallback = 'xuat-du-lieu'): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

export function downloadCsv(fileName: string, csv: string): void {
  const url = URL.createObjectURL(
    new Blob([csv], { type: 'text/csv;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeFileName(fileName)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
