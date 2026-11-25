import type { HrmReportCell, HrmReportColumn, HrmReportResult } from '@enterprise-platform/contracts-hrm';

/** Ngày đầu và ngày cuối của tháng `yyyy-mm` dạng yyyy-mm-dd. */
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** Các cột được chọn sẵn của một báo cáo. */
export function defaultColumnKeys(columns: readonly HrmReportColumn[]): string[] {
  return columns.filter((c) => c.defaultOn).map((c) => c.key);
}

/** Bật hoặc tắt một cột; luôn giữ lại ít nhất một cột để file không rỗng. */
export function toggleColumn(selected: readonly string[], key: string): string[] {
  if (selected.includes(key)) return selected.length > 1 ? selected.filter((k) => k !== key) : [...selected];
  return [...selected, key];
}

/** Cột theo đúng thứ tự của báo cáo, chỉ gồm các cột đã chọn. */
export function selectedColumns(columns: readonly HrmReportColumn[], selected: readonly string[]): HrmReportColumn[] {
  const keys = new Set(selected);
  return columns.filter((c) => keys.has(c.key));
}

export interface ReportSheetOptions {
  /** Thêm cột STT ở đầu. */
  readonly withIndex?: boolean;
  readonly maxRows?: number;
}

/** Dòng Excel: dòng đầu là tiêu đề các cột đã chọn, các dòng sau là dữ liệu; số giữ dạng số để cộng được. */
export function buildReportRows(
  result: Pick<HrmReportResult, 'columns' | 'rows'>,
  selected: readonly string[],
  options: ReportSheetOptions = {},
): (string | number)[][] {
  const columns = selectedColumns(result.columns, selected);
  const header: (string | number)[] = columns.map((c) => c.label);
  const rows = options.maxRows === undefined ? result.rows : result.rows.slice(0, options.maxRows);
  const body = rows.map((row, index) => {
    const cells = columns.map((c): string | number => cellValue(row[c.key], c));
    return options.withIndex ? [index + 1, ...cells] : cells;
  });
  return [options.withIndex ? ['STT', ...header] : header, ...body];
}

function cellValue(value: HrmReportCell | undefined, column: HrmReportColumn): string | number {
  if (value === null || value === undefined) return '';
  if (column.type === 'number') return typeof value === 'number' ? value : Number.isFinite(Number(value)) ? Number(value) : '';
  return String(value);
}

/** Tên file: `<nhãn>_<từ>_<đến>`, ngày dạng yyyymmdd, bỏ ký tự không hợp lệ. */
export function reportFileName(label: string, from: string, to: string): string {
  const slug = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug}_${from.replaceAll('-', '')}_${to.replaceAll('-', '')}`;
}

/** Khoảng ngày hợp lệ để gọi báo cáo; trả thông báo lỗi tiếng Việt hoặc chuỗi rỗng. */
export function reportRangeProblem(from: string, to: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return 'Cần chọn từ ngày và đến ngày';
  if (to < from) return 'Đến ngày phải sau hoặc bằng từ ngày';
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  return days > 400 ? 'Khoảng ngày tối đa 400 ngày' : '';
}

/** Chuỗi query từ bộ lọc; danh sách rỗng thì bỏ khóa. */
export function reportQuery(filters: {
  from: string;
  to: string;
  departmentIds: readonly string[];
  employeeIds: readonly string[];
  statuses?: readonly string[];
  requestKinds?: readonly string[];
  leaveTypeIds?: readonly string[];
}): string {
  const params = new URLSearchParams({ from: filters.from, to: filters.to });
  const lists: [string, readonly string[] | undefined][] = [
    ['departmentIds', filters.departmentIds],
    ['employeeIds', filters.employeeIds],
    ['statuses', filters.statuses],
    ['requestKinds', filters.requestKinds],
    ['leaveTypeIds', filters.leaveTypeIds],
  ];
  for (const [key, list] of lists) if (list && list.length) params.set(key, list.join(','));
  return params.toString();
}
