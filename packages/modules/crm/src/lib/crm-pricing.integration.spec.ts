import { randomUUID } from 'node:crypto';
import { CRM_NO_CAPABILITIES } from '@enterprise-platform/contracts-crm';
import type { CrmActor } from './application/crm-actor.js';
import { CustomerGroupService } from './application/customer-group.service.js';
import { CustomerService } from './application/customer.service.js';
import { CrmDataScopeService } from './application/data-scope.js';
import { DiscountPolicyService } from './application/discount-policy.service.js';
import { PriceListService } from './application/price-list.service.js';
import { PricingService } from './application/pricing.service.js';
import { createCrmTestDatabase, crmIntegrationEnabled, type CrmTestDatabaseHandle } from './crm-test-support.js';
import { PendingCatalogReader } from './infrastructure/pending-catalog-reader.js';
import { PostgresCustomerStore } from './infrastructure/postgres-customer.store.js';
import {
  PostgresDiscountPolicyStore,
  PostgresPriceListStore,
  PostgresPricingStore,
} from './infrastructure/postgres-pricing.store.js';
import { PostgresCustomerGroupStore } from './infrastructure/postgres-settings.store.js';

const integration = crmIntegrationEnabled() ? describe : describe.skip;

/** Mặt hàng `QA-KHO-CAP` của Kho (chỉ id và mã chụp lại; không đọc schema Kho). */
const CAP = randomUUID();

integration('Bán hàng GĐ3a: bảng giá, chính sách, thử tính giá (PostgreSQL)', () => {
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

  let lists: PriceListService;
  let policies: DiscountPolicyService;
  let pricing: PricingService;
  let customers: CustomerService;
  let groups: CustomerGroupService;
  let vipGroupId: string;
  let vipCustomerId: string;

  beforeAll(async () => {
    handle = await createCrmTestDatabase();
    const scopes = new CrmDataScopeService({ snapshot: async () => ({ positions: [], assignments: [] }) });
    const catalog = new PendingCatalogReader();
    customers = new CustomerService(new PostgresCustomerStore(handle.database), scopes);
    groups = new CustomerGroupService(new PostgresCustomerGroupStore(handle.database));
    lists = new PriceListService(new PostgresPriceListStore(handle.database), catalog);
    policies = new DiscountPolicyService(new PostgresDiscountPolicyStore(handle.database));
    pricing = new PricingService(new PostgresPricingStore(handle.database), customers, catalog);

    vipGroupId = (await groups.create(admin, { code: 'VIP', name: 'Khách VIP' })).id;
    vipCustomerId = (await customers.create({ ...admin, canWriteOpportunity: true }, { name: 'Công ty VIP', groupId: vipGroupId, ownerUserId: seller.userId })).id;
  }, 120_000);

  afterAll(async () => {
    await handle?.drop();
  }, 60_000);

  const item = (price: number) => ({ materialId: CAP, materialCode: 'QA-KHO-CAP', materialName: 'Cáp', unit: 'Cái', price, vatRate: 10 });

  it('migration ghi trần chiết khấu mặc định 10%', async () => {
    await expect(pricing.settings(seller)).resolves.toEqual({ discountCapPercent: 10 });
  });

  it('CRUD bảng giá chuẩn và dòng giá; trùng mã 409; trùng mặt hàng và đơn vị 409', async () => {
    const created = await lists.create(admin, { code: 'bg-chuan', name: 'Bảng giá chuẩn', isStandard: true, validFrom: '2026-01-01' });
    expect(created).toMatchObject({ code: 'BG-CHUAN', isStandard: true, validTo: null, status: 'ACTIVE', itemCount: 0 });

    const withItem = await lists.addItem(admin, created.id, item(1_000_000));
    expect(withItem.items).toEqual([expect.objectContaining({ materialCode: 'QA-KHO-CAP', price: 1_000_000, vatRate: 10 })]);
    await expect(lists.addItem(admin, created.id, item(5))).rejects.toMatchObject({ statusCode: 409, code: 'PRICE_LIST_ITEM_EXISTS' });

    const other = randomUUID();
    const bulk = await lists.upsertItems(admin, created.id, {
      items: [item(1_000_000), { ...item(250_000.5), materialId: other, materialCode: 'QA-KHO-KHAC', unit: 'Thùng', vatRate: 8 }],
    });
    expect(bulk.items).toHaveLength(2);
    expect(bulk.items.find((entry) => entry.materialId === other)).toMatchObject({ price: 250_000.5, vatRate: 8, unit: 'Thùng' });

    const khac = bulk.items.find((entry) => entry.materialId === other);
    const afterUpdate = await lists.updateItem(admin, created.id, khac?.id as string, { ...item(260_000), materialId: other, materialCode: 'QA-KHO-KHAC', unit: 'Thùng' });
    expect(afterUpdate.items.find((entry) => entry.materialId === other)?.price).toBe(260_000);
    const afterDelete = await lists.removeItem(admin, created.id, khac?.id as string);
    expect(afterDelete.items).toHaveLength(1);

    await expect(
      lists.create(admin, { code: 'BG-CHUAN', name: 'Trùng', validFrom: '2030-01-01' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PRICE_LIST_CODE_EXISTS' });
    await expect(lists.addItem(seller, created.id, item(1))).rejects.toMatchObject({ statusCode: 403 });
    await expect(lists.list(seller)).resolves.toEqual([expect.objectContaining({ code: 'BG-CHUAN', itemCount: 1 })]);
  });

  it('hai bảng chuẩn ACTIVE chồng hiệu lực trả 409', async () => {
    await expect(
      lists.create(admin, { code: 'BG-CHUAN-2', name: 'Chuẩn 2', isStandard: true, validFrom: '2026-06-01', validTo: '2026-06-30' }),
    ).rejects.toMatchObject({ statusCode: 409, message: 'Trùng thời gian hiệu lực với bảng giá BG-CHUAN' });
    // Bảng ngừng áp dụng thì không chặn.
    const inactive = await lists.create(admin, {
      code: 'BG-CHUAN-CU',
      name: 'Chuẩn cũ',
      isStandard: true,
      status: 'INACTIVE',
      validFrom: '2026-06-01',
    });
    await lists.remove(admin, inactive.id);
  });

  it('TC-PRC-02: bảng A cho VIP 01/12–31/12, tạo bảng B cho VIP 15/12–15/01 trả 409', async () => {
    const a = await lists.create(admin, {
      code: 'A',
      name: 'Bảng A',
      validFrom: '2026-12-01',
      validTo: '2026-12-31',
      customerGroupIds: [vipGroupId],
    });
    expect(a.customerGroups).toEqual([{ id: vipGroupId, code: 'VIP', name: 'Khách VIP' }]);
    await lists.addItem(admin, a.id, item(950_000));

    await expect(
      lists.create(admin, { code: 'B', name: 'Bảng B', validFrom: '2026-12-15', validTo: '2027-01-15', customerGroupIds: [vipGroupId] }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'PRICE_LIST_OVERLAP', message: 'Trùng thời gian hiệu lực với bảng giá A' });

    // Tạo B không nhóm rồi gán VIP cũng bị chặn; hiệu lực nối tiếp thì được.
    const b = await lists.create(admin, { code: 'B', name: 'Bảng B', validFrom: '2026-12-15', validTo: '2027-01-15' });
    await expect(lists.assignGroups(admin, b.id, [vipGroupId])).rejects.toMatchObject({ statusCode: 409 });
    const moved = await lists.update(admin, b.id, { code: 'B', name: 'Bảng B', validFrom: '2027-01-01', validTo: '2027-01-15' });
    expect(moved.customerGroups).toEqual([]);
    await expect(lists.assignGroups(admin, b.id, [vipGroupId])).resolves.toMatchObject({ customerGroups: [expect.objectContaining({ code: 'VIP' })] });
    await expect(lists.update(admin, b.id, { code: 'B', name: 'Bảng B', validFrom: '2026-12-31', validTo: '2027-01-15' })).rejects.toMatchObject({
      statusCode: 409,
    });
    await lists.remove(admin, b.id);
    await expect(lists.get(admin, b.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('TC-PRC-01: bảng nhóm áp ngày 31/12, sang 01/01 dùng bảng chuẩn', async () => {
    const at = async (date: string) =>
      (await pricing.preview(seller, { customerGroupId: vipGroupId, date, lines: [{ materialId: CAP, quantity: 1, unit: 'Cái' }] })).lines[0];
    await expect(at('2026-12-31')).resolves.toMatchObject({ priceSource: 'GROUP_LIST', listPrice: 950_000, priceReferenceCode: 'A' });
    await expect(at('2027-01-01')).resolves.toMatchObject({ priceSource: 'STANDARD_LIST', listPrice: 1_000_000 });
  });

  it('CRUD chính sách: bậc số lượng, VIP; trùng mã 409; NV không ghi được', async () => {
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
    expect(tiers.rules).toEqual([
      expect.objectContaining({ criterion: 'QUANTITY', minQty: 1, maxQty: 9, percent: 2 }),
      expect.objectContaining({ minQty: 10, maxQty: 49, percent: 5 }),
      expect.objectContaining({ minQty: 50, maxQty: null, percent: 8 }),
    ]);
    const vip = await policies.create(admin, {
      code: 'VIP',
      name: 'Ưu đãi VIP',
      priority: 20,
      percent: 3,
      appliesToAllCustomers: false,
      validFrom: '2026-01-01',
      rules: [{ criterion: 'CUSTOMER_GROUP', refId: vipGroupId, refText: 'VIP' }],
    });
    expect(vip).toMatchObject({ percent: 3, appliesToAllCustomers: false, stacking: 'STACK' });

    await expect(
      policies.create(admin, { code: 'VIP', name: 'Trùng', percent: 1, validFrom: '2026-01-01' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'POLICY_CODE_EXISTS' });
    await expect(
      policies.create(admin, {
        code: 'MA',
        name: 'Nhóm không có',
        percent: 1,
        appliesToAllCustomers: false,
        validFrom: '2026-01-01',
        rules: [{ criterion: 'CUSTOMER_GROUP', refId: randomUUID() }],
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_REFERENCE' });
    await expect(policies.create(seller, { code: 'X', name: 'X', percent: 1, validFrom: '2026-01-01' })).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(policies.list(seller)).resolves.toHaveLength(2);

    const temp = await policies.create(admin, { code: 'TAM', name: 'Tạm', percent: 1, validFrom: '2026-01-01' });
    const edited = await policies.update(admin, temp.id, {
      code: 'TAM',
      name: 'Tạm sửa',
      percent: 1.25,
      validFrom: '2026-01-01',
      status: 'INACTIVE',
      rules: [{ criterion: 'MATERIAL_CATEGORY', refText: 'Thiết bị' }],
    });
    expect(edited).toMatchObject({ name: 'Tạm sửa', percent: 1.25, status: 'INACTIVE', rules: [expect.objectContaining({ refText: 'Thiết bị' })] });
    await policies.remove(admin, temp.id);
    await expect(policies.get(admin, temp.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('TC-PRC-15: thử tính giá 10 cái cho khách VIP, bậc 5% + VIP 3% cộng dồn = 8% trên giá gốc', async () => {
    // Ngày ngoài hiệu lực bảng A để giá gốc là bảng chuẩn 1.000.000.
    const result = await pricing.preview(seller, {
      customerId: vipCustomerId,
      date: '2026-11-15',
      lines: [{ materialId: CAP, materialCode: 'QA-KHO-CAP', quantity: 10, unit: 'Cái' }],
      shipping: { amount: 200_000 },
    });
    expect(result.customerGroupId).toBe(vipGroupId);
    expect(result.lines[0]).toMatchObject({
      priceSource: 'STANDARD_LIST',
      listPrice: 1_000_000,
      discountPercent: 8,
      cappedAt: null,
      lineAmount: 9_200_000,
      vatAmount: 920_000,
    });
    expect(result.lines[0].appliedPolicies.map((applied) => [applied.code, applied.percent])).toEqual([
      ['BAC-SL', 5],
      ['VIP', 3],
    ]);
    expect(result.totals).toMatchObject({ netAmount: 9_200_000, shippingAmount: 200_000, vatAmount: 940_000, totalAmount: 10_340_000 });
  });

  it('TC-PRC-17: VIP 4% + bậc 8% với 50 cái bị cắt còn 10% (trần trong cấu hình)', async () => {
    const vip = (await policies.list(admin)).find((policy) => policy.code === 'VIP');
    await policies.update(admin, vip?.id as string, {
      code: 'VIP',
      name: 'Ưu đãi VIP',
      priority: 20,
      percent: 4,
      appliesToAllCustomers: false,
      validFrom: '2026-01-01',
      rules: [{ criterion: 'CUSTOMER_GROUP', refId: vipGroupId }],
    });
    const preview = () =>
      pricing.preview(seller, {
        customerId: vipCustomerId,
        date: '2026-11-15',
        lines: [{ materialId: CAP, quantity: 50, unit: 'Cái' }],
      });
    await expect(preview()).resolves.toMatchObject({
      discountCapPercent: 10,
      lines: [expect.objectContaining({ discountPercent: 10, cappedAt: 10, lineAmount: 45_000_000 })],
    });

    await pricing.saveSettings(admin, { discountCapPercent: 15 });
    await expect(preview()).resolves.toMatchObject({
      lines: [expect.objectContaining({ discountPercent: 12, cappedAt: null, lineAmount: 44_000_000 })],
    });
    await pricing.saveSettings(admin, { discountCapPercent: 10 });
  });

  it('khách ngoài phạm vi của nhân viên trả 404', async () => {
    const outsider: CrmActor = { ...seller, userId: randomUUID() };
    await expect(
      pricing.preview(outsider, { customerId: vipCustomerId, lines: [{ materialId: CAP, quantity: 1, unit: 'Cái' }] }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
