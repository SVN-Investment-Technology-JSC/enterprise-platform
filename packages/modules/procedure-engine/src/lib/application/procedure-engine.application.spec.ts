import type { CreateProcedureDefinitionRequest } from '@enterprise-platform/contracts-procedure-engine';
import { ProcedureEngineApplication } from './procedure-engine.application.js';
import type {
  ProcedureClock,
  ProcedureIdGenerator,
} from './procedure-store.port.js';
import type { ProcedureActor } from '../domain/procedure-authorization.js';
import { InMemoryProcedureStore } from '../infrastructure/in-memory-procedure-store.js';

class FixedClock implements ProcedureClock {
  now(): Date {
    return new Date('2026-08-15T10:00:00.000Z');
  }
}

class SequentialIds implements ProcedureIdGenerator {
  private value = 0;

  next(): string {
    this.value += 1;
    return `generated-${this.value.toString().padStart(4, '0')}`;
  }
}

const actor: ProcedureActor = {
  tenantId: 'tenant-a',
  userId: 'user-superadmin',
  displayName: 'Quản trị hệ thống',
  canDesign: true,
  canPublish: true,
  canCreateInstances: true,
  isOverride: true,
  membershipId: '20000000-0000-4000-8000-000000000001',
  organizationUnitIds: [],
  positionIds: [],
};

function definitionInput(): CreateProcedureDefinitionRequest {
  return {
    code: 'PROC-TEST',
    name: 'Quy trình kiểm thử',
    kind: 'process',
    // Bắt buộc từ đợt 21/8: bản nháp phải thuộc một nhóm mới công bố được.
    category: 'technical',
    steps: [
      {
        key: 'REQUEST',
        order: 1,
        name: 'Lập đề nghị',
        assignments: [
          {
            role: 'S',
            subjectType: 'user',
            subjectId: actor.userId,
          },
        ],
      },
      {
        key: 'APPROVE',
        order: 2,
        name: 'Phê duyệt',
        assignments: [
          {
            role: 'A',
            subjectType: 'user',
            subjectId: actor.userId,
          },
        ],
      },
    ],
  };
}

describe('ProcedureEngineApplication', () => {
  function setup() {
    return new ProcedureEngineApplication(
      new InMemoryProcedureStore(),
      new FixedClock(),
      new SequentialIds(),
    );
  }

  it('runs the first vertical slice from draft to completed instance', async () => {
    const application = setup();
    const draft = await application.createDefinition(actor, definitionInput());
    const published = await application.publishDefinition(actor, draft.id);
    const started = await application.startInstance(actor, {
      definitionId: published.id,
      title: 'Đề nghị thử nghiệm',
      idempotencyKey: 'start-001',
    });

    expect(started.status).toBe('running');
    expect(started.authorization?.currentRoleStage).toBe('S');

    const awaitingApproval = await application.applyAction(actor, started.id, {
      action: 'complete',
      idempotencyKey: 'action-001',
    });
    expect(awaitingApproval.authorization?.currentRoleStage).toBe('A');

    const completed = await application.applyAction(actor, started.id, {
      action: 'approve',
      idempotencyKey: 'action-002',
    });
    expect(completed.status).toBe('completed');
    expect(completed.steps.every((step) => step.status === 'completed')).toBe(
      true,
    );
  });

  it('separates design, publication and initiation, retaining runtime RACI', async () => {
    const application = setup();
    const employee = { ...actor, canDesign: false, canPublish: false, isOverride: false };
    await expect(application.createDefinition(employee, definitionInput())).rejects.toMatchObject({ code: 'forbidden' });
    const designer = { ...actor, canPublish: false, canCreateInstances: false, isOverride: false };
    const draft = await application.createDefinition(designer, definitionInput());
    await expect(application.updateDefinition(employee, draft.id, { steps: definitionInput().steps })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(application.publishDefinition(designer, draft.id)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(application.archiveDefinition(designer, draft.id)).rejects.toMatchObject({ code: 'forbidden' });
    const publisher = { ...employee, canPublish: true, canCreateInstances: false };
    expect((await application.getWorkspace(publisher)).definitions).toEqual(expect.arrayContaining([expect.objectContaining({ id: draft.id })]));
    await application.publishDefinition(publisher, draft.id);
    await expect(application.startInstance(publisher, { definitionId: draft.id, title: 'Test', idempotencyKey: 'denied' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(application.startInstance({ ...employee, userId: 'unassigned', membershipId: 'unassigned' }, { definitionId: draft.id, title: 'Test', idempotencyKey: 'unassigned' })).rejects.toMatchObject({ code: 'forbidden' });
    const started = await application.startInstance(employee, { definitionId: draft.id, title: 'Test', idempotencyKey: 'allowed' });
    expect(started.status).toBe('running');
    expect((await application.getWorkspace(employee)).permissions).toEqual({ canManageDefinitions: false, canPublishDefinitions: false, canCreateInstances: true, canOverrideActions: false });
    // Không cần quyền quản trị: người giữ vai A của đơn (ở đây chính là nhân viên này) được xoá đơn.
    // Người không giữ vai A bị chặn: xem procedure-instance-deletion.spec.ts.
    await application.deleteInstance(employee, started.id, { reason: 'Nhập nhầm' });
  });

  it('liệt kê quy trình đã công bố mà người gọi khởi tạo được', async () => {
    const application = setup();
    const draft = await application.createDefinition(actor, definitionInput());
    const other = await application.createDefinition(actor, {
      ...definitionInput(),
      code: 'PROC-OTHER',
      name: 'A quy trình khác',
    });
    const otherPublished = await application.publishDefinition(actor, other.id);
    const ids = async (who: ProcedureActor) =>
      (await application.listStartableDefinitions(who)).map((definition) => definition.id);
    expect(await application.listStartableDefinitions(actor)).toContainEqual({
      id: otherPublished.id,
      code: 'PROC-OTHER',
      name: 'A quy trình khác',
      description: null,
      category: 'technical',
    });
    // Bản nháp chưa công bố thì chưa khởi tạo được.
    expect(await ids(actor)).not.toContain(draft.id);
    const published = await application.publishDefinition(actor, draft.id);
    const employee = { ...actor, canDesign: false, canPublish: false, isOverride: false };
    const employeeIds = await ids(employee);
    // Theo tên: "A quy trình khác" trước "Quy trình kiểm thử".
    expect(employeeIds.filter((id) => id === otherPublished.id || id === published.id)).toEqual([
      otherPublished.id,
      published.id,
    ]);
    // Không giữ vai S ở bước nào: không thấy; quyền override thì thấy; không có quyền tạo hồ sơ: rỗng.
    const stranger = { ...employee, userId: 'unassigned', membershipId: 'unassigned' };
    expect(await ids(stranger)).not.toContain(otherPublished.id);
    expect(await ids(stranger)).not.toContain(published.id);
    expect(await ids({ ...stranger, isOverride: true })).toEqual(
      expect.arrayContaining([otherPublished.id, published.id]),
    );
    expect(await application.listStartableDefinitions({ ...employee, canCreateInstances: false })).toEqual([]);
  });

  it('chỉ lưu trữ khi mọi hồ sơ của quy trình đã kết thúc', async () => {
    const application = setup();
    const published = await application.publishDefinition(actor, (await application.createDefinition(actor, definitionInput())).id);
    const started = await application.startInstance(actor, { definitionId: published.id, title: 'Đang chạy', idempotencyKey: 'archive-run' });
    await expect(application.archiveDefinition(actor, published.id)).rejects.toMatchObject({
      code: 'conflict',
      message: expect.stringContaining(started.code),
    });
    await application.applyAction(actor, started.id, { action: 'complete', idempotencyKey: 'archive-a1' });
    await application.applyAction(actor, started.id, { action: 'approve', idempotencyKey: 'archive-a2' });
    expect((await application.archiveDefinition(actor, published.id)).status).toBe('archived');
  });

  it('xoá quy trình đã lưu trữ là xoá mềm: ẩn khỏi giao diện, hồ sơ cũ vẫn giữ', async () => {
    const application = setup();
    const published = await application.publishDefinition(actor, (await application.createDefinition(actor, definitionInput())).id);
    const started = await application.startInstance(actor, { definitionId: published.id, title: 'Hồ sơ cũ', idempotencyKey: 'del-run' });
    await application.applyAction(actor, started.id, { action: 'complete', idempotencyKey: 'del-a1' });
    await application.applyAction(actor, started.id, { action: 'approve', idempotencyKey: 'del-a2' });
    await application.archiveDefinition(actor, published.id);

    const designerOnly = { ...actor, isOverride: false };
    await expect(application.deleteDefinition(designerOnly, published.id)).rejects.toMatchObject({ code: 'forbidden' });
    await application.deleteDefinition(actor, published.id);

    const workspace = await application.getWorkspace(actor);
    expect(workspace.definitions.some((item) => item.id === published.id)).toBe(false);
    expect(workspace.instances.find((item) => item.id === started.id)).toMatchObject({ status: 'completed', definitionId: published.id });
    await expect(application.reviseDefinition(actor, published.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(application.deleteDefinition(actor, published.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(application.createDefinition(actor, definitionInput())).rejects.toMatchObject({
      code: 'conflict',
      message: expect.stringContaining('đã xoá'),
    });
  });

  it('công bố quy trình không cần danh mục mẫu', async () => {
    const application = setup();
    const draft = await application.createDefinition(actor, definitionInput());
    const published = await application.publishDefinition(actor, draft.id);
    expect(published.status).toBe('published');
  });

  it('không công bố được khi bản nháp chưa có nhóm', async () => {
    const application = setup();
    const draft = await application.createDefinition(actor, {
      ...definitionInput(),
      category: undefined,
    });
    await expect(application.publishDefinition(actor, draft.id)).rejects.toThrow(
      /thuộc một nhóm/,
    );
  });

  it('gán nhóm cho bản nháp rồi công bố được', async () => {
    const application = setup();
    const draft = await application.createDefinition(actor, {
      ...definitionInput(),
      category: undefined,
    });
    await application.updateDefinition(actor, draft.id, {
      category: 'finance',
      steps: definitionInput().steps,
    });
    const published = await application.publishDefinition(actor, draft.id);
    expect(published.status).toBe('published');
    expect(published.category).toBe('finance');
  });

  it('bước tuần tự chặn đầu việc chưa tới lượt, kể cả khi gọi thẳng application', async () => {
    const application = setup();
    const draft = await application.createDefinition(actor, definitionInput());
    const published = await application.publishDefinition(actor, draft.id);
    const started = await application.startInstance(actor, {
      definitionId: published.id,
      title: 'Hồ sơ tuần tự',
      idempotencyKey: 'start-seq',
    });

    const decomposed = await application.setSubtasks(actor, started.id, {
      executionMode: 'sequential',
      items: [
        { title: 'Việc 1', weight: 50 },
        { title: 'Việc 2', weight: 50 },
      ],
    });
    const [first, second] = [...decomposed.subtasks!].sort((a, b) => a.order - b.order);
    expect(decomposed.steps[0].subtaskExecutionMode).toBe('sequential');
    expect([first.order, second.order]).toEqual([1, 2]);

    await expect(
      application.completeSubtask(actor, started.id, second.id),
    ).rejects.toThrow(/tuần tự/i);

    await application.completeSubtask(actor, started.id, first.id);
    const done = await application.completeSubtask(actor, started.id, second.id);
    expect(done.subtasks?.every((item) => item.status === 'completed')).toBe(true);
  });

  it('bước song song không ràng buộc thứ tự', async () => {
    const application = setup();
    const draft = await application.createDefinition(actor, definitionInput());
    const published = await application.publishDefinition(actor, draft.id);
    const started = await application.startInstance(actor, {
      definitionId: published.id,
      title: 'Hồ sơ song song',
      idempotencyKey: 'start-par',
    });

    const decomposed = await application.setSubtasks(actor, started.id, {
      items: [
        { title: 'Việc 1', weight: 50 },
        { title: 'Việc 2', weight: 50 },
      ],
    });
    // Bỏ trống executionMode: mặc định song song, giữ đúng hành vi cũ.
    expect(decomposed.steps[0].subtaskExecutionMode).toBeUndefined();

    const last = [...decomposed.subtasks!].sort((a, b) => a.order - b.order)[1];
    const done = await application.completeSubtask(actor, started.id, last.id);
    expect(done.subtasks?.find((item) => item.id === last.id)?.status).toBe('completed');
  });

  it('vật tư của bước sống sót qua mỗi lần sửa một ô RACI', async () => {
    const application = setup();
    const input = definitionInput();
    const draft = await application.createDefinition(actor, {
      ...input,
      steps: input.steps.map((step, index) =>
        index === 0
          ? { ...step, slaHours: 6, materials: [{ materialCode: 'VT-X', quantity: 3 }] }
          : step,
      ),
    });
    expect(draft.steps[0].materials).toEqual([{ materialCode: 'VT-X', quantity: 3 }]);

    // Mô phỏng đúng cái writeCell làm: PATCH cả bản nháp sau mỗi lần bấm một ô.
    const roundTrip = (definition: typeof draft) =>
      definition.steps.map((step) => ({
        key: step.key,
        order: step.order,
        name: step.name,
        description: step.description,
        linkedDefinitionId: step.linkedDefinitionId,
        slaHours: step.slaHours,
        materials: step.materials?.map((item) => ({ ...item })),
        assignments: step.assignments.map((assignment) => ({
          role: assignment.role,
          subjectType: assignment.subjectType,
          subjectId: assignment.subjectId,
          subjectLabel: assignment.subjectLabel,
        })),
      }));

    let current = draft;
    for (let round = 0; round < 2; round += 1) {
      current = await application.updateDefinition(actor, draft.id, {
        name: current.name,
        kind: current.kind,
        steps: roundTrip(current),
      });
    }

    expect(current.steps[0].materials).toEqual([{ materialCode: 'VT-X', quantity: 3 }]);
    expect(current.steps[0].slaHours).toBe(6);
  });

  it('keeps state isolated by tenant', async () => {
    const application = setup();
    const workspaceA = await application.getWorkspace(actor);
    const published = workspaceA.definitions.find(
      (definition) => definition.status === 'published',
    );
    expect(published).toBeDefined();
    await application.startInstance(actor, {
      definitionId: published?.id ?? '',
      title: 'Chỉ thuộc tenant A',
      idempotencyKey: 'tenant-a-start',
    });

    const workspaceB = await application.getWorkspace({
      ...actor,
      tenantId: 'tenant-b',
    });
    expect(workspaceB.instances).toHaveLength(0);
  });

  it('returns the same instance for a repeated idempotency key', async () => {
    const application = setup();
    const workspace = await application.getWorkspace(actor);
    const published = workspace.definitions.find(
      (definition) => definition.status === 'published',
    );
    const request = {
      definitionId: published?.id ?? '',
      title: 'Yêu cầu idempotent',
      idempotencyKey: 'same-command',
    };

    const first = await application.startInstance(actor, request);
    const second = await application.startInstance(actor, request);
    expect(second.id).toBe(first.id);
  });

  it('đọc định nghĩa đã công bố cho dịch vụ nội bộ, từ chối bản nháp', async () => {
    const application = setup();
    const draft = await application.createDefinition(actor, definitionInput());
    await expect(
      application.getPublishedDefinitionForService('tenant-a', draft.id),
    ).rejects.toMatchObject({ code: 'not_found' });
    const published = await application.publishDefinition(actor, draft.id);
    const read = await application.getPublishedDefinitionForService('tenant-a', published.id);
    expect(read.id).toBe(published.id);
    expect(read.steps.length).toBeGreaterThan(0);
  });
});

describe('phân rã công việc của vai trò E', () => {
  const sum = (items: { weight: number }[]) =>
    Math.round(items.reduce((total, item) => total + item.weight, 0) * 100);

  it('chấp nhận tổng đúng 100', () => {
    expect(sum([{ weight: 40 }, { weight: 60 }])).toBe(10_000);
  });

  it('chấp nhận số lẻ cộng lại vừa 100', () => {
    // Cộng float thuần cho 33.33+33.33+33.34 ra 100.00000000000001
    expect(sum([{ weight: 33.33 }, { weight: 33.33 }, { weight: 33.34 }])).toBe(10_000);
  });

  it('phát hiện tổng thiếu', () => {
    expect(sum([{ weight: 40 }, { weight: 50 }])).not.toBe(10_000);
  });

  it('phát hiện tổng thừa', () => {
    expect(sum([{ weight: 70 }, { weight: 50 }])).not.toBe(10_000);
  });
});
