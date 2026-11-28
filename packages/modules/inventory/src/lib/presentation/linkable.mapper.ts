import type {
  Asset,
  AssetCriticality,
  Material,
  MaterialCategory,
  StockDocument,
  StockDocumentType,
  StocktakeScopeType,
  StocktakeSession,
  StocktakeStatus,
} from '@enterprise-platform/contracts-inventory';
import type {
  LinkableCandidate,
  LinkableField,
  LinkableKind,
  LinkableObject,
  LinkableRef,
} from '@enterprise-platform/contracts-integration';
import { STOCK_DOCUMENT_STATUS_LABELS } from '../domain/stock-document-policy.js';

/**
 * Kho công bố hồ sơ của mình cho module khác gắn vào (hợp đồng `LinkableObject` ở `contracts-integration`).
 *
 * Chỉ chuyển dạng dữ liệu mà service sẵn có đã trả (cùng `list`, `get` mà màn Kho dùng); không đọc thêm gì.
 * `label` chỉ gồm mã và tên ngắn, không số tiền: bên gắn lưu nhãn này và ai trong dự án cũng thấy. Giá trị tiền nằm ở
 * `fields`, chỉ đọc trực tiếp mỗi lần xem nên người không vào được Kho thì không thấy.
 *
 * Chứng từ kho chia theo nhóm loại như báo cáo xuất nhập (`MOVEMENT_CATEGORY_RULES`): nhập, xuất, điều chuyển,
 * điều chỉnh. Vật tư, tài sản dùng mã làm id vì mã là khoá nghiệp vụ, không sửa được, và route chi tiết đọc theo mã.
 */
export const INVENTORY_LINKABLE_KINDS = {
  receipt: 'inventory.receipt',
  issue: 'inventory.issue',
  transfer: 'inventory.transfer',
  adjustment: 'inventory.adjustment',
  stocktake: 'inventory.stocktake',
  material: 'inventory.material',
  asset: 'inventory.asset',
} as const;

export type InventoryLinkableKind = (typeof INVENTORY_LINKABLE_KINDS)[keyof typeof INVENTORY_LINKABLE_KINDS];

/** Loại là chứng từ kho (`v1/stock-documents`). */
export type InventoryDocumentKind = Extract<
  InventoryLinkableKind,
  'inventory.receipt' | 'inventory.issue' | 'inventory.transfer' | 'inventory.adjustment'
>;

const MODULE_LABEL = 'Kho';

/** Thứ tự theo cách người dùng hay tìm: chứng từ trước, kiểm kê, rồi danh mục vật tư và tài sản. */
export const INVENTORY_LINKABLE_KIND_LIST: readonly LinkableKind[] = [
  { key: INVENTORY_LINKABLE_KINDS.receipt, moduleLabel: MODULE_LABEL, label: 'Phiếu nhập kho', prefill: false },
  { key: INVENTORY_LINKABLE_KINDS.issue, moduleLabel: MODULE_LABEL, label: 'Phiếu xuất kho', prefill: false },
  { key: INVENTORY_LINKABLE_KINDS.transfer, moduleLabel: MODULE_LABEL, label: 'Phiếu chuyển kho', prefill: false },
  {
    key: INVENTORY_LINKABLE_KINDS.adjustment,
    moduleLabel: MODULE_LABEL,
    label: 'Phiếu điều chỉnh kho',
    prefill: false,
  },
  { key: INVENTORY_LINKABLE_KINDS.stocktake, moduleLabel: MODULE_LABEL, label: 'Phiếu kiểm kê', prefill: false },
  { key: INVENTORY_LINKABLE_KINDS.material, moduleLabel: MODULE_LABEL, label: 'Vật tư', prefill: false },
  { key: INVENTORY_LINKABLE_KINDS.asset, moduleLabel: MODULE_LABEL, label: 'Tài sản', prefill: false },
];

export function isInventoryLinkableKind(value: unknown): value is InventoryLinkableKind {
  return INVENTORY_LINKABLE_KIND_LIST.some((kind) => kind.key === value);
}

/** Loại chứng từ của từng nhóm; cùng cách gộp với báo cáo xuất nhập của Kho. */
export const DOCUMENT_TYPES_BY_KIND: Readonly<Record<InventoryDocumentKind, readonly StockDocumentType[]>> = {
  'inventory.receipt': ['RECEIPT_PURCHASE', 'RECEIPT_SALES_RETURN', 'RECEIPT_OTHER'],
  'inventory.issue': ['ISSUE_SALES', 'ISSUE_PROJECT', 'ISSUE_WARRANTY', 'ISSUE_OTHER'],
  'inventory.transfer': ['TRANSFER', 'RECEIPT_TRANSFER', 'ISSUE_TRANSFER'],
  'inventory.adjustment': ['ADJUSTMENT'],
};

export function isDocumentKind(kind: InventoryLinkableKind): kind is InventoryDocumentKind {
  return kind in DOCUMENT_TYPES_BY_KIND;
}

/** Nhóm loại (khoá loại liên kết) của một chứng từ kho. */
export function documentKindOf(docType: StockDocumentType): InventoryDocumentKind {
  const kinds = Object.keys(DOCUMENT_TYPES_BY_KIND) as InventoryDocumentKind[];
  return kinds.find((kind) => DOCUMENT_TYPES_BY_KIND[kind].includes(docType)) ?? INVENTORY_LINKABLE_KINDS.adjustment;
}

/** Mã hoá một đoạn đường dẫn, kể cả `!'()*` mà `encodeURIComponent` để nguyên (bên gọi chỉ nhận ký tự an toàn). */
function segment(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Đường dẫn mở hồ sơ trong giao diện Kho (điều hướng bằng hash).
 *
 * Chứng từ mở thẳng chi tiết (`#stock/movements/<id>`), tài sản chọn sẵn trên cây tài sản (`#assets/<mã>`). Phiếu
 * kiểm kê và vật tư chưa có hash mở thẳng một hồ sơ, nên mở trang Kho hàng (`#stock`) để người dùng tìm theo mã.
 */
export function inventoryLaunchUrl(kind: InventoryLinkableKind, id: string): string {
  if (isDocumentKind(kind)) return `/modules/inventory#stock/movements/${segment(id)}`;
  if (kind === INVENTORY_LINKABLE_KINDS.asset) return `/modules/inventory#assets/${segment(id)}`;
  return '/modules/inventory#stock';
}

/* ------------------------------------------------------------------ Nhãn */

const DOCUMENT_TYPE_LABELS: Readonly<Record<StockDocumentType, string>> = {
  RECEIPT_PURCHASE: 'Nhập mua hàng',
  RECEIPT_SALES_RETURN: 'Nhập trả hàng bán',
  RECEIPT_TRANSFER: 'Nhập điều chuyển',
  RECEIPT_OTHER: 'Nhập khác',
  ISSUE_SALES: 'Xuất bán hàng',
  ISSUE_PROJECT: 'Xuất cho dự án',
  ISSUE_WARRANTY: 'Xuất bảo hành',
  ISSUE_TRANSFER: 'Xuất điều chuyển',
  ISSUE_OTHER: 'Xuất khác',
  ADJUSTMENT: 'Điều chỉnh tồn',
  TRANSFER: 'Điều chuyển kho',
};

/** Nguồn phát sinh của chứng từ, cùng nhãn với màn Kho; mã chưa có nhãn hiện nguyên văn. */
const SOURCE_TYPE_LABELS: Readonly<Record<string, string>> = {
  manual: 'Thủ công',
  crm_order: 'Đơn bán',
  crm_sales_order: 'Đơn bán',
  crm_delivery: 'Đợt giao hàng',
  crm_warranty: 'Bảo hành',
  crm_return: 'Trả hàng',
  procedure: 'Quy trình',
  procedure_instance: 'Quy trình',
  maintenance: 'Bảo trì',
  stocktake: 'Kiểm kê',
  asset: 'Thiết bị vận hành',
  opening_balance: 'Tồn đầu kỳ',
};

const STOCKTAKE_STATUS_LABELS: Readonly<Record<StocktakeStatus, string>> = {
  DRAFT: 'Bản nháp',
  COUNTING: 'Đang kiểm đếm',
  PENDING_APPROVAL: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  POSTED: 'Đã ghi sổ',
  CANCELLED: 'Đã huỷ',
};

const STOCKTAKE_SCOPE_LABELS: Readonly<Record<StocktakeScopeType, string>> = {
  ALL: 'Toàn kho',
  CATEGORY: 'Theo nhóm vật tư',
  SPECIFIC_ITEMS: 'Theo mặt hàng chọn',
};

const MATERIAL_CATEGORY_LABELS: Readonly<Record<MaterialCategory, string>> = {
  SPARE_PART: 'Phụ tùng',
  CONSUMABLE: 'Vật tư tiêu hao',
  TOOL: 'Dụng cụ',
  ROTABLE: 'Vật tư luân chuyển',
};

const ASSET_STATUS_LABELS: Readonly<Record<string, string>> = {
  OPERATING: 'Đang vận hành',
  STOPPED: 'Đang dừng',
  MAINTENANCE: 'Đang bảo trì',
  DISPOSED: 'Đã thanh lý',
};

const ASSET_CRITICALITY_LABELS: Readonly<Record<AssetCriticality, string>> = {
  CRITICAL: 'Trọng yếu',
  HIGH: 'Cao',
  MEDIUM: 'Trung bình',
  LOW: 'Thấp',
};

const ASSET_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  INDUSTRIAL: 'Thiết bị công nghiệp',
  IT_OFFICE: 'Thiết bị CNTT, văn phòng',
  TOOL_PPE: 'Dụng cụ, bảo hộ lao động',
  VEHICLE: 'Phương tiện',
};

function sourceTypeLabel(value: string | undefined): string {
  const code = value?.trim();
  if (!code) return 'Thủ công';
  return SOURCE_TYPE_LABELS[code.toLowerCase()] ?? code;
}

/* ------------------------------------------------------------------ Tiện ích */

const joined = (...parts: readonly (string | null | undefined)[]) =>
  parts.filter((part): part is string => Boolean(part && part.trim())).join(' — ');
const listed = (...parts: readonly (string | null | undefined)[]) =>
  parts.filter((part): part is string => Boolean(part && part.trim())).join(' · ');
const day = (value: string | null | undefined) => (value ? value.slice(0, 10) : null);
const text = (key: string, label: string, value: string | number | null | undefined): LinkableField => ({
  key,
  label,
  type: 'text',
  value: value == null || value === '' ? null : String(value),
});
const date = (key: string, label: string, value: string | null | undefined): LinkableField => ({
  key,
  label,
  type: 'date',
  value: day(value),
});
const money = (key: string, label: string, value: number | null | undefined): LinkableField => ({
  key,
  label,
  type: 'money',
  value: value == null || !Number.isFinite(value) ? null : value,
});
/** Số lượng gọn: bỏ đuôi thập phân thừa do cộng số thực. */
const quantity = (value: number) => String(Math.round(value * 1000) / 1000);

/** Chuỗi so khớp: chữ thường, bỏ dấu tiếng Việt, để "phieu nhap" khớp "Phiếu nhập". */
export function foldSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

/** Mọi từ trong `q` đều có trong một trong các trường của dòng. */
export function matchesSearch(q: string, parts: readonly (string | null | undefined)[]): boolean {
  const haystack = foldSearchText(parts.filter(Boolean).join(' '));
  return foldSearchText(q)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/** Mới nhất trước; dòng không có ngày tạo xếp cuối, giữ thứ tự mã. */
export function newestFirst<T extends { readonly createdAt?: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''));
}

/* ------------------------------------------------------------------ Chứng từ kho */

function warehouseText(row: StockDocument): string {
  return row.targetWarehouseCode ? `${row.warehouseCode} → ${row.targetWarehouseCode}` : row.warehouseCode;
}

/** Các trường tìm kiếm của chứng từ: mã, loại, kho, ghi chú, mã và tên vật tư trên dòng. */
export function documentSearchParts(row: StockDocument): readonly (string | undefined)[] {
  return [
    row.code,
    DOCUMENT_TYPE_LABELS[row.docType],
    row.warehouseCode,
    row.targetWarehouseCode,
    row.note,
    ...row.lines.flatMap((line) => [line.materialCode, line.materialName]),
  ];
}

export function documentCandidate(row: StockDocument): LinkableCandidate {
  return {
    kind: documentKindOf(row.docType),
    id: row.id,
    code: row.code,
    label: joined(row.code, DOCUMENT_TYPE_LABELS[row.docType] ?? row.docType),
    status: STOCK_DOCUMENT_STATUS_LABELS[row.status] ?? row.status,
    hint: listed(`Kho ${warehouseText(row)}`, day(row.documentDate)),
  };
}

export function documentObject(row: StockDocument): LinkableObject {
  const kind = documentKindOf(row.docType);
  const totalQuantity = row.lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
  // Giá trị theo giá vốn: dòng đã ghi sổ có `costAmount`, dòng nháp lấy số lượng nhân đơn giá đã khai.
  const totalValue = row.lines.reduce(
    (sum, line) => sum + (line.costAmount ?? (Number(line.quantity) || 0) * (Number(line.unitCost) || 0)),
    0,
  );
  const upstream: LinkableRef[] = [];
  if (row.reversesDocumentId) {
    // Chứng từ đảo giữ nguyên loại của chứng từ gốc nên cùng nhóm loại.
    upstream.push({ kind, id: row.reversesDocumentId, label: 'Chứng từ gốc' });
  }
  if (row.sourceType === 'stocktake' && row.sourceId) {
    upstream.push({ kind: INVENTORY_LINKABLE_KINDS.stocktake, id: row.sourceId, label: 'Đợt kiểm kê' });
  }
  return {
    ...documentCandidate(row),
    launchUrl: inventoryLaunchUrl(kind, row.id),
    fields: [
      text('docType', 'Loại chứng từ', DOCUMENT_TYPE_LABELS[row.docType] ?? row.docType),
      date('documentDate', 'Ngày chứng từ', row.documentDate),
      text('warehouse', row.targetWarehouseCode ? 'Kho xuất' : 'Kho', row.warehouseCode),
      ...(row.targetWarehouseCode ? [text('targetWarehouse', 'Kho nhận', row.targetWarehouseCode)] : []),
      text('status', 'Trạng thái', STOCK_DOCUMENT_STATUS_LABELS[row.status] ?? row.status),
      text('source', 'Nguồn phát sinh', sourceTypeLabel(row.sourceType)),
      text('lineCount', 'Số dòng', row.lines.length),
      text('totalQuantity', 'Tổng số lượng', quantity(totalQuantity)),
      money('totalValue', 'Giá trị', row.lines.length ? totalValue : null),
      date('postedAt', 'Ngày ghi sổ', row.postedAt),
      text('note', 'Ghi chú', row.note),
    ],
    upstream,
  };
}

/* ------------------------------------------------------------------ Kiểm kê */

function stocktakeWarehouse(row: StocktakeSession): string {
  return joined(row.warehouseCode, row.warehouseName);
}

export function stocktakeCandidate(row: StocktakeSession): LinkableCandidate {
  return {
    kind: INVENTORY_LINKABLE_KINDS.stocktake,
    id: row.id,
    code: row.code,
    label: joined(row.code, row.title),
    status: STOCKTAKE_STATUS_LABELS[row.status] ?? row.status,
    hint: listed(`Kho ${row.warehouseCode}`, day(row.stocktakeDate ?? row.createdAt)),
  };
}

export function stocktakeObject(row: StocktakeSession): LinkableObject {
  return {
    ...stocktakeCandidate(row),
    launchUrl: inventoryLaunchUrl(INVENTORY_LINKABLE_KINDS.stocktake, row.id),
    fields: [
      text('title', 'Tên đợt kiểm kê', row.title),
      text('warehouse', 'Kho', stocktakeWarehouse(row)),
      date('stocktakeDate', 'Ngày kiểm kê', row.stocktakeDate ?? row.createdAt),
      text('status', 'Trạng thái', STOCKTAKE_STATUS_LABELS[row.status] ?? row.status),
      text('scope', 'Phạm vi', STOCKTAKE_SCOPE_LABELS[row.scopeType] ?? row.scopeType),
      text('leadAuditor', 'Trưởng ban kiểm kê', row.leadAuditor),
      text('totalItems', 'Số mặt hàng', row.totalItems),
      text('countedItems', 'Đã kiểm đếm', row.countedItems),
      text('differenceItems', 'Mặt hàng chênh lệch', row.differenceItems),
      money('totalVarianceValue', 'Giá trị chênh lệch', row.totalVarianceValue),
      text('document', 'Chứng từ điều chỉnh', row.documentCode),
      date('postedAt', 'Ngày ghi sổ', row.postedAt),
      text('note', 'Ghi chú', row.note),
    ],
    upstream: [],
  };
}

/* ------------------------------------------------------------------ Vật tư */

export function materialSearchParts(row: Material): readonly (string | undefined)[] {
  return [row.code, row.name, row.barcode, row.tradeCategory, row.type, row.manufacturer, row.supplier];
}

export function materialCandidate(row: Material): LinkableCandidate {
  return {
    kind: INVENTORY_LINKABLE_KINDS.material,
    id: row.code,
    code: row.code,
    label: joined(row.code, row.name),
    status: row.isActive ? 'Đang dùng' : 'Ngừng dùng',
    hint: listed(
      row.kind === 'SERVICE' ? 'Dịch vụ' : (MATERIAL_CATEGORY_LABELS[row.category] ?? row.category),
      row.unit ? `ĐVT ${row.unit}` : null,
    ),
  };
}

export function materialObject(row: Material): LinkableObject {
  return {
    ...materialCandidate(row),
    launchUrl: inventoryLaunchUrl(INVENTORY_LINKABLE_KINDS.material, row.code),
    fields: [
      text('name', 'Tên vật tư', row.name),
      text('kind', 'Loại mặt hàng', row.kind === 'SERVICE' ? 'Dịch vụ' : 'Hàng hoá'),
      text('category', 'Nhóm vật tư', MATERIAL_CATEGORY_LABELS[row.category] ?? row.category),
      text('type', 'Loại', row.type),
      text('tradeCategory', 'Phân loại', row.tradeCategory),
      text('unit', 'Đơn vị tính', row.unit),
      text('barcode', 'Mã vạch', row.barcode),
      text('tracking', 'Theo dõi serial', row.isSerialized ? 'Có' : 'Không'),
      text('stockRange', 'Tồn tối thiểu / tối đa', `${quantity(row.minStock)} / ${quantity(row.maxStock)}`),
      text('supplier', 'Nhà cung cấp', row.supplier),
      text('manufacturer', 'Hãng sản xuất', row.manufacturer),
      money('purchasePrice', 'Giá nhập', row.purchasePrice),
      money('salePrice', 'Giá bán', row.salePrice),
      text('warranty', 'Bảo hành', row.warrantyMonths == null ? null : `${row.warrantyMonths} tháng`),
      text('description', 'Mô tả', row.description),
    ],
    upstream: [],
  };
}

/* ------------------------------------------------------------------ Tài sản */

export function assetSearchParts(row: Asset): readonly (string | undefined)[] {
  return [row.code, row.name, row.internalCode, row.serialNumber, row.type, row.manufacturer];
}

/** Phần cấp phát của tài sản (cùng dòng ở tab Tài sản); thiếu thì coi như chưa cấp phát. */
export type AssetCustody = Pick<Material, 'assignedEmployeeId' | 'assignedAt' | 'assetCategory'>;

export function assetCandidate(row: Asset): LinkableCandidate {
  return {
    kind: INVENTORY_LINKABLE_KINDS.asset,
    id: row.code,
    code: row.code,
    label: joined(row.code, row.name),
    status: ASSET_STATUS_LABELS[row.status] ?? row.status,
    hint: listed(row.type, row.serialNumber ? `S/N ${row.serialNumber}` : null),
  };
}

export function assetObject(row: Asset, custody?: AssetCustody | null): LinkableObject {
  return {
    ...assetCandidate(row),
    launchUrl: inventoryLaunchUrl(INVENTORY_LINKABLE_KINDS.asset, row.code),
    fields: [
      text('name', 'Tên tài sản', row.name),
      text('type', 'Loại', row.type),
      text('category', 'Nhóm tài sản', custody?.assetCategory ? ASSET_CATEGORY_LABELS[custody.assetCategory] : null),
      text('status', 'Trạng thái', ASSET_STATUS_LABELS[row.status] ?? row.status),
      text('criticality', 'Mức quan trọng', ASSET_CRITICALITY_LABELS[row.criticality] ?? row.criticality),
      text('usageState', 'Vị trí sử dụng', row.usageState),
      text('custody', 'Cấp phát', custody?.assignedEmployeeId ? 'Đang cấp phát cho nhân sự' : 'Chưa cấp phát'),
      date('assignedAt', 'Ngày cấp phát', custody?.assignedEmployeeId ? custody.assignedAt : null),
      text('internalCode', 'Mã nội bộ', row.internalCode),
      text('serialNumber', 'Số serial', row.serialNumber),
      text('manufacturer', 'Hãng sản xuất', row.manufacturer),
      text('supplier', 'Nhà cung cấp', row.supplier),
      text('manufactureYear', 'Năm sản xuất', row.manufactureYear),
      date('warrantyUntil', 'Bảo hành đến', row.warrantyUntil),
      money('purchasePrice', 'Giá mua', row.purchasePrice),
    ],
    upstream: [],
  };
}
