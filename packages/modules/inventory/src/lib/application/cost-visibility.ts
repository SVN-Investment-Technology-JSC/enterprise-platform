import type {
  Asset,
  InventoryTransaction,
  Material,
  MaterialInventory,
  PostedStockDocument,
  Reservation,
  StockApprovalReport,
  StockDocument,
  StockDocumentPage,
  StockMovementAmounts,
  StockMovementReport,
  StockReport,
} from '@enterprise-platform/contracts-inventory';
import type { InventoryActor } from './inventory.application.js';

/**
 * Giá vốn, giá trị tồn và nguồn giữ hàng (hợp đồng, đơn bán của khách) chỉ trả cho
 * người có `inventory.cost.read` (quản lý kho có sẵn qua bao hàm). Người chỉ có
 * `inventory.read` vẫn tra được số lượng tồn.
 *
 * Giá mua, giá bán khai ở danh mục vật tư, thiết bị cũng theo cùng quyền: người chỉ đọc tra được mã, tên,
 * đơn vị nhưng không thấy giá. Bên gọi dịch vụ (Bán hàng báo giá) có `canReadCost` nên vẫn nhận giá.
 *
 * Bỏ hẳn trường thay vì trả 0: giao diện phân biệt được "không được xem" với "giá 0".
 */
function omit<T extends object, K extends keyof T>(value: T, ...keys: readonly K[]): Omit<T, K> {
  const copy: Partial<T> = { ...value };
  for (const key of keys) delete copy[key];
  return copy as Omit<T, K>;
}

export function canReadCost(actor: InventoryActor): boolean {
  return actor.canReadCost ?? actor.canManage;
}

export function visibleStockRow(actor: InventoryActor, row: MaterialInventory): MaterialInventory;
export function visibleStockRow(actor: InventoryActor, row: MaterialInventory | null): MaterialInventory | null;
export function visibleStockRow(actor: InventoryActor, row: MaterialInventory | null): MaterialInventory | null {
  if (!row || canReadCost(actor)) return row;
  return omit(row, 'avgCost');
}

export function visibleStockRows(actor: InventoryActor, rows: readonly MaterialInventory[]): MaterialInventory[] {
  return rows.map((row) => visibleStockRow(actor, row));
}

export function visibleTransaction(actor: InventoryActor, row: InventoryTransaction): InventoryTransaction {
  if (canReadCost(actor)) return row;
  return omit(row, 'unitCost');
}

export function visibleTransactions(
  actor: InventoryActor,
  rows: readonly InventoryTransaction[],
): InventoryTransaction[] {
  return rows.map((row) => visibleTransaction(actor, row));
}

export function visibleReservation(actor: InventoryActor, row: Reservation): Reservation {
  if (canReadCost(actor)) return row;
  return omit(row, 'referenceId', 'sourceId', 'idempotencyKey');
}

export function visibleReservations(actor: InventoryActor, rows: readonly Reservation[]): Reservation[] {
  return rows.map((row) => visibleReservation(actor, row));
}

export function visibleDocument(actor: InventoryActor, document: StockDocument): StockDocument {
  if (canReadCost(actor)) return document;
  return {
    ...document,
    lines: document.lines.map((line) => omit(line, 'unitCost', 'costAmount')),
  };
}

export function visibleDocumentPage(actor: InventoryActor, page: StockDocumentPage): StockDocumentPage {
  if (canReadCost(actor)) return page;
  return { ...page, items: page.items.map((item) => visibleDocument(actor, item)) };
}

export function visiblePosted(actor: InventoryActor, posted: PostedStockDocument): PostedStockDocument {
  if (canReadCost(actor)) return posted;
  return {
    document: visibleDocument(actor, posted.document),
    transactions: visibleTransactions(actor, posted.transactions),
  };
}

export function visibleStockReport(actor: InventoryActor, report: StockReport): StockReport {
  if (canReadCost(actor) || report.groupBy !== 'WAREHOUSE') return report;
  return {
    ...report,
    rows: report.rows.map((row) => omit(row, 'avgCost', 'stockValue')),
    totals: omit(report.totals, 'stockValue'),
  };
}

function withoutValues<T extends StockMovementAmounts>(row: T): T {
  return omit(row, 'valueIn', 'valueOut') as T;
}

export function visibleMovementReport(actor: InventoryActor, report: StockMovementReport): StockMovementReport {
  if (canReadCost(actor)) return report;
  return {
    ...report,
    summary: report.summary.map(withoutValues),
    breakdown: report.breakdown.map(withoutValues),
    totals: withoutValues(report.totals),
    lines: report.lines.map((line) => omit(line, 'unitCost', 'value')),
  };
}

export function visibleApprovalReport(actor: InventoryActor, report: StockApprovalReport): StockApprovalReport {
  if (canReadCost(actor)) return report;
  return { ...report, rows: report.rows.map((row) => omit(row, 'value')) };
}

export function visibleMaterial(actor: InventoryActor, material: Material): Material {
  if (canReadCost(actor)) return material;
  return omit(material, 'purchasePrice', 'salePrice');
}

export function visibleMaterials(actor: InventoryActor, rows: readonly Material[]): Material[] {
  return rows.map((row) => visibleMaterial(actor, row));
}

export function visibleAsset(actor: InventoryActor, asset: Asset): Asset {
  if (canReadCost(actor)) return asset;
  return omit(asset, 'purchasePrice');
}

export function visibleAssets(actor: InventoryActor, rows: readonly Asset[]): Asset[] {
  return rows.map((row) => visibleAsset(actor, row));
}
