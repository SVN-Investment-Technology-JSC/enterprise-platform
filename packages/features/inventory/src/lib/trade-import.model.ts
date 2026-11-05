import type { ImportMaterialRow, InventoryTradeCatalog } from '@enterprise-platform/contracts-inventory';
import * as XLSX from 'xlsx';
import { categoriesOf, fold, type TradeGroup } from './trade-items.model';

/**
 * Nhập hàng hóa, dịch vụ từ tệp Excel bất kỳ (kể cả tệp xuất từ hệ cũ): đọc tiêu đề, tự đoán cột nào là trường nào
 * rồi để người dùng chỉnh, sau đó quyết định giá trị lạ (phân loại, sử dụng chưa có trong Cài đặt) và người tạo.
 * Toàn bộ logic ở đây là hàm thuần để kiểm bằng test; màn hình chỉ gọi.
 */

export type ImportFieldKey =
  | 'code'
  | 'name'
  | 'unit'
  | 'kind'
  | 'category'
  | 'usage'
  | 'price'
  | 'cost'
  | 'barcode'
  | 'manufacturer'
  | 'description'
  | 'createdBy'
  | 'createdAt'
  | 'status';

export interface ImportFieldSpec {
  readonly key: ImportFieldKey;
  readonly label: string;
  readonly required?: boolean;
  /** Tiêu đề (đã bỏ dấu, chữ thường) khớp nguyên văn. */
  readonly exact: readonly string[];
}

/** Thứ tự cũng là thứ tự gán cột khi tự đoán: một cột chỉ thuộc một trường. */
export const IMPORT_FIELDS: readonly ImportFieldSpec[] = [
  { key: 'code', label: 'Mã', required: true, exact: ['ma', 'ma dich vu', 'ma san pham', 'ma hang hoa', 'ma hang', 'ma vat tu', 'ma sku', 'sku'] },
  { key: 'name', label: 'Tên', required: true, exact: ['ten', 'ten dich vu', 'ten san pham', 'ten hang hoa', 'ten hang', 'ten vat tu'] },
  { key: 'unit', label: 'Đơn vị', required: true, exact: ['don vi', 'don vi tinh', 'dvt'] },
  { key: 'kind', label: 'Loại (Hàng hóa hoặc Dịch vụ)', exact: ['loai', 'loai mat hang', 'loai hang', 'nhom'] },
  { key: 'category', label: 'Phân loại', exact: ['phan loai', 'nhom', 'nhom dich vu', 'nhom san pham', 'nhom hang', 'nhom hang hoa'] },
  { key: 'usage', label: 'Sử dụng', exact: ['su dung', 'su dung cho', 'loai dich vu', 'hinh thuc', 'hinh thuc kinh doanh'] },
  { key: 'price', label: 'Giá bán', exact: ['gia ban', 'gia ban mac dinh'] },
  { key: 'cost', label: 'Giá vốn (giá nhập)', exact: ['gia von', 'gia von mac dinh', 'gia nhap'] },
  { key: 'barcode', label: 'Barcode', exact: ['barcode', 'ma vach'] },
  { key: 'manufacturer', label: 'Nhà sản xuất', exact: ['nha san xuat', 'hang san xuat', 'hang sx', 'thuong hieu'] },
  { key: 'description', label: 'Mô tả', exact: ['mo ta', 'ghi chu', 'thong tin dich vu', 'thong tin san pham', 'thong tin'] },
  { key: 'createdBy', label: 'Người tạo', exact: ['nguoi tao'] },
  { key: 'createdAt', label: 'Ngày tạo', exact: ['ngay tao'] },
  { key: 'status', label: 'Trạng thái', exact: ['trang thai'] },
];

export type ColumnMapping = Partial<Record<ImportFieldKey, string>>;

export interface ImportSheet {
  readonly headers: readonly string[];
  /** Mỗi dòng là tiêu đề -> giá trị thô; `line` là số dòng trong tệp (dòng 1 là tiêu đề). */
  readonly rows: readonly { readonly line: number; readonly cells: Readonly<Record<string, unknown>> }[];
}

export async function readImportSheet(file: File): Promise<ImportSheet> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return { headers: [], rows: [] };
  return sheetFromRecords(XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' }));
}

export function sheetFromRecords(records: readonly Record<string, unknown>[]): ImportSheet {
  const headers: string[] = [];
  for (const record of records) {
    for (const key of Object.keys(record)) if (!headers.includes(key)) headers.push(key);
  }
  return { headers, rows: records.map((cells, index) => ({ line: index + 2, cells })) };
}

/** Độ dài tối đa của các cột chữ trong Kho (khớp `materials`). */
const TEXT_LIMIT_MAX: Readonly<Record<'code' | 'name' | 'unit' | 'barcode' | 'manufacturer', number>> = {
  code: 100,
  name: 255,
  unit: 50,
  barcode: 100,
  manufacturer: 180,
};
const TEXT_LIMITS: readonly { key: 'code' | 'name' | 'unit' | 'barcode' | 'manufacturer'; label: string }[] = [
  { key: 'code', label: 'Mã' },
  { key: 'name', label: 'Tên' },
  { key: 'unit', label: 'Đơn vị' },
  { key: 'barcode', label: 'Barcode' },
  { key: 'manufacturer', label: 'Nhà sản xuất' },
];

const KIND_BY_FOLDED: Readonly<Record<string, TradeGroup>> = {
  'hang hoa': 'GOODS',
  'vat tu': 'GOODS',
  'dich vu': 'SERVICE',
};

function text(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function valuesOf(sheet: ImportSheet, header: string): string[] {
  return sheet.rows.map((row) => text(row.cells[header])).filter(Boolean);
}

/** Cột "Nhóm" chỉ là loại mặt hàng khi mọi giá trị là Hàng hóa, Vật tư hoặc Dịch vụ; ngược lại là phân loại. */
function looksLikeKindColumn(sheet: ImportSheet, header: string): boolean {
  const values = valuesOf(sheet, header);
  return values.length > 0 && values.every((value) => KIND_BY_FOLDED[fold(value)] !== undefined);
}

/** Đoán cột cho từng trường theo tiêu đề; chỉ nhận khớp nguyên văn nên không ghép nhầm (vd. "Đơn vị quy đổi"). */
export function detectMapping(sheet: ImportSheet): ColumnMapping {
  const mapping: ColumnMapping = {};
  const taken = new Set<string>();
  for (const field of IMPORT_FIELDS) {
    const header = sheet.headers.find(
      (candidate) =>
        !taken.has(candidate) &&
        field.exact.includes(fold(candidate)) &&
        (field.key !== 'kind' || looksLikeKindColumn(sheet, candidate)),
    );
    if (header) {
      mapping[field.key] = header;
      taken.add(header);
    }
  }
  return mapping;
}

/** Tệp toàn dịch vụ thường có "dịch vụ" ngay trong tiêu đề cột mã hoặc tên; dùng làm gợi ý loại mặc định. */
export function guessDefaultKind(sheet: ImportSheet): TradeGroup {
  const joined = sheet.headers.map(fold).join(' | ');
  return joined.includes('dich vu') && !joined.includes('san pham') && !joined.includes('hang hoa') ? 'SERVICE' : 'GOODS';
}

/** Cách xử lý một giá trị phân loại hoặc sử dụng chưa khai trong Cài đặt. */
export type ValueDecision = { action: 'add' } | { action: 'blank' } | { action: 'map'; to: string };

export interface ImportOptions {
  readonly mapping: ColumnMapping;
  /** Loại cho các dòng không có giá trị ở cột Loại (hoặc khi không ghép cột Loại). */
  readonly defaultKind: TradeGroup;
  readonly catalog?: InventoryTradeCatalog;
  /** Quyết định theo giá trị; giá trị ngoài danh mục mà không có quyết định thì mặc định là thêm vào Cài đặt. */
  readonly categoryDecisions: Readonly<Record<string, ValueDecision>>;
  readonly usageDecisions: Readonly<Record<string, ValueDecision>>;
  /** Người tạo cần để trống (đã nghỉ việc, xử lý sau); so khớp nguyên văn. */
  readonly blankAuthors: ReadonlySet<string>;
}

export interface BuiltImportRow {
  readonly line: number;
  readonly input?: ImportMaterialRow;
  readonly error?: string;
  /** Mã lặp lại ngay trong tệp: dòng sau trùng dòng trước, không phải dữ liệu lỗi cần nhập lại. */
  readonly duplicate?: boolean;
}

export interface CatalogAdditions {
  readonly goodsCategories: readonly string[];
  readonly serviceCategories: readonly string[];
  readonly usageModes: readonly string[];
}

/** Số trong ô Excel hoặc chuỗi kiểu Việt ("1.250.000", "12,5"). Trả `NaN` nếu không đọc được. */
export function parseAmount(value: unknown): number {
  if (typeof value === 'number') return value;
  const raw = text(value).replace(/\s/g, '');
  if (!raw) return NaN;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)) return Number(raw.replace(/\./g, '').replace(',', '.'));
  if (/^\d+,\d+$/.test(raw)) return Number(raw.replace(',', '.'));
  return Number(raw);
}

/** "dd/mm/yyyy" hoặc "yyyy-mm-dd" (hoặc ô ngày của Excel) thành ISO theo múi giờ Việt Nam; sai thì `undefined`. */
export function parseImportDate(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  let year: number;
  let month: number;
  let day: number;
  const vn = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(raw);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (vn) {
    [day, month, year] = [Number(vn[1]), Number(vn[2]), Number(vn[3])];
  } else if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else {
    return undefined;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const pad = (n: number) => String(n).padStart(2, '0');
  const result = `${year}-${pad(month)}-${pad(day)}T00:00:00+07:00`;
  return Number.isNaN(Date.parse(result)) ? undefined : result;
}

const ACTIVE_STATUS = new Set(['hoat dong', 'dang dung', 'dang hoat dong', 'active', 'con dung', '1', 'true']);

/** Mã vạch hỏng do lỗi mã hóa của hệ cũ (ký tự lạ như "·") thì bỏ, không nhập rác. */
function cleanBarcode(value: string): string | undefined {
  return value && /^[\w\-./ ]+$/.test(value) ? value : undefined;
}

function kindOf(row: { cells: Readonly<Record<string, unknown>> }, options: ImportOptions): TradeGroup | undefined {
  const header = options.mapping.kind;
  const value = header ? text(row.cells[header]) : '';
  if (!value) return options.defaultKind;
  return KIND_BY_FOLDED[fold(value)];
}

function resolveValue(
  value: string,
  declared: readonly string[],
  decisions: Readonly<Record<string, ValueDecision>>,
): { value?: string; add?: boolean } {
  if (!value) return {};
  // Danh mục trống nghĩa là tenant chưa khai báo gì: mọi giá trị trong tệp đều là mục mới.
  if (declared.includes(value)) return { value };
  const decision = decisions[value] ?? { action: 'add' };
  if (decision.action === 'blank') return {};
  if (decision.action === 'map') return { value: decision.to };
  return { value, add: true };
}

export function buildImportRows(sheet: ImportSheet, options: ImportOptions): BuiltImportRow[] {
  const { mapping, catalog } = options;
  const seen = new Set<string>();
  const cell = (row: { cells: Readonly<Record<string, unknown>> }, key: ImportFieldKey) => {
    const header = mapping[key];
    return header ? text(row.cells[header]) : '';
  };

  return sheet.rows.map((row) => {
    const { line } = row;
    const code = cell(row, 'code').toUpperCase();
    const name = cell(row, 'name');
    const unit = cell(row, 'unit');
    if (!code) return { line, error: 'Thiếu mã.' };
    if (!name) return { line, error: 'Thiếu tên.' };
    if (!unit) return { line, error: 'Thiếu đơn vị.' };
    if (seen.has(code)) return { line, error: `Mã ${code} bị lặp trong tệp.`, duplicate: true };
    seen.add(code);
    // Cột trong DB có độ dài giới hạn; báo ngay ở bước xem trước thay vì để Kho từ chối lúc ghi.
    const tooLong = TEXT_LIMITS.find(({ key }) => cell(row, key).length > TEXT_LIMIT_MAX[key]);
    if (tooLong) {
      return { line, error: `${tooLong.label} tối đa ${TEXT_LIMIT_MAX[tooLong.key]} ký tự (hiện ${cell(row, tooLong.key).length}).` };
    }

    const kind = kindOf(row, options);
    if (!kind) return { line, error: `Loại "${cell(row, 'kind')}" không hợp lệ (Hàng hóa hoặc Dịch vụ).` };

    const category = resolveValue(cell(row, 'category'), categoriesOf(kind, catalog), options.categoryDecisions);
    const usage = resolveValue(cell(row, 'usage'), catalog?.usageModes ?? [], options.usageDecisions);

    const amount = (key: 'price' | 'cost'): number | undefined | 'invalid' => {
      const header = mapping[key];
      if (!header || text(row.cells[header]) === '') return undefined;
      const parsed = parseAmount(row.cells[header]);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 'invalid';
    };
    const salePrice = amount('price');
    if (salePrice === 'invalid') return { line, error: 'Giá bán phải là số không âm.' };
    const purchasePrice = amount('cost');
    if (purchasePrice === 'invalid') return { line, error: 'Giá vốn phải là số không âm.' };

    const createdAtText = cell(row, 'createdAt');
    const createdAt = parseImportDate(row.cells[mapping.createdAt ?? '']);
    if (createdAtText && !createdAt) return { line, error: `Ngày tạo "${createdAtText}" không đọc được (dd/mm/yyyy).` };

    const author = cell(row, 'createdBy');
    const statusText = cell(row, 'status');

    return {
      line,
      input: {
        line,
        code,
        name,
        unit,
        category: 'CONSUMABLE',
        kind: kind === 'SERVICE' ? 'SERVICE' : 'STOCK',
        barcode: cleanBarcode(cell(row, 'barcode')),
        manufacturer: cell(row, 'manufacturer') || undefined,
        tradeCategory: category.value,
        tradeMode: usage.value,
        salePrice,
        purchasePrice,
        currency: salePrice === undefined && purchasePrice === undefined ? undefined : 'VND',
        description: cell(row, 'description') || undefined,
        createdAt,
        // Chuỗi rỗng là "không ghi người tạo": khác với bỏ trống ở tạo thường (lấy người đang đăng nhập).
        createdBy: options.blankAuthors.has(author) ? '' : author,
        isActive: statusText === '' ? true : ACTIVE_STATUS.has(fold(statusText)),
      },
    };
  });
}

/**
 * Các dòng của tệp gốc chưa nhập được, để người dùng sửa rồi nhập lại mà không dính dữ liệu đã có.
 * Gồm dòng sai ở bước kiểm tra và dòng Kho từ chối vì lỗi dữ liệu. Không gồm dòng trùng mã (trùng hàng đã có, hoặc lặp
 * trong tệp), dòng bị bỏ qua có chủ đích và dòng đã tạo hoặc cập nhật. Lỗi không gắn với dòng nào (line 0, vd. không
 * cập nhật được danh mục) nghĩa là chưa nhập gì: mọi dòng hợp lệ đều còn lại.
 */
export function unimportedLines(
  built: readonly BuiltImportRow[],
  failures: readonly { line: number; duplicate?: boolean }[],
): number[] {
  const nothingImported = failures.some((failure) => failure.line === 0);
  const failedByStore = new Set(failures.filter((failure) => !failure.duplicate).map((failure) => failure.line));
  return built
    .filter((row) => {
      if (row.duplicate) return false;
      if (row.error) return true;
      return nothingImported || failedByStore.has(row.line);
    })
    .map((row) => row.line);
}

/** Tệp gốc chỉ còn các dòng đã chọn, giữ nguyên tiêu đề, thứ tự cột và giá trị từng ô. */
export function unimportedRecords(sheet: ImportSheet, lines: readonly number[]): Record<string, unknown>[] {
  const wanted = new Set(lines);
  return sheet.rows
    .filter((row) => wanted.has(row.line))
    .map((row) => Object.fromEntries(sheet.headers.map((header) => [header, row.cells[header] ?? ''])));
}

export function downloadUnimported(sheet: ImportSheet, lines: readonly number[], sourceName: string): void {
  const ws = XLSX.utils.json_to_sheet(unimportedRecords(sheet, lines), { header: [...sheet.headers] });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const base = sourceName.replace(/\.[^.]+$/, '') || 'tep';
  XLSX.writeFile(wb, `${base}_chua_nhap.xlsx`);
}

/** Giá trị phân loại và sử dụng chưa khai trong Cài đặt, kèm danh sách người tạo, để màn hình hỏi người dùng. */
export function collectImportValues(
  sheet: ImportSheet,
  options: Pick<ImportOptions, 'mapping' | 'defaultKind' | 'catalog'>,
): { categories: string[]; usages: string[]; authors: string[] } {
  const categories = new Set<string>();
  const usages = new Set<string>();
  const authors = new Set<string>();
  for (const row of sheet.rows) {
    const kind = kindOf(row, { ...options, categoryDecisions: {}, usageDecisions: {}, blankAuthors: new Set() });
    const category = options.mapping.category ? text(row.cells[options.mapping.category]) : '';
    if (kind && category && !categoriesOf(kind, options.catalog).includes(category)) categories.add(category);
    const usage = options.mapping.usage ? text(row.cells[options.mapping.usage]) : '';
    if (usage && !(options.catalog?.usageModes ?? []).includes(usage)) usages.add(usage);
    const author = options.mapping.createdBy ? text(row.cells[options.mapping.createdBy]) : '';
    if (author) authors.add(author);
  }
  return { categories: [...categories].sort(), usages: [...usages].sort(), authors: [...authors].sort() };
}

/** Mục cần thêm vào Cài đặt để các dòng sắp nhập có phân loại, sử dụng hợp lệ. */
export function catalogAdditionsFor(rows: readonly BuiltImportRow[], options: ImportOptions): CatalogAdditions {
  const goods = new Set<string>();
  const services = new Set<string>();
  const usages = new Set<string>();
  for (const row of rows) {
    const input = row.input;
    if (!input) continue;
    const isService = input.kind === 'SERVICE';
    const category = input.tradeCategory;
    if (category && !categoriesOf(isService ? 'SERVICE' : 'GOODS', options.catalog).includes(category)) {
      (isService ? services : goods).add(category);
    }
    const usage = input.tradeMode;
    if (usage && !(options.catalog?.usageModes ?? []).includes(usage)) usages.add(usage);
  }
  return { goodsCategories: [...goods], serviceCategories: [...services], usageModes: [...usages] };
}
