import { CRM_NO_CAPABILITIES, type SalesOrganization } from '@enterprise-platform/contracts-crm';
import type { CrmActor } from './crm-actor.js';
import type { SalesOrganizationRecord, SalesOrganizationStore } from './sales-organization-store.port.js';
import { pickSalesOrganization, quoteSellerOf, SalesOrganizationService } from './sales-organization.service.js';

const ID = '11111111-1111-4111-8111-111111111111';
const actor = (extra: Partial<CrmActor> = {}): CrmActor => ({
  ...CRM_NO_CAPABILITIES,
  tenantId: 't1',
  userId: '22222222-2222-4222-8222-222222222222',
  displayName: 'Người dùng',
  ...extra,
});
const manager = actor({ canManage: true });
const seller = actor({ canWriteQuote: true });

const VALID = {
  name: '  Công ty Con A ',
  address: 'Số 1, Hà Nội',
  taxCode: '0101234567',
  phone: '024 0000 0000',
  email: 'a@example.vn',
};

function stored(overrides: Partial<SalesOrganization> = {}): SalesOrganization {
  return {
    id: ID,
    code: 'A',
    name: 'Công ty Con A',
    shortName: null,
    address: 'Số 1, Hà Nội',
    taxCode: '0101234567',
    phone: '024 0000 0000',
    email: 'a@example.vn',
    website: null,
    bankAccount: null,
    bankName: null,
    representative: null,
    representativeTitle: null,
    hasLogo: true,
    logo: 'data:image/png;base64,iVBORw0KGgo=',
    isDefault: false,
    active: true,
    sortOrder: 0,
    inUse: false,
    updatedAt: '2026-11-09T00:00:00.000Z',
    ...overrides,
  };
}

function fakeStore(current: SalesOrganization | undefined = stored()) {
  const writes: SalesOrganizationRecord[] = [];
  const store: SalesOrganizationStore = {
    list: async () => [],
    get: async (_tenantId, id) => (current && id === current.id ? current : undefined),
    defaultOrganization: async () => undefined,
    create: async (_tenantId, record) => {
      writes.push(record);
      return stored({ ...record, hasLogo: !!record.logo });
    },
    update: async (_tenantId, _id, record) => {
      writes.push(record);
      return stored({ ...record, hasLogo: !!record.logo });
    },
    remove: async (_tenantId, id) => (id !== current?.id ? 'not-found' : current.inUse ? 'in-use' : 'deleted'),
  };
  return { store, writes };
}

describe('SalesOrganizationService', () => {
  it('TC-ORG-07: chỉ crm.manage được tạo, sửa, xoá; crm.read đọc được', async () => {
    const { store } = fakeStore();
    const service = new SalesOrganizationService(store);
    await expect(service.create(seller, VALID)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.update(seller, ID, VALID)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.remove(seller, ID)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.get(actor(), ID)).resolves.toMatchObject({ id: ID });
    await expect(service.list(actor(), undefined)).resolves.toEqual([]);
  });

  it('TC-ORG-04: kiểm bằng validateSalesOrganization, lỗi 400 kèm fieldErrors; hợp lệ thì ghi bản đã chuẩn hoá', async () => {
    const { store, writes } = fakeStore();
    const service = new SalesOrganizationService(store);
    await expect(service.create(manager, { ...VALID, taxCode: '', email: 'sai' })).rejects.toMatchObject({
      statusCode: 400,
      code: 'SALES_ORGANIZATION_INVALID',
      message: 'Vui lòng nhập mã số thuế.',
      details: {
        fieldErrors: [
          { field: 'taxCode', message: 'Vui lòng nhập mã số thuế.' },
          { field: 'email', message: 'Email không đúng định dạng.' },
        ],
      },
    });
    await service.create(manager, VALID);
    expect(writes[0]).toMatchObject({ name: 'Công ty Con A', code: null, logo: null, isDefault: false, active: true, sortOrder: 0 });
  });

  it('TC-ORG-06: tắt tổ chức thì thôi là mặc định', async () => {
    const { store, writes } = fakeStore();
    await new SalesOrganizationService(store).create(manager, { ...VALID, isDefault: true, active: false });
    expect(writes[0]).toMatchObject({ isDefault: false, active: false });
  });

  it('sửa: trường không gửi giữ giá trị đang lưu (kể cả logo); logo null là bỏ', async () => {
    const { store, writes } = fakeStore(stored({ isDefault: true }));
    const service = new SalesOrganizationService(store);
    await service.update(manager, ID, { active: false });
    expect(writes[0]).toMatchObject({ name: 'Công ty Con A', code: 'A', active: false, isDefault: false, logo: stored().logo });
    await service.update(manager, ID, { ...VALID, logo: null });
    expect(writes[1]).toMatchObject({ logo: null, isDefault: true, active: true });
  });

  it('TC-ORG-05: xoá tổ chức đang dùng trả 409 tiếng Việt; không có trả 404 SALES_ORGANIZATION_NOT_FOUND', async () => {
    const service = new SalesOrganizationService(fakeStore(stored({ inUse: true })).store);
    await expect(service.remove(manager, ID)).rejects.toMatchObject({
      statusCode: 409,
      code: 'SALES_ORGANIZATION_IN_USE',
      message: 'Tổ chức đã có báo giá, chỉ tắt được.',
    });
    for (const id of ['khong-phai-uuid', '33333333-3333-4333-8333-333333333333']) {
      await expect(service.remove(manager, id)).rejects.toMatchObject({ statusCode: 404, code: 'SALES_ORGANIZATION_NOT_FOUND' });
      await expect(service.get(manager, id)).rejects.toMatchObject({ statusCode: 404, code: 'SALES_ORGANIZATION_NOT_FOUND' });
    }
  });
});

describe('tổ chức trên báo giá', () => {
  it('TC-ORG-08: chọn tổ chức đã tắt là 400 SALES_ORGANIZATION_INACTIVE; không có là 404', async () => {
    const reader = fakeStore(stored({ active: false })).store;
    await expect(pickSalesOrganization(reader, 't1', ID)).rejects.toMatchObject({
      statusCode: 400,
      code: 'SALES_ORGANIZATION_INACTIVE',
      message: 'Tổ chức báo giá này đã tắt, vui lòng chọn tổ chức khác.',
    });
    await expect(pickSalesOrganization(reader, 't1', '33333333-3333-4333-8333-333333333333')).rejects.toMatchObject({
      statusCode: 404,
      code: 'SALES_ORGANIZATION_NOT_FOUND',
    });
    await expect(pickSalesOrganization(undefined, 't1', ID)).rejects.toMatchObject({ statusCode: 404 });
    await expect(pickSalesOrganization(fakeStore().store, 't1', ID.toUpperCase())).resolves.toMatchObject({ id: ID });
  });

  it('TC-ORG-08: seller sửa tay chỉ kiểm độ dài, không ép bắt buộc; null là xoá; rỗng hết là null', () => {
    expect(quoteSellerOf(null)).toBeNull();
    expect(quoteSellerOf({ name: '  ', phone: '' })).toBeNull();
    expect(quoteSellerOf({ name: 'Công ty X', phone: '0909' })).toMatchObject({ name: 'Công ty X', phone: '0909', taxCode: '' });
    expect(() => quoteSellerOf({ name: 'x'.repeat(201) })).toThrow(
      expect.objectContaining({
        code: 'SALES_ORGANIZATION_INVALID',
        message: 'Tên công ty tối đa 200 ký tự.',
        details: { fieldErrors: [{ field: 'name', message: 'Tên công ty tối đa 200 ký tự.' }] },
      }),
    );
    expect(() => quoteSellerOf('chuỗi')).toThrow(expect.objectContaining({ code: 'SALES_ORGANIZATION_INVALID' }));
  });
});
