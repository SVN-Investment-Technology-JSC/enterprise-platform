import { CRM_NO_CAPABILITIES } from '@enterprise-platform/contracts-crm';
import type { HttpException } from '@nestjs/common';
import type { CrmActor } from '../application/crm-actor.js';
import { CrmOrganizationUnavailableError } from '../domain/crm.error.js';
import { CrmController } from './crm.controller.js';

const NO_INVENTORY = { read: jest.fn().mockResolvedValue({ inventoryEntitled: false, canAccessInventory: false }) };

const ACTOR: CrmActor = {
  ...CRM_NO_CAPABILITIES,
  tenantId: 't1',
  userId: 'u1',
  displayName: 'Nhân viên',
  canWriteOpportunity: true,
  canWriteQuote: true,
};

describe('CrmController', () => {
  it('status trả mức sẵn sàng, người dùng hiện tại và đúng cờ quyền của actor (cờ quyền không kèm danh tính)', async () => {
    const schemaStatus = jest.fn().mockResolvedValue({ schemaExists: true, tablesReady: true });
    const controller = new CrmController({ schemaStatus }, NO_INVENTORY);
    const status = await controller.status({ crmActor: ACTOR });
    expect(schemaStatus).toHaveBeenCalledWith('t1');
    expect(status).toEqual({
      tenantId: 't1',
      userId: 'u1',
      schemaExists: true,
      tablesReady: true,
      inventoryEntitled: false,
      canAccessInventory: false,
      capabilities: { ...CRM_NO_CAPABILITIES, canWriteOpportunity: true, canWriteQuote: true },
    });
    expect(status.capabilities).not.toHaveProperty('userId');
  });

  it('thiếu actor (guard không chạy) thì 401', async () => {
    const controller = new CrmController({ schemaStatus: jest.fn() }, NO_INVENTORY);
    await expect(controller.status({})).rejects.toMatchObject({ status: 401 });
  });

  it('lỗi nghiệp vụ đổi thành { statusCode, code, message }', async () => {
    const controller = new CrmController({
      schemaStatus: jest.fn().mockRejectedValue(new CrmOrganizationUnavailableError()),
    }, NO_INVENTORY);
    const error = (await controller.status({ crmActor: ACTOR }).catch((cause) => cause)) as HttpException;
    expect(error.getStatus()).toBe(503);
    expect(error.getResponse()).toMatchObject({ statusCode: 503, code: 'ORGANIZATION_UNAVAILABLE' });
  });

  it('status chuyển cờ Kho từ Platform và truyền phiên của người gọi (TC-FB-11)', async () => {
    const read = jest.fn().mockResolvedValue({ inventoryEntitled: true, canAccessInventory: true });
    const controller = new CrmController({ schemaStatus: jest.fn().mockResolvedValue({ schemaExists: true, tablesReady: true }) }, { read });
    const status = await controller.status({ crmActor: { ...ACTOR, sessionId: 's1' } });
    expect(read).toHaveBeenCalledWith({ tenantId: 't1', userId: 'u1', sessionId: 's1' });
    expect(status).toMatchObject({ inventoryEntitled: true, canAccessInventory: true });
  });

  it('lỗi đọc Kho thì cả hai cờ false, status vẫn trả (TC-FB-14)', async () => {
    const controller = new CrmController(
      { schemaStatus: jest.fn().mockResolvedValue({ schemaExists: true, tablesReady: true }) },
      { read: jest.fn().mockRejectedValue(new Error('platform down')) },
    );
    const status = await controller.status({ crmActor: ACTOR });
    expect(status).toMatchObject({ inventoryEntitled: false, canAccessInventory: false, tablesReady: true });
  });
});
