import { CRM_NO_CAPABILITIES } from '@enterprise-platform/contracts-crm';
import type { CrmActor } from './crm-actor.js';
import { CrmSettingsService, CustomerGroupService } from './customer-group.service.js';
import type { CustomerGroupStore, SettingsStore } from './sales-store.port.js';

const base: CrmActor = { ...CRM_NO_CAPABILITIES, tenantId: 't1', userId: 'u1', displayName: 'A' };
const manager: CrmActor = { ...base, canManage: true };
const GROUP_ID = '60000000-0000-4000-8000-000000000001';

describe('nhóm khách hàng và cấu hình', () => {
  const groups = {
    listGroups: jest.fn().mockResolvedValue([]),
    createGroup: jest.fn(async (_t, record) => ({ id: GROUP_ID, ...record, customerCount: 0 })),
    updateGroup: jest.fn().mockResolvedValue(undefined),
    deleteGroup: jest.fn().mockResolvedValue(false),
  } as unknown as jest.Mocked<CustomerGroupStore>;
  const service = new CustomerGroupService(groups);

  it('TC-CUS-08: chỉ crm.manage tạo nhóm; mã viết hoa', async () => {
    await expect(service.create({ ...base, canWriteOpportunity: true }, { code: 'dl1', name: 'Đại lý cấp 1' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.create(manager, { code: 'dl1', name: 'Đại lý cấp 1' })).resolves.toMatchObject({ code: 'DL1' });
  });

  it('mã nhóm có ký tự lạ: 400; nhóm không có: 404', async () => {
    await expect(service.create(manager, { code: 'Đại lý', name: 'X' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.update(manager, GROUP_ID, { code: 'A', name: 'B' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.remove(manager, GROUP_ID)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('cấu hình: ai cũng đọc, chỉ crm.manage sửa; giá trị sai 400', async () => {
    const store: jest.Mocked<SettingsStore> = {
      customerCodeRule: jest.fn().mockResolvedValue({ prefix: 'KH', length: 6 }),
      saveCustomerCodeRule: jest.fn().mockResolvedValue(undefined),
      activityReminderMinutes: jest.fn().mockResolvedValue(30),
      saveActivityReminderMinutes: jest.fn().mockResolvedValue(undefined),
    };
    const settings = new CrmSettingsService(store);
    await expect(settings.get(base)).resolves.toEqual({ customerCode: { prefix: 'KH', length: 6 }, activityReminderMinutes: 30 });
    await expect(settings.save(base, { activityReminderMinutes: 15 })).rejects.toMatchObject({ statusCode: 403 });
    await expect(settings.save(manager, { activityReminderMinutes: -5 })).rejects.toMatchObject({ statusCode: 400 });
    await settings.save(manager, { customerCode: { prefix: 'qa', length: 4 }, activityReminderMinutes: 15 });
    expect(store.saveCustomerCodeRule).toHaveBeenCalledWith('t1', { prefix: 'QA', length: 4 }, 'u1');
    expect(store.saveActivityReminderMinutes).toHaveBeenCalledWith('t1', 15, 'u1');
  });
});
