import type { ProjectReportGroup, ProjectSummary } from '@enterprise-platform/contracts-workspace';
import { exportDate, type ProjectExportLookups } from './project-export';
import { PROJECT_STATUS_LABELS } from './workspace-labels';

/**
 * Báo cáo "Chi tiết doanh thu dự án" theo mẫu Excel của người dùng (BẢNG 2): mỗi dự án một dòng, giá trị hợp đồng
 * (trước VAT) nằm ở cột tổng và đúng một cột lĩnh vực theo nhóm báo cáo của dự án.
 *
 * Bố cục (dòng tính từ 1 như trong Excel):
 * - Dòng 1: tiêu đề gộp ngang, ngày xuất ở góc phải.
 * - Dòng 2–3: tiêu đề hai tầng; cột thường gộp dọc, "Doanh thu theo lĩnh vực" gộp ngang trên các cột nhóm báo cáo.
 * - Dòng 4: dòng tổng, công thức SUBTOTAL(9, …) trên các dòng dữ liệu (kèm sẵn giá trị đã tính để mở ra là thấy số).
 * - Từ dòng 5: dữ liệu.
 *
 * Mô-đun này chỉ dựng ma trận ô (thuần, kiểm thử được); ghi tệp ở `downloadProjectReportXlsx` (project-export-xlsx.ts).
 */

export type ProjectReportLookups = Pick<ProjectExportLookups, 'customerName' | 'orgUnitName'>;

export const PROJECT_REPORT_TITLE = 'BẢNG: CHI TIẾT DOANH THU DỰ ÁN';

/** Cột cho dự án chưa gán nhóm báo cáo, hay gán một nhóm không còn trong danh mục. */
export const UNASSIGNED_REPORT_GROUP_LABEL = 'Chưa phân nhóm';

export const REPORT_GROUP_HEADER = 'Doanh thu theo lĩnh vực';

/** Cột đứng trước khối nhóm báo cáo, theo đúng thứ tự của mẫu. */
const LEADING_HEADERS = [
  'STT',
  'Tên khách hàng',
  'Tên dự án',
  'Mã dự án',
  'Ghi chú',
  'Tình trạng',
  'Giá trị hợp đồng (trước VAT)',
  'Phòng ban',
] as const;

/** Cột đứng sau khối nhóm báo cáo. */
const TRAILING_HEADERS = ['Năm', 'Nhóm dự án'] as const;

const LEADING_WIDTHS = [6, 32, 42, 14, 30, 14, 18, 24];
const GROUP_WIDTH = 16;
const TRAILING_WIDTHS = [8, 22];

/** Vị trí cột (tính từ 0) của giá trị hợp đồng. */
export const CONTRACT_COLUMN = 6;
/** Cột nhóm báo cáo đầu tiên. */
export const FIRST_GROUP_COLUMN = LEADING_HEADERS.length;
/** Số dòng tiêu đề (tiêu đề bảng + hai tầng tiêu đề cột) trước dòng tổng. */
export const REPORT_HEADER_ROWS = 3;
/** Dòng tổng (tính từ 0) và dòng dữ liệu đầu tiên. */
export const TOTAL_ROW = REPORT_HEADER_ROWS;
export const FIRST_DATA_ROW = TOTAL_ROW + 1;

/** Loại ô quyết định kiểu trình bày khi ghi tệp. */
export type ProjectReportCellKind =
  | 'title'
  | 'date'
  | 'header'
  | 'totalLabel'
  | 'total'
  | 'index'
  | 'text'
  | 'wrap'
  | 'number'
  | 'year';

export interface ProjectReportCell {
  readonly kind: ProjectReportCellKind;
  /** `null`: ô trống (vẫn kẻ viền theo kiểu ô). */
  readonly value: string | number | null;
  /** Công thức Excel (không có dấu `=`); `value` là kết quả đã tính sẵn. */
  readonly formula?: string;
}

export interface ProjectReportMerge {
  readonly s: { readonly r: number; readonly c: number };
  readonly e: { readonly r: number; readonly c: number };
}

/** Một cột lĩnh vực: `id` của nhóm báo cáo, `null` là cột "Chưa phân nhóm". */
export interface ProjectReportGroupColumn {
  readonly id: string | null;
  readonly label: string;
}

export interface ProjectReportSheet {
  /** Ma trận ô đủ hình chữ nhật: mọi dòng cùng số cột. */
  readonly rows: readonly (readonly ProjectReportCell[])[];
  readonly merges: readonly ProjectReportMerge[];
  /** Độ rộng cột theo số ký tự (`wch`). */
  readonly columnWidths: readonly number[];
  readonly groupColumns: readonly ProjectReportGroupColumn[];
  readonly projectCount: number;
  /** Có ít nhất một dự án có giá trị hợp đồng (người xuất được xem tài chính). */
  readonly hasContractValues: boolean;
}

/** Chữ cái cột Excel: 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index: number): string {
  let rest = index + 1;
  let letters = '';
  while (rest > 0) {
    const digit = (rest - 1) % 26;
    letters = String.fromCharCode(65 + digit) + letters;
    rest = Math.floor((rest - 1) / 26);
  }
  return letters;
}

/** Giá trị hợp đồng trước VAT; vắng khi người xuất không được xem tài chính hay dự án chưa nhập hợp đồng. */
export function reportContractValue(project: ProjectSummary): number | undefined {
  const value = project.contractValue ?? project.finance?.contractValue;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Năm của dự án: năm ngày bắt đầu, chưa có thì năm tạo dự án. */
export function projectReportYear(project: Pick<ProjectSummary, 'startDate' | 'createdAt'>): number | undefined {
  for (const value of [project.startDate, project.createdAt]) {
    const match = /^(\d{4})-/.exec(value ?? '');
    if (match) return Number(match[1]);
  }
  return undefined;
}

/** Danh mục theo thứ tự sắp xếp của tenant (cùng thứ tự thì theo tên). */
const orderedCatalog = (catalog: readonly ProjectReportGroup[]) =>
  [...catalog].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi'));

/**
 * Các cột lĩnh vực: mỗi nhóm báo cáo trong danh mục một cột, theo thứ tự danh mục; thêm cột "Chưa phân nhóm" ở cuối khi
 * có dự án chưa gán nhóm (hay gán nhóm đã bị xoá), hoặc khi danh mục còn trống.
 */
export function reportGroupColumns(
  catalog: readonly ProjectReportGroup[],
  projects: readonly Pick<ProjectSummary, 'reportGroupId'>[],
): ProjectReportGroupColumn[] {
  const ordered = orderedCatalog(catalog);
  const known = new Set(ordered.map((group) => group.id));
  const columns: ProjectReportGroupColumn[] = ordered.map((group) => ({ id: group.id, label: group.name }));
  const hasUnassigned = projects.some((project) => !project.reportGroupId || !known.has(project.reportGroupId));
  if (hasUnassigned || columns.length === 0) columns.push({ id: null, label: UNASSIGNED_REPORT_GROUP_LABEL });
  return columns;
}

/** Vị trí (trong các cột lĩnh vực) của cột nhận giá trị của dự án. */
function groupSlot(project: Pick<ProjectSummary, 'reportGroupId'>, columns: readonly ProjectReportGroupColumn[]): number {
  const found = project.reportGroupId ? columns.findIndex((column) => column.id === project.reportGroupId) : -1;
  return found >= 0 ? found : columns.findIndex((column) => column.id === null);
}

/** Xếp dự án theo thứ tự nhóm báo cáo, rồi theo mã dự án, để mỗi nhóm nằm liền một khối. */
export function sortProjectsForReport(
  projects: readonly ProjectSummary[],
  columns: readonly ProjectReportGroupColumn[],
): ProjectSummary[] {
  return [...projects].sort(
    (a, b) =>
      groupSlot(a, columns) - groupSlot(b, columns) ||
      a.code.localeCompare(b.code, 'vi', { numeric: true }) ||
      a.name.localeCompare(b.name, 'vi'),
  );
}

const blank = (kind: ProjectReportCellKind): ProjectReportCell => ({ kind, value: null });

/** Dựng toàn bộ trang tính của báo cáo. `now` là lúc xuất (ghi "Ngày xuất" ở dòng 1). */
export function buildProjectReportSheet(
  projects: readonly ProjectSummary[],
  catalog: readonly ProjectReportGroup[],
  lookups: ProjectReportLookups,
  now: Date = new Date(),
): ProjectReportSheet {
  const groupColumns = reportGroupColumns(catalog, projects);
  const sorted = sortProjectsForReport(projects, groupColumns);
  const groupCount = groupColumns.length;
  const trailingStart = FIRST_GROUP_COLUMN + groupCount;
  const width = trailingStart + TRAILING_HEADERS.length;
  const lastColumn = width - 1;
  const merges: ProjectReportMerge[] = [];
  const merge = (r1: number, c1: number, r2: number, c2: number) => {
    if (r1 !== r2 || c1 !== c2) merges.push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } });
  };

  // Dòng 1: tiêu đề gộp tới trước hai cột cuối; hai cột cuối là ngày xuất.
  const dateColumn = lastColumn - 1;
  const title: ProjectReportCell[] = Array.from({ length: width }, (_, c) => {
    if (c === 0) return { kind: 'title', value: PROJECT_REPORT_TITLE };
    if (c === dateColumn) return { kind: 'date', value: `Ngày xuất ${exportDate(now.toLocaleDateString('en-CA'))}` };
    return blank(c > dateColumn ? 'date' : 'title');
  });
  merge(0, 0, 0, dateColumn - 1);
  merge(0, dateColumn, 0, lastColumn);

  // Dòng 2–3: tiêu đề hai tầng.
  const upper: ProjectReportCell[] = [];
  const lower: ProjectReportCell[] = [];
  const plainHeader = (c: number): string | undefined =>
    c < FIRST_GROUP_COLUMN ? LEADING_HEADERS[c] : c >= trailingStart ? TRAILING_HEADERS[c - trailingStart] : undefined;
  for (let c = 0; c < width; c += 1) {
    const fixed = plainHeader(c);
    if (fixed !== undefined) {
      upper[c] = { kind: 'header', value: fixed };
      lower[c] = blank('header');
      merge(1, c, 2, c);
    } else {
      const slot = c - FIRST_GROUP_COLUMN;
      upper[c] = slot === 0 ? { kind: 'header', value: REPORT_GROUP_HEADER } : blank('header');
      lower[c] = { kind: 'header', value: groupColumns[slot]?.label ?? '' };
    }
  }
  merge(1, FIRST_GROUP_COLUMN, 1, trailingStart - 1);

  // Dữ liệu.
  const data: ProjectReportCell[][] = sorted.map((project, index) => {
    const value = reportContractValue(project);
    const slot = groupSlot(project, groupColumns);
    const year = projectReportYear(project);
    const statusLabel = PROJECT_STATUS_LABELS[project.status] ?? project.status;
    return [
      { kind: 'index', value: index + 1 },
      { kind: 'wrap', value: lookups.customerName(project.customerId) },
      { kind: 'wrap', value: project.name },
      { kind: 'text', value: project.code },
      { kind: 'wrap', value: project.description?.trim() ?? '' },
      { kind: 'text', value: statusLabel },
      { kind: 'number', value: value ?? null },
      { kind: 'wrap', value: lookups.orgUnitName(project.orgUnitId) },
      ...groupColumns.map((_, i): ProjectReportCell => ({ kind: 'number', value: i === slot ? (value ?? null) : null })),
      { kind: 'year', value: year ?? null },
      { kind: 'wrap', value: project.projectType?.trim() ?? '' },
    ];
  });

  // Dòng 4: tổng. Công thức SUBTOTAL(9, …) để lọc trong Excel vẫn ra tổng đúng phần đang hiện.
  const firstDataExcel = FIRST_DATA_ROW + 1;
  const lastDataExcel = FIRST_DATA_ROW + data.length;
  const totalOf = (c: number): ProjectReportCell => {
    const sum = data.reduce((acc, row) => {
      const value = row[c]?.value;
      return acc + (typeof value === 'number' ? value : 0);
    }, 0);
    // Không có dòng dữ liệu: một vùng rỗng không viết được thành công thức, ghi thẳng số 0.
    if (data.length === 0) return { kind: 'total', value: 0 };
    const letter = columnLetter(c);
    return { kind: 'total', value: sum, formula: `SUBTOTAL(9,${letter}${firstDataExcel}:${letter}${lastDataExcel})` };
  };
  const totals: ProjectReportCell[] = Array.from({ length: width }, (_, c) => {
    if (c === 0) return { kind: 'totalLabel', value: 'Tổng cộng' };
    if (c < CONTRACT_COLUMN) return blank('totalLabel');
    if (c === CONTRACT_COLUMN || (c >= FIRST_GROUP_COLUMN && c < trailingStart)) return totalOf(c);
    return blank('total');
  });
  merge(TOTAL_ROW, 0, TOTAL_ROW, CONTRACT_COLUMN - 1);

  return {
    rows: [title, upper, lower, totals, ...data],
    merges,
    columnWidths: [...LEADING_WIDTHS, ...groupColumns.map(() => GROUP_WIDTH), ...TRAILING_WIDTHS],
    groupColumns,
    projectCount: data.length,
    hasContractValues: sorted.some((project) => reportContractValue(project) !== undefined),
  };
}

/** `Bao-cao-doanh-thu-theo-linh-vuc-ngay-27112026.xlsx`. */
export function projectReportFileName(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `Bao-cao-doanh-thu-theo-linh-vuc-ngay-${pad(now.getDate())}${pad(now.getMonth() + 1)}${now.getFullYear()}.xlsx`;
}
