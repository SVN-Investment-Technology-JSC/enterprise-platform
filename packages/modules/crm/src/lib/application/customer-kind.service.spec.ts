import { CRM_NO_CAPABILITIES } from '@enterprise-platform/contracts-crm';
import type { CrmActor } from './crm-actor.js';
import { CustomerKindService, kindRecord, optionalKindCode } from './customer-kind.service.js';
import type { CustomerKindStore } from './sales-store.port.js';

const manager: CrmActor = { ...CRM_NO_CAPABILITIES, tenantId: 't1', userId: 'u1', displayName: 'QTBH', canManage: true };
const seller: CrmActor = { ...CRM_NO_CAPABILITIES, tenantId: 't1', userId: 'u2', displayName: 'NV1', canWriteOpportunity: true };

const VIP = { code: 'VIP', name: 'Khách VIP', description: null, isSystem: false, sortOrder: 100, customerCount: 0 };

function setup() {
  const store: jest.Mocked<CustomerKindStore> = {
    listKinds: jest.fn().mockResolvedValue([VIP]),
    createKind: jest.fn().mockResolvedValue(VIP),
    updateKind: jest.fn().mockResolvedValue(VIP),
    deleteKind: jest.fn().mockResolvedValue(true),
  };
  return { store, service: new CustomerKindService(store) };
}

describe('CustomerKindService', () => {
  it('ai có crm.read cũng xem được danh mục', async () => {
    const { service } = setup();
    await expect(service.list(seller)).resolves.toEqual([VIP]);
  });

  it('tạo, sửa, xoá cần crm.manage', async () => {
    const { store, service } = setup();
    await expect(service.create(seller, { code: 'VIP', name: 'Khách VIP' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.update(seller, 'VIP', { code: 'VIP', name: 'Khách VIP' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.remove(seller, 'VIP')).rejects.toMatchObject({ statusCode: 403 });
    expect(store.createKind).not.toHaveBeenCalled();
    expect(store.updateKind).not.toHaveBeenCalled();
    expect(store.deleteKind).not.toHaveBeenCalled();
  });

  it('chuẩn hoá mã viết hoa và đặt thứ tự mặc định', async () => {
    const { store, service } = setup();
    await service.create(manager, { code: ' vip ', name: ' Khách VIP ' });
    expect(store.createKind).toHaveBeenCalledWith(
      't1',
      { code: 'VIP', name: 'Khách VIP', description: null, sortOrder: 100 },
      'u1',
    );
  });

  it('sửa và xoá theo mã hiện tại; mã sai định dạng hoặc không có thì 404', async () => {
    const { store, service } = setup();
    await service.update(manager, 'vip', { code: 'VIP-1', name: 'Khách VIP', sortOrder: 5 });
    expect(store.updateKind).toHaveBeenCalledWith('t1', 'VIP', expect.objectContaining({ code: 'VIP-1', sortOrder: 5 }), 'u1');
    await expect(service.remove(manager, 'Khách VIP!')).rejects.toMatchObject({ statusCode: 404 });
    store.deleteKind.mockResolvedValueOnce(false);
    await expect(service.remove(manager, 'KHONG-CO')).rejects.toMatchObject({ statusCode: 404 });
    store.updateKind.mockResolvedValueOnce(undefined);
    await expect(service.update(manager, 'KHONG-CO', { code: 'KHONG-CO', name: 'X' })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('kiểm mã, tên và thứ tự', () => {
    expect(() => kindRecord({ code: 'Khách VIP', name: 'Khách VIP' })).toThrow(/Mã phân loại/);
    expect(() => kindRecord({ code: 'VIP', name: ' ' })).toThrow(/tên phân loại/);
    expect(() => kindRecord({ code: 'VIP', name: 'Khách VIP', sortOrder: -1 })).toThrow();
  });

  it('mã phân loại khi lọc hoặc lưu khách', () => {
    expect(optionalKindCode(undefined)).toBeUndefined();
    expect(optionalKindCode('')).toBeUndefined();
    expect(optionalKindCode(' lead_customer ')).toBe('LEAD_CUSTOMER');
    expect(() => optionalKindCode('Khách VIP!')).toThrow();
    expect(() => optionalKindCode(5)).toThrow();
  });
});
