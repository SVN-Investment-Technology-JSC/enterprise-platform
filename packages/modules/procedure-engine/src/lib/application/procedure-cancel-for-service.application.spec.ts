import type { CreateProcedureDefinitionRequest } from '@enterprise-platform/contracts-procedure-engine';
import type { ProcedureActor } from '../domain/procedure-authorization.js';
import { InMemoryProcedureStore } from '../infrastructure/in-memory-procedure-store.js';
import { ProcedureEngineApplication } from './procedure-engine.application.js';

const TENANT = 'tenant-cancel';

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

describe('Phân hệ nguồn huỷ hồ sơ (CRM xoá báo giá Chờ duyệt)', () => {
  async function running() {
    const ctx = await setup();
    const created = await ctx.application.createInstance(TENANT, {
      definitionId: ctx.definitionId,
      title: 'Duyệt báo giá BG2600401',
      sourceType: 'crm_quote',
      sourceId: 'link-1',
      idempotencyKey: 'q-1:v1',
      initiatedBy: 'seller',
      autoCompleteInitiatorStep: true,
    });
    return { ...ctx, instanceId: created.id };
  }

  it('hồ sơ đang chạy: chuyển Đã huỷ, bước hiện tại huỷ, lịch sử ghi lý do và người huỷ', async () => {
    const { application, instanceId } = await running();
    const result = await application.cancelInstanceForService(TENANT, instanceId, {
      reason: 'Báo giá BG2600401 đã bị xoá bên Bán hàng.',
      actorUserId: 'seller',
      actorName: 'Nhân viên kinh doanh',
    });
    expect(result).toEqual({ id: instanceId, status: 'cancelled' });
    const instance = await application.getInstance(seller, instanceId);
    expect(instance.status).toBe('cancelled');
    expect(instance.steps.find((step) => step.id === instance.currentStepId)?.status).toBe('cancelled');
    expect(instance.activity[0]).toMatchObject({ action: 'cancel', actorId: 'seller', actorName: 'Nhân viên kinh doanh', comment: 'Báo giá BG2600401 đã bị xoá bên Bán hàng.' });
  });

  it('gọi lại khi đã huỷ trả kết quả cũ, không ghi thêm lịch sử', async () => {
    const { application, instanceId } = await running();
    await application.cancelInstanceForService(TENANT, instanceId, { reason: 'Đã xoá báo giá.' });
    const before = (await application.getInstance(seller, instanceId)).activity.length;
    await expect(application.cancelInstanceForService(TENANT, instanceId, { reason: 'Đã xoá báo giá.' })).resolves.toEqual({ id: instanceId, status: 'cancelled' });
    expect((await application.getInstance(seller, instanceId)).activity.length).toBe(before);
  });

  it('hồ sơ đã duyệt xong: 409, không đổi trạng thái', async () => {
    const { application, instanceId } = await running();
    await application.applyAction(approver, instanceId, { action: 'approve', idempotencyKey: 'approve-1' });
    await expect(application.cancelInstanceForService(TENANT, instanceId, { reason: 'Đã xoá báo giá.' })).rejects.toMatchObject({ code: 'conflict' });
    expect((await application.getInstance(seller, instanceId)).status).toBe('completed');
  });

  it('thiếu lý do hoặc không có hồ sơ: báo lỗi tiếng Việt', async () => {
    const { application, instanceId } = await running();
    await expect(application.cancelInstanceForService(TENANT, instanceId, { reason: 'x' })).rejects.toMatchObject({ code: 'validation' });
    await expect(application.cancelInstanceForService(TENANT, 'khong-co', { reason: 'Đã xoá báo giá.' })).rejects.toMatchObject({ code: 'not_found' });
  });
});
