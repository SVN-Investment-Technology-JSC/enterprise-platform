import { CRM_NO_CAPABILITIES, type CustomerDetail } from '@enterprise-platform/contracts-crm';
import type { CrmActor } from './crm-actor.js';
import { CustomerService } from './customer.service.js';
import { scopeIncludes, type CrmDataScope, type CrmDataScopeService } from './data-scope.js';
import type { CustomerStore } from './sales-store.port.js';

const NV1 = '00000000-0000-4000-8000-000000000001';
const NV3 = '00000000-0000-4000-8000-000000000003';
const CUSTOMER_ID = '10000000-0000-4000-8000-000000000001';
const CONTACT_ID = '20000000-0000-4000-8000-000000000001';

const writer: CrmActor = { ...CRM_NO_CAPABILITIES, tenantId: 't1', userId: NV1, displayName: 'NV1', canWriteOpportunity: true };
const reader: CrmActor = { ...writer, canWriteOpportunity: false };

function customer(overrides: Partial<CustomerDetail> = {}): CustomerDetail {
  return {
    id: CUSTOMER_ID,
    code: 'KH000001',
    name: 'Công ty Minh Anh',
    taxCode: '0101234567',
    province: null,
    region: null,
    kind: 'CUSTOMER',
    groupId: null,
    groupName: null,
    ownerUserId: NV1,
    primaryContactName: null,
    updatedAt: '2026-10-27T00:00:00.000Z',
    address: 'Hà Nội',
    industry: null,
    phone: null,
    email: null,
    creditLimit: 1000,
    paymentTermDays: 30,
    note: null,
    version: 3,
    createdAt: '2026-10-27T00:00:00.000Z',
    contacts: [
      { id: CONTACT_ID, customerId: CUSTOMER_ID, fullName: 'Chị Lan', title: null, phone: null, email: null, note: null, isPrimary: false },
    ],
    ...overrides,
  };
}

function setup(options: { scope?: CrmDataScope; existing?: CustomerDetail; matches?: { id: string; code: string; name: string }[] } = {}) {
  const scope: CrmDataScope = options.scope ?? { kind: 'users', userIds: [NV1] };
  const existing = options.existing ?? customer();
  const store: jest.Mocked<CustomerStore> = {
    listCustomers: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    getCustomer: jest.fn(async (_tenant, readScope: CrmDataScope, id: string) =>
      id === existing.id && scopeIncludes(readScope, existing.ownerUserId) ? existing : undefined,
    ),
    findByTaxCode: jest.fn().mockResolvedValue(options.matches ?? []),
    createCustomer: jest.fn().mockResolvedValue(existing.id),
    updateCustomer: jest.fn().mockResolvedValue(undefined),
    addContact: jest.fn().mockResolvedValue(CONTACT_ID),
    updateContact: jest.fn().mockResolvedValue(true),
    deleteContact: jest.fn().mockResolvedValue(true),
    lookupCustomers: jest.fn().mockResolvedValue([]),
  };
  const scopes = { resolve: jest.fn().mockResolvedValue(scope) } as unknown as CrmDataScopeService;
  return { store, service: new CustomerService(store, scopes) };
}

describe('CustomerService', () => {
  it('tạo khách: người phụ trách mặc định là người tạo, mã rỗng để store sinh', async () => {
    const { store, service } = setup();
    await service.create(writer, { name: '  Công ty Minh Anh ', taxCode: '0101234567', kind: 'CUSTOMER' });
    expect(store.createCustomer).toHaveBeenCalledWith(
      't1',
      null,
      expect.objectContaining({ name: 'Công ty Minh Anh', ownerUserId: NV1, taxCode: '0101234567', kind: 'CUSTOMER' }),
      NV1,
    );
  });

  it('không có crm.opportunity.write thì 403, không ghi gì', async () => {
    const { store, service } = setup();
    await expect(service.create(reader, { name: 'A' })).rejects.toMatchObject({ statusCode: 403 });
    expect(store.createCustomer).not.toHaveBeenCalled();
  });

  it('MST sai định dạng: 400 trước khi ghi', async () => {
    const { store, service } = setup();
    await expect(service.create(writer, { name: 'A', taxCode: '01012345' })).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_TAX_CODE',
    });
    expect(store.createCustomer).not.toHaveBeenCalled();
  });

  it('TC-CUS-05: MST trùng thì cảnh báo kèm khách đã có; xác nhận thì lưu', async () => {
    const matches = [{ id: CUSTOMER_ID, code: 'KH000001', name: 'Công ty Minh Anh' }];
    const { store, service } = setup({ matches });
    await expect(service.create(writer, { name: 'B', taxCode: '0101234567' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'DUPLICATE_TAX_CODE',
      details: { matches },
    });
    expect(store.createCustomer).not.toHaveBeenCalled();
    await service.create(writer, { name: 'B', taxCode: '0101234567', confirmDuplicateTaxCode: true });
    expect(store.createCustomer).toHaveBeenCalledTimes(1);
  });

  it('nhân viên không giao khách cho người ngoài phạm vi', async () => {
    const { service } = setup();
    await expect(service.create(writer, { name: 'A', ownerUserId: NV3 })).rejects.toMatchObject({
      code: 'OWNER_OUT_OF_SCOPE',
    });
  });

  it('TC-PERM-03: khách ngoài phạm vi trả 404 cả khi đọc lẫn sửa', async () => {
    const { store, service } = setup({ existing: customer({ ownerUserId: NV3 }) });
    await expect(service.get(writer, CUSTOMER_ID)).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.update(writer, CUSTOMER_ID, { code: 'X', name: 'X', version: 1 })).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(service.get(writer, 'không-phải-uuid')).rejects.toMatchObject({ statusCode: 404 });
    expect(store.updateCustomer).not.toHaveBeenCalled();
  });

  it('sửa: trường không gửi giữ giá trị cũ, MST không đổi thì không kiểm trùng', async () => {
    const { store, service } = setup({ matches: [{ id: 'x', code: 'K', name: 'K' }] });
    await service.update(writer, CUSTOMER_ID, { code: 'kh000009', name: 'Tên mới', version: 3 } as never);
    expect(store.findByTaxCode).not.toHaveBeenCalled();
    expect(store.updateCustomer).toHaveBeenCalledWith(
      't1',
      CUSTOMER_ID,
      'KH000009',
      expect.objectContaining({ name: 'Tên mới', address: 'Hà Nội', creditLimit: 1000, paymentTermDays: 30, ownerUserId: NV1 }),
      3,
      NV1,
    );
  });

  it('đặt người liên hệ chính gửi cờ chính cho store; người liên hệ lạ trả 404', async () => {
    const { store, service } = setup();
    await service.setPrimaryContact(writer, CUSTOMER_ID, CONTACT_ID);
    expect(store.updateContact).toHaveBeenCalledWith(
      't1',
      CUSTOMER_ID,
      CONTACT_ID,
      expect.objectContaining({ fullName: 'Chị Lan', isPrimary: true }),
      NV1,
    );
    await expect(
      service.setPrimaryContact(writer, CUSTOMER_ID, '20000000-0000-4000-8000-000000000009'),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('thêm người liên hệ thiếu họ tên trả 400', async () => {
    const { service } = setup();
    await expect(service.addContact(writer, CUSTOMER_ID, { fullName: ' ' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('danh sách chuyển bộ lọc đã kiểm cho store', async () => {
    const { store, service } = setup();
    await service.list(writer, { q: ' minh ', kind: 'CUSTOMER', limit: 500 });
    expect(store.listCustomers).toHaveBeenCalledWith('t1', { kind: 'users', userIds: [NV1] }, expect.objectContaining({ q: 'minh', kind: 'CUSTOMER', limit: 100 }));
    await expect(service.list(writer, { kind: 'VIP' as never })).rejects.toMatchObject({ statusCode: 400 });
  });

  describe('tra khách cho phân hệ khác (GET /v1/internal/customers)', () => {
    const system: CrmActor = { ...CRM_NO_CAPABILITIES, tenantId: 't1', userId: '00000000-0000-0000-0000-000000000000', displayName: 'Hệ thống' };

    it('theo chuỗi tìm: mặc định 20 dòng, tối đa 100; không lọc phạm vi người phụ trách', async () => {
      const { store, service } = setup();
      await service.lookup(system, { search: ' KH00 ' });
      expect(store.lookupCustomers).toHaveBeenLastCalledWith('t1', { q: 'KH00', ids: undefined, limit: 20 });
      await service.lookup(system, { limit: '500' });
      expect(store.lookupCustomers).toHaveBeenLastCalledWith('t1', { q: undefined, ids: undefined, limit: 100 });
    });

    it('theo danh sách id: bỏ id sai định dạng, trùng; không còn id hợp lệ thì trả rỗng không hỏi DB', async () => {
      const { store, service } = setup();
      await service.lookup(system, { ids: `${CUSTOMER_ID},abc,${CUSTOMER_ID.toUpperCase()}` });
      expect(store.lookupCustomers).toHaveBeenLastCalledWith('t1', { q: undefined, ids: [CUSTOMER_ID], limit: 1 });
      store.lookupCustomers.mockClear();
      await expect(service.lookup(system, { ids: 'abc' })).resolves.toEqual([]);
      expect(store.lookupCustomers).not.toHaveBeenCalled();
    });

    it('limit sai trả 400', async () => {
      const { service } = setup();
      await expect(service.lookup(system, { limit: '0' })).rejects.toMatchObject({ statusCode: 400 });
    });
  });
});
