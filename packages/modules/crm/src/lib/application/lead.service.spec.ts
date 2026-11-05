import { CRM_NO_CAPABILITIES, type Lead } from '@enterprise-platform/contracts-crm';
import type { CrmActor } from './crm-actor.js';
import type { CrmDataScopeService } from './data-scope.js';
import { LeadService } from './lead.service.js';
import type { LeadStore } from './sales-store.port.js';

const NV1 = '00000000-0000-4000-8000-000000000001';
const LEAD_ID = '40000000-0000-4000-8000-000000000001';
const writer: CrmActor = { ...CRM_NO_CAPABILITIES, tenantId: 't1', userId: NV1, displayName: 'NV1', canWriteOpportunity: true };

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: LEAD_ID,
    name: 'Công ty Sự Kiện',
    contactName: 'Anh Tuấn',
    taxCode: '0101234567',
    phone: '0901234567',
    email: 'tuan@example.vn',
    source: 'Sự kiện',
    need: 'Mua máy',
    note: null,
    ownerUserId: NV1,
    status: 'NEW',
    convertedCustomerId: null,
    convertedOpportunityId: null,
    convertedAt: null,
    version: 4,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function setup(current: Lead) {
  const leads = {
    getLead: jest.fn().mockResolvedValue(current),
    convertLead: jest.fn().mockResolvedValue({ customerId: 'c', opportunityId: 'o', attachedToExistingCustomer: false }),
    createLead: jest.fn().mockResolvedValue(LEAD_ID),
    updateLead: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<LeadStore>;
  const scopes = { resolve: jest.fn().mockResolvedValue({ kind: 'users', userIds: [NV1] }) } as unknown as CrmDataScopeService;
  return { leads, service: new LeadService(leads, scopes) };
}

describe('LeadService', () => {
  it('chuyển đổi dựng kế hoạch: khách tiềm năng, người liên hệ chính, cơ hội theo tên lead', async () => {
    const { leads, service } = setup(lead());
    const result = await service.convert(writer, LEAD_ID, { expectedValue: 5_000_000 });
    expect(result).toEqual({ leadId: LEAD_ID, customerId: 'c', opportunityId: 'o', attachedToExistingCustomer: false });
    expect(leads.convertLead).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        leadId: LEAD_ID,
        expectedVersion: 4,
        customer: expect.objectContaining({ name: 'Công ty Sự Kiện', taxCode: '0101234567', kind: 'LEAD_CUSTOMER', ownerUserId: NV1 }),
        contact: expect.objectContaining({ fullName: 'Anh Tuấn', isPrimary: true }),
        opportunity: expect.objectContaining({ name: 'Công ty Sự Kiện', expectedValue: 5_000_000, need: 'Mua máy' }),
      }),
      NV1,
    );
  });

  it('TC-OPP-02: MST sai định dạng trả 400, không gọi chuyển đổi', async () => {
    const { leads, service } = setup(lead({ taxCode: '01012345' }));
    await expect(service.convert(writer, LEAD_ID, {})).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_TAX_CODE' });
    expect(leads.convertLead).not.toHaveBeenCalled();
  });

  it('lead đã chuyển đổi hoặc không tiềm năng: 409', async () => {
    await expect(setup(lead({ status: 'CONVERTED' })).service.convert(writer, LEAD_ID, {})).rejects.toMatchObject({ statusCode: 409 });
    await expect(setup(lead({ status: 'DISQUALIFIED' })).service.convert(writer, LEAD_ID, {})).rejects.toMatchObject({ statusCode: 409 });
  });

  it('không có quyền ghi: 403', async () => {
    const { service } = setup(lead());
    await expect(service.convert({ ...writer, canWriteOpportunity: false }, LEAD_ID, {})).rejects.toMatchObject({ statusCode: 403 });
  });

  it('sửa lead: không đặt được trạng thái Đã chuyển đổi bằng tay', async () => {
    const { service } = setup(lead());
    await expect(service.update(writer, LEAD_ID, { name: 'X', status: 'CONVERTED' as never, version: 4 })).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});
