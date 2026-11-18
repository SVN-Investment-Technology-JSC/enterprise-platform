import {
  STOCK_DOCUMENT_STATUSES,
  STOCK_DOCUMENT_TYPES,
  STOCK_MOVEMENT_KINDS,
  type StockMovementListQuery,
  type StockMovementPage,
} from '@enterprise-platform/contracts-inventory';
import { InventoryError } from '../domain/inventory.error.js';
import {
  STOCK_MOVEMENT_SEARCH_MAX,
  normalizeMovementSource,
  resolveMovementPaging,
} from '../domain/stock-movement.js';
import type { InventoryActor } from './inventory.application.js';
import type { StockMovementStore } from './stock-movement-store.port.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function text(value: string | undefined): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : undefined;
  return trimmed || undefined;
}

function oneOf<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  message: string,
): T | undefined {
  const trimmed = text(value);
  if (trimmed === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(trimmed)) throw new InventoryError('VALIDATION', message);
  return trimmed as T;
}

function date(value: string | undefined, label: string): string | undefined {
  const trimmed = text(value);
  if (trimmed === undefined) return undefined;
  if (!DATE_PATTERN.test(trimmed) || Number.isNaN(Date.parse(`${trimmed}T00:00:00Z`))) {
    throw new InventoryError('VALIDATION', `${label} phải có dạng YYYY-MM-DD.`);
  }
  return trimmed;
}

/**
 * Danh sách gộp xuất/nhập kho. Chỉ đọc: ai có `inventory.read` (guard của
 * inventory-api) đều xem được, như danh sách chứng từ và lịch sử xuất nhập.
 * Không thay hai endpoint đó; mở chi tiết vẫn dùng `GET /v1/stock-documents/:id`.
 */
export class StockMovementService {
  constructor(private readonly store: StockMovementStore) {}

  async list(actor: InventoryActor, query: StockMovementListQuery): Promise<StockMovementPage> {
    const fromDate = date(query.fromDate, 'Từ ngày');
    const toDate = date(query.toDate, 'Đến ngày');
    if (fromDate && toDate && fromDate > toDate) {
      throw new InventoryError('VALIDATION', 'Từ ngày không được sau Đến ngày.');
    }
    const sourceType = text(query.sourceType);
    const paging = resolveMovementPaging(query.limit, query.offset);
    const result = await this.store.list(actor.tenantId, {
      search: text(query.search)?.slice(0, STOCK_MOVEMENT_SEARCH_MAX),
      kind: oneOf(query.kind, STOCK_MOVEMENT_KINDS, 'Loại dòng xuất/nhập không hợp lệ.'),
      docType: oneOf(query.docType, STOCK_DOCUMENT_TYPES, 'Loại chứng từ không hợp lệ.'),
      status: oneOf(query.status, STOCK_DOCUMENT_STATUSES, 'Trạng thái chứng từ không hợp lệ.'),
      warehouseCode: text(query.warehouseCode),
      sourceType: sourceType ? normalizeMovementSource(sourceType) : undefined,
      fromDate,
      toDate,
      ...paging,
    });
    return { rows: result.rows, total: result.total, pendingCount: result.pendingCount, ...paging };
  }
}
