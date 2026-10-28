import {
  STOCK_MOVEMENT_CATEGORIES,
  type InternalWarehouseCatalogItem,
  type InternalWarehouseCatalogQuery,
  type StockDocumentType,
  type StockMovementAmounts,
  type StockMovementBreakdownRow,
  type StockMovementCategory,
  type StockMovementSummaryRow,
  type StockQuantities,
  type TransactionType,
  type Warehouse,
} from '@enterprise-platform/contracts-inventory';
import { InventoryError } from './inventory.error.js';

/**
 * Báo cáo kho (T7-06, T7-07) và danh mục kho nội bộ (T4-19).
 *
 * Hàm thuần: phân nhóm bút toán, cộng dồn số liệu, kiểm tham số. Store chỉ lấy
 * số liệu đã gộp từ DB; quy tắc nhóm nằm ở đây để test được mà không cần DB.
 */

const round3 = (value: number): number => Math.round(value * 1000) / 1000;
const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Bốn loại tồn từ ba cột của dòng tồn; khả dụng không âm dù dữ liệu cũ lệch. */
export function stockQuantities(onHand: number, reserved: number, blocked: number): StockQuantities {
  return {
    onHand: round3(onHand),
    reserved: round3(reserved),
    blocked: round3(blocked),
    available: Math.max(round3(onHand - reserved - blocked), 0),
  };
}

/**
 * Quy tắc nhóm của báo cáo nhập xuất. Bút toán có chứng từ nhóm theo loại chứng
 * từ (chứng từ đảo luôn là REVERSAL); bút toán cũ không có chứng từ (lắp, tháo
 * thiết bị, thanh lý) nhóm theo loại bút toán.
 */
export const MOVEMENT_CATEGORY_RULES: Readonly<
  Record<
    StockMovementCategory,
    { readonly docTypes: readonly StockDocumentType[]; readonly ledgerTypes: readonly TransactionType[] }
  >
> = {
  RECEIPT: { docTypes: ['RECEIPT_PURCHASE', 'RECEIPT_OTHER'], ledgerTypes: ['IMPORT', 'RETURN'] },
  ISSUE: {
    docTypes: ['ISSUE_SALES', 'ISSUE_PROJECT', 'ISSUE_WARRANTY', 'ISSUE_OTHER'],
    ledgerTypes: ['EXPORT', 'BORROW'],
  },
  TRANSFER: {
    docTypes: ['TRANSFER', 'RECEIPT_TRANSFER', 'ISSUE_TRANSFER'],
    ledgerTypes: ['TRANSFER_IN', 'TRANSFER_OUT'],
  },
  SALES_RETURN: { docTypes: ['RECEIPT_SALES_RETURN'], ledgerTypes: [] },
  ADJUSTMENT: { docTypes: ['ADJUSTMENT'], ledgerTypes: ['ADJUST'] },
  REVERSAL: { docTypes: [], ledgerTypes: [] },
};

export interface MovementKey {
  readonly docType?: StockDocumentType;
  readonly isReversal: boolean;
  readonly ledgerType: TransactionType;
}

export function classifyMovement(key: MovementKey): StockMovementCategory {
  if (key.isReversal) return 'REVERSAL';
  for (const category of STOCK_MOVEMENT_CATEGORIES) {
    const rule = MOVEMENT_CATEGORY_RULES[category];
    if (key.docType ? rule.docTypes.includes(key.docType) : rule.ledgerTypes.includes(key.ledgerType)) {
      return category;
    }
  }
  // Loại chứng từ mới chưa khai quy tắc: theo chiều bút toán, không để rơi khỏi báo cáo.
  return key.ledgerType === 'IMPORT' || key.ledgerType === 'TRANSFER_IN' || key.ledgerType === 'RETURN'
    ? 'RECEIPT'
    : 'ISSUE';
}

export function isMovementCategory(value: string): value is StockMovementCategory {
  return (STOCK_MOVEMENT_CATEGORIES as readonly string[]).includes(value);
}

/** Một nhóm bút toán đã cộng ở DB theo (loại chứng từ, có phải chứng từ đảo, loại bút toán, kho). */
export interface MovementGroup extends MovementKey, StockMovementAmounts {
  readonly warehouseCode: string;
  readonly warehouseName: string;
}

const ZERO_AMOUNTS: StockMovementAmounts = {
  quantityIn: 0,
  quantityOut: 0,
  valueIn: 0,
  valueOut: 0,
  entries: 0,
};

function addAmounts(left: StockMovementAmounts, right: StockMovementAmounts): StockMovementAmounts {
  return {
    quantityIn: round3(left.quantityIn + right.quantityIn),
    quantityOut: round3(left.quantityOut + right.quantityOut),
    valueIn: round2(left.valueIn + right.valueIn),
    valueOut: round2(left.valueOut + right.valueOut),
    entries: left.entries + right.entries,
  };
}

function amountsOf(group: StockMovementAmounts): StockMovementAmounts {
  return {
    quantityIn: group.quantityIn,
    quantityOut: group.quantityOut,
    valueIn: group.valueIn,
    valueOut: group.valueOut,
    entries: group.entries,
  };
}

/**
 * Gộp các nhóm từ DB thành tổng theo nhóm nghiệp vụ (đủ sáu nhóm, thứ tự cố
 * định), bảng chi tiết theo (nhóm, loại chứng từ, kho) và tổng cộng.
 */
export function foldMovementGroups(groups: readonly MovementGroup[]): {
  summary: StockMovementSummaryRow[];
  breakdown: StockMovementBreakdownRow[];
  totals: StockMovementAmounts;
} {
  const byCategory = new Map<StockMovementCategory, StockMovementAmounts>(
    STOCK_MOVEMENT_CATEGORIES.map((category) => [category, ZERO_AMOUNTS]),
  );
  const breakdown = new Map<string, StockMovementBreakdownRow>();
  let totals = ZERO_AMOUNTS;
  for (const group of groups) {
    const category = classifyMovement(group);
    const amounts = amountsOf(group);
    byCategory.set(category, addAmounts(byCategory.get(category) ?? ZERO_AMOUNTS, amounts));
    totals = addAmounts(totals, amounts);
    const key = `${category}|${group.docType ?? ''}|${group.warehouseCode}`;
    const previous = breakdown.get(key);
    breakdown.set(key, {
      category,
      docType: group.docType,
      warehouseCode: group.warehouseCode,
      warehouseName: group.warehouseName,
      ...addAmounts(previous ?? ZERO_AMOUNTS, amounts),
    });
  }
  const order = (category: StockMovementCategory) => STOCK_MOVEMENT_CATEGORIES.indexOf(category);
  return {
    summary: STOCK_MOVEMENT_CATEGORIES.map((category) => ({
      category,
      ...(byCategory.get(category) ?? ZERO_AMOUNTS),
    })),
    breakdown: [...breakdown.values()].sort(
      (left, right) =>
        order(left.category) - order(right.category) ||
        (left.docType ?? '').localeCompare(right.docType ?? '') ||
        left.warehouseCode.localeCompare(right.warehouseCode),
    ),
    totals,
  };
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Số ngày từ `from` tới `to` (YYYY-MM-DD); âm khi `to` trước `from`. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Kỳ báo cáo tối đa: dài hơn thì một lần gọi quét gần hết sổ kho. */
export const MAX_REPORT_PERIOD_DAYS = 366 * 3;

/**
 * Kỳ báo cáo theo ngày Việt Nam, gồm cả hai đầu. Bỏ trống `fromDate` thì lấy
 * ngày đầu tháng của `toDate`; bỏ trống `toDate` thì lấy hôm nay.
 */
export function resolveReportPeriod(
  fromDate: string | undefined,
  toDate: string | undefined,
  today: string,
): { fromDate: string; toDate: string } {
  const to = toDate?.trim() || today;
  const from = fromDate?.trim() || `${to.slice(0, 8)}01`;
  if (!isValidDate(from) || !isValidDate(to)) {
    throw new InventoryError('VALIDATION', 'Ngày của kỳ báo cáo không hợp lệ (định dạng YYYY-MM-DD).');
  }
  if (from > to) {
    throw new InventoryError('VALIDATION', 'Ngày bắt đầu kỳ báo cáo phải trước hoặc bằng ngày kết thúc.');
  }
  if (daysBetween(from, to) > MAX_REPORT_PERIOD_DAYS) {
    throw new InventoryError('VALIDATION', 'Kỳ báo cáo dài tối đa 3 năm.');
  }
  return { fromDate: from, toDate: to };
}

export const DEFAULT_REPORT_LIMIT = 50;
export const MAX_REPORT_LIMIT = 1000;

/** Trang của báo cáo: `limit` 1 đến 1000 (mặc định 50), `offset` không âm. */
export function resolveReportPaging(
  limit: number | string | undefined,
  offset: number | string | undefined,
): { limit: number; offset: number } {
  const parsedLimit = limit === undefined || limit === '' ? DEFAULT_REPORT_LIMIT : Number(limit);
  const parsedOffset = offset === undefined || offset === '' ? 0 : Number(offset);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_REPORT_LIMIT) {
    throw new InventoryError('VALIDATION', `Số dòng mỗi trang phải từ 1 đến ${MAX_REPORT_LIMIT}.`);
  }
  if (!Number.isInteger(parsedOffset) || parsedOffset < 0) {
    throw new InventoryError('VALIDATION', 'Vị trí trang không hợp lệ.');
  }
  return { limit: parsedLimit, offset: parsedOffset };
}

/** Số ngày lọc lô sắp hết hạn: số nguyên 0 đến 3650. */
export function resolveExpiringWithinDays(value: number | string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const days = Number(value);
  if (!Number.isInteger(days) || days < 0 || days > 3650) {
    throw new InventoryError('VALIDATION', 'Số ngày sắp hết hạn phải là số nguyên từ 0 đến 3650.');
  }
  return days;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lọc danh mục kho cho phân hệ khác. Bảng kho nhỏ (vài chục dòng) nên lọc
 * trong bộ nhớ. Mã so không phân biệt hoa thường; có `codes` hoặc `ids` thì kho
 * phải khớp một trong hai danh sách.
 */
export function filterWarehouseCatalog(
  warehouses: readonly Warehouse[],
  query: InternalWarehouseCatalogQuery,
): InternalWarehouseCatalogItem[] {
  const ids = (query.ids ?? []).map((id) => id.trim()).filter(Boolean);
  if (ids.some((id) => !UUID_PATTERN.test(id))) {
    throw new InventoryError('VALIDATION', 'Danh sách id kho không hợp lệ.');
  }
  const idSet = new Set(ids.map((id) => id.toLowerCase()));
  const codeSet = new Set(
    (query.codes ?? []).map((code) => code.trim().toUpperCase()).filter(Boolean),
  );
  const search = query.search?.trim().toLocaleLowerCase('vi');
  return warehouses
    .filter((warehouse) => query.includeInactive || warehouse.isActive)
    .filter(
      (warehouse) =>
        (!idSet.size && !codeSet.size) ||
        idSet.has(warehouse.id.toLowerCase()) ||
        codeSet.has(warehouse.code.toUpperCase()),
    )
    .filter(
      (warehouse) =>
        !search ||
        warehouse.code.toLocaleLowerCase('vi').includes(search) ||
        warehouse.name.toLocaleLowerCase('vi').includes(search),
    )
    .map((warehouse) => ({
      id: warehouse.id,
      code: warehouse.code,
      name: warehouse.name,
      isActive: warehouse.isActive,
      type: warehouse.type,
    }))
    .sort((left, right) => left.code.localeCompare(right.code));
}
