import type { CreateProcedureDefinitionRequest } from '@enterprise-platform/contracts-procedure-engine';
import type { ProcedureActor } from '../domain/procedure-authorization.js';
import { WORK_ITEM_PROCEDURE_LINKED, workspaceProjectRef } from '../domain/procedure-workspace-link.js';
import { InMemoryProcedureStore } from '../infrastructure/in-memory-procedure-store.js';
import { ProcedureEngineApplication, type StartProcedureInstanceInput } from './procedure-engine.application.js';
import { ProcedureWorkspaceEvents } from './workspace-link-events.js';

const TENANT = 'tenant-a';
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const base = {
  tenantId: TENANT,
  canDesign: false,
  canPublish: false,
  canCreateInstances: true,
  isOverride: false,
  organizationUnitIds: [],
  positionIds: [],
};
const person = (userId: string): ProcedureActor => ({
  ...base,
  userId,
  displayName: userId,
  membershipId: `m-${userId}`,
});
const admin: ProcedureActor = { ...person('admin'), canDesign: true, canPublish: true, isOverride: true };
const initiator = person('initiator');
const people = [initiator, person('approver')];

const DEFINITION: CreateProcedureDefinitionRequest = {
  code: 'MUA',
  name: 'Mua hàng',
  kind: 'process',
  category: 'technical',
  steps: [
    {
      key: 'REQUEST',
      order: 1,
      name: 'Lập đề nghị',
      assignments: [{ role: 'S', subjectType: 'user', subjectId: 'initiator' }],
    },
    {
      key: 'APPROVE',
      order: 2,
      name: 'Phê duyệt',
      assignments: [{ role: 'A', subjectType: 'user', subjectId: 'approver' }],
    },
  ],
};

async function setup() {
  const store = new InMemoryProcedureStore();
  let id = 0;
  const application = new ProcedureEngineApplication(
    store,
    { now: () => new Date('2026-11-27T08:00:00.000Z') },
    { next: () => `id-${(id += 1).toString().padStart(4, '0')}` },
    undefined,
    { countForSubtask: async () => 0, countForInstance: async () => 0 },
    undefined,
    { resolve: async (_tenant, userId) => people.find((candidate) => candidate.userId === userId) ?? null },
  );
  const definition = await application.publishDefinition(
    admin,
    (await application.createDefinition(admin, DEFINITION)).id,
  );
  const workItemRequest = (extra: { projectName?: string } = {}) => ({
    workItemId: 'wi-1',
    workItemCode: 'CV-001',
    projectId: PROJECT_ID,
    projectCode: 'EVN',
    title: 'Mua cáp',
    definitionId: definition.id,
    requestId: 'req-1',
    requestedBy: 'initiator',
    requestedByName: 'initiator',
    requestedByIsTenantAdmin: false,
    ...extra,
  });
  return { application, store, definition, workItemRequest };
}

describe('Hồ sơ thuộc dự án nào', () => {
  it('hồ sơ mở từ công việc Workspace lưu mã, tên dự án từ sự kiện', async () => {
    const { application, workItemRequest } = await setup();
    const started = await application.startForWorkspaceWorkItem(
      TENANT,
      workItemRequest({ projectName: 'Cải tạo trạm EVN' }),
    );
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.instance.workspaceProject).toEqual({
      projectId: PROJECT_ID,
      projectCode: 'EVN',
      projectName: 'Cải tạo trạm EVN',
    });
    // Người trong hồ sơ đọc lại vẫn thấy.
    const read = await application.getInstance(initiator, started.instance.id);
    expect(read.workspaceProject?.projectName).toBe('Cải tạo trạm EVN');
  });

  it('sự kiện cũ chưa có tên dự án: vẫn lưu mã và id để mở dự án', async () => {
    const { application, workItemRequest } = await setup();
    const started = await application.startForWorkspaceWorkItem(TENANT, workItemRequest());
    expect(started.ok && started.instance.workspaceProject).toEqual({ projectId: PROJECT_ID, projectCode: 'EVN' });
  });

  it('người dùng không tự gắn được dự án qua body tạo hồ sơ', async () => {
    const { application, definition } = await setup();
    const input = {
      definitionId: definition.id,
      title: 'Đơn tay',
      idempotencyKey: 'manual-1',
      workspaceLink: { projectId: PROJECT_ID, projectCode: 'EVN', workItem: {} },
      workspaceProject: { projectId: PROJECT_ID, projectCode: 'GIA', projectName: 'Dự án giả' },
    } as StartProcedureInstanceInput;
    const instance = await application.startInstance(initiator, input);
    expect(instance.workspaceProject).toBeUndefined();
  });

  it('hồ sơ gắn dự án từ Quy trình nhận tên dự án khi Workspace báo đã tạo công việc', async () => {
    const { application, definition } = await setup();
    const started = await application.startInstance(initiator, {
      definitionId: definition.id,
      title: 'Mua cáp Anten',
      idempotencyKey: 'linked-1',
      workspaceLink: { projectId: PROJECT_ID, projectCode: 'EVN', workItem: {} },
    });
    expect(started.workspaceLink?.status).toBe('pending');
    expect(started.workspaceLink?.projectName).toBeUndefined();

    const events = new ProcedureWorkspaceEvents(application, async () => undefined);
    await events.handle(TENANT, WORK_ITEM_PROCEDURE_LINKED, {
      instanceId: started.id,
      workItemId: 'wi-9',
      workItemCode: 'CV-013',
      projectId: PROJECT_ID,
      projectCode: 'EVN',
      projectName: 'Cải tạo trạm EVN',
    });
    const linked = await application.getInstance(initiator, started.id);
    expect(linked.workspaceLink).toMatchObject({
      status: 'linked',
      projectId: PROJECT_ID,
      projectCode: 'EVN',
      projectName: 'Cải tạo trạm EVN',
      workItemCode: 'CV-013',
    });
  });

  it('thiếu id hay mã dự án thì không lưu gì; tên quá dài bị cắt', () => {
    expect(workspaceProjectRef({ projectId: '', projectCode: 'EVN' })).toBeUndefined();
    expect(workspaceProjectRef({ projectId: PROJECT_ID, projectCode: ' ' })).toBeUndefined();
    expect(
      workspaceProjectRef({ projectId: PROJECT_ID, projectCode: 'EVN', projectName: 'x'.repeat(400) })?.projectName,
    ).toHaveLength(255);
  });
});
