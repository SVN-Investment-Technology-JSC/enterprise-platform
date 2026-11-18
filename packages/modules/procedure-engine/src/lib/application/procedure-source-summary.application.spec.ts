import type { CreateProcedureDefinitionRequest, ProcedureSourceSummary } from '@enterprise-platform/contracts-procedure-engine';
import type { ProcedureActor } from '../domain/procedure-authorization.js';
import { InMemoryProcedureStore } from '../infrastructure/in-memory-procedure-store.js';
import { AUTO_COMPLETE_SOURCE_TYPES, ProcedureEngineApplication } from './procedure-engine.application.js';

const TENANT = 'tenant-source';

const person = (userId: string, overrides: Partial<ProcedureActor> = {}): ProcedureActor => ({
  tenantId: TENANT,
  userId,
  displayName: `Tên ${userId}`,
  membershipId: `m-${userId}`,
  canDesign: false,
  canPublish: false,
  canCreateInstances: true,
  isOverride: false,
  organizationUnitIds: [],
  positionIds: [],
  ...overrides,
});
const admin = person('admin', { canDesign: true, canPublish: true, isOverride: true });
const seller = person('seller');
const approver = person('approver');

function definitionInput(): CreateProcedureDefinitionRequest {
  return {
    code: 'PROC-BG',
    name: 'Duyệt báo giá',
    kind: 'process',
    category: 'technical',
    steps: [
      {
        key: 'SUBMIT',
        order: 1,
        name: 'Trình duyệt',
        assignments: [{ role: 'S', subjectType: 'user', subjectId: 'seller' }],
      },
      {
        key: 'APPROVE',
        order: 2,
        name: 'Duyệt',
        assignments: [{ role: 'A', subjectType: 'user', subjectId: 'approver' }],
      },
    ],
  };
}

const SUMMARY: ProcedureSourceSummary = {
  title: 'Báo giá BG2600401 v2',
  items: [
    { label: 'Khách hàng', value: 'Công ty <b>An Phát</b>' },
    { label: 'Tổng tiền', value: '120.000.000 đ' },
  ],
  url: '/modules/crm#quotes/q-1',
  urlLabel: 'Mở báo giá trong Bán hàng',
};

async function setup() {
  let id = 0;
  const store = new InMemoryProcedureStore();
  const application = new ProcedureEngineApplication(
    store,
    { now: () => new Date('2026-11-09T08:00:00.000Z') },
    { next: () => `id-${(id += 1).toString().padStart(4, '0')}` },
  );
  const draft = await application.createDefinition(admin, definitionInput());
  const published = await application.publishDefinition(admin, draft.id);
  return { application, store, definitionId: published.id };
}

describe('Thông tin nguồn của hồ sơ (D3-31)', () => {
  it('TC-TSK-03: hồ sơ tạo qua API nội bộ lưu thông tin nguồn đã chuẩn hoá và đọc lại trên hồ sơ', async () => {
    const { application, definitionId } = await setup();
    const created = await application.createInstance(TENANT, {
      definitionId,
      title: 'Duyệt báo giá BG2600401',
      sourceType: 'crm_quote',
      sourceId: 'link-1',
      idempotencyKey: 'q-1:v2',
      initiatedBy: 'seller',
      sourceSummary: {
        title: '  Báo giá BG2600401 v2 ',
        items: [...SUMMARY.items, { label: ' ', value: '' }],
        url: SUMMARY.url,
        urlLabel: SUMMARY.urlLabel,
      },
    });

    const instance = await application.getInstance(seller, created.id);
    expect(instance.sourceSummary).toEqual(SUMMARY);
    const workspace = await application.getWorkspace(approver);
    expect(workspace.instances.find((item) => item.id === created.id)?.sourceSummary).toEqual(SUMMARY);
  });

  it('TC-TSK-03: hồ sơ không có thông tin nguồn trả sourceSummary null', async () => {
    const { application, definitionId } = await setup();
    const started = await application.startInstance(seller, {
      definitionId,
      title: 'Hồ sơ thủ công',
      idempotencyKey: 'manual-1',
    });
    expect(started.sourceSummary).toBeNull();
    expect((await application.getInstance(seller, started.id)).sourceSummary).toBeNull();
  });

  it('TC-TSK-03: người dùng tự mở hồ sơ cũng gửi kèm được thông tin nguồn', async () => {
    const { application, definitionId } = await setup();
    const started = await application.startInstance(seller, {
      definitionId,
      title: 'Hồ sơ có nguồn',
      idempotencyKey: 'manual-2',
      sourceSummary: { items: [{ label: 'Ghi chú', value: 'Giá trị' }] },
    });
    expect(started.sourceSummary).toEqual({ items: [{ label: 'Ghi chú', value: 'Giá trị' }] });
  });

  it.each([
    [{ items: [{ label: 'Nhãn', value: 'x' }], url: 'https://evil.example' }, 'Đường dẫn chứng từ phải là đường dẫn nội bộ'],
    [{ items: [{ label: 'Nhãn', value: 'x' }], url: '//evil.example/a' }, 'Đường dẫn chứng từ phải là đường dẫn nội bộ'],
    [{ items: [{ label: '', value: 'thiếu nhãn' }] }, 'Dòng 1: thiếu nhãn.'],
    [{ items: Array.from({ length: 31 }, (_, index) => ({ label: `N${index}`, value: 'v' })) }, 'tối đa 30 dòng'],
    ['chuỗi', 'Thông tin nguồn không đúng định dạng.'],
  ])('TC-TSK-03: thông tin nguồn sai bị từ chối 400 với lỗi tiếng Việt (%#)', async (sourceSummary, message) => {
    const { application, store, definitionId } = await setup();
    await expect(
      application.createInstance(TENANT, {
        definitionId,
        title: 'Sai nguồn',
        sourceType: 'crm_quote',
        idempotencyKey: 'bad',
        sourceSummary: sourceSummary as never,
      }),
    ).rejects.toMatchObject({ code: 'validation', message: expect.stringContaining(message) });
    expect((await store.read(TENANT)).instances).toHaveLength(0);
  });

  it('TC-TSK-03: PUT cập nhật, cập nhật cả khi hồ sơ đã kết thúc, null là xoá; không ghi nhật ký bước', async () => {
    const { application, store, definitionId } = await setup();
    const started = await application.startInstance(seller, {
      definitionId,
      title: 'Duyệt báo giá',
      idempotencyKey: 'run-1',
    });

    const updated = await application.updateSourceSummaryForService(TENANT, started.id, SUMMARY);
    expect(updated).toEqual({ id: started.id, sourceSummary: SUMMARY });
    expect((await application.getInstance(seller, started.id)).sourceSummary).toEqual(SUMMARY);

    await application.applyAction(seller, started.id, { action: 'complete', idempotencyKey: 'run-1:complete' });
    const done = await application.applyAction(approver, started.id, { action: 'approve', idempotencyKey: 'run-1:approve' });
    expect(done.status).toBe('completed');
    const before = (await store.read(TENANT)).instances.find((item) => item.id === started.id);

    const next = { ...SUMMARY, title: 'Báo giá BG2600401 v3' };
    await application.updateSourceSummaryForService(TENANT, started.id, next);
    const after = (await store.read(TENANT)).instances.find((item) => item.id === started.id);
    expect(after?.status).toBe('completed');
    expect(after?.sourceSummary).toEqual(next);
    expect(after?.activity).toEqual(before?.activity);
    expect(after?.steps).toEqual(before?.steps);

    await expect(application.updateSourceSummaryForService(TENANT, started.id, null)).resolves.toEqual({
      id: started.id,
      sourceSummary: null,
    });
    expect((await application.getInstance(seller, started.id)).sourceSummary).toBeNull();
  });

  it('TC-TSK-03: PUT hồ sơ không tồn tại trả 404, thông tin nguồn sai trả 400', async () => {
    const { application, definitionId } = await setup();
    await expect(application.updateSourceSummaryForService(TENANT, 'khong-co', SUMMARY)).rejects.toMatchObject({
      code: 'not_found',
    });
    const started = await application.startInstance(seller, { definitionId, title: 'Hồ sơ', idempotencyKey: 'k' });
    await expect(
      application.updateSourceSummaryForService(TENANT, started.id, { items: [], url: 'javascript:alert(1)' }),
    ).rejects.toMatchObject({ code: 'validation' });
  });

  it('crm_business_plan được tự hoàn thành bước người khởi tạo như crm_quote', async () => {
    expect(AUTO_COMPLETE_SOURCE_TYPES).toEqual(expect.arrayContaining(['crm_quote', 'crm_business_plan']));
    const { application, definitionId } = await setup();
    const created = await application.createInstance(TENANT, {
      definitionId,
      title: 'PAKD báo giá BG2600401 v2',
      sourceType: 'crm_business_plan',
      sourceId: 'round-1',
      idempotencyKey: 'plan-1',
      initiatedBy: 'seller',
      initiatedByName: 'Người bán',
      autoCompleteInitiatorStep: true,
    });
    expect(created.autoComplete?.status).toBe('completed');
    expect(created.currentStepName).toBe('Duyệt');
  });
});
