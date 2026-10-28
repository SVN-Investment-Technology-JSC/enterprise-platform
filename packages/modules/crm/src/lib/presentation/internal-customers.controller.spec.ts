import { CRM_NO_CAPABILITIES } from '@enterprise-platform/contracts-crm';
import type { HttpException } from '@nestjs/common';
import type { CrmActor } from '../application/crm-actor.js';
import { CustomerService } from '../application/customer.service.js';
import type { CrmDataScopeService } from '../application/data-scope.js';
import type { CustomerStore } from '../application/sales-store.port.js';
import { InternalCustomersController } from './internal-customers.controller.js';

const SYSTEM: CrmActor = {
  ...CRM_NO_CAPABILITIES,
  tenantId: 't1',
  userId: '00000000-0000-0000-0000-000000000000',
  displayName: 'Hệ thống',
};
const CUSTOMER = {
  id: '10000000-0000-4000-8000-000000000001',
  code: 'KH000001',
  name: 'Công ty Minh Anh',
  taxCode: '0101234567',
  version: 3,
};

function setup() {
  const store = { lookupCustomers: jest.fn().mockResolvedValue([CUSTOMER]) } as unknown as jest.Mocked<CustomerStore>;
  // Actor hệ thống không có phạm vi dữ liệu: tra khách không được hỏi phạm vi.
  const scopes = { resolve: jest.fn().mockRejectedValue(new Error('scope must not be resolved')) };
  const controller = new InternalCustomersController(
    new CustomerService(store, scopes as unknown as CrmDataScopeService),
  );
  return { store, scopes, controller };
}

describe('InternalCustomersController', () => {
  it('nằm dưới /v1/internal để guard xác thực bằng service token', () => {
    expect(Reflect.getMetadata('path', InternalCustomersController)).toBe('v1/internal');
  });

  it('trả { items } chỉ gồm id, mã, tên, MST, phiên bản', async () => {
    const { controller, store, scopes } = setup();
    const result = await controller.lookup({ crmActor: SYSTEM }, 'minh', undefined, '10');
    expect(result).toEqual({ items: [CUSTOMER] });
    expect(store.lookupCustomers).toHaveBeenCalledWith('t1', { q: 'minh', ids: undefined, limit: 10 });
    expect(scopes.resolve).not.toHaveBeenCalled();
  });

  it('nhận ids lặp tham số', async () => {
    const { controller, store } = setup();
    await controller.lookup({ crmActor: SYSTEM }, undefined, [CUSTOMER.id, 'x']);
    expect(store.lookupCustomers).toHaveBeenCalledWith('t1', { q: undefined, ids: [CUSTOMER.id], limit: 1 });
  });

  it('thiếu actor thì 401; tham số sai thì 400', async () => {
    const { controller } = setup();
    await expect(controller.lookup({}, 'a')).rejects.toMatchObject({ status: 401 });
    const error = (await controller.lookup({ crmActor: SYSTEM }, 'a', undefined, '-1').catch((cause) => cause)) as HttpException;
    expect(error.getStatus()).toBe(400);
  });
});
