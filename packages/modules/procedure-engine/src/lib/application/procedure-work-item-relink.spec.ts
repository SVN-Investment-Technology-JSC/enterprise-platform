import type { CreateProcedureDefinitionRequest } from '@enterprise-platform/contracts-procedure-engine';
import type { ProcedureActor } from '../domain/procedure-authorization.js';
import { workItemIdempotencyKey } from '../domain/procedure-workspace-link.js';
import { InMemoryProcedureStore } from '../infrastructure/in-memory-procedure-store.js';
import { ProcedureEngineApplication } from './procedure-engine.application.js';

const TENANT = 'tenant-a';
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
const people = [person('initiator'), person('approver')];

const definition = (code: string): CreateProcedureDefinitionRequest => ({
  code,
  name: `Quy trình ${code}`,
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
});

describe('mở hồ sơ cho công việc sau khi gỡ liên kết rồi gắn lại', () => {
  async function setup() {
    const store = new InMemoryProcedureStore();
    let id = 0;
    const application = new ProcedureEngineApplication(
      store,
      { now: () => new Date('2026-10-21T08:00:00.000Z') },
      { next: () => `id-${(id += 1).toString().padStart(4, '0')}` },
      undefined,
      { countForSubtask: async () => 0, countForInstance: async () => 0 },
      undefined,
      { resolve: async (_tenant, userId) => people.find((candidate) => candidate.userId === userId) ?? null },
    );
    const publish = async (code: string) =>
      application.publishDefinition(admin, (await application.createDefinition(admin, definition(code))).id);
    const first = await publish('FIRST');
    const second = await publish('SECOND');
    const request = (definitionId: string, requestId?: string) => ({
      workItemId: 'wi-1',
      workItemCode: 'CV-001',
      projectId: '11111111-1111-4111-8111-111111111111',
      projectCode: 'EVN',
      title: 'Mua cáp',
      definitionId,
      requestId,
      requestedBy: 'initiator',
      requestedByName: 'initiator',
      requestedByIsTenantAdmin: false,
    });
    return { application, store, first, second, request };
  }

  it('khoá chống trùng khác nhau theo từng lần yêu cầu, và giữ khoá cũ khi sự kiện không có requestId', () => {
    expect(workItemIdempotencyKey('wi-1')).toBe('workspace-work-item:wi-1');
    expect(workItemIdempotencyKey('wi-1', 'r1')).toBe('workspace-work-item:wi-1:r1');
    expect(workItemIdempotencyKey('wi-1', 'r1')).not.toBe(workItemIdempotencyKey('wi-1', 'r2'));
  });

  it('lần yêu cầu mới mở hồ sơ mới thay vì trả lại hồ sơ cũ', async () => {
    const { application, store, first, second, request } = await setup();
    const a = await application.startForWorkspaceWorkItem(TENANT, request(first.id, 'req-1'));
    const b = await application.startForWorkspaceWorkItem(TENANT, request(second.id, 'req-2'));
    if (!a.ok || !b.ok) throw new Error('mở hồ sơ thất bại');
    expect(b.instance.id).not.toBe(a.instance.id);
    expect((await store.read(TENANT)).instances).toHaveLength(2);
  });

  it('cùng một lần yêu cầu được giao lại thì không mở thêm hồ sơ', async () => {
    const { application, store, first, request } = await setup();
    const a = await application.startForWorkspaceWorkItem(TENANT, request(first.id, 'req-1'));
    const again = await application.startForWorkspaceWorkItem(TENANT, request(first.id, 'req-1'));
    if (!a.ok || !again.ok) throw new Error('mở hồ sơ thất bại');
    expect(again.instance.id).toBe(a.instance.id);
    expect((await store.read(TENANT)).instances).toHaveLength(1);
  });
});
