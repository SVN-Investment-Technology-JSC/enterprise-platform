import type {
  CreateProcedureDefinitionRequest,
  ProcedureInstance,
} from '@enterprise-platform/contracts-procedure-engine';
import { canRelinkProcedureWorkspace, type ProcedureActor } from './domain/procedure-authorization.js';
import {
  WORKSPACE_LINK_REQUESTED_EVENT,
  WORKSPACE_RELINK_REQUESTED_EVENT,
  workspaceInstanceBaseTitle,
  workspaceLinkEvents,
} from './domain/procedure-workspace-link.js';
import { buildFinanceVoucherRequestedPayload } from './domain/procedure-finance-step.js';
import { InMemoryProcedureStore } from './infrastructure/in-memory-procedure-store.js';
import {
  PROCEDURE_INSTANCE_RELINKED,
  procedureNotificationEvents,
} from './infrastructure/procedure-notification-events.js';
import { PROJECT_REQUIRED_MESSAGE, ProcedureEngineApplication } from './application/procedure-engine.application.js';

/**
 * Luật dự án của hồ sơ:
 *  - người dùng tự mở hồ sơ phải chọn dự án; hồ sơ do module khác mở thì không;
 *  - người tham gia đơn trừ người chỉ xem được đổi dự án / công việc liên kết;
 *  - hồ sơ mở từ công việc "Theo quy trình" bên Workspace cũng đổi được, cùng một đường sự kiện.
 */

const TENANT = 'tenant-a';
const PROJECT_A = '11111111-1111-4111-8111-111111111111';
const PROJECT_B = '22222222-2222-4222-8222-222222222222';
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
  displayName: `Tên ${userId}`,
  membershipId: `m-${userId}`,
});
const admin: ProcedureActor = { ...person('admin'), canDesign: true, canPublish: true, isOverride: true };
const initiator = person('initiator');
const approver = person('approver');
const consultant = person('consultant');
const viewer = person('viewer');
const delegate = person('delegate');
const worker = person('worker');
const outsider = person('outsider');
const people = [initiator, approver, consultant, viewer, delegate, worker];

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
      assignments: [
        { role: 'S', subjectType: 'user', subjectId: initiator.userId },
        { role: 'I', subjectType: 'user', subjectId: viewer.userId },
      ],
    },
    {
      key: 'APPROVE',
      order: 2,
      name: 'Phê duyệt',
      assignments: [
        { role: 'C', subjectType: 'user', subjectId: consultant.userId },
        { role: 'A', subjectType: 'user', subjectId: approver.userId },
        { role: 'I', subjectType: 'user', subjectId: viewer.userId },
      ],
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
  /** Hồ sơ người dùng tự mở kèm dự án, Workspace đã tạo xong công việc `wi-old`. */
  const startLinked = async () => {
    const started = await application.startInstance(initiator, {
      definitionId: definition.id,
      title: 'Mua cáp',
      idempotencyKey: 'linked-1',
      workspaceLink: { projectId: PROJECT_A, projectCode: 'EVN', workItem: {} },
    });
    await application.applyWorkspaceLinkResult(TENANT, {
      instanceId: started.id,
      linked: { workItemId: 'wi-old', workItemCode: 'CV001', projectCode: 'EVN' },
    });
    return started.id;
  };
  /** Hồ sơ mở từ công việc "Theo quy trình" `wi-src` của dự án EVN. */
  const startFromWorkItem = async () => {
    const started = await application.startForWorkspaceWorkItem(TENANT, {
      workItemId: 'wi-src',
      workItemCode: 'CV-013',
      projectId: PROJECT_A,
      projectCode: 'EVN',
      projectName: 'Cải tạo trạm EVN',
      title: 'Mua cáp Anten',
      definitionId: definition.id,
      requestId: 'req-1',
      requestedBy: initiator.userId,
      requestedByName: initiator.displayName,
      requestedByIsTenantAdmin: false,
    });
    if (!started.ok) throw new Error(started.reason);
    return started.instance.id;
  };
  const read = async (instanceId: string) =>
    (await store.read(TENANT)).instances.find((candidate) => candidate.id === instanceId) as ProcedureInstance;
  return { application, store, definition, startLinked, startFromWorkItem, read };
}

describe('Bắt buộc chọn dự án khi người dùng tự mở hồ sơ', () => {
  it('mở thủ công không kèm dự án bị từ chối, kể cả khi ghi rõ nguồn manual', async () => {
    const { application, definition } = await setup();
    await expect(
      application.startInstance(initiator, { definitionId: definition.id, title: 'Mua cáp', idempotencyKey: 'k1' }),
    ).rejects.toMatchObject({ code: 'validation', message: PROJECT_REQUIRED_MESSAGE });
    await expect(
      application.startInstance(initiator, {
        definitionId: definition.id,
        title: 'Mua cáp',
        idempotencyKey: 'k2',
        sourceType: 'manual',
      }),
    ).rejects.toMatchObject({ code: 'validation', message: 'Hãy chọn dự án cho hồ sơ.' });
    // Quản trị tự mở cũng phải chọn dự án.
    await expect(
      application.startInstance(admin, { definitionId: definition.id, title: 'Mua cáp', idempotencyKey: 'k3' }),
    ).rejects.toMatchObject({ code: 'validation' });
  });

  it('mở thủ công kèm dự án thì được, hồ sơ chờ Workspace tạo công việc', async () => {
    const { application, definition } = await setup();
    const started = await application.startInstance(initiator, {
      definitionId: definition.id,
      title: 'Mua cáp',
      idempotencyKey: 'k1',
      workspaceLink: { projectId: PROJECT_A, projectCode: 'EVN', workItem: {} },
    });
    expect(started.workspaceLink).toMatchObject({ status: 'pending', projectId: PROJECT_A });
  });

  it('hồ sơ do module khác mở (actor hệ thống, đơn HRM, bảo trì…) không cần dự án', async () => {
    const { application, definition } = await setup();
    for (const sourceType of ['hrm_request', 'maintenance_occurrence', 'crm_quote', 'finance_voucher'] as const) {
      const created = await application.createInstance(TENANT, {
        definitionId: definition.id,
        title: `Từ ${sourceType}`,
        idempotencyKey: `ext-${sourceType}`,
        sourceType,
        sourceId: `src-${sourceType}`,
        initiatedBy: initiator.userId,
      });
      expect(created.status).toBe('running');
    }
    // Không ghi nguồn nhưng đi qua API nội bộ (actor hệ thống) cũng được miễn.
    expect(
      (await application.createInstance(TENANT, { definitionId: definition.id, title: 'API', idempotencyKey: 'ext-x' }))
        .status,
    ).toBe('running');
  });

  it('hồ sơ mở cho công việc / việc ngoài dự án của Workspace và lời gọi nội bộ projectOptional được miễn', async () => {
    const { application, definition, startFromWorkItem } = await setup();
    await startFromWorkItem();
    const standalone = await application.startForWorkspaceStandaloneTask(TENANT, {
      taskId: 'task-1',
      taskCode: 'GV012',
      title: 'Soạn báo giá',
      definitionId: definition.id,
      requestedBy: initiator.userId,
      requestedByIsTenantAdmin: false,
    });
    expect(standalone.ok).toBe(true);
    const imported = await application.startInstance(
      initiator,
      { definitionId: definition.id, title: 'Dữ liệu mẫu', idempotencyKey: 'seed-1' },
      { projectOptional: true },
    );
    expect(imported.workspaceLink).toBeUndefined();
  });
});

describe('Ai được đổi dự án / công việc liên kết', () => {
  it('người tạo, người được giao (C, A), người được uỷ quyền, người làm đầu việc và quản trị được; người chỉ xem (I) thì không', async () => {
    const { store, startLinked, read } = await setup();
    const instanceId = await startLinked();
    await store.transaction(TENANT, (state) => {
      const target = state.instances.find((candidate) => candidate.id === instanceId) as ProcedureInstance;
      target.delegations = [
        {
          id: 'dl-1',
          stepInstanceId: target.currentStepId,
          delegatedBy: initiator.userId,
          delegatedByName: initiator.displayName,
          delegatedTo: delegate.userId,
          roles: ['S'],
          createdAt: '2026-11-27T08:00:00.000Z',
        },
      ];
      target.subtasks = [
        {
          id: 'st-1',
          instanceId,
          stepInstanceId: target.currentStepId,
          title: 'Khảo sát',
          order: 1,
          assigneeId: worker.userId,
          weight: 1,
          status: 'open',
          createdAt: '2026-11-27T08:00:00.000Z',
        },
      ];
    });
    const instance = await read(instanceId);
    for (const who of [initiator, approver, consultant, delegate, worker, admin]) {
      expect([who.userId, canRelinkProcedureWorkspace(instance, who)]).toEqual([who.userId, true]);
    }
    for (const who of [viewer, outsider]) {
      expect([who.userId, canRelinkProcedureWorkspace(instance, who)]).toEqual([who.userId, false]);
    }
  });

  it('người tạo hộ cũng được đổi', async () => {
    const { read, startLinked, store } = await setup();
    const instanceId = await startLinked();
    await store.transaction(TENANT, (state) => {
      const target = state.instances.find((candidate) => candidate.id === instanceId) as ProcedureInstance;
      target.createdOnBehalfBy = { userId: 'secretary', name: 'Thư ký' };
    });
    expect(canRelinkProcedureWorkspace(await read(instanceId), person('secretary'))).toBe(true);
  });

  it('người chỉ xem bị chặn với lý do rõ ràng; đang chờ Workspace thì không gửi yêu cầu thứ hai', async () => {
    const { application, startLinked } = await setup();
    const instanceId = await startLinked();
    await expect(
      application.relinkWorkspace(viewer, instanceId, { projectId: PROJECT_B, projectCode: 'HN' }),
    ).rejects.toMatchObject({ code: 'forbidden', message: expect.stringContaining('vai I') });

    const pending = await application.relinkWorkspace(initiator, instanceId, {
      projectId: PROJECT_B,
      projectCode: 'HN',
    });
    expect(pending.workspaceLink).toMatchObject({ status: 'pending', replacesWorkItemId: 'wi-old' });
    expect(pending.authorization?.canRelinkWorkspace).toBe(false);
    await expect(
      application.relinkWorkspace(admin, instanceId, { projectId: PROJECT_A, projectCode: 'EVN' }),
    ).rejects.toMatchObject({ code: 'forbidden', message: expect.stringContaining('đang chờ Workspace') });
  });

  it('hồ sơ đã xoá hoặc đã huỷ hiệu lực thì không đổi được, kể cả quản trị', async () => {
    const { read, startLinked } = await setup();
    const instanceId = await startLinked();
    const instance = await read(instanceId);
    expect(canRelinkProcedureWorkspace({ ...instance, status: 'reversed' }, admin)).toBe(false);
    expect(
      canRelinkProcedureWorkspace(
        { ...instance, deletion: { deletedAt: 'x', deletedBy: 'admin', reason: 'Nhầm' } },
        admin,
      ),
    ).toBe(false);
  });
});

describe('Đổi dự án / công việc của hồ sơ mở từ công việc Workspace', () => {
  it('phát yêu cầu đổi với công việc nguồn là công việc bị thay, tên gốc bỏ mã dự án / công việc cũ', async () => {
    const { application, store, startFromWorkItem } = await setup();
    const instanceId = await startFromWorkItem();
    const asApprover = await application.getInstance(approver, instanceId);
    expect(asApprover.title).toBe('EVN-CV013-Mua cáp Anten');
    expect(asApprover.authorization?.canRelinkWorkspace).toBe(true);
    expect((await application.getInstance(viewer, instanceId)).authorization?.canRelinkWorkspace).toBe(false);

    const before = (await store.read(TENANT)).instances;
    const pending = await application.relinkWorkspace(approver, instanceId, {
      projectId: PROJECT_B,
      projectCode: 'HN',
      parentId: 'wi-parent',
    });
    expect(pending.workspaceLink).toMatchObject({
      status: 'pending',
      projectId: PROJECT_B,
      projectCode: 'HN',
      baseTitle: 'Mua cáp Anten',
      replacesWorkItemId: 'wi-src',
      workItem: { parentId: 'wi-parent' },
      requestedBy: approver.userId,
    });
    expect(pending.workspaceLink?.previous).toBeUndefined();
    const after = (await store.read(TENANT)).instances;
    const events = workspaceLinkEvents(before, after);
    expect(events.map((event) => event.type)).toEqual([WORKSPACE_RELINK_REQUESTED_EVENT]);
    expect(events[0]?.payload).toMatchObject({
      instanceId,
      projectId: PROJECT_B,
      title: 'Mua cáp Anten',
      replacesWorkItemId: 'wi-src',
      requestedBy: approver.userId,
      workItem: { parentId: 'wi-parent' },
    });
    expect(events[0]?.payload).not.toHaveProperty('submitterUserId');
    expect(events.some((event) => event.type === WORKSPACE_LINK_REQUESTED_EVENT)).toBe(false);
  });

  it('Workspace đổi xong: hồ sơ mang liên kết mới, tên theo mã mới, người tạo được báo', async () => {
    const { application, store, startFromWorkItem, read } = await setup();
    const instanceId = await startFromWorkItem();
    await application.relinkWorkspace(approver, instanceId, { projectId: PROJECT_B, projectCode: 'HN' });

    const before = (await store.read(TENANT)).instances;
    await application.applyWorkspaceLinkResult(TENANT, {
      instanceId,
      linked: { workItemId: 'wi-new', workItemCode: 'CV009', projectCode: 'HN', projectName: 'Trạm Hà Nội' },
    });
    const after = (await store.read(TENANT)).instances;
    const linked = await read(instanceId);
    expect(linked.workspaceLink).toMatchObject({
      status: 'linked',
      projectId: PROJECT_B,
      projectName: 'Trạm Hà Nội',
      workItemId: 'wi-new',
      workItemCode: 'CV009',
    });
    expect(linked.workspaceLink?.replacesWorkItemId).toBeUndefined();
    expect(linked.title).toBe('HN-CV009-Mua cáp Anten');
    // Nguồn giữ nguyên để tra cứu; bản chụp dự án cũ vẫn còn nhưng liên kết mới được ưu tiên.
    expect(linked).toMatchObject({ sourceType: 'workspace_work_item', sourceId: 'wi-src' });

    const notices = procedureNotificationEvents(before, after).filter(
      (event) => event.type === PROCEDURE_INSTANCE_RELINKED,
    );
    expect(notices).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          instanceId,
          projectCode: 'HN',
          projectName: 'Trạm Hà Nội',
          workItemCode: 'CV009',
          actorName: approver.displayName,
          recipientUserIds: [initiator.userId],
          actorUserId: approver.userId,
        }),
      }),
    ]);

    // Đổi tiếp lần nữa: công việc bị thay giờ là công việc mới, không phải công việc nguồn đã xoá.
    const again = await application.relinkWorkspace(initiator, instanceId, { projectId: PROJECT_A, projectCode: 'EVN' });
    expect(again.workspaceLink).toMatchObject({ replacesWorkItemId: 'wi-new', baseTitle: 'Mua cáp Anten' });
  });

  it('người tạo tự đổi thì không tự báo cho mình; Workspace từ chối thì quay về công việc nguồn, không báo', async () => {
    const { application, store, startFromWorkItem, read } = await setup();
    const instanceId = await startFromWorkItem();
    await application.relinkWorkspace(initiator, instanceId, { projectId: PROJECT_B, projectCode: 'HN' });
    let before = (await store.read(TENANT)).instances;
    await application.applyWorkspaceLinkResult(TENANT, { instanceId, rejected: 'Không thuộc dự án HN' });
    let after = (await store.read(TENANT)).instances;
    const restored = await read(instanceId);
    expect(restored.workspaceLink).toBeUndefined();
    expect(restored.workspaceProject).toMatchObject({ projectId: PROJECT_A, projectCode: 'EVN' });
    expect(restored.title).toBe('EVN-CV013-Mua cáp Anten');
    expect(restored.activity[0]).toMatchObject({ action: 'relink', comment: 'Không thuộc dự án HN' });
    expect(procedureNotificationEvents(before, after).some((event) => event.type === PROCEDURE_INSTANCE_RELINKED)).toBe(
      false,
    );

    await application.relinkWorkspace(initiator, instanceId, { projectId: PROJECT_B, projectCode: 'HN' });
    before = (await store.read(TENANT)).instances;
    await application.applyWorkspaceLinkResult(TENANT, {
      instanceId,
      linked: { workItemId: 'wi-new', workItemCode: 'CV009', projectCode: 'HN' },
    });
    after = (await store.read(TENANT)).instances;
    expect(procedureNotificationEvents(before, after).some((event) => event.type === PROCEDURE_INSTANCE_RELINKED)).toBe(
      false,
    );
  });

  it('phiếu tài chính hạch toán cho công việc mới sau khi đổi, không cho công việc nguồn đã xoá', async () => {
    const { application, startFromWorkItem, read } = await setup();
    const instanceId = await startFromWorkItem();
    const step = (instance: ProcedureInstance) =>
      ({ ...instance.steps[0], integration: { module: 'finance', voucherKind: 'payment' } }) as never;
    const source = await read(instanceId);
    expect(buildFinanceVoucherRequestedPayload(source, step(source)).workItemId).toBe('wi-src');
    await application.relinkWorkspace(approver, instanceId, { projectId: PROJECT_B, projectCode: 'HN' });
    await application.applyWorkspaceLinkResult(TENANT, {
      instanceId,
      linked: { workItemId: 'wi-new', workItemCode: 'CV009', projectCode: 'HN' },
    });
    const moved = await read(instanceId);
    expect(buildFinanceVoucherRequestedPayload(moved, step(moved))).toMatchObject({
      workItemId: 'wi-new',
      projectId: PROJECT_B,
    });
  });
});

describe('workspaceInstanceBaseTitle', () => {
  const instance = (title: string, projectCode?: string) =>
    ({
      title,
      sourceType: 'workspace_work_item',
      ...(projectCode ? { workspaceProject: { projectId: PROJECT_A, projectCode } } : {}),
    }) as Pick<ProcedureInstance, 'title' | 'sourceType' | 'workspaceProject'>;

  it('bỏ mã dự án và mã công việc đã ghép; tên có gạch nối vẫn giữ nguyên phần sau', () => {
    expect(workspaceInstanceBaseTitle(instance('EVN-CV013-Mua cáp Anten', 'EVN'))).toBe('Mua cáp Anten');
    expect(workspaceInstanceBaseTitle(instance('EVN-CV013-Cáp 2-3 lõi', 'EVN'))).toBe('Cáp 2-3 lõi');
  });

  it('không chắc thì giữ nguyên tên: không có dự án, tên đã sửa, hồ sơ nguồn khác', () => {
    expect(workspaceInstanceBaseTitle(instance('EVN-CV013-Mua cáp'))).toBe('EVN-CV013-Mua cáp');
    expect(workspaceInstanceBaseTitle(instance('Đã đổi tên', 'EVN'))).toBe('Đã đổi tên');
    expect(
      workspaceInstanceBaseTitle({ title: 'EVN-CV013-Mua cáp', sourceType: 'manual', workspaceProject: undefined }),
    ).toBe('EVN-CV013-Mua cáp');
  });
});
