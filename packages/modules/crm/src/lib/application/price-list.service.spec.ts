import { CRM_NO_CAPABILITIES, type PriceListType } from '@enterprise-platform/contracts-crm';
import { CrmNotFoundError } from '../domain/crm.error.js';
import type { CrmActor } from './crm-actor.js';
import { PriceListService, priceListRecord, ratioPercent } from './price-list.service.js';
import type { CatalogMaterial, CatalogReader, PriceListStore } from './pricing-store.port.js';

const TENANT = 'tenant-1';
const LIST = '99999999-9999-4999-8999-999999999999';
const ITEM = '88888888-8888-4888-8888-888888888888';
const CAP = '11111111-1111-4111-8111-111111111111';

const seller: CrmActor = { ...CRM_NO_CAPABILITIES, tenantId: TENANT, userId: 'u-1', displayName: 'NV1', canWriteOpportunity: true };
const manager: CrmActor = { ...seller, userId: 'u-2', displayName: 'QTBH', canManage: true };

class FakeCatalogReader implements CatalogReader {
  constructor(private readonly known: readonly CatalogMaterial[] = []) {}
  async materials(_tenantId: string, ids: readonly string[]): Promise<ReadonlyMap<string, CatalogMaterial>> {
    return new Map(this.known.filter((material) => ids.includes(material.id)).map((material) => [material.id, material]));
  }
  async search(): Promise<CatalogMaterial[]> {
    return [...this.known];
  }
}

function priceListStore(listType: PriceListType = 'MANUAL'): jest.Mocked<PriceListStore> {
  return {
    listPriceLists: jest.fn().mockResolvedValue([]),
    getPriceList: jest.fn().mockResolvedValue({ id: LIST, items: [] }),
    priceListRef: jest.fn().mockResolvedValue({
      id: LIST,
      code: 'BG',
      name: 'Bảng',
      listType,
      status: 'ACTIVE',
      validFrom: '2026-01-01',
      validTo: null,
    }),
    createPriceList: jest.fn().mockResolvedValue(LIST),
    updatePriceList: jest.fn().mockResolvedValue(true),
    deletePriceList: jest.fn().mockResolvedValue(true),
    setManualPrice: jest.fn().mockResolvedValue(true),
    clearManualPrice: jest.fn().mockResolvedValue(true),
    setVatRate: jest.fn().mockResolvedValue(true),
    addItem: jest.fn().mockResolvedValue('item-1'),
    updateItem: jest.fn().mockResolvedValue(true),
    deleteItem: jest.fn().mockResolvedValue(true),
    upsertItems: jest.fn().mockResolvedValue(true),
  };
}

const item = { materialId: CAP, materialCode: 'X', materialName: 'X', unit: 'Cái', price: 1 };

describe('A3: tỷ lệ giá so với bảng mặc định', () => {
  it.each([100, 105, '105', 99.5, 0.01, 1000])('A3.1, A3.2: %p hợp lệ', (value) => {
    expect(ratioPercent(value, 100)).toBe(Number(value));
  });

  it.each([0, -5, 1000.01, 'abc', Number.NaN, Number.POSITIVE_INFINITY, true])('A3.3, A3.5: %p trả INVALID_NUMBER', (value) => {
    expect(() => ratioPercent(value, 100)).toThrow(expect.objectContaining({ code: 'INVALID_NUMBER', statusCode: 400 }));
  });

  it('A3.4: 3 chữ số thập phân trả lời "tối đa 2 chữ số thập phân"', () => {
    expect(() => ratioPercent(105.555, 100)).toThrow(
      expect.objectContaining({ code: 'INVALID_NUMBER', message: expect.stringContaining('tối đa 2 chữ số thập phân') }),
    );
  });

  it('A3.5: rỗng thì mặc định 100 khi tạo, giữ nguyên khi sửa', () => {
    expect(ratioPercent(undefined, 100)).toBe(100);
    expect(ratioPercent(null, 100)).toBe(100);
    expect(ratioPercent('', 100)).toBe(100);
    expect(ratioPercent(null, null)).toBeNull();
  });
});

describe('PriceListService (A5)', () => {
  it('A5.21, A5.22: chỉ quản trị bán hàng được ghi; ai có crm.read cũng xem được', async () => {
    const store = priceListStore('DERIVED');
    const service = new PriceListService(store, new FakeCatalogReader());
    const request = { code: 'bg-90', name: 'Bảng 90', validFrom: '2026-01-01', ratioPercent: 90 };
    await expect(service.create(seller, request)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.update(seller, LIST, request)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.remove(seller, LIST)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.setManualPrice(seller, LIST, ITEM, { price: 1 })).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.clearManualPrice(seller, LIST, ITEM)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.setVatRate(seller, LIST, ITEM, { vatRate: 8 })).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.addItem(seller, LIST, item)).rejects.toMatchObject({ statusCode: 403 });
    expect(store.createPriceList).not.toHaveBeenCalled();
    await expect(service.list(seller)).resolves.toEqual([]);
    await expect(service.get(seller, LIST)).resolves.toMatchObject({ id: LIST });
  });

  it('A5.2, A5.3: tạo luôn là bảng theo tỷ lệ; isStandard, loại gửi lên bị bỏ qua; tỷ lệ rỗng là 100', async () => {
    const store = priceListStore();
    const service = new PriceListService(store, new FakeCatalogReader());
    await service.create(manager, { code: 'bg-90', name: 'Bảng 90', validFrom: '2026-01-01', ratioPercent: 90 });
    expect(store.createPriceList).toHaveBeenLastCalledWith(
      TENANT,
      { code: 'BG-90', name: 'Bảng 90', ratioPercent: 90, validFrom: '2026-01-01', validTo: null, status: 'ACTIVE', note: null },
      'u-2',
    );
    await service.create(manager, { code: 'BG-X', name: 'X', validFrom: '2026-01-01', isStandard: true, listType: 'DEFAULT' } as never);
    expect(store.createPriceList).toHaveBeenLastCalledWith(TENANT, expect.objectContaining({ ratioPercent: 100 }), 'u-2');
    expect(store.createPriceList.mock.calls[1][1]).not.toHaveProperty('isStandard');
  });

  it('A5.5: mã có dấu, khoảng trắng trả INVALID_CODE; hiệu lực sai trả 400', () => {
    expect(() => priceListRecord({ code: 'Bảng giá', name: 'A', validFrom: '2026-01-01' })).toThrow(
      expect.objectContaining({ code: 'INVALID_CODE' }),
    );
    expect(() => priceListRecord({ code: 'A', name: 'A', validFrom: '2026-12-31', validTo: '2026-12-01' })).toThrow(
      expect.objectContaining({ code: 'INVALID_VALIDITY' }),
    );
    expect(() => priceListRecord({ code: 'A', name: 'A', validFrom: '' })).toThrow(expect.objectContaining({ code: 'REQUIRED' }));
  });

  it('A5.6, A5.7: sửa bảng theo tỷ lệ; tỷ lệ rỗng là giữ nguyên', async () => {
    const store = priceListStore('DERIVED');
    const service = new PriceListService(store, new FakeCatalogReader());
    await service.update(manager, LIST, { code: 'BG-90', name: 'Bảng 90', validFrom: '2026-01-01', ratioPercent: 110 });
    expect(store.updatePriceList).toHaveBeenLastCalledWith(TENANT, LIST, expect.objectContaining({ ratioPercent: 110 }), 'u-2');
    await service.update(manager, LIST, { code: 'BG-90', name: 'Tên mới', validFrom: '2026-02-01' });
    expect(store.updatePriceList).toHaveBeenLastCalledWith(TENANT, LIST, expect.objectContaining({ ratioPercent: null }), 'u-2');
  });

  it('A5.8–A5.12: nhập, bỏ giá tay ở bảng theo tỷ lệ; giá sai trả INVALID_NUMBER', async () => {
    const store = priceListStore('DERIVED');
    const service = new PriceListService(store, new FakeCatalogReader());
    await service.setManualPrice(manager, LIST, ITEM, { price: 11_000 });
    expect(store.setManualPrice).toHaveBeenCalledWith(TENANT, LIST, ITEM, 11_000, 'u-2');
    for (const price of [-1, 1.234, 1e13 + 1, 'abc']) {
      await expect(service.setManualPrice(manager, LIST, ITEM, { price } as never)).rejects.toMatchObject({ code: 'INVALID_NUMBER' });
    }
    await service.clearManualPrice(manager, LIST, ITEM);
    expect(store.clearManualPrice).toHaveBeenCalledWith(TENANT, LIST, ITEM, 'u-2');
    store.setManualPrice.mockResolvedValueOnce(false);
    await expect(service.setManualPrice(manager, LIST, ITEM, { price: 1 })).rejects.toBeInstanceOf(CrmNotFoundError);
  });

  it('A5.13: bảng theo tỷ lệ không thêm, sửa, xoá, dán dòng, không sửa thuế suất (PRICE_LIST_READ_ONLY)', async () => {
    const store = priceListStore('DERIVED');
    const service = new PriceListService(store, new FakeCatalogReader());
    const readOnly = { statusCode: 409, code: 'PRICE_LIST_READ_ONLY' };
    await expect(service.addItem(manager, LIST, item)).rejects.toMatchObject(readOnly);
    await expect(service.updateItem(manager, LIST, ITEM, item)).rejects.toMatchObject(readOnly);
    await expect(service.removeItem(manager, LIST, ITEM)).rejects.toMatchObject(readOnly);
    await expect(service.upsertItems(manager, LIST, { items: [item] })).rejects.toMatchObject(readOnly);
    await expect(service.setVatRate(manager, LIST, ITEM, { vatRate: 8 })).rejects.toMatchObject(readOnly);
    expect(store.addItem).not.toHaveBeenCalled();
    expect(store.setVatRate).not.toHaveBeenCalled();
  });

  it('A5.14–A5.16: bảng mặc định chỉ sửa thuế suất', async () => {
    const store = priceListStore('DEFAULT');
    const service = new PriceListService(store, new FakeCatalogReader());
    await service.setVatRate(manager, LIST, ITEM, { vatRate: 8 });
    expect(store.setVatRate).toHaveBeenCalledWith(TENANT, LIST, ITEM, 8, 'u-2');
    for (const vatRate of [-1, 101, 8.125]) {
      await expect(service.setVatRate(manager, LIST, ITEM, { vatRate })).rejects.toMatchObject({ code: 'INVALID_NUMBER' });
    }
    const readOnly = { statusCode: 409, code: 'PRICE_LIST_READ_ONLY' };
    const header = { code: 'BG-MAC-DINH', name: 'Đổi tên', validFrom: '2026-01-01', status: 'INACTIVE' as const };
    await expect(service.update(manager, LIST, header)).rejects.toMatchObject(readOnly);
    await expect(service.remove(manager, LIST)).rejects.toMatchObject(readOnly);
    await expect(service.addItem(manager, LIST, item)).rejects.toMatchObject(readOnly);
    await expect(service.updateItem(manager, LIST, ITEM, item)).rejects.toMatchObject(readOnly);
    await expect(service.removeItem(manager, LIST, ITEM)).rejects.toMatchObject(readOnly);
    await expect(service.upsertItems(manager, LIST, { items: [item] })).rejects.toMatchObject(readOnly);
    await expect(service.setManualPrice(manager, LIST, ITEM, { price: 1 })).rejects.toMatchObject(readOnly);
    expect(store.updatePriceList).not.toHaveBeenCalled();
    expect(store.deletePriceList).not.toHaveBeenCalled();
  });

  it('A5.19: bảng nhập tay cũ: dòng giá kiểm đơn giá, thuế suất; mã, tên theo danh mục Kho', async () => {
    const store = priceListStore('MANUAL');
    const catalog = new FakeCatalogReader([{ id: CAP, code: 'QA-KHO-CAP', name: 'Cáp đồng', unit: 'Cái', category: 'Thiết bị' }]);
    const service = new PriceListService(store, catalog);
    await service.addItem(manager, LIST, { materialId: CAP, materialCode: 'gõ tay', materialName: 'gõ tay', unit: 'Cái', price: 1_000_000 });
    expect(store.addItem).toHaveBeenCalledWith(
      TENANT,
      LIST,
      { materialId: CAP, materialCode: 'QA-KHO-CAP', materialName: 'Cáp đồng', unit: 'Cái', price: 1_000_000, vatRate: 10 },
      'u-2',
    );
    await expect(service.addItem(manager, LIST, { ...item, price: -1 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.addItem(manager, LIST, { ...item, vatRate: 101 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.addItem(manager, LIST, { ...item, materialId: 'abc' })).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
    await expect(service.upsertItems(manager, LIST, { items: [item, { ...item, price: -5 }] })).rejects.toMatchObject({
      message: expect.stringMatching(/^Dòng 2: /),
    });
    await expect(service.upsertItems(manager, LIST, { items: [item, item] })).rejects.toMatchObject({ code: 'DUPLICATE_ITEM' });
    await service.updateItem(manager, LIST, ITEM, item);
    await service.removeItem(manager, LIST, ITEM);
    expect(store.deleteItem).toHaveBeenCalledWith(TENANT, LIST, ITEM);
  });

  it('không có bảng giá thì 404', async () => {
    const store = priceListStore();
    store.getPriceList.mockResolvedValue(undefined);
    store.priceListRef.mockResolvedValue(undefined);
    const service = new PriceListService(store, new FakeCatalogReader());
    await expect(service.get(seller, LIST)).rejects.toBeInstanceOf(CrmNotFoundError);
    await expect(service.get(seller, 'not-a-uuid')).rejects.toBeInstanceOf(CrmNotFoundError);
    await expect(service.remove(manager, LIST)).rejects.toBeInstanceOf(CrmNotFoundError);
    await expect(service.setVatRate(manager, 'x', ITEM, { vatRate: 8 })).rejects.toBeInstanceOf(CrmNotFoundError);
  });
});
