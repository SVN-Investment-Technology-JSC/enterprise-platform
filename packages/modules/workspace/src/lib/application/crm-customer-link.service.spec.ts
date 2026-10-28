import { CRM_CUSTOMER_CREATED, CRM_CUSTOMER_UPDATED } from '@enterprise-platform/contracts-integration';
import type { Customer } from '@enterprise-platform/contracts-workspace';
import { CrmCustomerLinkService, WORKSPACE_CRM_SYNC_ACTOR_ID, parseEventPayload } from './crm-customer-link.service.js';
import type { CrmCustomerCopyStore, CrmCustomerDirectory } from './crm-customer.port.js';
import type { WorkspaceActor } from './workspace.application.js';

const CRM_ID = '10000000-0000-4000-8000-000000000001';
const LOCAL_ID = '20000000-0000-4000-8000-000000000001';
const USER = '00000000-0000-4000-8000-000000000009';
const REFERENCE = { id: CRM_ID, code: 'KH000001', name: 'Công ty Minh Anh', taxCode: '0101234567', version: 2 };
const COPY: Customer = {
  id: LOCAL_ID,
  code: 'KH000001',
  name: 'Công ty Minh Anh',
  createdBy: USER,
  createdAt: '',
  updatedAt: '',
  crmCustomerId: CRM_ID,
};

const member: WorkspaceActor = {
  tenantId: 't1',
  userId: USER,
  displayName: 'U',
  isTenantAdmin: false,
  canManage: false,
  canWriteTasks: true,
  canWriteDocuments: false,
  canDeleteDocuments: false,
};

function setup(enabled = true) {
  const directory: jest.Mocked<CrmCustomerDirectory> = {
    enabled: jest.fn().mockResolvedValue(enabled),
    lookup: jest.fn().mockResolvedValue([REFERENCE]),
  };
  const copies: jest.Mocked<CrmCustomerCopyStore> = {
    ready: jest.fn().mockResolvedValue(true),
    apply: jest.fn().mockResolvedValue({ action: 'created', customer: COPY }),
    linkedIds: jest.fn().mockResolvedValue(new Map([[CRM_ID, LOCAL_ID]])),
  };
  return { directory, copies, service: new CrmCustomerLinkService(directory, copies) };
}

describe('CrmCustomerLinkService', () => {
  it('tenant không bật Bán hàng: tìm trả enabled=false, không gọi Bán hàng (TC-INT-14)', async () => {
    const { service, directory } = setup(false);
    await expect(service.search(member, { search: 'minh' })).resolves.toEqual({ enabled: false, items: [] });
    expect(directory.lookup).not.toHaveBeenCalled();
  });

  it('tìm ở Bán hàng kèm id bản sao đã có (TC-INT-13)', async () => {
    const { service, directory } = setup();
    const result = await service.search(member, { search: '  minh ' });
    expect(directory.lookup).toHaveBeenCalledWith('t1', { search: 'minh', limit: 50 });
    expect(result).toEqual({
      enabled: true,
      items: [
        { crmCustomerId: CRM_ID, code: 'KH000001', name: 'Công ty Minh Anh', taxCode: '0101234567', customerId: LOCAL_ID },
      ],
    });
  });

  it('chọn khách: đọc lại từ Bán hàng theo id rồi tạo hoặc gắn bản sao', async () => {
    const { service, directory, copies } = setup();
    await expect(service.link(member, CRM_ID)).resolves.toEqual(COPY);
    expect(directory.lookup).toHaveBeenCalledWith('t1', { ids: [CRM_ID], limit: 1 });
    expect(copies.apply).toHaveBeenCalledWith('t1', REFERENCE, { actorUserId: USER, targetCustomerId: undefined });
  });

  it('chọn khách: id lạ 404, chưa bật Bán hàng 409, chỉ định khách Workspace mà không phải quản trị 403', async () => {
    const { service, directory } = setup();
    directory.lookup.mockResolvedValueOnce([]);
    await expect(service.link(member, CRM_ID)).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.link(member, 'abc')).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.link(member, CRM_ID, { customerId: LOCAL_ID })).rejects.toMatchObject({ statusCode: 403 });
    await expect(setup(false).service.link(member, CRM_ID)).rejects.toMatchObject({
      statusCode: 409,
      code: 'CRM_NOT_ENABLED',
    });
  });

  it('quản trị chỉ định khách Workspace có sẵn để gắn', async () => {
    const { service, copies } = setup();
    await service.link({ ...member, isTenantAdmin: true }, CRM_ID, { customerId: LOCAL_ID });
    expect(copies.apply).toHaveBeenCalledWith('t1', REFERENCE, { actorUserId: USER, targetCustomerId: LOCAL_ID });
  });

  it('sự kiện crm.customer.*: ghi bản sao theo payload; loại khác bỏ qua', async () => {
    const { service, copies } = setup();
    const payload = { customerId: CRM_ID, code: 'KH000001', name: 'Công ty Minh Anh', taxCode: null, version: 1, actorUserId: null };
    await service.handleEvent('t1', CRM_CUSTOMER_CREATED, payload);
    expect(copies.apply).toHaveBeenLastCalledWith(
      't1',
      { id: CRM_ID, code: 'KH000001', name: 'Công ty Minh Anh', taxCode: null, version: 1 },
      { actorUserId: WORKSPACE_CRM_SYNC_ACTOR_ID },
    );
    await service.handleEvent('t1', CRM_CUSTOMER_UPDATED, { ...payload, version: 2, actorUserId: USER });
    expect(copies.apply).toHaveBeenLastCalledWith('t1', expect.objectContaining({ version: 2 }), { actorUserId: USER });
    copies.apply.mockClear();
    await expect(service.handleEvent('t1', 'crm.lead.created', payload)).resolves.toBeUndefined();
    expect(copies.apply).not.toHaveBeenCalled();
  });

  it('payload hỏng (thiếu mã, phiên bản sai) ném lỗi', () => {
    expect(() => parseEventPayload({ customerId: CRM_ID, code: '', name: 'A', version: 1 })).toThrow();
    expect(() => parseEventPayload({ customerId: CRM_ID, code: 'A', name: 'A', version: 0 })).toThrow();
    expect(() => parseEventPayload({ customerId: 'x', code: 'A', name: 'A', version: 1 })).toThrow();
  });
});
