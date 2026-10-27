import { CRM_NO_CAPABILITIES, type CustomerDetail } from '@enterprise-platform/contracts-crm';
import { CrmNotFoundError } from '../domain/crm.error.js';
import type { PricingPolicy, PricingPriceList } from '../domain/pricing-engine.js';
import type { CrmActor } from './crm-actor.js';
import { DiscountPolicyService, discountPolicyRecord } from './discount-policy.service.js';
import { PriceListService, priceListRecord } from './price-list.service.js';
import type {
  CatalogMaterial,
  CatalogReader,
  DiscountPolicyStore,
  PriceListStore,
  PricingStore,
} from './pricing-store.port.js';
import { PricingService, vietnamToday } from './pricing.service.js';

const TENANT = 'tenant-1';
const CAP = '11111111-1111-4111-8111-111111111111';
const VIP = '33333333-3333-4333-8333-333333333333';
const CUSTOMER = '55555555-5555-4555-8555-555555555555';

const seller: CrmActor = { ...CRM_NO_CAPABILITIES, tenantId: TENANT, userId: 'u-1', displayName: 'NV1', canWriteOpportunity: true };
const manager: CrmActor = { ...seller, userId: 'u-2', displayName: 'QTBH', canManage: true };

/** Danh mục giả: thay cho API nội bộ của Kho (T1-24) trong test. */
class FakeCatalogReader implements CatalogReader {
  constructor(private readonly known: readonly CatalogMaterial[] = []) {}
  async materials(_tenantId: string, ids: readonly string[]): Promise<ReadonlyMap<string, CatalogMaterial>> {
    return new Map(this.known.filter((material) => ids.includes(material.id)).map((material) => [material.id, material]));
  }
}

function priceListStore(): jest.Mocked<PriceListStore> {
  return {
    listPriceLists: jest.fn().mockResolvedValue([]),
    getPriceList: jest.fn().mockResolvedValue({ id: 'list-1', items: [] }),
    createPriceList: jest.fn().mockResolvedValue('99999999-9999-4999-8999-999999999999'),
    updatePriceList: jest.fn().mockResolvedValue(true),
    deletePriceList: jest.fn().mockResolvedValue(true),
    addItem: jest.fn().mockResolvedValue('item-1'),
    updateItem: jest.fn().mockResolvedValue(true),
    deleteItem: jest.fn().mockResolvedValue(true),
    upsertItems: jest.fn().mockResolvedValue(true),
  };
}

describe('PriceListService', () => {
  const id = '99999999-9999-4999-8999-999999999999';

  it('chỉ crm.manage được tạo, sửa, xoá; ai có crm.read cũng xem được', async () => {
    const store = priceListStore();
    const service = new PriceListService(store, new FakeCatalogReader());
    const request = { code: 'bg-chuan', name: 'Bảng giá chuẩn', isStandard: true, validFrom: '2026-01-01' };
    await expect(service.create(seller, request)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.remove(seller, id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.addItem(seller, id, {} as never)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.list(seller)).resolves.toEqual([]);
    expect(store.createPriceList).not.toHaveBeenCalled();

    await service.create(manager, request);
    expect(store.createPriceList).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ code: 'BG-CHUAN', isStandard: true, validFrom: '2026-01-01', validTo: null, status: 'ACTIVE' }),
      [],
      'u-2',
    );
  });

  it('kiểm hiệu lực, mã, nhóm của bảng chuẩn', () => {
    expect(() => priceListRecord({ code: 'A', name: 'A', validFrom: '2026-12-31', validTo: '2026-12-01' })).toThrow(
      expect.objectContaining({ code: 'INVALID_VALIDITY' }),
    );
    expect(() => priceListRecord({ code: 'Bảng giá', name: 'A', validFrom: '2026-01-01' })).toThrow(
      expect.objectContaining({ code: 'INVALID_CODE' }),
    );
    expect(() => priceListRecord({ code: 'A', name: 'A', validFrom: '' })).toThrow(expect.objectContaining({ code: 'REQUIRED' }));
  });

  it('bảng chuẩn không gán nhóm khách', async () => {
    const service = new PriceListService(priceListStore(), new FakeCatalogReader());
    await expect(
      service.create(manager, { code: 'A', name: 'A', isStandard: true, validFrom: '2026-01-01', customerGroupIds: [VIP] }),
    ).rejects.toMatchObject({ code: 'STANDARD_LIST_GROUPS' });
  });

  it('dòng giá: kiểm đơn giá, thuế suất; mã, tên lấy theo danh mục khi danh mục biết mặt hàng', async () => {
    const store = priceListStore();
    const catalog = new FakeCatalogReader([{ id: CAP, code: 'QA-KHO-CAP', name: 'Cáp đồng', unit: 'Cái', category: 'Thiết bị' }]);
    const service = new PriceListService(store, catalog);
    await service.addItem(manager, id, { materialId: CAP, materialCode: 'gõ tay', materialName: 'gõ tay', unit: 'Cái', price: 1_000_000 });
    expect(store.addItem).toHaveBeenCalledWith(
      TENANT,
      id,
      { materialId: CAP, materialCode: 'QA-KHO-CAP', materialName: 'Cáp đồng', unit: 'Cái', price: 1_000_000, vatRate: 10 },
      'u-2',
    );
    await expect(
      service.addItem(manager, id, { materialId: CAP, materialCode: 'X', materialName: 'X', unit: 'Cái', price: -1 }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      service.addItem(manager, id, { materialId: CAP, materialCode: 'X', materialName: 'X', unit: 'Cái', price: 1, vatRate: 101 }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      service.addItem(manager, id, { materialId: 'abc', materialCode: 'X', materialName: 'X', unit: 'Cái', price: 1 }),
    ).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
  });

  it('dán nhiều dòng: báo số dòng lỗi, chặn trùng mặt hàng và đơn vị', async () => {
    const service = new PriceListService(priceListStore(), new FakeCatalogReader());
    const item = { materialId: CAP, materialCode: 'X', materialName: 'X', unit: 'Cái', price: 1 };
    await expect(service.upsertItems(manager, id, { items: [item, { ...item, price: -5 }] })).rejects.toMatchObject({
      message: expect.stringMatching(/^Dòng 2: /),
    });
    await expect(service.upsertItems(manager, id, { items: [item, item] })).rejects.toMatchObject({ code: 'DUPLICATE_ITEM' });
  });

  it('không có bảng giá thì 404', async () => {
    const store = priceListStore();
    store.getPriceList.mockResolvedValue(undefined);
    const service = new PriceListService(store, new FakeCatalogReader());
    await expect(service.get(seller, id)).rejects.toBeInstanceOf(CrmNotFoundError);
    await expect(service.get(seller, 'not-a-uuid')).rejects.toBeInstanceOf(CrmNotFoundError);
  });
});

describe('DiscountPolicyService', () => {
  const tiers = [
    { criterion: 'QUANTITY' as const, minQty: 1, maxQty: 9, percent: 2 },
    { criterion: 'QUANTITY' as const, minQty: 10, maxQty: 49, percent: 5 },
    { criterion: 'QUANTITY' as const, minQty: 50, maxQty: null, percent: 8 },
  ];

  it('chính sách bậc số lượng: các bậc là dòng QUANTITY, không có phần trăm chung', () => {
    const record = discountPolicyRecord({ code: 'bac-sl', name: 'Bậc số lượng', validFrom: '2026-01-01', rules: tiers });
    expect(record).toMatchObject({ code: 'BAC-SL', priority: 100, stacking: 'STACK', exclusive: false, percent: null });
    expect(record.rules).toHaveLength(3);
    expect(() =>
      discountPolicyRecord({ code: 'A', name: 'A', validFrom: '2026-01-01', percent: 3, rules: tiers }),
    ).toThrow(expect.objectContaining({ code: 'PERCENT_WITH_TIERS' }));
  });

  it('bậc chồng nhau hoặc bậc trước không giới hạn thì 400', () => {
    const overlap = [tiers[0], { ...tiers[1], minQty: 9 }];
    expect(() => discountPolicyRecord({ code: 'A', name: 'A', validFrom: '2026-01-01', rules: overlap })).toThrow(
      expect.objectContaining({ code: 'OVERLAPPING_TIERS' }),
    );
    const open = [{ ...tiers[0], maxQty: null }, tiers[1]];
    expect(() => discountPolicyRecord({ code: 'A', name: 'A', validFrom: '2026-01-01', rules: open })).toThrow(
      expect.objectContaining({ code: 'OVERLAPPING_TIERS' }),
    );
  });

  it('không bậc thì phải có phần trăm; phạm vi khách khớp với tiêu chí khách', () => {
    expect(() => discountPolicyRecord({ code: 'A', name: 'A', validFrom: '2026-01-01' })).toThrow(
      expect.objectContaining({ code: 'PERCENT_REQUIRED' }),
    );
    const vipRule = { criterion: 'CUSTOMER_GROUP' as const, refId: VIP };
    expect(() =>
      discountPolicyRecord({ code: 'A', name: 'A', validFrom: '2026-01-01', percent: 4, rules: [vipRule] }),
    ).toThrow(expect.objectContaining({ code: 'CUSTOMER_SCOPE_CONFLICT' }));
    expect(() =>
      discountPolicyRecord({ code: 'A', name: 'A', validFrom: '2026-01-01', percent: 4, appliesToAllCustomers: false }),
    ).toThrow(expect.objectContaining({ code: 'CUSTOMER_SCOPE_REQUIRED' }));
    expect(
      discountPolicyRecord({ code: 'VIP', name: 'VIP', validFrom: '2026-01-01', percent: 4, appliesToAllCustomers: false, rules: [vipRule] })
        .rules,
    ).toEqual([expect.objectContaining({ criterion: 'CUSTOMER_GROUP', refId: VIP, percent: null })]);
  });

  it('tiêu chí sai báo số thứ tự tiêu chí', () => {
    expect(() =>
      discountPolicyRecord({
        code: 'A',
        name: 'A',
        validFrom: '2026-01-01',
        percent: 2,
        rules: [{ criterion: 'PERIOD', fromDate: '2026-12-31', toDate: '2026-12-01' }],
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_RULE', message: 'Tiêu chí 1: đến ngày phải sau hoặc bằng từ ngày.' }));
    expect(() =>
      discountPolicyRecord({ code: 'A', name: 'A', validFrom: '2026-01-01', percent: 2, rules: [{ criterion: 'MATERIAL' }] }),
    ).toThrow(expect.objectContaining({ message: 'Tiêu chí 1: vui lòng chọn mặt hàng.' }));
  });

  it('chỉ crm.manage được ghi; nhóm khách trong tiêu chí phải tồn tại', async () => {
    const store: jest.Mocked<DiscountPolicyStore> = {
      listPolicies: jest.fn().mockResolvedValue([]),
      getPolicy: jest.fn().mockResolvedValue({ id: 'p-1' }),
      createPolicy: jest.fn().mockResolvedValue('88888888-8888-4888-8888-888888888888'),
      updatePolicy: jest.fn().mockResolvedValue(true),
      deletePolicy: jest.fn().mockResolvedValue(true),
      missingCustomerGroups: jest.fn().mockResolvedValue([VIP]),
      missingCustomers: jest.fn().mockResolvedValue([]),
    };
    const service = new DiscountPolicyService(store);
    const request = {
      code: 'VIP',
      name: 'VIP',
      validFrom: '2026-01-01',
      percent: 4,
      appliesToAllCustomers: false,
      rules: [{ criterion: 'CUSTOMER_GROUP' as const, refId: VIP }],
    };
    await expect(service.create(seller, request)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.create(manager, request)).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
    store.missingCustomerGroups.mockResolvedValue([]);
    await service.create(manager, request);
    expect(store.createPolicy).toHaveBeenCalledWith(TENANT, expect.objectContaining({ code: 'VIP' }), 'u-2');
  });
});

describe('PricingService.preview', () => {
  const standard: PricingPriceList = {
    id: 'list-1',
    code: 'BG-CHUAN',
    isStandard: true,
    validFrom: '2026-01-01',
    validTo: null,
    status: 'ACTIVE',
    customerGroupIds: [],
    items: [{ materialId: CAP, unit: 'Cái', price: 1_000_000, vatRate: 10 }],
  };
  const vipPolicy: PricingPolicy = {
    id: 'p-vip',
    code: 'VIP',
    name: 'VIP',
    priority: 20,
    stacking: 'STACK',
    exclusive: false,
    percent: 3,
    validFrom: '2026-01-01',
    validTo: null,
    status: 'ACTIVE',
    appliesToAllCustomers: false,
    rules: [{ criterion: 'CUSTOMER_GROUP', refId: VIP }],
  };

  function setup() {
    const store: jest.Mocked<PricingStore> = {
      discountCapPercent: jest.fn().mockResolvedValue(10),
      saveDiscountCapPercent: jest.fn().mockResolvedValue(undefined),
      priceListsForPricing: jest.fn().mockResolvedValue([standard]),
      policiesForPricing: jest.fn().mockResolvedValue([vipPolicy]),
    };
    const customers = { get: jest.fn().mockResolvedValue({ id: CUSTOMER, groupId: VIP } as CustomerDetail) };
    const service = new PricingService(store, customers, new FakeCatalogReader(), () => new Date('2026-12-31T18:30:00Z'));
    return { store, customers, service };
  }

  it('ngày mặc định là hôm nay theo giờ Việt Nam; nhóm lấy theo hồ sơ khách (đã kiểm phạm vi)', async () => {
    const { store, customers, service } = setup();
    const result = await service.preview(seller, {
      customerId: CUSTOMER,
      lines: [{ materialId: CAP, quantity: 10, unit: 'Cái' }],
    });
    expect(customers.get).toHaveBeenCalledWith(seller, CUSTOMER);
    expect(store.priceListsForPricing).toHaveBeenCalledWith(TENANT, '2027-01-01', VIP, [CAP]);
    expect(result).toMatchObject({ date: '2027-01-01', customerGroupId: VIP });
    expect(result.lines[0]).toMatchObject({ discountPercent: 3, lineAmount: 9_700_000 });
  });

  it('khách ngoài phạm vi trả 404 từ CustomerService', async () => {
    const { customers, service } = setup();
    customers.get.mockRejectedValue(new CrmNotFoundError('Không tìm thấy khách hàng.'));
    await expect(
      service.preview(seller, { customerId: CUSTOMER, lines: [{ materialId: CAP, quantity: 1, unit: 'Cái' }] }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('dòng sai: số lượng 0 trả "Số lượng phải lớn hơn 0", thiếu dòng trả 400', async () => {
    const { service } = setup();
    await expect(
      service.preview(seller, { lines: [{ materialId: CAP, quantity: 0, unit: 'Cái' }] }),
    ).rejects.toMatchObject({ statusCode: 400, message: 'Số lượng phải lớn hơn 0.' });
    await expect(service.preview(seller, { lines: [] })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('trần chiết khấu: ai cũng đọc, chỉ crm.manage sửa', async () => {
    const { store, service } = setup();
    await expect(service.settings(seller)).resolves.toEqual({ discountCapPercent: 10 });
    await expect(service.saveSettings(seller, { discountCapPercent: 12 })).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.saveSettings(manager, { discountCapPercent: 120 })).rejects.toMatchObject({ statusCode: 400 });
    await service.saveSettings(manager, { discountCapPercent: 12 });
    expect(store.saveDiscountCapPercent).toHaveBeenCalledWith(TENANT, 12, 'u-2');
  });

  it('vietnamToday đổi ngày lúc 17:00 UTC', () => {
    expect(vietnamToday(new Date('2026-12-31T16:59:59Z'))).toBe('2026-12-31');
    expect(vietnamToday(new Date('2026-12-31T17:00:00Z'))).toBe('2027-01-01');
  });
});
