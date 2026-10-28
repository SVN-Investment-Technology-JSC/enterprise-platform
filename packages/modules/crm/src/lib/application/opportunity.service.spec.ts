import { CRM_NO_CAPABILITIES, type OpportunityDetail, type OpportunityStage } from '@enterprise-platform/contracts-crm';
import type { CrmActor } from './crm-actor.js';
import { scopeIncludes, type CrmDataScope, type CrmDataScopeService } from './data-scope.js';
import { OpportunityService } from './opportunity.service.js';
import type { CustomerStore, OpportunityStore } from './sales-store.port.js';

const NV1 = '00000000-0000-4000-8000-000000000001';
const NV3 = '00000000-0000-4000-8000-000000000003';
const OPP_ID = '30000000-0000-4000-8000-000000000001';
const CUSTOMER_ID = '10000000-0000-4000-8000-000000000001';

const writer: CrmActor = { ...CRM_NO_CAPABILITIES, tenantId: 't1', userId: NV1, displayName: 'NV1', canWriteOpportunity: true };

function opportunity(stage: OpportunityStage, owner = NV1): OpportunityDetail {
  return {
    id: OPP_ID,
    name: 'Dự án A',
    customerId: CUSTOMER_ID,
    customerCode: 'KH000001',
    customerName: 'Minh Anh',
    stage,
    probability: 40,
    expectedValue: 1000,
    expectedCloseDate: null,
    ownerUserId: owner,
    version: 2,
    updatedAt: '',
    need: null,
    budget: null,
    lostReason: null,
    leadId: null,
    closedAt: null,
    createdAt: '',
    history: [],
  };
}

function setup(current: OpportunityDetail, customerOwner = NV1) {
  const scope: CrmDataScope = { kind: 'users', userIds: [NV1] };
  const opportunities = {
    getOpportunity: jest.fn(async (_t: string, readScope: CrmDataScope) =>
      scopeIncludes(readScope, current.ownerUserId) ? current : undefined,
    ),
    changeStage: jest.fn().mockResolvedValue(undefined),
    createOpportunity: jest.fn().mockResolvedValue(OPP_ID),
    updateOpportunity: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<OpportunityStore>;
  const customers = {
    getCustomer: jest.fn(async (_t: string, readScope: CrmDataScope) =>
      scopeIncludes(readScope, customerOwner) ? { id: CUSTOMER_ID } : undefined,
    ),
  } as unknown as CustomerStore;
  const scopes = { resolve: jest.fn().mockResolvedValue(scope) } as unknown as CrmDataScopeService;
  return { opportunities, service: new OpportunityService(opportunities, customers, scopes) };
}

describe('OpportunityService', () => {
  it('chuyển hợp lệ gọi store với giai đoạn hiện tại làm điều kiện', async () => {
    const { opportunities, service } = setup(opportunity('NEW'));
    await service.changeStage(writer, OPP_ID, { stage: 'CONTACTED', version: 2 });
    expect(opportunities.changeStage).toHaveBeenCalledWith(
      't1',
      OPP_ID,
      { from: 'NEW', to: 'CONTACTED', reason: null, expectedVersion: 2 },
      NV1,
    );
  });

  it('chuyển sai bảng: 409, không ghi', async () => {
    const { opportunities, service } = setup(opportunity('WON'));
    await expect(service.changeStage(writer, OPP_ID, { stage: 'NEW' })).rejects.toMatchObject({ statusCode: 409 });
    expect(opportunities.changeStage).not.toHaveBeenCalled();
  });

  it('TC-OPP-04/05: Thua thiếu lý do 400; có lý do thì lưu lý do đã cắt khoảng trắng', async () => {
    const { opportunities, service } = setup(opportunity('NEGOTIATION'));
    await expect(service.changeStage(writer, OPP_ID, { stage: 'LOST' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Phải ghi lý do thua.',
    });
    await service.changeStage(writer, OPP_ID, { stage: 'LOST', reason: ' Giá cao hơn đối thủ ' });
    expect(opportunities.changeStage).toHaveBeenCalledWith(
      't1',
      OPP_ID,
      expect.objectContaining({ from: 'NEGOTIATION', to: 'LOST', reason: 'Giá cao hơn đối thủ', declineOpenQuotes: true }),
      NV1,
    );
  });

  it('giai đoạn lạ: 400', async () => {
    const { service } = setup(opportunity('NEW'));
    await expect(service.changeStage(writer, OPP_ID, { stage: 'DONE' as never })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('cơ hội của người ngoài phạm vi: 404', async () => {
    const { opportunities, service } = setup(opportunity('NEW', NV3));
    await expect(service.changeStage(writer, OPP_ID, { stage: 'CONTACTED' })).rejects.toMatchObject({ statusCode: 404 });
    expect(opportunities.changeStage).not.toHaveBeenCalled();
  });

  it('TC-OPP-06: tạo với xác suất ngoài 0–100 trả 400; 50 lưu được', async () => {
    const { opportunities, service } = setup(opportunity('NEW'));
    for (const probability of [-1, 101]) {
      await expect(
        service.create(writer, { customerId: CUSTOMER_ID, name: 'Cơ hội', probability }),
      ).rejects.toMatchObject({ statusCode: 400 });
    }
    await service.create(writer, { customerId: CUSTOMER_ID, name: 'Cơ hội', probability: 50 });
    expect(opportunities.createOpportunity).toHaveBeenCalledWith(
      't1',
      CUSTOMER_ID,
      expect.objectContaining({ probability: 50, ownerUserId: NV1 }),
      NV1,
    );
  });

  it('tạo cơ hội cho khách ngoài phạm vi: 404', async () => {
    const { service } = setup(opportunity('NEW'), NV3);
    await expect(service.create(writer, { customerId: CUSTOMER_ID, name: 'X' })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('cơ hội đã đóng không sửa được', async () => {
    const { service } = setup(opportunity('LOST'));
    await expect(service.update(writer, OPP_ID, { name: 'Y', version: 2 })).rejects.toMatchObject({
      statusCode: 409,
      code: 'OPPORTUNITY_CLOSED',
    });
  });
});
