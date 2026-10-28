import { CRM_NO_CAPABILITIES } from '@enterprise-platform/contracts-crm';
import type { HttpException } from '@nestjs/common';
import type { CrmActor } from '../application/crm-actor.js';
import { CrmOrganizationUnavailableError } from '../domain/crm.error.js';
import { CrmController } from './crm.controller.js';

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
    const controller = new CrmController({ schemaStatus });
    const status = await controller.status({ crmActor: ACTOR });
    expect(schemaStatus).toHaveBeenCalledWith('t1');
    expect(status).toEqual({
      tenantId: 't1',
      userId: 'u1',
      schemaExists: true,
      tablesReady: true,
      capabilities: { ...CRM_NO_CAPABILITIES, canWriteOpportunity: true, canWriteQuote: true },
    });
    expect(status.capabilities).not.toHaveProperty('userId');
  });

  it('thiếu actor (guard không chạy) thì 401', async () => {
    const controller = new CrmController({ schemaStatus: jest.fn() });
    await expect(controller.status({})).rejects.toMatchObject({ status: 401 });
  });

  it('lỗi nghiệp vụ đổi thành { statusCode, code, message }', async () => {
    const controller = new CrmController({
      schemaStatus: jest.fn().mockRejectedValue(new CrmOrganizationUnavailableError()),
    });
    const error = (await controller.status({ crmActor: ACTOR }).catch((cause) => cause)) as HttpException;
    expect(error.getStatus()).toBe(503);
    expect(error.getResponse()).toMatchObject({ statusCode: 503, code: 'ORGANIZATION_UNAVAILABLE' });
  });
});
