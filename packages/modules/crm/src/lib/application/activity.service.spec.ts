import { CRM_NO_CAPABILITIES, type Activity } from '@enterprise-platform/contracts-crm';
import { ActivityService } from './activity.service.js';
import type { CrmActor } from './crm-actor.js';
import type { CrmDataScopeService } from './data-scope.js';
import type { ActivityStore, CustomerStore, OpportunityStore } from './sales-store.port.js';

const NV1 = '00000000-0000-4000-8000-000000000001';
const NV2 = '00000000-0000-4000-8000-000000000002';
const CUSTOMER_ID = '10000000-0000-4000-8000-000000000001';
const OTHER_CUSTOMER = '10000000-0000-4000-8000-000000000002';
const OPP_ID = '30000000-0000-4000-8000-000000000001';
const ACTIVITY_ID = '50000000-0000-4000-8000-000000000001';
const writer: CrmActor = { ...CRM_NO_CAPABILITIES, tenantId: 't1', userId: NV1, displayName: 'NV1', canWriteOpportunity: true };

const existing: Activity = {
  id: ACTIVITY_ID,
  type: 'CALL',
  subject: 'Gọi chào hàng',
  description: null,
  customerId: CUSTOMER_ID,
  customerName: 'Minh Anh',
  opportunityId: null,
  opportunityName: null,
  assigneeUserId: NV1,
  dueAt: '2026-10-28T03:00:00.000Z',
  status: 'OPEN',
  result: null,
  completedAt: null,
  completedBy: null,
  version: 1,
  createdAt: '',
  createdBy: NV1,
};

function setup() {
  const activities = {
    createActivity: jest.fn().mockResolvedValue(ACTIVITY_ID),
    getActivity: jest.fn().mockResolvedValue(existing),
    updateActivity: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<ActivityStore>;
  const customers = { getCustomer: jest.fn().mockResolvedValue({ id: CUSTOMER_ID }) } as unknown as jest.Mocked<CustomerStore>;
  const opportunities = {
    getOpportunity: jest.fn().mockResolvedValue({ id: OPP_ID, customerId: CUSTOMER_ID }),
  } as unknown as jest.Mocked<OpportunityStore>;
  const scopes = { resolve: jest.fn().mockResolvedValue({ kind: 'all' }) } as unknown as CrmDataScopeService;
  return { activities, customers, service: new ActivityService(activities, customers, opportunities, scopes) };
}

describe('ActivityService', () => {
  it('TC-ACT-02: thiếu cả khách lẫn cơ hội trả 400', async () => {
    const { activities, service } = setup();
    await expect(service.create(writer, { type: 'CALL', subject: 'Gọi' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Hoạt động phải gắn khách hàng hoặc cơ hội.',
    });
    expect(activities.createActivity).not.toHaveBeenCalled();
  });

  it('TC-ACT-01: gắn cơ hội thì tự gắn khách của cơ hội; người được giao mặc định là người tạo', async () => {
    const { activities, service } = setup();
    await service.create(writer, { type: 'MEETING', subject: 'Gặp khách', opportunityId: OPP_ID, dueAt: '2026-10-28T10:00:00+07:00' });
    expect(activities.createActivity).toHaveBeenCalledWith(
      't1',
      { customerId: CUSTOMER_ID, opportunityId: OPP_ID },
      expect.objectContaining({ type: 'MEETING', assigneeUserId: NV1, dueAt: '2026-10-28T03:00:00.000Z', status: 'OPEN' }),
      NV1,
    );
  });

  it('cơ hội không thuộc khách đã chọn: 400', async () => {
    const { service } = setup();
    await expect(
      service.create(writer, { type: 'TASK', subject: 'X', opportunityId: OPP_ID, customerId: OTHER_CUSTOMER }),
    ).rejects.toMatchObject({ code: 'ACTIVITY_TARGET_MISMATCH' });
  });

  it('loại hoạt động lạ: 400', async () => {
    const { service } = setup();
    await expect(service.create(writer, { type: 'SMS' as never, subject: 'X', customerId: CUSTOMER_ID })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('TC-ACT-03: ghi kết quả và hoàn tất, giữ các trường không gửi', async () => {
    const { activities, service } = setup();
    await service.update(writer, ACTIVITY_ID, { version: 1, status: 'DONE', result: 'Khách đồng ý gặp', assigneeUserId: NV2 });
    expect(activities.updateActivity).toHaveBeenCalledWith(
      't1',
      ACTIVITY_ID,
      expect.objectContaining({ status: 'DONE', result: 'Khách đồng ý gặp', subject: 'Gọi chào hàng', assigneeUserId: NV2, dueAt: existing.dueAt }),
      1,
      NV1,
    );
  });
});
