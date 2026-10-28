import { randomUUID } from 'node:crypto';
import { CRM_NO_CAPABILITIES } from '@enterprise-platform/contracts-crm';
import { ActivityService, CustomerTimelineService } from './application/activity.service.js';
import type { CrmActor } from './application/crm-actor.js';
import { CustomerGroupService } from './application/customer-group.service.js';
import { CustomerService } from './application/customer.service.js';
import { CrmDataScopeService } from './application/data-scope.js';
import { LeadService } from './application/lead.service.js';
import { OpportunityService } from './application/opportunity.service.js';
import type { ReportingLineSnapshot } from './domain/reporting-line.js';
import { createCrmTestDatabase, crmIntegrationEnabled, type CrmTestDatabaseHandle } from './crm-test-support.js';
import { PostgresActivityStore, PostgresTimelineStore } from './infrastructure/postgres-activity.store.js';
import { PostgresCustomerStore } from './infrastructure/postgres-customer.store.js';
import { PostgresLeadStore } from './infrastructure/postgres-lead.store.js';
import { PostgresOpportunityStore } from './infrastructure/postgres-opportunity.store.js';
import { PostgresCustomerGroupStore } from './infrastructure/postgres-settings.store.js';

const integration = crmIntegrationEnabled() ? describe : describe.skip;

/**
 * Cơ cấu tổ chức giả: TN (trưởng nhóm A) có cấp dưới NV1, NV2; NV3 ở nhóm B
 * báo cáo cho người khác. Như seed tenant `svn` (TC-PERM-02..05).
 */
const TN = randomUUID();
const NV1 = randomUUID();
const NV2 = randomUUID();
const NV3 = randomUUID();
const QL = randomUUID();
const ORGANIZATION: ReportingLineSnapshot = {
  positions: [
    { id: 'p-ql', reportsToPositionId: null },
    { id: 'p-tn', reportsToPositionId: 'p-ql' },
    { id: 'p-nv1', reportsToPositionId: 'p-tn' },
    { id: 'p-nv2', reportsToPositionId: 'p-tn' },
    { id: 'p-tnb', reportsToPositionId: 'p-ql' },
    { id: 'p-nv3', reportsToPositionId: 'p-tnb' },
  ],
  assignments: [
    { userId: QL, positionId: 'p-ql', reportsToOverrideId: null },
    { userId: TN, positionId: 'p-tn', reportsToOverrideId: null },
    { userId: NV1, positionId: 'p-nv1', reportsToOverrideId: null },
    { userId: NV2, positionId: 'p-nv2', reportsToOverrideId: null },
    { userId: NV3, positionId: 'p-nv3', reportsToOverrideId: null },
  ],
};

integration('Bán hàng GĐ2: khách hàng, lead, cơ hội, hoạt động (PostgreSQL)', () => {
  let handle: CrmTestDatabaseHandle;
  const tenantId = randomUUID();
  const seller = (userId: string): CrmActor => ({
    ...CRM_NO_CAPABILITIES,
    tenantId,
    userId,
    displayName: 'Nhân viên',
    canWriteOpportunity: true,
  });
  const manager: CrmActor = { ...seller(QL), canReadAll: true };
  const admin: CrmActor = { ...CRM_NO_CAPABILITIES, tenantId, userId: randomUUID(), displayName: 'QTBH', canManage: true, canReadAll: true };

  let customers: CustomerService;
  let groups: CustomerGroupService;
  let leads: LeadService;
  let opportunities: OpportunityService;
  let activities: ActivityService;
  let timeline: CustomerTimelineService;
  let leadStore: PostgresLeadStore;
  let opportunityStore: PostgresOpportunityStore;

  beforeAll(async () => {
    handle = await createCrmTestDatabase();
    const scopes = new CrmDataScopeService({ snapshot: async () => ORGANIZATION });
    const customerStore = new PostgresCustomerStore(handle.database);
    opportunityStore = new PostgresOpportunityStore(handle.database);
    leadStore = new PostgresLeadStore(handle.database);
    customers = new CustomerService(customerStore, scopes);
    groups = new CustomerGroupService(new PostgresCustomerGroupStore(handle.database));
    leads = new LeadService(leadStore, scopes);
    opportunities = new OpportunityService(opportunityStore, customerStore, scopes);
    activities = new ActivityService(new PostgresActivityStore(handle.database), customerStore, opportunityStore, scopes);
    timeline = new CustomerTimelineService(new PostgresTimelineStore(handle.database), customerStore, scopes);
  }, 120_000);

  afterAll(async () => {
    await handle?.drop();
  }, 60_000);

  const count = async (table: string) =>
    (await handle.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM crm_schema.${table}`)).rows[0].n;

  describe('khách hàng', () => {
    it('TC-CUS-01: mã tự sinh KH000001, mọi trường lưu đúng, người phụ trách mặc định là người tạo', async () => {
      const created = await customers.create(seller(NV1), {
        name: 'Công ty TNHH Minh Anh',
        taxCode: '0109999999',
        address: '12 Láng Hạ',
        province: 'Hà Nội',
        region: 'Miền Bắc',
        industry: 'Xây dựng',
        kind: 'CUSTOMER',
        creditLimit: 500_000_000,
        paymentTermDays: 30,
      });
      expect(created).toMatchObject({
        code: 'KH000001',
        name: 'Công ty TNHH Minh Anh',
        taxCode: '0109999999',
        province: 'Hà Nội',
        kind: 'CUSTOMER',
        creditLimit: 500_000_000,
        paymentTermDays: 30,
        ownerUserId: NV1,
        version: 1,
      });
      await expect(customers.get(seller(NV1), created.id)).resolves.toMatchObject({ code: 'KH000001' });
    });

    it('mã sinh bỏ qua số đã có người nhập tay', async () => {
      await customers.create(seller(NV1), { code: 'kh000002', name: 'Nhập tay' });
      const next = await customers.create(seller(NV1), { name: 'Sinh tự động' });
      expect(next.code).toBe('KH000003');
    });

    it('TC-CUS-02: sửa mã thành mã đã có trả 409, dữ liệu không đổi; sai phiên bản cũng 409', async () => {
      await customers.create(seller(NV1), { code: 'QA-CRM-KH01', name: 'Khách 01' });
      const second = await customers.create(seller(NV1), { code: 'QA-CRM-KH02', name: 'Khách 02' });
      await expect(
        customers.update(seller(NV1), second.id, { code: 'QA-CRM-KH01', name: 'Khách 02', version: second.version }),
      ).rejects.toMatchObject({ statusCode: 409, message: 'Mã khách hàng đã tồn tại.' });
      await expect(customers.get(seller(NV1), second.id)).resolves.toMatchObject({ code: 'QA-CRM-KH02', version: 1 });
      await expect(
        customers.create(seller(NV1), { code: 'QA-CRM-KH01', name: 'Trùng' }),
      ).rejects.toMatchObject({ statusCode: 409, code: 'CUSTOMER_CODE_EXISTS' });

      const updated = await customers.update(seller(NV1), second.id, { code: 'QA-CRM-KH02', name: 'Khách 02 mới', version: 1 });
      expect(updated).toMatchObject({ name: 'Khách 02 mới', version: 2 });
      await expect(
        customers.update(seller(NV1), second.id, { code: 'QA-CRM-KH02', name: 'Bản cũ', version: 1 }),
      ).rejects.toMatchObject({ statusCode: 409, code: 'STALE_VERSION' });
    });

    it('TC-CUS-05: MST trùng cảnh báo kèm khách đã có, xác nhận thì lưu', async () => {
      const first = await customers.create(seller(NV1), { name: 'Có MST', taxCode: '0101234567' });
      const warning = await customers
        .create(seller(NV1), { name: 'Trùng MST', taxCode: '0101234567' })
        .catch((error: unknown) => error);
      expect(warning).toMatchObject({
        statusCode: 409,
        code: 'DUPLICATE_TAX_CODE',
        details: { matches: [{ id: first.id, code: first.code, name: 'Có MST' }] },
      });
      const saved = await customers.create(seller(NV1), { name: 'Trùng MST', taxCode: '0101234567', confirmDuplicateTaxCode: true });
      expect(saved.taxCode).toBe('0101234567');
    });

    it('TC-CUS-06/07: nhiều người liên hệ, luôn đúng một người chính', async () => {
      const customer = await customers.create(seller(NV1), { code: 'QA-CRM-KH10', name: 'Có liên hệ' });
      let detail = await customers.addContact(seller(NV1), customer.id, { fullName: 'Người 1' });
      detail = await customers.addContact(seller(NV1), customer.id, { fullName: 'Người 2' });
      detail = await customers.addContact(seller(NV1), customer.id, { fullName: 'Người 3' });
      const id = (name: string) => detail.contacts.find((contact) => contact.fullName === name)?.id ?? '';
      // Người đầu tiên tự là người chính.
      expect(detail.contacts.filter((contact) => contact.isPrimary).map((contact) => contact.fullName)).toEqual(['Người 1']);

      detail = await customers.setPrimaryContact(seller(NV1), customer.id, id('Người 2'));
      expect(detail.contacts.filter((contact) => contact.isPrimary).map((contact) => contact.fullName)).toEqual(['Người 2']);
      detail = await customers.setPrimaryContact(seller(NV1), customer.id, id('Người 3'));
      expect(detail.contacts).toHaveLength(3);
      expect(detail.contacts.filter((contact) => contact.isPrimary).map((contact) => contact.fullName)).toEqual(['Người 3']);
      expect(detail.primaryContactName).toBe('Người 3');

      // Partial unique index chặn hai người chính ngay ở DB.
      await expect(
        handle.pool.query(`UPDATE crm_schema.customer_contacts SET is_primary = TRUE WHERE id = $1`, [id('Người 1')]),
      ).rejects.toMatchObject({ code: '23505' });

      // Xoá người chính thì người cũ nhất còn lại thành người chính.
      detail = await customers.deleteContact(seller(NV1), customer.id, id('Người 3'));
      expect(detail.contacts.filter((contact) => contact.isPrimary).map((contact) => contact.fullName)).toEqual(['Người 1']);
    });

    it('TC-CUS-08/09: nhóm do QTBH cấu hình; lọc theo nhóm, phân loại; nhóm đang dùng không xoá được', async () => {
      const group = await groups.create(admin, { code: 'DL1', name: 'Đại lý cấp 1' });
      const vip = await groups.create(admin, { code: 'VIP', name: 'VIP' });
      await expect(groups.create(admin, { code: 'vip', name: 'Trùng' })).rejects.toMatchObject({ statusCode: 409 });
      const customer = await customers.create(seller(NV1), { name: 'Đại lý Hưng Thịnh', groupId: group.id });
      const inactive = await customers.update(seller(NV1), customer.id, { code: customer.code, name: customer.name, kind: 'INACTIVE', version: 1 });
      expect(inactive).toMatchObject({ kind: 'INACTIVE', groupId: group.id, groupName: 'Đại lý cấp 1' });

      const byGroup = await customers.list(seller(NV1), { groupId: group.id });
      expect(byGroup.items.map((item) => item.id)).toEqual([customer.id]);
      const byKind = await customers.list(seller(NV1), { kind: 'INACTIVE' });
      expect(byKind.items.map((item) => item.id)).toEqual([customer.id]);

      await expect(groups.remove(admin, group.id)).rejects.toMatchObject({
        statusCode: 409,
        message: 'Nhóm đang được dùng cho khách hàng, không xoá được.',
      });
      expect((await groups.list(admin)).find((item) => item.id === group.id)).toMatchObject({ customerCount: 1 });
      await groups.remove(admin, vip.id);
      expect((await groups.list(admin)).some((item) => item.id === vip.id)).toBe(false);
    });

    it('tìm theo đầu mã, đầu MST, đầu từ trong tên có dấu; ký tự đặc biệt không lỗi', async () => {
      await customers.create(seller(NV1), { code: 'TIM-01', name: 'Công ty Cổ phần Đông Á', taxCode: '0312345678' });
      const names = async (q: string) => (await customers.list(seller(NV1), { q })).items.map((item) => item.name);
      expect(await names('đông')).toContain('Công ty Cổ phần Đông Á');
      expect(await names('cổ phần đô')).toContain('Công ty Cổ phần Đông Á');
      expect(await names('tim-0')).toContain('Công ty Cổ phần Đông Á');
      expect(await names('031234')).toContain('Công ty Cổ phần Đông Á');
      expect(await names("' OR 1=1 --")).toEqual([]);
      expect(await names('%')).toEqual([]);
    });

    it('phân trang keyset không lặp, không sót', async () => {
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await customers.list(manager, { limit: 3, cursor });
        seen.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen.length).toBe(await count('customers'));
    });
  });

  describe('phạm vi dữ liệu', () => {
    let nv1Customer: string;
    let nv2Customer: string;
    let nv3Customer: string;

    beforeAll(async () => {
      nv1Customer = (await customers.create(seller(NV1), { name: 'Phạm vi NV1' })).id;
      nv2Customer = (await customers.create(seller(NV2), { name: 'Phạm vi NV2' })).id;
      nv3Customer = (await customers.create(seller(NV3), { name: 'Phạm vi NV3' })).id;
    });

    const ids = async (actor: CrmActor) => {
      const all: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await customers.list(actor, { limit: 100, cursor });
        all.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return all;
    };

    it('TC-PERM-02: NV1 chỉ thấy khách của mình', async () => {
      const visible = await ids(seller(NV1));
      expect(visible).toContain(nv1Customer);
      expect(visible).not.toContain(nv2Customer);
      expect(visible).not.toContain(nv3Customer);
    });

    it('TC-PERM-03: NV1 gọi thẳng id của NV3 nhận 404, dữ liệu không đổi', async () => {
      await expect(customers.get(seller(NV1), nv3Customer)).rejects.toMatchObject({ statusCode: 404 });
      await expect(
        customers.update(seller(NV1), nv3Customer, { code: 'HACK', name: 'Sửa trộm', version: 1 }),
      ).rejects.toMatchObject({ statusCode: 404 });
      await expect(customers.get(manager, nv3Customer)).resolves.toMatchObject({ name: 'Phạm vi NV3', version: 1 });
    });

    it('TC-PERM-04: trưởng nhóm thấy NV1, NV2, không thấy NV3', async () => {
      const visible = await ids(seller(TN));
      expect(visible).toEqual(expect.arrayContaining([nv1Customer, nv2Customer]));
      expect(visible).not.toContain(nv3Customer);
    });

    it('TC-PERM-05: crm.read.all thấy cả hai nhóm', async () => {
      expect(await ids(manager)).toEqual(expect.arrayContaining([nv1Customer, nv2Customer, nv3Customer]));
    });

    it('trưởng nhóm giao khách cho cấp dưới được, cho người nhóm khác thì không', async () => {
      const created = await customers.create(seller(TN), { name: 'Giao cho NV2', ownerUserId: NV2 });
      expect(created.ownerUserId).toBe(NV2);
      await expect(customers.create(seller(TN), { name: 'Giao cho NV3', ownerUserId: NV3 })).rejects.toMatchObject({
        code: 'OWNER_OUT_OF_SCOPE',
      });
    });

    it('TC-CUS-11: dòng thời gian khách của NV1 không lộ cơ hội, hoạt động của NV3', async () => {
      const own = await opportunities.create(seller(NV1), { customerId: nv1Customer, name: 'Cơ hội NV1' });
      const foreign = await opportunities.create(manager, { customerId: nv1Customer, name: 'Cơ hội NV3', ownerUserId: NV3 });
      await activities.create(manager, { type: 'CALL', subject: 'Gọi của NV3', opportunityId: foreign.id, assigneeUserId: NV3 });
      await activities.create(seller(NV1), { type: 'EMAIL', subject: 'Email của NV1', customerId: nv1Customer });

      const nv1View = await timeline.list(seller(NV1), nv1Customer, {});
      const nv1Opportunities = nv1View.items.flatMap((entry) => ('opportunityName' in entry ? [entry.opportunityName] : []));
      expect(nv1Opportunities).toContain('Cơ hội NV1');
      expect(nv1Opportunities).not.toContain('Cơ hội NV3');
      const nv1Subjects = nv1View.items.flatMap((entry) => (entry.kind === 'activity' ? [entry.subject] : []));
      expect(nv1Subjects).toEqual(['Email của NV1']);

      const managerView = await timeline.list(manager, nv1Customer, {});
      expect(managerView.items.map((entry) => entry.kind)).toEqual(
        expect.arrayContaining(['opportunity-created', 'activity']),
      );
      expect(managerView.items.filter((entry) => entry.kind === 'activity')).toHaveLength(2);
      // Mới nhất trước.
      const times = managerView.items.map((entry) => entry.at);
      expect([...times].sort().reverse()).toEqual(times);
      expect(own.stage).toBe('NEW');

      await expect(timeline.list(seller(NV1), nv3Customer, {})).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('lead', () => {
    it('TC-OPP-01: chuyển lead thành khách và cơ hội bằng một thao tác, liên kết hai chiều', async () => {
      const lead = await leads.create(seller(NV1), {
        name: 'QA-CRM-L01 Công ty Sự Kiện',
        contactName: 'Anh Tuấn',
        taxCode: '0108888888',
        phone: '0901234567',
        source: 'Sự kiện',
      });
      const result = await leads.convert(seller(NV1), lead.id, { expectedValue: 120_000_000 });
      expect(result.attachedToExistingCustomer).toBe(false);

      const customer = await customers.get(seller(NV1), result.customerId);
      expect(customer).toMatchObject({ name: 'QA-CRM-L01 Công ty Sự Kiện', taxCode: '0108888888', kind: 'LEAD_CUSTOMER', ownerUserId: NV1 });
      expect(customer.contacts).toEqual([expect.objectContaining({ fullName: 'Anh Tuấn', isPrimary: true })]);
      const opportunity = await opportunities.get(seller(NV1), result.opportunityId);
      expect(opportunity).toMatchObject({ stage: 'NEW', customerId: result.customerId, leadId: lead.id, expectedValue: 120_000_000 });
      expect(opportunity.history).toEqual([expect.objectContaining({ fromStage: null, toStage: 'NEW', actorId: NV1 })]);
      await expect(leads.get(seller(NV1), lead.id)).resolves.toMatchObject({
        status: 'CONVERTED',
        convertedCustomerId: result.customerId,
        convertedOpportunityId: result.opportunityId,
      });
      await expect(leads.convert(seller(NV1), lead.id, {})).rejects.toMatchObject({ statusCode: 409 });
    });

    it('TC-OPP-03: lead trùng MST khách có sẵn gắn vào khách cũ, không tạo khách mới', async () => {
      const existing = await customers.create(seller(NV1), { name: 'Khách có sẵn', taxCode: '0107777777' });
      const lead = await leads.create(seller(NV1), { name: 'Lead trùng MST', taxCode: '0107777777' });
      const before = await count('customers');
      const result = await leads.convert(seller(NV1), lead.id, {});
      expect(result).toMatchObject({ customerId: existing.id, attachedToExistingCustomer: true });
      expect(await count('customers')).toBe(before);
    });

    it('TC-OPP-02: MST sai định dạng trả 400, không để lại dữ liệu dở', async () => {
      const lead = await leads.create(seller(NV1), { name: 'Lead MST hỏng' });
      // Lead nhập từ nguồn ngoài mang MST sai (API không cho nhập như vậy).
      await handle.pool.query(`UPDATE crm_schema.leads SET tax_code = '01012345' WHERE id = $1`, [lead.id]);
      const before = { customers: await count('customers'), opportunities: await count('opportunities') };
      await expect(leads.convert(seller(NV1), lead.id, {})).rejects.toMatchObject({ statusCode: 400 });
      expect({ customers: await count('customers'), opportunities: await count('opportunities') }).toEqual(before);
      await expect(leads.get(seller(NV1), lead.id)).resolves.toMatchObject({ status: 'NEW' });
    });

    it('lỗi giữa chừng (sau khi đã tạo khách) rollback toàn bộ', async () => {
      const lead = await leads.create(seller(NV1), { name: 'Lead lỗi giữa chừng', contactName: 'Chị Hoa' });
      const before = {
        customers: await count('customers'),
        contacts: await count('customer_contacts'),
        opportunities: await count('opportunities'),
        history: await count('opportunity_stage_history'),
        audit: await count('audit_log'),
      };
      // Xác suất 150 vi phạm CHECK của `opportunities`: lỗi xảy ra SAU khi khách và người liên hệ đã ghi.
      await expect(
        leadStore.convertLead(
          tenantId,
          {
            leadId: lead.id,
            expectedVersion: lead.version,
            customer: {
              name: 'Lead lỗi giữa chừng', taxCode: null, address: null, province: null, region: null, industry: null,
              phone: null, email: null, groupId: null, kind: 'LEAD_CUSTOMER', creditLimit: null, paymentTermDays: null,
              note: null, ownerUserId: NV1,
            },
            contact: { fullName: 'Chị Hoa', title: null, phone: null, email: null, note: null, isPrimary: true },
            opportunity: {
              name: 'Hỏng', probability: 150, expectedValue: null, expectedCloseDate: null, need: null, budget: null,
              ownerUserId: NV1,
            },
          },
          NV1,
        ),
      ).rejects.toMatchObject({ code: '23514' });
      expect({
        customers: await count('customers'),
        contacts: await count('customer_contacts'),
        opportunities: await count('opportunities'),
        history: await count('opportunity_stage_history'),
        audit: await count('audit_log'),
      }).toEqual(before);
      await expect(leads.get(seller(NV1), lead.id)).resolves.toMatchObject({ status: 'NEW', convertedCustomerId: null });
    });

    it('NV1 không thấy, không chuyển đổi được lead của NV3', async () => {
      const lead = await leads.create(seller(NV3), { name: 'Lead NV3' });
      await expect(leads.convert(seller(NV1), lead.id, {})).rejects.toMatchObject({ statusCode: 404 });
      expect((await leads.list(seller(NV1), {})).items.some((item) => item.id === lead.id)).toBe(false);
    });
  });

  describe('cơ hội', () => {
    let customerId: string;

    beforeAll(async () => {
      customerId = (await customers.create(seller(NV1), { name: 'Khách cơ hội' })).id;
    });

    it('TC-SM-01/02, TC-OPP-04/05: chuyển giai đoạn ghi lịch sử và nhật ký; sai bảng 409; Thua cần lý do', async () => {
      const created = await opportunities.create(seller(NV1), { customerId, name: 'Cung cấp máy phát', probability: 30 });
      let current = await opportunities.changeStage(seller(NV1), created.id, { stage: 'CONTACTED', version: created.version });
      current = await opportunities.changeStage(seller(NV1), created.id, { stage: 'DISCOVERY' });
      current = await opportunities.changeStage(seller(NV1), created.id, { stage: 'CONTACTED' });
      current = await opportunities.changeStage(seller(NV1), created.id, { stage: 'DISCOVERY' });

      await expect(opportunities.changeStage(seller(NV1), created.id, { stage: 'WON' })).rejects.toMatchObject({ statusCode: 409 });
      await expect(opportunities.changeStage(seller(NV1), created.id, { stage: 'LOST' })).rejects.toMatchObject({
        statusCode: 400,
        message: 'Phải ghi lý do thua.',
      });
      await expect(opportunities.get(seller(NV1), created.id)).resolves.toMatchObject({ stage: 'DISCOVERY' });

      current = await opportunities.changeStage(seller(NV1), created.id, { stage: 'LOST', reason: 'Khách chọn đối thủ' });
      expect(current).toMatchObject({ stage: 'LOST', lostReason: 'Khách chọn đối thủ', probability: 0 });
      expect(current.closedAt).not.toBeNull();
      expect(current.history.map((entry) => `${entry.fromStage ?? '-'}>${entry.toStage}`)).toEqual([
        'DISCOVERY>LOST',
        'CONTACTED>DISCOVERY',
        'DISCOVERY>CONTACTED',
        'CONTACTED>DISCOVERY',
        'NEW>CONTACTED',
        '-' + '>NEW',
      ]);
      expect(current.history[0]).toMatchObject({ actorId: NV1, reason: 'Khách chọn đối thủ' });

      const audit = await handle.pool.query<{ from_status: string | null; to_status: string; action: string }>(
        `SELECT from_status, to_status, action FROM crm_schema.audit_log
          WHERE entity_type = 'opportunity' AND entity_id = $1 ORDER BY at, action DESC`,
        [created.id],
      );
      expect(audit.rows).toHaveLength(6);
      expect(audit.rows[audit.rows.length - 1]).toMatchObject({ from_status: 'DISCOVERY', to_status: 'LOST', action: 'change_stage' });

      // Thua là trạng thái cuối.
      await expect(opportunities.changeStage(seller(NV1), created.id, { stage: 'NEGOTIATION' })).rejects.toMatchObject({ statusCode: 409 });
    });

    it('Đàm phán → Thắng (cần báo giá khách chấp nhận, T3-14)', async () => {
      const created = await opportunities.create(seller(NV1), { customerId, name: 'Thắng được' });
      for (const stage of ['CONTACTED', 'DISCOVERY', 'QUOTING', 'NEGOTIATION'] as const) {
        await opportunities.changeStage(seller(NV1), created.id, { stage });
      }
      await expect(opportunities.changeStage(seller(NV1), created.id, { stage: 'WON' })).rejects.toMatchObject({
        statusCode: 409,
        code: 'ACCEPTED_QUOTE_REQUIRED',
      });
      // Luồng báo giá đầy đủ kiểm ở crm-quotes.integration.spec.ts; ở đây chỉ đặt nháp tự tạo thành chấp nhận.
      await handle.pool.query(`UPDATE crm_schema.quotes SET status = 'ACCEPTED' WHERE opportunity_id = $1`, [created.id]);
      await opportunities.changeStage(seller(NV1), created.id, { stage: 'WON' });
      await expect(opportunities.get(seller(NV1), created.id)).resolves.toMatchObject({ stage: 'WON', probability: 100 });
    });

    it('hai người cùng kéo một thẻ: người sau nhận 409, lịch sử chỉ một dòng', async () => {
      const created = await opportunities.create(seller(NV1), { customerId, name: 'Kéo cùng lúc' });
      await opportunityStore.changeStage(tenantId, created.id, { from: 'NEW', to: 'CONTACTED', reason: null }, NV1);
      await expect(
        opportunityStore.changeStage(tenantId, created.id, { from: 'NEW', to: 'LOST', reason: 'x' }, NV1),
      ).rejects.toMatchObject({ statusCode: 409, code: 'STAGE_CHANGED' });
      const detail = await opportunities.get(seller(NV1), created.id);
      expect(detail.history).toHaveLength(2);
    });

    it('TC-OPP-06: xác suất ngoài 0–100 bị chặn ở service và ở DB', async () => {
      await expect(opportunities.create(seller(NV1), { customerId, name: 'X', probability: 101 })).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        handle.pool.query(
          `INSERT INTO crm_schema.opportunities (customer_id, name, probability, owner_user_id) VALUES ($1, 'X', -1, $2)`,
          [customerId, NV1],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      // Thua thiếu lý do bị CHECK chặn kể cả khi ghi thẳng DB.
      await expect(
        handle.pool.query(
          `INSERT INTO crm_schema.opportunities (customer_id, name, stage, owner_user_id) VALUES ($1, 'X', 'LOST', $2)`,
          [customerId, NV1],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('BUG-CRM-001: tìm cơ hội theo `%`, `_` như chuỗi thường; tìm theo từ vẫn đúng', async () => {
      await opportunities.create(seller(NV1), { customerId, name: 'Bảo trì trạm biến áp' });
      const names = async (q: string) => (await opportunities.list(seller(NV1), { q })).items.map((item) => item.name);
      expect(await names('%')).toEqual([]);
      expect(await names('_')).toEqual([]);
      expect(await names('%%')).toEqual([]);
      expect(await names('bảo trì')).toEqual(['Bảo trì trạm biến áp']);
      expect(await names('biến')).toEqual(['Bảo trì trạm biến áp']);
      const board = await opportunities.board(seller(NV1), { q: '%' });
      expect(board.columns.every((column) => column.items.length === 0)).toBe(true);

      const literal = await opportunities.create(seller(NV1), { customerId, name: '%_ Ký hiệu đặc biệt' });
      expect((await opportunities.list(seller(NV1), { q: '%_' })).items.map((item) => item.id)).toEqual([literal.id]);
    });

    it('kanban: cột theo giai đoạn, tổng giá trị, lọc theo phạm vi', async () => {
      const board = await opportunities.board(seller(NV1), {});
      expect(board.columns.map((column) => column.stage)).toEqual(['NEW', 'CONTACTED', 'DISCOVERY', 'QUOTING', 'NEGOTIATION', 'WON', 'LOST']);
      const owners = board.columns.flatMap((column) => column.items.map((item) => item.ownerUserId));
      expect(new Set(owners)).toEqual(new Set([NV1]));
      const lost = board.columns.find((column) => column.stage === 'LOST');
      expect(lost?.total).toBeGreaterThanOrEqual(1);
    });
  });

  describe('hoạt động', () => {
    it('TC-ACT-01/02/03: bốn loại, bắt buộc gắn khách hoặc cơ hội, hoàn tất ghi người và thời điểm', async () => {
      const customer = await customers.create(seller(NV1), { name: 'Khách hoạt động' });
      const opportunity = await opportunities.create(seller(NV1), { customerId: customer.id, name: 'Cơ hội hoạt động' });
      const due = '2026-11-01T03:00:00.000Z';
      const created = [];
      for (const type of ['CALL', 'EMAIL', 'MEETING', 'TASK'] as const) {
        created.push(
          await activities.create(seller(NV1), {
            type,
            subject: `Hoạt động ${type}`,
            ...(type === 'MEETING' ? { opportunityId: opportunity.id } : { customerId: customer.id }),
            assigneeUserId: NV2,
            dueAt: due,
          }),
        );
      }
      expect(created.map((item) => [item.type, item.assigneeUserId, item.dueAt, item.status])).toEqual([
        ['CALL', NV2, due, 'OPEN'],
        ['EMAIL', NV2, due, 'OPEN'],
        ['MEETING', NV2, due, 'OPEN'],
        ['TASK', NV2, due, 'OPEN'],
      ]);
      expect(created[2]).toMatchObject({ customerId: customer.id, opportunityId: opportunity.id });

      await expect(activities.create(seller(NV1), { type: 'CALL', subject: 'Không gắn' })).rejects.toMatchObject({
        statusCode: 400,
        message: 'Hoạt động phải gắn khách hàng hoặc cơ hội.',
      });
      await expect(
        handle.pool.query(`INSERT INTO crm_schema.activities (type, subject, assignee_user_id) VALUES ('CALL', 'x', $1)`, [NV1]),
      ).rejects.toMatchObject({ code: '23514' });

      const done = await activities.update(seller(NV1), created[0].id, { version: 1, status: 'DONE', result: 'Khách hẹn tuần sau' });
      expect(done).toMatchObject({ status: 'DONE', result: 'Khách hẹn tuần sau', completedBy: NV1 });
      expect(done.completedAt).not.toBeNull();
      const reopened = await activities.update(seller(NV1), created[0].id, { version: 2, status: 'OPEN' });
      expect(reopened).toMatchObject({ status: 'OPEN', completedAt: null, completedBy: null });

      // NV2 là người được giao nên thấy hoạt động dù khách thuộc NV1.
      const nv2 = await activities.list(seller(NV2), { assigneeUserId: NV2 });
      expect(nv2.items.length).toBeGreaterThanOrEqual(4);
      // NV3 không liên quan thì không thấy.
      await expect(activities.get(seller(NV3), created[1].id)).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('hiệu năng (TC-PERF-01, kế hoạch truy vấn)', () => {
    it('danh sách và tìm kiếm đều có đường đi bằng index, không buộc quét cả bảng', async () => {
      const client = await handle.pool.connect();
      try {
        await client.query('BEGIN');
        // Tắt seq scan: nếu không có index dùng được, PostgreSQL vẫn phải quét bảng.
        await client.query('SET LOCAL enable_seqscan = off');
        const plan = async (sql: string, params: unknown[]) =>
          (await client.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${sql}`, params)).rows
            .map((row) => row['QUERY PLAN'])
            .join('\n');
        const page = await plan(
          `SELECT id FROM crm_schema.customers c ORDER BY c.updated_at DESC, c.id DESC LIMIT 31`,
          [],
        );
        const scoped = await plan(
          `SELECT id FROM crm_schema.customers c WHERE c.owner_user_id = ANY($1::uuid[]) ORDER BY c.updated_at DESC, c.id DESC LIMIT 31`,
          [[NV1, NV2]],
        );
        const search = await plan(
          `SELECT id FROM crm_schema.customers c
            WHERE lower(c.code) LIKE $1 OR c.tax_code LIKE $2
               OR to_tsvector('simple'::regconfig, c.name) @@ to_tsquery('simple'::regconfig, $3)`,
          ['kh%', '0101%', 'minh:*'],
        );
        for (const text of [page, scoped, search]) expect(text).not.toMatch(/Seq Scan on customers/);
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });
  });
});
