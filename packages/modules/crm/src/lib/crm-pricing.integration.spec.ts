import { createHash, randomUUID } from 'node:crypto';
import { CRM_NO_CAPABILITIES, type PriceListDetail, type PriceListItem } from '@enterprise-platform/contracts-crm';
import type { CrmActor } from './application/crm-actor.js';
import { CustomerGroupService } from './application/customer-group.service.js';
import { CustomerService } from './application/customer.service.js';
import { CrmDataScopeService } from './application/data-scope.js';
import { DiscountPolicyService } from './application/discount-policy.service.js';
import { PriceListSyncService } from './application/price-list-sync.service.js';
import { PriceListService } from './application/price-list.service.js';
import type { CatalogMaterial, CatalogReader, CatalogSyncReader } from './application/pricing-store.port.js';
import { PricingService } from './application/pricing.service.js';
import { createCrmTestDatabase, crmIntegrationEnabled, type CrmTestDatabaseHandle } from './crm-test-support.js';
import { seedPriceList } from './crm-test-price-lists.js';
import { PostgresCustomerStore } from './infrastructure/postgres-customer.store.js';
import {
  PostgresDiscountPolicyStore,
  PostgresPriceListStore,
  PostgresPriceListSyncStore,
  PostgresPricingStore,
} from './infrastructure/postgres-pricing.store.js';
import { PostgresCustomerGroupStore } from './infrastructure/postgres-settings.store.js';

const integration = crmIntegrationEnabled() ? describe : describe.skip;

/**
 * Danh mục Kho giả (fixture 0.1 của `docs/crm_price_list_logic/test.md`): dấu vân tay tính lại theo nội dung, trang
 * theo mã như API nội bộ của Kho.
 */
class FakeInventoryCatalog implements CatalogReader, CatalogSyncReader {
  items: CatalogMaterial[] = [];
  failing = false;
  pageSize = 3;

  async materials(): Promise<ReadonlyMap<string, CatalogMaterial>> {
    return new Map();
  }
  async search(): Promise<CatalogMaterial[]> {
    return [];
  }
  async catalogFingerprint(): Promise<{ count: number; fingerprint: string }> {
    if (this.failing) throw new Error('Kho lỗi');
    const sorted = [...this.items].sort((left, right) => left.id.localeCompare(right.id));
    const text = sorted.map((item) => [item.id, item.code, item.name, item.unit, item.salePrice, item.isActive].join('|')).join('\n');
    return { count: sorted.length, fingerprint: createHash('md5').update(text).digest('hex') };
  }
  async catalogPage(_tenantId: string, query: { cursor: string | null }) {
    if (this.failing) throw new Error('Kho lỗi');
    const sorted = [...this.items].sort((left, right) => left.code.localeCompare(right.code));
    const rest = query.cursor === null ? sorted : sorted.filter((item) => item.code > (query.cursor as string));
    const page = rest.slice(0, this.pageSize);
    return { materials: page, nextCursor: rest.length > this.pageSize ? page[page.length - 1].code : null };
  }
  set(code: string, patch: Partial<CatalogMaterial>): void {
    this.items = this.items.map((item) => (item.code === code ? { ...item, ...patch } : item));
  }
}

const material = (code: string, unit: string | null, salePrice: number | null, isActive = true): CatalogMaterial => ({
  id: randomUUID(),
  code,
  name: `Mặt hàng ${code}`,
  unit,
  category: null,
  kind: 'STOCK',
  salePrice,
  isActive,
});

const byCode = (list: PriceListDetail, code: string): PriceListItem | undefined =>
  list.items.find((item) => item.materialCode === code);

integration('Bảng giá mặc định đồng bộ Kho, bảng theo tỷ lệ, chọn bảng giá, chính sách (PostgreSQL)', () => {
  let handle: CrmTestDatabaseHandle;
  const tenantId = randomUUID();
  const admin: CrmActor = {
    ...CRM_NO_CAPABILITIES,
    tenantId,
    userId: randomUUID(),
    displayName: 'QTBH',
    canManage: true,
    canReadAll: true,
  };
  const seller: CrmActor = { ...CRM_NO_CAPABILITIES, tenantId, userId: randomUUID(), displayName: 'NV1', canWriteOpportunity: true };
  const catalog = new FakeInventoryCatalog();

  let lists: PriceListService;
  let sync: PriceListSyncService;
  let policies: DiscountPolicyService;
  let pricing: PricingService;
  let pricingStore: PostgresPricingStore;
  let customers: CustomerService;
  let vipGroupId: string;
  let vipCustomerId: string;
  let defaultId: string;
  let bg105: string;
  let bg90: string;

  beforeAll(async () => {
    handle = await createCrmTestDatabase();
    const scopes = new CrmDataScopeService({ snapshot: async () => ({ positions: [], assignments: [] }) });
    customers = new CustomerService(new PostgresCustomerStore(handle.database), scopes);
    const groups = new CustomerGroupService(new PostgresCustomerGroupStore(handle.database));
    lists = new PriceListService(new PostgresPriceListStore(handle.database), catalog);
    sync = new PriceListSyncService(new PostgresPriceListSyncStore(handle.database), catalog, () => new Date(), { warn: () => undefined });
    policies = new DiscountPolicyService(new PostgresDiscountPolicyStore(handle.database));
    pricingStore = new PostgresPricingStore(handle.database);
    pricing = new PricingService(pricingStore, customers, catalog);

    vipGroupId = (await groups.create(admin, { code: 'VIP', name: 'Khách VIP' })).id;
    vipCustomerId = (
      await customers.create({ ...admin, canWriteOpportunity: true }, { name: 'Công ty VIP', groupId: vipGroupId, ownerUserId: seller.userId })
    ).id;
    catalog.items = [
      material('M1', 'Cái', 12_345),
      material('M2', 'Hộp', 10_001),
      material('M3', 'Giờ', 1_001),
      material('M4', 'Cái', null),
      material('M5', 'Cái', 0),
      material('M6', 'Cái', 50_000, false),
      material('M7', null, 20_000),
      material('M8', 'Kg', 99_999.99),
    ];
  }, 120_000);

  afterAll(async () => {
    await handle?.drop();
  }, 60_000);

  const items = async (id: string) => (await lists.get(admin, id)).items;
  const itemUpdatedAt = async (id: string) =>
    (
      await handle.pool.query<{ updated_at: Date }>(
        `SELECT updated_at FROM crm_schema.price_list_items WHERE price_list_id = $1 ORDER BY id`,
        [id],
      )
    ).rows.map((row) => row.updated_at.toISOString());

  it('migration ghi trần chiết khấu mặc định 10%', async () => {
    await expect(pricing.settings(seller)).resolves.toEqual({ discountCapPercent: 10 });
  });

  it('A4.1, A5.1: chưa có bảng mặc định: trạng thái NO_DEFAULT, tạo bảng giá báo DEFAULT_PRICE_LIST_MISSING', async () => {
    await expect(sync.status(admin)).resolves.toMatchObject({ needsSync: true, reason: 'NO_DEFAULT', defaultPriceListId: null });
    await expect(lists.create(admin, { code: 'BG-105', name: 'Bảng 105', validFrom: '2026-01-01', ratioPercent: 105 })).rejects.toMatchObject({
      statusCode: 409,
      code: 'DEFAULT_PRICE_LIST_MISSING',
      message: 'Chưa có bảng giá mặc định. Vui lòng đồng bộ bảng giá với Kho trước.',
    });
    await expect(sync.status(seller)).rejects.toMatchObject({ statusCode: 403 });
    await expect(sync.sync(seller)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('A4.2, A4.3, B3.3: đồng bộ lần đầu tạo bảng mặc định (mã kế tiếp khi trùng), bỏ M7, thuế suất 10%', async () => {
    await seedPriceList(handle.pool, { code: 'BG-MAC-DINH', items: [] });
    const result = await sync.sync(admin);
    expect(result).toMatchObject({ added: 7, updated: 0, removed: 0, skippedWithoutUnit: 1, derivedListsUpdated: 0 });
    defaultId = result.defaultPriceListId;
    const detail = await lists.get(admin, defaultId);
    expect(detail).toMatchObject({ code: 'BG-MAC-DINH-1', listType: 'DEFAULT', status: 'ACTIVE', validTo: null, itemCount: 7 });
    expect(detail.items.map((item) => item.materialCode)).toEqual(['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M8']);
    expect(detail.items.every((item) => item.vatRate === 10 && item.priceMode === 'SYNCED')).toBe(true);
    expect(byCode(detail, 'M4')?.price).toBeNull();
    expect(byCode(detail, 'M5')?.price).toBe(0);
    expect(byCode(detail, 'M6')?.sourceActive).toBe(false);
    expect(byCode(detail, 'M8')?.price).toBe(99_999.99);
    await expect(sync.status(admin)).resolves.toMatchObject({ needsSync: false, reason: null, defaultPriceListId: defaultId });
    // Bảng mặc định đứng đầu danh sách.
    expect((await lists.list(seller))[0]).toMatchObject({ id: defaultId, listType: 'DEFAULT', usageCount: 0 });
  });

  it('A5.2–A5.5, A5.20: tạo bảng theo tỷ lệ; bỏ qua isStandard; mã trùng 409; hai bảng trùng hiệu lực được', async () => {
    const created = await lists.create(admin, { code: 'bg-105', name: 'Bảng 105', validFrom: '2026-01-01', ratioPercent: 105, isStandard: true });
    bg105 = created.id;
    expect(created).toMatchObject({ code: 'BG-105', listType: 'DERIVED', ratioPercent: 105, isStandard: false, itemCount: 7 });
    expect(byCode(created, 'M1')).toMatchObject({ price: 12_962, priceMode: 'RATIO', vatRate: 10 });
    expect(byCode(created, 'M4')?.price).toBeNull();
    expect(byCode(created, 'M6')?.sourceActive).toBe(false);
    const ninety = await lists.create(admin, { code: 'BG-90', name: 'Bảng 90', validFrom: '2026-01-01', ratioPercent: 90 });
    bg90 = ninety.id;
    expect(byCode(ninety, 'M2')?.price).toBe(9_001);
    const hundred = await lists.create(admin, { code: 'BG-100', name: 'Bảng 100', validFrom: '2026-01-01' });
    expect(hundred.ratioPercent).toBe(100);
    expect(byCode(hundred, 'M8')?.price).toBe(100_000);
    await expect(lists.create(admin, { code: 'BG-90', name: 'Trùng', validFrom: '2026-01-01' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'PRICE_LIST_CODE_EXISTS',
    });
    await expect(lists.create(admin, { code: 'Bảng giá', name: 'X', validFrom: '2026-01-01' })).rejects.toMatchObject({ code: 'INVALID_CODE' });
    // A5.18: xoá bảng theo tỷ lệ chưa ai dùng, dòng bị xoá theo.
    await lists.remove(admin, hundred.id);
    await expect(lists.get(admin, hundred.id)).rejects.toMatchObject({ statusCode: 404 });
    expect((await handle.pool.query(`SELECT 1 FROM crm_schema.price_list_items WHERE price_list_id = $1`, [hundred.id])).rowCount).toBe(0);
  });

  it('A5.8–A5.12: nhập giá tay, đổi tỷ lệ giữ giá tay, bỏ giá tay về giá theo tỷ lệ', async () => {
    const m1 = byCode(await lists.get(admin, bg90), 'M1') as PriceListItem;
    const m4 = byCode(await lists.get(admin, bg90), 'M4') as PriceListItem;
    expect(byCode(await lists.setManualPrice(admin, bg90, m1.id, { price: 11_000 }), 'M1')).toMatchObject({ price: 11_000, priceMode: 'MANUAL' });
    expect(byCode(await lists.setManualPrice(admin, bg90, m4.id, { price: 500 }), 'M4')).toMatchObject({ price: 500, priceMode: 'MANUAL' });

    const before = await itemUpdatedAt(bg90);
    await lists.update(admin, bg90, { code: 'BG-90', name: 'Bảng 90 mới', validFrom: '2026-01-01' });
    expect(await itemUpdatedAt(bg90)).toEqual(before);

    const raised = await lists.update(admin, bg90, { code: 'BG-90', name: 'Bảng 90 mới', validFrom: '2026-01-01', ratioPercent: 110 });
    expect(raised.ratioPercent).toBe(110);
    expect(byCode(raised, 'M2')?.price).toBe(11_001);
    expect(byCode(raised, 'M1')).toMatchObject({ price: 11_000, priceMode: 'MANUAL' });

    expect(byCode(await lists.clearManualPrice(admin, bg90, m4.id), 'M4')).toMatchObject({ price: null, priceMode: 'RATIO' });
    const cleared = await lists.clearManualPrice(admin, bg90, m4.id);
    expect(byCode(cleared, 'M4')).toMatchObject({ price: null, priceMode: 'RATIO' });
    await lists.update(admin, bg90, { code: 'BG-90', name: 'Bảng 90', validFrom: '2026-01-01', ratioPercent: 90 });
  });

  it('A5.13–A5.16: bảng mặc định chỉ sửa thuế suất (bảng theo tỷ lệ nhận theo); bảng theo tỷ lệ chỉ sửa giá tay', async () => {
    const m1 = byCode(await lists.get(admin, defaultId), 'M1') as PriceListItem;
    const after = await lists.setVatRate(admin, defaultId, m1.id, { vatRate: 8 });
    expect(byCode(after, 'M1')?.vatRate).toBe(8);
    expect(byCode(await lists.get(admin, bg105), 'M1')?.vatRate).toBe(8);
    expect(byCode(await lists.get(admin, bg90), 'M1')).toMatchObject({ vatRate: 8, price: 11_000 });

    const readOnly = { statusCode: 409, code: 'PRICE_LIST_READ_ONLY' };
    const line = { materialId: randomUUID(), materialCode: 'X', materialName: 'X', unit: 'Cái', price: 1 };
    await expect(lists.update(admin, defaultId, { code: 'BG-MAC-DINH-1', name: 'Đổi', validFrom: '2026-01-01' })).rejects.toMatchObject(readOnly);
    await expect(lists.remove(admin, defaultId)).rejects.toMatchObject(readOnly);
    await expect(lists.addItem(admin, defaultId, line)).rejects.toMatchObject(readOnly);
    await expect(lists.removeItem(admin, defaultId, m1.id)).rejects.toMatchObject(readOnly);
    await expect(lists.setManualPrice(admin, defaultId, m1.id, { price: 1 })).rejects.toMatchObject(readOnly);
    const derivedItem = byCode(await lists.get(admin, bg105), 'M1') as PriceListItem;
    await expect(lists.addItem(admin, bg105, line)).rejects.toMatchObject(readOnly);
    await expect(lists.upsertItems(admin, bg105, { items: [line] })).rejects.toMatchObject(readOnly);
    await expect(lists.removeItem(admin, bg105, derivedItem.id)).rejects.toMatchObject(readOnly);
    await expect(lists.setVatRate(admin, bg105, derivedItem.id, { vatRate: 5 })).rejects.toMatchObject(readOnly);
    await expect(lists.setVatRate(seller, defaultId, m1.id, { vatRate: 5 })).rejects.toMatchObject({ statusCode: 403 });
  });

  it('A4.5: đồng bộ lại khi Kho không đổi: 0 thêm, sửa, xoá; dòng không bị ghi lại', async () => {
    const before = [await itemUpdatedAt(defaultId), await itemUpdatedAt(bg105), await itemUpdatedAt(bg90)];
    await expect(sync.sync(admin)).resolves.toMatchObject({ added: 0, updated: 0, removed: 0, derivedListsUpdated: 0 });
    expect([await itemUpdatedAt(defaultId), await itemUpdatedAt(bg105), await itemUpdatedAt(bg90)]).toEqual(before);
  });

  it('A4.6–A4.11, A4.13, A4.16, A4.17, B3.2: Kho đổi; bảng theo tỷ lệ tính lại, giữ giá tay, kể cả bảng ngừng áp dụng', async () => {
    const m2 = byCode(await lists.get(admin, bg90), 'M2') as PriceListItem;
    await lists.setManualPrice(admin, bg90, m2.id, { price: 7_777 });
    await lists.update(admin, bg105, { code: 'BG-105', name: 'Bảng 105', validFrom: '2026-01-01', status: 'INACTIVE' });

    catalog.items.push(material('M9', 'Bộ', 2_000));
    catalog.set('M1', { salePrice: 20_000 });
    catalog.set('M2', { unit: 'Thùng' });
    catalog.set('M3', { code: 'M3-MOI', name: 'Giờ công mới' });
    catalog.set('M4', { salePrice: 4_000 });
    catalog.set('M5', { isActive: false });
    await expect(sync.status(admin)).resolves.toMatchObject({ needsSync: true, reason: 'CATALOG_CHANGED' });

    const result = await sync.sync(admin);
    expect(result).toMatchObject({ added: 1, updated: 5, removed: 0, derivedListsUpdated: 2, manualPricesRemoved: 0 });
    const base = await lists.get(admin, defaultId);
    expect(byCode(base, 'M9')).toMatchObject({ vatRate: 10, price: 2_000, priceMode: 'SYNCED' });
    expect(byCode(base, 'M1')).toMatchObject({ price: 20_000, vatRate: 8 });
    expect(byCode(base, 'M2')?.unit).toBe('Thùng');
    expect(byCode(base, 'M3-MOI')?.materialName).toBe('Giờ công mới');
    expect(byCode(base, 'M5')?.sourceActive).toBe(false);

    const derived = await lists.get(admin, bg105);
    expect(derived.status).toBe('INACTIVE');
    expect(byCode(derived, 'M1')).toMatchObject({ price: 21_000, vatRate: 8, priceMode: 'RATIO' });
    expect(byCode(derived, 'M9')).toMatchObject({ price: 2_100, priceMode: 'RATIO' });
    expect(byCode(derived, 'M4')?.price).toBe(4_200);
    expect(byCode(derived, 'M3-MOI')).toBeDefined();
    const ninety = await lists.get(admin, bg90);
    expect(byCode(ninety, 'M1')).toMatchObject({ price: 11_000, priceMode: 'MANUAL' });
    expect(byCode(ninety, 'M2')).toMatchObject({ price: 7_777, priceMode: 'MANUAL', unit: 'Thùng' });
    expect(byCode(ninety, 'M5')?.sourceActive).toBe(false);

    catalog.set('M1', { salePrice: null });
    catalog.set('M5', { isActive: true });
    await sync.sync(admin);
    expect(byCode(await lists.get(admin, defaultId), 'M1')?.price).toBeNull();
    expect(byCode(await lists.get(admin, bg105), 'M1')).toMatchObject({ price: null, priceMode: 'RATIO' });
    expect(byCode(await lists.get(admin, bg90), 'M1')).toMatchObject({ price: 11_000, priceMode: 'MANUAL' });
    expect(byCode(await lists.get(admin, bg90), 'M5')?.sourceActive).toBe(true);
    await expect(sync.status(admin)).resolves.toMatchObject({ needsSync: false });
  });

  it('A4.12, A4.14, A4.15: Kho xoá, tạo lại cùng mã, đổi mã cho nhau: khớp theo id mặt hàng', async () => {
    const m3 = byCode(await lists.get(admin, bg90), 'M3-MOI') as PriceListItem;
    await lists.setManualPrice(admin, bg90, m3.id, { price: 333 });
    const oldM1 = catalog.items.find((item) => item.code === 'M1') as CatalogMaterial;
    catalog.items = catalog.items.filter((item) => item.code !== 'M3-MOI' && item.code !== 'M1');
    catalog.items.push({ ...material('M1', 'Cái', 15_000) });
    catalog.set('M8', { code: 'M5' });
    const m5 = catalog.items.find((item) => item.code === 'M5' && item.unit === 'Cái') as CatalogMaterial;
    catalog.items = catalog.items.map((item) => (item.id === m5.id ? { ...item, code: 'M8' } : item));

    const result = await sync.sync(admin);
    // M3 và M1 cũ bị bỏ (cả giá tay ở BG-90), M1 mới thêm.
    expect(result).toMatchObject({ added: 1, removed: 2, manualPricesRemoved: 2 });
    const ninety = await lists.get(admin, bg90);
    expect(ninety.items.some((item) => item.materialId === oldM1.id)).toBe(false);
    expect(byCode(ninety, 'M1')).toMatchObject({ price: 13_500, priceMode: 'RATIO' });
    expect(byCode(ninety, 'M3-MOI')).toBeUndefined();
    // Đổi mã cho nhau: giá đi theo mặt hàng, không theo mã.
    expect(byCode(ninety, 'M8')).toMatchObject({ materialId: m5.id, price: 0, unit: 'Cái' });
    expect(byCode(ninety, 'M5')).toMatchObject({ price: 90_000, unit: 'Kg' });
  });

  it('A4.22, 4.9: giá sau tỷ lệ vượt giới hạn: đồng bộ, tạo, đổi tỷ lệ bị từ chối, không ghi gì', async () => {
    const huge = await lists.create(admin, { code: 'BG-1000', name: 'Gấp mười', validFrom: '2026-01-01', ratioPercent: 1000 });
    const stateBefore = (await handle.pool.query(`SELECT value FROM crm_schema.settings WHERE key = 'pricing.catalogSync'`)).rows[0];
    const baseBefore = await itemUpdatedAt(defaultId);
    catalog.set('M9', { salePrice: 9_000_000_000_000 });
    await expect(sync.sync(admin)).rejects.toMatchObject({ code: 'PRICE_OUT_OF_RANGE', message: 'Giá sau tỷ lệ vượt giới hạn.' });
    expect(await itemUpdatedAt(defaultId)).toEqual(baseBefore);
    expect((await handle.pool.query(`SELECT value FROM crm_schema.settings WHERE key = 'pricing.catalogSync'`)).rows[0]).toEqual(stateBefore);
    await lists.remove(admin, huge.id);
    await sync.sync(admin);
    await expect(lists.create(admin, { code: 'BG-200', name: 'X', validFrom: '2026-01-01', ratioPercent: 200 })).rejects.toMatchObject({
      code: 'PRICE_OUT_OF_RANGE',
    });
    await expect(lists.update(admin, bg90, { code: 'BG-90', name: 'Bảng 90', validFrom: '2026-01-01', ratioPercent: 200 })).rejects.toMatchObject({
      code: 'PRICE_OUT_OF_RANGE',
    });
    expect((await lists.get(admin, bg90)).ratioPercent).toBe(90);
    catalog.set('M9', { salePrice: 2_000 });
    await sync.sync(admin);
  });

  it('A5.17, B1.13: xoá bảng đang được báo giá dùng: PRICE_LIST_IN_USE', async () => {
    const quote = await handle.pool.query<{ id: string }>(
      `INSERT INTO crm_schema.quotes (code, customer_id, owner_user_id) VALUES ('BG-TEST-1', $1, $2) RETURNING id`,
      [vipCustomerId, seller.userId],
    );
    await handle.pool.query(`INSERT INTO crm_schema.quote_versions (quote_id, version_no, price_list_id) VALUES ($1, 1, $2)`, [
      quote.rows[0].id,
      bg105,
    ]);
    await expect(lists.get(admin, bg105)).resolves.toMatchObject({ usageCount: 1 });
    await expect(lists.remove(admin, bg105)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PRICE_LIST_IN_USE',
      message: 'Bảng giá đang được dùng trong báo giá hoặc đơn bán; hãy chuyển sang Ngừng áp dụng.',
    });
    await lists.update(admin, bg105, { code: 'BG-105', name: 'Bảng 105', validFrom: '2026-01-01', status: 'ACTIVE' });
  });

  it('B4.1, B4.2: hai lần đồng bộ cùng lúc chạy lần lượt; giá tay nhập trong lúc đồng bộ được giữ', async () => {
    catalog.set('M9', { salePrice: 3_000 });
    const m9 = byCode(await lists.get(admin, bg90), 'M9') as PriceListItem;
    const [first, second] = await Promise.all([
      sync.sync(admin),
      sync.sync(admin),
      lists.setManualPrice(admin, bg90, m9.id, { price: 1_234 }),
    ]);
    expect(first.updated + second.updated).toBe(1);
    const duplicates = await handle.pool.query(
      `SELECT price_list_id, material_id FROM crm_schema.price_list_items GROUP BY 1, 2 HAVING count(*) > 1`,
    );
    expect(duplicates.rowCount).toBe(0);
    expect(byCode(await lists.get(admin, bg90), 'M9')).toMatchObject({ price: 1_234, priceMode: 'MANUAL' });
    expect(byCode(await lists.get(admin, bg105), 'M9')?.price).toBe(3_150);
  });

  it('A8.1, A8.2: thử tính giá bắt buộc bảng giá; khách không đổi bảng giá; nhóm khách vẫn dùng cho chính sách', async () => {
    const m9 = byCode(await lists.get(admin, bg105), 'M9') as PriceListItem;
    const line = { materialId: m9.materialId, quantity: 2, unit: 'Bộ' };
    await expect(pricing.preview(seller, { priceListId: null, lines: [line] })).rejects.toMatchObject({ code: 'PRICE_LIST_REQUIRED' });
    await expect(pricing.preview(seller, { priceListId: randomUUID(), lines: [line] })).rejects.toMatchObject({ code: 'PRICE_LIST_NOT_FOUND' });
    await expect(pricing.preview(seller, { priceListId: bg105, date: '2025-12-31', lines: [line] })).rejects.toMatchObject({
      code: 'PRICE_LIST_NOT_EFFECTIVE',
    });

    // Bảng cũ gán ở hồ sơ khách (customers.price_list_id) không còn ảnh hưởng.
    const legacy = await seedPriceList(handle.pool, {
      code: 'BG-CU-RIENG',
      items: [{ materialId: m9.materialId, materialCode: 'M9', materialName: 'M9', unit: 'Bộ', price: 1 }],
    });
    await handle.pool.query(`UPDATE crm_schema.customers SET price_list_id = $2 WHERE id = $1`, [vipCustomerId, legacy]);
    const vip = await policies.create(admin, {
      code: 'VIP',
      name: 'Ưu đãi VIP',
      percent: 3,
      appliesToAllCustomers: false,
      validFrom: '2026-01-01',
      rules: [{ criterion: 'CUSTOMER_GROUP', refId: vipGroupId }],
    });
    const result = await pricing.preview(seller, { customerId: vipCustomerId, priceListId: bg105, date: '2026-11-15', lines: [line] });
    expect(result.customerGroupId).toBe(vipGroupId);
    expect(result.lines[0]).toMatchObject({ priceSource: 'GROUP_LIST', priceReferenceCode: 'BG-105', listPrice: 3_150, discountPercent: 3 });
    // Bảng nhập tay cũ vẫn chọn được.
    const fromLegacy = await pricing.preview(seller, { priceListId: legacy, date: '2026-11-15', lines: [line] });
    expect(fromLegacy.lines[0]).toMatchObject({ listPrice: 1, priceReferenceCode: 'BG-CU-RIENG' });
    // Dòng chưa nhập giá ở Kho phải ghi đè đơn giá; ghi đè thì dùng thuế suất của dòng.
    const m1 = byCode(await lists.get(admin, defaultId), 'M1') as PriceListItem;
    await catalog.set('M1', { salePrice: null });
    await sync.sync(admin);
    await expect(
      pricing.preview(seller, { priceListId: defaultId, lines: [{ materialId: m1.materialId, materialCode: 'M1', quantity: 1, unit: 'Cái' }] }),
    ).rejects.toMatchObject({ code: 'PRICE_NOT_FOUND', message: 'Mặt hàng M1 chưa nhập giá ở Kho; vui lòng nhập đơn giá ghi đè.' });
    await policies.remove(admin, vip.id);
  });

  it('A8.3: khách ngoài phạm vi của nhân viên trả 404', async () => {
    const outsider: CrmActor = { ...seller, userId: randomUUID() };
    await expect(
      pricing.preview(outsider, { customerId: vipCustomerId, priceListId: bg105, lines: [{ materialId: randomUUID(), quantity: 1, unit: 'Cái' }] }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('A6.16, A6.17: mặt hàng chọn được theo bảng đã chọn (có M4, M6); chưa chọn bảng thì rỗng', async () => {
    const query = { date: '2026-11-15', priceListId: bg105, customerId: vipCustomerId, search: '', limit: 30 };
    const codes = (await pricingStore.pricedMaterials(tenantId, query)).map((row) => row.code);
    expect(codes).toEqual(expect.arrayContaining(['M4', 'M6', 'M9']));
    expect(codes).not.toContain('M7');
    await expect(pricingStore.pricedMaterials(tenantId, { ...query, priceListId: null })).resolves.toEqual([]);
    await expect(pricingStore.pricedMaterials(tenantId, { ...query, search: 'M9' })).resolves.toEqual([
      expect.objectContaining({ code: 'M9', units: ['bộ'] }),
    ]);
    await expect(pricingStore.priceListsForPricing(tenantId, '2026-11-15', null, [])).resolves.toEqual([]);
  });

  it('CRUD chính sách: bậc số lượng; trùng mã 409; NV không ghi được', async () => {
    const tiers = await policies.create(admin, {
      code: 'BAC-SL',
      name: 'Bậc số lượng',
      priority: 10,
      validFrom: '2026-01-01',
      rules: [
        { criterion: 'QUANTITY', minQty: 1, maxQty: 9, percent: 2 },
        { criterion: 'QUANTITY', minQty: 10, maxQty: 49, percent: 5 },
        { criterion: 'QUANTITY', minQty: 50, percent: 8 },
      ],
    });
    expect(tiers.rules).toHaveLength(3);
    await expect(policies.create(admin, { code: 'BAC-SL', name: 'Trùng', percent: 1, validFrom: '2026-01-01' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'POLICY_CODE_EXISTS',
    });
    await expect(policies.create(seller, { code: 'X', name: 'X', percent: 1, validFrom: '2026-01-01' })).rejects.toMatchObject({ statusCode: 403 });
    const m9 = byCode(await lists.get(admin, bg105), 'M9') as PriceListItem;
    const result = await pricing.preview(seller, { priceListId: bg105, date: '2026-11-15', lines: [{ materialId: m9.materialId, quantity: 10, unit: 'Bộ' }] });
    expect(result.lines[0]).toMatchObject({ discountPercent: 5, lineAmount: 29_925 });
  });

  it('A4.18: danh mục Kho rỗng: bảng mặc định 0 dòng, bảng theo tỷ lệ bỏ hết dòng', async () => {
    catalog.items = [];
    const result = await sync.sync(admin);
    expect(result.added).toBe(0);
    expect(await items(defaultId)).toEqual([]);
    expect(await items(bg90)).toEqual([]);
    expect(await items(bg105)).toEqual([]);
  });
});
