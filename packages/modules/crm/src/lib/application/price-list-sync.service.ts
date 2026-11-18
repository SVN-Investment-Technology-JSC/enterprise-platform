import type { PriceListSyncResult, PriceListSyncStatus } from '@enterprise-platform/contracts-crm';
import { CrmError } from '../domain/crm.error.js';
import { requireSalesManager } from './crm-access.js';
import type { CrmActor } from './crm-actor.js';
import type {
  CatalogFingerprint,
  CatalogSyncReader,
  PriceListSyncStore,
  SyncCatalogMaterial,
} from './pricing-store.port.js';
import { vietnamToday } from './pricing.service.js';

/** Nhóm mặt hàng của Kho đưa vào bảng giá mặc định. */
export const CATALOG_SYNC_KINDS: readonly string[] = ['STOCK', 'SERVICE'];
/** Số mặt hàng một trang khi đọc danh mục Kho (tối đa Kho cho phép). */
export const CATALOG_SYNC_PAGE_SIZE = 500;
/** Chặn vòng lặp khi Kho trả cursor lặp: 2.000 trang × 500 mặt hàng. */
const CATALOG_SYNC_MAX_PAGES = 2_000;

/** Không đọc được danh mục Kho khi đồng bộ: không ghi gì. */
export function catalogUnavailable(): CrmError {
  return new CrmError('CATALOG_UNAVAILABLE', 'Không đọc được danh mục Kho. Vui lòng thử lại.', 502);
}

export interface PriceListSyncLogger {
  warn(message: string, context?: Record<string, unknown>): void;
}

const consoleLogger: PriceListSyncLogger = {
  warn: (message, context) => console.warn(message, context ?? {}),
};

/**
 * Đồng bộ bảng giá mặc định với danh mục Kho (`docs/crm_price_list_logic/plan.md` 4.3). Chỉ quản trị bán hàng.
 *
 * Phát hiện thay đổi bằng dấu vân tay danh mục (D1). Đồng bộ đọc dấu vân tay rồi toàn bộ danh mục ngoài transaction,
 * sau đó ghi trong một transaction có khoá tư vấn (`PriceListSyncStore`).
 */
export class PriceListSyncService {
  constructor(
    private readonly store: PriceListSyncStore,
    private readonly catalog: CatalogSyncReader,
    private readonly now: () => Date = () => new Date(),
    private readonly logger: PriceListSyncLogger = consoleLogger,
  ) {}

  /** Kho lỗi thì `needsSync = false` (không chặn trang), chỉ ghi log. */
  async status(actor: CrmActor): Promise<PriceListSyncStatus> {
    requireSalesManager(actor);
    const [defaultPriceListId, state] = await Promise.all([
      this.store.defaultPriceListId(actor.tenantId),
      this.store.catalogSyncState(actor.tenantId),
    ]);
    const lastSyncedAt = state?.syncedAt ?? null;
    if (!defaultPriceListId) return { needsSync: true, reason: 'NO_DEFAULT', defaultPriceListId: null, lastSyncedAt };
    let current: CatalogFingerprint;
    try {
      current = await this.catalog.catalogFingerprint(actor.tenantId, CATALOG_SYNC_KINDS);
    } catch (error) {
      this.logger.warn('CRM price list sync status: inventory fingerprint unavailable', {
        tenantId: actor.tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { needsSync: false, reason: null, defaultPriceListId, lastSyncedAt };
    }
    const changed = !state || state.fingerprint !== current.fingerprint || state.count !== current.count;
    return { needsSync: changed, reason: changed ? 'CATALOG_CHANGED' : null, defaultPriceListId, lastSyncedAt };
  }

  async sync(actor: CrmActor): Promise<PriceListSyncResult> {
    requireSalesManager(actor);
    // Dấu vân tay đọc trước danh mục: Kho đổi trong lúc đọc thì lần sau vẫn báo cần đồng bộ.
    let fingerprint: CatalogFingerprint;
    let materials: SyncCatalogMaterial[];
    let skippedWithoutUnit = 0;
    try {
      fingerprint = await this.catalog.catalogFingerprint(actor.tenantId, CATALOG_SYNC_KINDS);
      const read = await this.readCatalog(actor.tenantId);
      materials = read.materials;
      skippedWithoutUnit = read.skippedWithoutUnit;
    } catch (error) {
      this.logger.warn('CRM price list sync: inventory catalog unavailable', {
        tenantId: actor.tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw catalogUnavailable();
    }
    return this.store.syncDefaultPriceList(
      actor.tenantId,
      { materials, skippedWithoutUnit, fingerprint, today: vietnamToday(this.now()) },
      actor.userId,
    );
  }

  /** Mọi trang danh mục (cả mặt hàng ngừng dùng); mặt hàng chưa có đơn vị tính bị bỏ qua và đếm lại. */
  private async readCatalog(tenantId: string): Promise<{ materials: SyncCatalogMaterial[]; skippedWithoutUnit: number }> {
    const byId = new Map<string, SyncCatalogMaterial>();
    const skipped = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < CATALOG_SYNC_MAX_PAGES; page += 1) {
      const result = await this.catalog.catalogPage(tenantId, {
        kinds: CATALOG_SYNC_KINDS,
        cursor,
        limit: CATALOG_SYNC_PAGE_SIZE,
        includeInactive: true,
      });
      for (const material of result.materials) {
        const id = material.id.toLowerCase();
        const unit = material.unit?.trim();
        if (!unit) {
          skipped.add(id);
          continue;
        }
        byId.set(id, {
          id,
          code: material.code.trim().slice(0, 100),
          name: (material.name?.trim() || material.code).slice(0, 300),
          unit: unit.slice(0, 50),
          salePrice: normalizePrice(material.salePrice),
          isActive: material.isActive !== false,
        });
      }
      if (!result.nextCursor) {
        return { materials: [...byId.values()], skippedWithoutUnit: [...skipped].filter((id) => !byId.has(id)).length };
      }
      if (cursors.has(result.nextCursor)) throw new Error('Inventory catalog cursor repeated');
      cursors.add(result.nextCursor);
      cursor = result.nextCursor;
    }
    throw new Error('Inventory catalog has too many pages');
  }
}

/** Giá bán Kho về 2 chữ số thập phân như cột `price`; giá âm hoặc không phải số coi như chưa nhập. */
function normalizePrice(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100) / 100;
}
