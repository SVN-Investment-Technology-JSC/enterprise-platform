import { CRM_NO_CAPABILITIES, type PriceListSyncResult } from '@enterprise-platform/contracts-crm';
import { CrmError } from '../domain/crm.error.js';
import type { CrmActor } from './crm-actor.js';
import { PriceListSyncService } from './price-list-sync.service.js';
import type {
  CatalogMaterial,
  CatalogSyncReader,
  CatalogSyncState,
  PriceListSyncStore,
  SyncDefaultPriceListInput,
} from './pricing-store.port.js';

const TENANT = 'tenant-1';
const DEFAULT_ID = '99999999-9999-4999-8999-999999999999';
const seller: CrmActor = { ...CRM_NO_CAPABILITIES, tenantId: TENANT, userId: 'u-1', displayName: 'NV1', canWriteOpportunity: true };
const manager: CrmActor = { ...seller, userId: 'u-2', displayName: 'QTBH', canManage: true };

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const material = (n: number, unit: string | null, salePrice: number | null, isActive = true): CatalogMaterial => ({
  id: id(n),
  code: `M${n}`,
  name: `Mặt hàng ${n}`,
  unit,
  category: null,
  kind: 'STOCK',
  salePrice,
  isActive,
});

/** Fixture 0.1 của `test.md`. */
const FIXTURE = [
  material(1, 'Cái', 12_345),
  material(2, 'Hộp', 10_001),
  material(3, 'Giờ', 1_001),
  material(4, 'Cái', null),
  material(5, 'Cái', 0),
  material(6, 'Cái', 50_000, false),
  material(7, null, 20_000),
  material(8, 'Kg', 99_999.99),
];

class FakeCatalog implements CatalogSyncReader {
  fingerprint = { count: 8, fingerprint: 'f1' };
  pages: CatalogMaterial[][] = [FIXTURE];
  failFingerprint = false;
  failPage: number | null = null;
  readonly calls: string[] = [];

  async catalogFingerprint(): Promise<{ count: number; fingerprint: string }> {
    this.calls.push('fingerprint');
    if (this.failFingerprint) throw new CrmError('INVENTORY_UNAVAILABLE', 'Kho lỗi', 503);
    return this.fingerprint;
  }

  async catalogPage(
    _tenantId: string,
    query: { kinds: readonly string[]; cursor: string | null; limit: number; includeInactive: boolean },
  ) {
    const index = query.cursor === null ? 0 : Number(query.cursor);
    this.calls.push(`page:${index}:${query.kinds.join(',')}:${query.includeInactive}:${query.limit}`);
    if (this.failPage === index) throw new CrmError('INVENTORY_UNAVAILABLE', 'Kho lỗi', 503);
    return { materials: this.pages[index], nextCursor: index + 1 < this.pages.length ? String(index + 1) : null };
  }
}

class FakeSyncStore implements PriceListSyncStore {
  defaultId: string | null = null;
  state: CatalogSyncState | null = null;
  readonly inputs: SyncDefaultPriceListInput[] = [];

  async defaultPriceListId(): Promise<string | null> {
    return this.defaultId;
  }
  async catalogSyncState(): Promise<CatalogSyncState | null> {
    return this.state;
  }
  async syncDefaultPriceList(_tenantId: string, input: SyncDefaultPriceListInput): Promise<PriceListSyncResult> {
    this.inputs.push(input);
    this.defaultId = DEFAULT_ID;
    this.state = { ...input.fingerprint, syncedAt: '2026-11-18T03:00:00.000Z', syncedBy: 'u-2' };
    return {
      defaultPriceListId: DEFAULT_ID,
      added: input.materials.length,
      updated: 0,
      removed: 0,
      skippedWithoutUnit: input.skippedWithoutUnit,
      derivedListsUpdated: 0,
      manualPricesRemoved: 0,
      syncedAt: '2026-11-18T03:00:00.000Z',
    };
  }
}

function setup() {
  const store = new FakeSyncStore();
  const catalog = new FakeCatalog();
  const logger = { warn: jest.fn() };
  const service = new PriceListSyncService(store, catalog, () => new Date('2026-11-17T18:00:00Z'), logger);
  return { store, catalog, logger, service };
}

describe('PriceListSyncService (A4)', () => {
  it('A4.1: chưa có bảng mặc định thì cần đồng bộ, lý do NO_DEFAULT', async () => {
    const { service } = setup();
    await expect(service.status(manager)).resolves.toEqual({
      needsSync: true,
      reason: 'NO_DEFAULT',
      defaultPriceListId: null,
      lastSyncedAt: null,
    });
  });

  it('A4.2: đồng bộ lần đầu đọc cả mặt hàng ngừng dùng; M7 thiếu đơn vị bị bỏ qua và đếm lại', async () => {
    const { store, catalog, service } = setup();
    const result = await service.sync(manager);
    expect(result).toMatchObject({ defaultPriceListId: DEFAULT_ID, added: 7, skippedWithoutUnit: 1 });
    expect(catalog.calls).toEqual(['fingerprint', 'page:0:STOCK,SERVICE:true:500']);
    const [input] = store.inputs;
    expect(input.today).toBe('2026-11-18');
    expect(input.materials.map((entry) => entry.code)).toEqual(['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M8']);
    expect(input.materials.find((entry) => entry.code === 'M4')).toMatchObject({ salePrice: null, isActive: true });
    expect(input.materials.find((entry) => entry.code === 'M5')).toMatchObject({ salePrice: 0 });
    expect(input.materials.find((entry) => entry.code === 'M6')).toMatchObject({ isActive: false });
  });

  it('A4.4: dấu vân tay trùng lần trước thì không cần đồng bộ; khác thì CATALOG_CHANGED', async () => {
    const { store, catalog, service } = setup();
    await service.sync(manager);
    await expect(service.status(manager)).resolves.toEqual({
      needsSync: false,
      reason: null,
      defaultPriceListId: DEFAULT_ID,
      lastSyncedAt: '2026-11-18T03:00:00.000Z',
    });
    catalog.fingerprint = { count: 8, fingerprint: 'f2' };
    await expect(service.status(manager)).resolves.toMatchObject({ needsSync: true, reason: 'CATALOG_CHANGED' });
    store.state = null;
    catalog.fingerprint = { count: 8, fingerprint: 'f1' };
    await expect(service.status(manager)).resolves.toMatchObject({ needsSync: true, reason: 'CATALOG_CHANGED' });
  });

  it('A4.19: danh mục nhiều trang đọc đủ, không trùng', async () => {
    const { store, catalog, service } = setup();
    catalog.pages = [FIXTURE.slice(0, 3), FIXTURE.slice(3, 6), [...FIXTURE.slice(5)]];
    await service.sync(manager);
    expect(catalog.calls.filter((call) => call.startsWith('page'))).toHaveLength(3);
    expect(store.inputs[0].materials.map((entry) => entry.code)).toEqual(['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M8']);
    expect(store.inputs[0].skippedWithoutUnit).toBe(1);
  });

  it('A4.20: Kho lỗi khi xem trạng thái thì không cần đồng bộ, ghi log, không ném lỗi', async () => {
    const { store, catalog, logger, service } = setup();
    store.defaultId = DEFAULT_ID;
    catalog.failFingerprint = true;
    await expect(service.status(manager)).resolves.toMatchObject({ needsSync: false, reason: null, defaultPriceListId: DEFAULT_ID });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('A4.21: Kho lỗi ở trang giữa khi đồng bộ: "Không đọc được danh mục Kho", không ghi gì', async () => {
    const { store, catalog, service } = setup();
    catalog.pages = [FIXTURE.slice(0, 4), FIXTURE.slice(4)];
    catalog.failPage = 1;
    await expect(service.sync(manager)).rejects.toMatchObject({
      code: 'CATALOG_UNAVAILABLE',
      statusCode: 502,
      message: 'Không đọc được danh mục Kho. Vui lòng thử lại.',
    });
    catalog.failPage = null;
    catalog.failFingerprint = true;
    await expect(service.sync(manager)).rejects.toMatchObject({ code: 'CATALOG_UNAVAILABLE' });
    expect(store.inputs).toHaveLength(0);
  });

  it('A4.23: lưu dấu vân tay đọc trước khi đọc danh mục', async () => {
    const { store, catalog, service } = setup();
    const original = catalog.catalogPage.bind(catalog);
    catalog.catalogPage = async (...args) => {
      // Kho đổi trong lúc đọc danh mục.
      catalog.fingerprint = { count: 9, fingerprint: 'f-sau' };
      return original(...args);
    };
    await service.sync(manager);
    expect(store.inputs[0].fingerprint).toEqual({ count: 8, fingerprint: 'f1' });
    await expect(service.status(manager)).resolves.toMatchObject({ needsSync: true, reason: 'CATALOG_CHANGED' });
  });

  it('A4.24: không phải quản trị bán hàng thì 403', async () => {
    const { store, service } = setup();
    await expect(service.status(seller)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.sync(seller)).rejects.toMatchObject({ statusCode: 403 });
    expect(store.inputs).toHaveLength(0);
  });

  it('cursor lặp lại thì dừng, báo Kho lỗi', async () => {
    const { store, catalog, service } = setup();
    catalog.catalogPage = async () => ({ materials: [], nextCursor: 'M1' });
    await expect(service.sync(manager)).rejects.toMatchObject({ code: 'CATALOG_UNAVAILABLE' });
    expect(store.inputs).toHaveLength(0);
  });
});
