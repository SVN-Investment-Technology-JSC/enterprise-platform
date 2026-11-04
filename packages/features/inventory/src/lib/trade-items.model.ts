import type {
  CreateMaterialRequest,
  InventoryTradeCatalog,
  Material,
} from '@enterprise-platform/contracts-inventory';
import * as XLSX from 'xlsx';

/** Nhóm trên trang: dịch vụ không quản lý tồn, còn lại là hàng hóa. */
export type TradeGroup = 'GOODS' | 'SERVICE';

export const TRADE_GROUP_LABEL: Readonly<Record<TradeGroup, string>> = {
  GOODS: 'Hàng hóa',
  SERVICE: 'Dịch vụ',
};

/** Số bản ghi mỗi trang của bảng Hàng hóa và bảng Nhà kho. */
export const PAGE_SIZES = [15, 30, 45] as const;

/**
 * Mã "hình thức" của bản đầu. Dòng cũ còn lưu mã; từ nay "Sử dụng" là chuỗi admin khai trong Cài đặt,
 * nên mã cũ chỉ được đổi sang nhãn khi hiển thị, không ghi đè dữ liệu.
 */
const LEGACY_USAGE_LABEL: Readonly<Record<string, string>> = {
  SALE_ONLY: 'Chỉ bán',
  GIFT_ONLY: 'Chỉ tặng',
  INTERNAL_ONLY: 'Chỉ dùng nội bộ',
  MULTI: 'Nhiều hình thức',
};

/** Nhãn "Sử dụng" để hiển thị và so khớp; rỗng khi chưa khai. */
export function usageLabel(mode?: string): string {
  const value = (mode ?? '').trim();
  return LEGACY_USAGE_LABEL[value] ?? value;
}

export function tradeGroupOf(item: Pick<Material, 'kind'>): TradeGroup {
  return item.kind === 'SERVICE' ? 'SERVICE' : 'GOODS';
}

/** Danh mục phân loại của một nhóm; hàng hóa và dịch vụ mỗi nhóm một danh sách riêng. */
export function categoriesOf(group: TradeGroup, catalog?: InventoryTradeCatalog): readonly string[] {
  return (group === 'SERVICE' ? catalog?.serviceCategories : catalog?.goodsCategories) ?? [];
}

export interface Choice {
  readonly value: string;
  readonly label: string;
}

function distinct(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.map((value) => (value ?? '').trim()).filter(Boolean))];
}

/**
 * Lựa chọn ô lọc "Phân loại": danh mục đã khai cộng giá trị mặt hàng đang dùng (để mặt hàng cũ vẫn lọc được
 * sau khi admin bỏ mục đó). Chọn nhóm thì chỉ hiện phân loại của nhóm đó.
 */
export function categoryChoices(
  items: readonly Material[],
  catalog: InventoryTradeCatalog | undefined,
  group: TradeGroup | '',
): Choice[] {
  const groups: TradeGroup[] = group ? [group] : ['GOODS', 'SERVICE'];
  const declared = groups.flatMap((g) => categoriesOf(g, catalog));
  const used = items.filter((item) => !group || tradeGroupOf(item) === group).map((item) => item.tradeCategory);
  return distinct([...declared, ...used]).map((value) => ({ value, label: value }));
}

/** Lựa chọn ô lọc "Sử dụng": danh mục đã khai cộng giá trị đang dùng, mã cũ đã đổi sang nhãn. */
export function usageChoices(items: readonly Material[], catalog: InventoryTradeCatalog | undefined): Choice[] {
  return distinct([...(catalog?.usageModes ?? []), ...items.map((item) => usageLabel(item.tradeMode))]).map(
    (value) => ({ value, label: value }),
  );
}

export interface TradeFilter {
  readonly search: string;
  readonly group: TradeGroup | '';
  /** Phân loại; so khớp nguyên văn. */
  readonly category: string;
  /** Nhãn "Sử dụng" (đã đổi mã cũ sang nhãn). */
  readonly usage: string;
  /** Chỉ mặt hàng còn dùng (mặc định) hay cả mặt hàng đã ngừng. */
  readonly includeInactive: boolean;
}

export const EMPTY_FILTER: TradeFilter = { search: '', group: '', category: '', usage: '', includeInactive: false };

/** So khớp không phân biệt hoa thường và dấu tiếng Việt. */
export function fold(value: string | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');
}

export function filterTradeItems(items: readonly Material[], filter: TradeFilter): Material[] {
  const term = fold(filter.search.trim());
  return items.filter((item) => {
    if (!filter.includeInactive && !item.isActive) return false;
    if (filter.group && tradeGroupOf(item) !== filter.group) return false;
    if (filter.category && (item.tradeCategory ?? '').trim() !== filter.category) return false;
    if (filter.usage && usageLabel(item.tradeMode) !== filter.usage) return false;
    if (!term) return true;
    return [item.code, item.name, item.barcode].some((value) => fold(value).includes(term));
  });
}

export interface Page<T> {
  readonly rows: T[];
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
  /** Số thứ tự (1-based) của dòng đầu và dòng cuối trang; 0 khi rỗng. */
  readonly from: number;
  readonly to: number;
}

/** Cắt một trang; số trang quá lớn (sau khi lọc ra ít dòng hơn) thì lùi về trang cuối. */
export function paginate<T>(rows: readonly T[], page: number, pageSize: number): Page<T> {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  const start = (current - 1) * pageSize;
  const slice = rows.slice(start, start + pageSize);
  return {
    rows: slice,
    page: current,
    pageCount,
    total,
    from: total === 0 ? 0 : start + 1,
    to: start + slice.length,
  };
}

/** Giá bán hiển thị; chưa khai khác 0. */
export function formatSalePrice(price?: number): string {
  return price === undefined || price === null ? '—' : `${new Intl.NumberFormat('vi-VN').format(price)} đ`;
}

// ---------------------------------------------------------------------------
// Xuất / nhập Excel
// ---------------------------------------------------------------------------

const EXPORT_HEADERS = {
  code: 'Mã',
  name: 'Tên',
  barcode: 'Barcode',
  group: 'Nhóm',
  category: 'Phân loại',
  unit: 'Đơn vị',
  usage: 'Sử dụng',
  price: 'Giá bán',
} as const;

export function toExportRows(items: readonly Material[]): Record<string, string | number>[] {
  return items.map((item) => ({
    [EXPORT_HEADERS.code]: item.code,
    [EXPORT_HEADERS.name]: item.name,
    [EXPORT_HEADERS.barcode]: item.barcode ?? '',
    [EXPORT_HEADERS.group]: TRADE_GROUP_LABEL[tradeGroupOf(item)],
    [EXPORT_HEADERS.category]: item.tradeCategory ?? '',
    [EXPORT_HEADERS.unit]: item.unit,
    [EXPORT_HEADERS.usage]: usageLabel(item.tradeMode),
    [EXPORT_HEADERS.price]: item.salePrice ?? '',
  }));
}

export function exportTradeItems(items: readonly Material[]): void {
  const ws = XLSX.utils.json_to_sheet(toExportRows(items));
  ws['!cols'] = [{ wch: 16 }, { wch: 40 }, { wch: 18 }, { wch: 12 }, { wch: 20 }, { wch: 10 }, { wch: 18 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'HangHoa');
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  XLSX.writeFile(wb, `Hang_hoa_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.xlsx`);
}

/** Tệp mẫu để người dùng điền rồi nhập lại. */
export function downloadTradeTemplate(): void {
  const sample = [
    {
      [EXPORT_HEADERS.code]: 'VT-001',
      [EXPORT_HEADERS.name]: 'Cáp điện 3 lõi',
      [EXPORT_HEADERS.barcode]: '8930000000011',
      [EXPORT_HEADERS.group]: 'Hàng hóa',
      [EXPORT_HEADERS.category]: '',
      [EXPORT_HEADERS.unit]: 'Mét',
      [EXPORT_HEADERS.usage]: 'Chỉ bán',
      [EXPORT_HEADERS.price]: 45000,
    },
  ];
  const ws = XLSX.utils.json_to_sheet(sample);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'HangHoa');
  XLSX.writeFile(wb, 'Mau_nhap_hang_hoa.xlsx');
}

export interface ImportRow {
  /** Số dòng trong tệp (dòng 1 là tiêu đề). */
  readonly line: number;
  readonly input?: CreateMaterialRequest;
  readonly error?: string;
}

/** Chấp nhận cả "Vật tư" của tệp mẫu cũ. */
const GROUP_BY_FOLDED: Readonly<Record<string, TradeGroup>> = {
  'hang hoa': 'GOODS',
  'vat tu': 'GOODS',
  'dich vu': 'SERVICE',
};

function cell(row: Record<string, unknown>, header: string): string {
  const value = row[header];
  return value === undefined || value === null ? '' : String(value).trim();
}

/**
 * Đổi các dòng đọc từ Excel thành yêu cầu tạo; dòng sai được giữ lại kèm lý do để báo người dùng.
 * Có danh mục (và danh sách đó không rỗng) thì phân loại và sử dụng phải nằm trong danh mục, không tự thêm giá trị lạ.
 */
export function parseImportRows(
  rows: readonly Record<string, unknown>[],
  catalog?: InventoryTradeCatalog,
): ImportRow[] {
  const seen = new Set<string>();
  return rows.map((row, index) => {
    const line = index + 2;
    const code = cell(row, EXPORT_HEADERS.code).toUpperCase();
    const name = cell(row, EXPORT_HEADERS.name);
    const unit = cell(row, EXPORT_HEADERS.unit);
    if (!code) return { line, error: 'Thiếu mã.' };
    if (!name) return { line, error: 'Thiếu tên.' };
    if (!unit) return { line, error: 'Thiếu đơn vị.' };
    if (seen.has(code)) return { line, error: `Mã ${code} bị lặp trong tệp.` };
    seen.add(code);

    const groupText = cell(row, EXPORT_HEADERS.group);
    const group = groupText ? GROUP_BY_FOLDED[fold(groupText)] : 'GOODS';
    if (!group) return { line, error: `Nhóm "${groupText}" không hợp lệ (Hàng hóa hoặc Dịch vụ).` };

    const categoryText = cell(row, EXPORT_HEADERS.category);
    const categories = categoriesOf(group, catalog);
    if (categoryText && categories.length > 0 && !categories.includes(categoryText)) {
      return { line, error: `Phân loại "${categoryText}" chưa khai báo trong Cài đặt.` };
    }

    // Mã cũ (SALE_ONLY...) đổi sang nhãn trước khi so với danh mục.
    const usageText = usageLabel(cell(row, EXPORT_HEADERS.usage));
    const usageModes = catalog?.usageModes ?? [];
    if (usageText && usageModes.length > 0 && !usageModes.includes(usageText)) {
      return { line, error: `Sử dụng "${usageText}" chưa khai báo trong Cài đặt.` };
    }

    const priceText = cell(row, EXPORT_HEADERS.price);
    let salePrice: number | undefined;
    if (priceText) {
      salePrice = Number(priceText.replace(/[.\s]/g, '').replace(',', '.'));
      if (!Number.isFinite(salePrice) || salePrice < 0) return { line, error: 'Giá bán phải là số không âm.' };
    }

    return {
      line,
      input: {
        code,
        name,
        unit,
        category: 'CONSUMABLE',
        kind: group === 'SERVICE' ? 'SERVICE' : 'STOCK',
        barcode: cell(row, EXPORT_HEADERS.barcode) || undefined,
        tradeCategory: categoryText || undefined,
        tradeMode: usageText || undefined,
        salePrice,
        currency: salePrice === undefined ? undefined : 'VND',
      },
    };
  });
}

export async function readImportFile(file: File, catalog?: InventoryTradeCatalog): Promise<ImportRow[]> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];
  return parseImportRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' }), catalog);
}
