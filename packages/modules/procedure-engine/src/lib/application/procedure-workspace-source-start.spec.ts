import type { CreateProcedureDefinitionRequest } from '@enterprise-platform/contracts-procedure-engine';
import type { ProcedureActor } from '../domain/procedure-authorization.js';
import { InMemoryProcedureStore } from '../infrastructure/in-memory-procedure-store.js';
import type { InitiatorActorResolver } from './initiator-actor.port.js';
import { ProcedureEngineApplication } from './procedure-engine.application.js';

/**
 * ISS-BE-061: hồ sơ mở từ Workspace (công việc dự án hay việc ngoài dự án "Theo quy trình") phải kiểm
 * `procedure.instance.create` thật của người thao tác, không tự đặt cờ khởi tạo.
 */
const person = (userId: string, overrides: Partial<ProcedureActor> = {}): ProcedureActor => ({
  tenantId: 'tenant-a',
  userId,
  displayName: `Tên ${userId}`,
  membershipId: `m-${userId}`,
  canDesign: false,
  canPublish: false,
  // Bộ dựng tổ chức (HTTP) luôn trả false: quyền do sự kiện của Workspace mang sang.
  canCreateInstances: false,
  isOverride: false,
  organizationUnitIds: [],
  positionIds: ['pos-staff'],
  ...overrides,
});
const admin = person('admin', { canDesign: true, canPublish: true, canCreateInstances: true, isOverride: true });
const staff = person('staff');

function definitionInput(): CreateProcedureDefinitionRequest {
  return {
    code: 'PROC-WS',
    name: 'Đề nghị mua vật tư',
    kind: 'process',
    category: 'technical',
    steps: [
      {
        key: 'REQUEST',
        order: 1,
        name: 'Lập đề nghị',
        assignments: [{ role: 'S', subjectType: 'position', subjectId: 'pos-staff' }],
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
  const resolver: InitiatorActorResolver = {
    resolve: async (_tenantId, userId) => (userId === staff.userId ? staff : null),
  };
  let id = 0;
  const application = new ProcedureEngineApplication(
    new InMemoryProcedureStore(),
    { now: () => new Date('2026-11-15T08:00:00.000Z') },
    { next: () => `id-${(id += 1).toString().padStart(4, '0')}` },
    undefined,
    undefined,
    undefined,
    resolver,
  );
  const draft = await application.createDefinition(admin, definitionInput());
  const published = await application.publishDefinition(admin, draft.id);
  return { application, definitionId: published.id };
}

const workItem = (definitionId: string, extra: Record<string, unknown>) => ({
  workItemId: '11111111-1111-4111-8111-111111111111',
  workItemCode: 'CV001',
  projectId: '22222222-2222-4222-8222-222222222222',
  projectCode: 'DA01',
  title: 'Mua vật tư',
  definitionId,
  requestedBy: staff.userId,
  requestedByName: staff.displayName,
  requestedByIsTenantAdmin: false,
  ...extra,
});

describe('Mở hồ sơ từ Workspace kiểm procedure.instance.create (ISS-BE-061)', () => {
  it('người không có quyền khởi tạo hồ sơ bị từ chối dù khớp vai S (SEC-BE061-01)', async () => {
    const { application, definitionId } = await setup();
    const result = await application.startForWorkspaceWorkItem(
      'tenant-a',
      workItem(definitionId, { requestedByCanCreateInstances: false }),
    );
    expect(result).toEqual({
      ok: false,
      reason: 'Người tạo công việc không có quyền khởi tạo hồ sơ quy trình.',
    });
    const standalone = await application.startForWorkspaceStandaloneTask('tenant-a', {
      taskId: '33333333-3333-4333-8333-333333333333',
      taskCode: 'GV001',
      title: 'Mua vật tư',
      definitionId,
      requestedBy: staff.userId,
      requestedByIsTenantAdmin: false,
      requestedByCanCreateInstances: false,
    });
    expect(standalone.ok).toBe(false);
  });

  it('sự kiện cũ chưa mang cờ quyền: người không phải quản trị bị từ chối', async () => {
    const { application, definitionId } = await setup();
    const result = await application.startForWorkspaceWorkItem('tenant-a', workItem(definitionId, {}));
    expect(result.ok).toBe(false);
  });

  it('người có quyền và khớp vai S mở được hồ sơ (SEC-BE061-03)', async () => {
    const { application, definitionId } = await setup();
    const result = await application.startForWorkspaceWorkItem(
      'tenant-a',
      workItem(definitionId, { requestedByCanCreateInstances: true }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.instance.initiatedBy).toBe(staff.userId);
  });

  it('quản trị tenant vẫn mở được (kể cả sự kiện cũ không có cờ)', async () => {
    const { application, definitionId } = await setup();
    const result = await application.startForWorkspaceWorkItem(
      'tenant-a',
      workItem(definitionId, { requestedBy: 'admin', requestedByIsTenantAdmin: true }),
    );
    expect(result.ok).toBe(true);
  });
});
