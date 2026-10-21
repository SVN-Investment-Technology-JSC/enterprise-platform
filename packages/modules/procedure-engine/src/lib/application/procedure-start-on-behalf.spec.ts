import type { CreateProcedureDefinitionRequest } from '@enterprise-platform/contracts-procedure-engine';
import type { ProcedureActor } from '../domain/procedure-authorization.js';
import { InMemoryProcedureStore } from '../infrastructure/in-memory-procedure-store.js';
import type { InitiatorActorResolver } from './initiator-actor.port.js';
import { ProcedureEngineApplication } from './procedure-engine.application.js';

const person = (userId: string, overrides: Partial<ProcedureActor> = {}): ProcedureActor => ({
  tenantId: 'tenant-a',
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
/** Thư ký: tạo đơn hộ, không giữ vai S. */
const clerk = person('clerk');
/** Nhân viên giữ vai S qua chức danh. */
const employee = person('employee', { positionIds: ['pos-staff'] });
const outsider = person('outsider');

function definitionInput(): CreateProcedureDefinitionRequest {
  return {
    code: 'PROC-OBO',
    name: 'Đề nghị tạm ứng',
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
  const known = new Map([employee, outsider, clerk].map((actor) => [actor.userId, actor]));
  const resolver: InitiatorActorResolver = {
    resolve: async (_tenantId, userId) => known.get(userId) ?? null,
  };
  let id = 0;
  const application = new ProcedureEngineApplication(
    new InMemoryProcedureStore(),
    { now: () => new Date('2026-10-21T08:00:00.000Z') },
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

describe('Tạo đơn hộ (người submit khác người tạo)', () => {
  it('mặc định người tạo là người submit: không có vai S thì không tạo được', async () => {
    const { application, definitionId } = await setup();
    await expect(
      application.startInstance(clerk, { definitionId, title: 'Tạm ứng', idempotencyKey: 'k1' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const own = await application.startInstance(employee, {
      definitionId,
      title: 'Tạm ứng',
      idempotencyKey: 'k2',
      submitterUserId: employee.userId,
    });
    expect(own.initiatedBy).toBe(employee.userId);
    expect(own.createdOnBehalfBy).toBeUndefined();
  });

  it('người tạo không cần vai S; người submit thành người khởi tạo, người tạo được uỷ quyền vai S ở bước đầu', async () => {
    const { application, definitionId } = await setup();
    const started = await application.startInstance(clerk, {
      definitionId,
      title: 'Tạm ứng công tác',
      idempotencyKey: 'k3',
      submitterUserId: employee.userId,
      submitterName: 'Tên giả mạo',
    });
    expect(started.initiatedBy).toBe(employee.userId);
    expect(started.createdOnBehalfBy).toEqual({ userId: clerk.userId, name: clerk.displayName });
    expect(started.delegations).toEqual([
      expect.objectContaining({
        delegatedBy: employee.userId,
        delegatedByName: employee.displayName,
        delegatedTo: clerk.userId,
        roles: ['S'],
        stepInstanceId: started.currentStepId,
      }),
    ]);
    // Đúng một dòng khởi tạo, mang tên người submit, ghi kèm người tạo hộ.
    const opened = started.activity.filter((entry) => entry.action === 'start');
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ actorId: employee.userId, actorName: employee.displayName });
    expect(opened[0]?.summary).toContain(`do ${clerk.displayName} tạo đơn hộ`);

    // Người tạo hộ hoàn tất được bước S thay người submit, và cả hai đều thấy đơn.
    expect(started.authorization?.availableActions).toContain('complete');
    const asEmployee = await application.getInstance(employee, started.id);
    expect(asEmployee.authorization?.availableActions).toContain('complete');
  });

  it('người tạo hoặc người submit có vai S là đủ; cả hai đều không có thì bị chặn', async () => {
    const { application, definitionId } = await setup();
    // Người có vai S nộp hộ cho bất kỳ ai trong tenant.
    const forOutsider = await application.startInstance(employee, {
      definitionId,
      title: 'Tạm ứng',
      idempotencyKey: 'k4',
      submitterUserId: outsider.userId,
    });
    expect(forOutsider.initiatedBy).toBe(outsider.userId);
    expect(forOutsider.createdOnBehalfBy?.userId).toBe(employee.userId);

    await expect(
      application.startInstance(clerk, {
        definitionId,
        title: 'Tạm ứng',
        idempotencyKey: 'k5',
        submitterUserId: outsider.userId,
      }),
    ).rejects.toMatchObject({ code: 'forbidden', message: expect.stringContaining('chưa được phân vai S') });
    await expect(
      application.startInstance(clerk, {
        definitionId,
        title: 'Tạm ứng',
        idempotencyKey: 'k6',
        submitterUserId: 'khong-co',
      }),
    ).rejects.toMatchObject({ code: 'validation' });
  });
});
