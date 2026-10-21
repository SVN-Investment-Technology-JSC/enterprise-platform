import type { CreateProcedureDefinitionRequest } from '@enterprise-platform/contracts-procedure-engine';
import type { ProcedureActor } from '../domain/procedure-authorization.js';
import {
  INSTANCE_DELETED_EVENT,
  WORKSPACE_RELINK_REQUESTED_EVENT,
  workspaceLinkEvents,
} from '../domain/procedure-workspace-link.js';
import { InMemoryProcedureStore } from '../infrastructure/in-memory-procedure-store.js';
import { ProcedureEngineApplication } from './procedure-engine.application.js';

const base = {
  tenantId: 'tenant-a',
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
const admin: ProcedureActor = {
  ...person('admin'),
  canDesign: true,
  canPublish: true,
  isOverride: true,
};
const initiator = person('initiator');
const approver = person('approver');
const viewer = person('viewer');
const consultant = person('consultant');

const PROJECT_A = '11111111-1111-4111-8111-111111111111';
const PROJECT_B = '22222222-2222-4222-8222-222222222222';

function definitionInput(options: { consult?: boolean } = {}): CreateProcedureDefinitionRequest {
  return {
    code: 'PROC-DEL',
    name: 'Quy trình kiểm thử xoá',
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
          ...(options.consult
            ? [{ role: 'C' as const, subjectType: 'user' as const, subjectId: consultant.userId }]
            : []),
          { role: 'A', subjectType: 'user', subjectId: approver.userId },
        ],
      },
    ],
  };
}

async function setup(options: { linked?: boolean; consult?: boolean } = {}) {
  const store = new InMemoryProcedureStore();
  let id = 0;
  const application = new ProcedureEngineApplication(
    store,
    { now: () => new Date('2026-10-21T08:00:00.000Z') },
    { next: () => `id-${(id += 1).toString().padStart(4, '0')}` },
  );
  const draft = await application.createDefinition(admin, definitionInput(options));
  const published = await application.publishDefinition(admin, draft.id);
  const started = await application.startInstance(initiator, {
    definitionId: published.id,
    title: 'Đề nghị mua cáp',
    idempotencyKey: 'start-del',
    ...(options.linked
      ? { workspaceLink: { projectId: PROJECT_A, projectCode: 'EVN', workItem: {} } }
      : {}),
  });
  if (options.linked) {
    await application.applyWorkspaceLinkResult('tenant-a', {
      instanceId: started.id,
      linked: { workItemId: 'wi-old', workItemCode: 'CV001', projectCode: 'EVN' },
    });
  }
  return { application, store, instanceId: started.id };
}

describe('Xoá đơn (xoá mềm)', () => {
  it('người giữ vai A (hoặc quản trị) xoá được; người xem thì không; bắt buộc lý do', async () => {
    const { application, instanceId } = await setup();
    await expect(application.deleteInstance(approver, instanceId, { reason: '' })).rejects.toMatchObject({
      code: 'validation',
    });
    await expect(
      application.deleteInstance(viewer, instanceId, { reason: 'Nhập nhầm' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await application.deleteInstance(approver, instanceId, { reason: 'Nhập nhầm' });
  });

  it('đơn đang chạy được huỷ trước rồi biến mất với mọi người, kể cả quản trị', async () => {
    const { application, store, instanceId } = await setup();
    await application.deleteInstance(approver, instanceId, { reason: 'Nhập nhầm đơn' });

    const stored = (await store.read('tenant-a')).instances.find((item) => item.id === instanceId);
    expect(stored?.status).toBe('cancelled');
    expect(stored?.deletion).toMatchObject({ deletedBy: approver.userId, reason: 'Nhập nhầm đơn' });
    expect(stored?.activity[0]).toMatchObject({ action: 'delete', comment: 'Nhập nhầm đơn' });

    for (const who of [admin, initiator, approver]) {
      expect((await application.getWorkspace(who)).instances.map((item) => item.id)).not.toContain(
        instanceId,
      );
      await expect(application.getInstance(who, instanceId)).rejects.toMatchObject({ code: 'not_found' });
    }
    await expect(
      application.deleteInstance(admin, instanceId, { reason: 'Xoá lần hai' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('đơn đã hoàn thành không xoá được', async () => {
    const { application, instanceId } = await setup();
    await application.applyAction(admin, instanceId, { action: 'complete', idempotencyKey: 'c1' });
    await application.applyAction(admin, instanceId, { action: 'approve', idempotencyKey: 'c2' });
    await expect(
      application.deleteInstance(admin, instanceId, { reason: 'Không cần nữa' }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('xoá đơn gắn dự án phát procedure.instance.deleted kèm công việc liên kết', async () => {
    const { application, store, instanceId } = await setup({ linked: true });
    const before = (await store.read('tenant-a')).instances;
    await application.deleteInstance(approver, instanceId, { reason: 'Sai dự án' });
    const after = (await store.read('tenant-a')).instances;
    const deleted = workspaceLinkEvents(before, after).find((event) => event.type === INSTANCE_DELETED_EVENT);
    expect(deleted?.payload).toMatchObject({ instanceId, workItemId: 'wi-old', reason: 'Sai dự án' });
  });
});

describe('Quyền theo đơn', () => {
  it('người xem (chỉ vai I) không xoá, không bổ sung tài liệu; người khởi tạo bổ sung được', async () => {
    const { application, instanceId } = await setup();
    const asViewer = await application.getInstance(viewer, instanceId);
    expect(asViewer.authorization).toMatchObject({ canDelete: false, canSupplement: false });
    const asInitiator = await application.getInstance(initiator, instanceId);
    // Người submit xoá được khi đơn chưa qua nút C/A nào.
    expect(asInitiator.authorization).toMatchObject({ canDelete: true, canSupplement: true });
    const asApprover = await application.getInstance(approver, instanceId);
    expect(asApprover.authorization).toMatchObject({ canDelete: true, canSupplement: true });
  });
});

describe('Đổi công việc liên kết', () => {
  it('người giữ vai A đổi được; Workspace từ chối thì giữ nguyên liên kết cũ', async () => {
    const { application, store, instanceId } = await setup({ linked: true });
    await expect(
      application.relinkWorkspace(initiator, instanceId, { projectId: PROJECT_B, projectCode: 'HN' }),
    ).rejects.toMatchObject({ code: 'forbidden' });

    const before = (await store.read('tenant-a')).instances;
    const pending = await application.relinkWorkspace(approver, instanceId, {
      projectId: PROJECT_B,
      projectCode: 'HN',
      parentId: 'wi-parent',
    });
    expect(pending.workspaceLink).toMatchObject({
      status: 'pending',
      projectId: PROJECT_B,
      replacesWorkItemId: 'wi-old',
      workItem: { parentId: 'wi-parent' },
      previous: { status: 'linked', workItemId: 'wi-old', projectId: PROJECT_A },
    });
    const after = (await store.read('tenant-a')).instances;
    const relink = workspaceLinkEvents(before, after).find(
      (event) => event.type === WORKSPACE_RELINK_REQUESTED_EVENT,
    );
    expect(relink?.payload).toMatchObject({ projectId: PROJECT_B, replacesWorkItemId: 'wi-old' });

    // Đang chờ Workspace: không gửi yêu cầu thứ hai.
    await expect(
      application.relinkWorkspace(approver, instanceId, { projectId: PROJECT_A, projectCode: 'EVN' }),
    ).rejects.toMatchObject({ code: 'forbidden' });

    await application.applyWorkspaceLinkResult('tenant-a', { instanceId, rejected: 'Không có quyền' });
    const restored = await application.getInstance(approver, instanceId);
    expect(restored.workspaceLink).toMatchObject({ status: 'linked', workItemId: 'wi-old', projectId: PROJECT_A });
    expect(restored.workspaceLink?.replacesWorkItemId).toBeUndefined();
  });

  it('Workspace tạo xong công việc mới thì liên kết trỏ sang công việc mới', async () => {
    const { application, instanceId } = await setup({ linked: true });
    await application.relinkWorkspace(approver, instanceId, { projectId: PROJECT_B, projectCode: 'HN' });
    await application.applyWorkspaceLinkResult('tenant-a', {
      instanceId,
      linked: { workItemId: 'wi-new', workItemCode: 'CV007', projectCode: 'HN' },
    });
    const linked = await application.getInstance(approver, instanceId);
    expect(linked.workspaceLink).toMatchObject({ status: 'linked', workItemId: 'wi-new', projectId: PROJECT_B });
    expect(linked.workspaceLink?.previous).toBeUndefined();
    expect(linked.title).toContain('HN-CV007');
  });
});

describe('Người submit xoá đơn', () => {
  it('xoá được trước khi nút C đầu tiên pass; sau đó thì không, kể cả khi đơn bị trả về', async () => {
    const { application, instanceId } = await setup({ consult: true });
    // Bước 1 (S) xong, đơn sang bước 2 ở nút C: chưa ai duyệt, người submit vẫn xoá được.
    await application.applyAction(initiator, instanceId, { action: 'complete', idempotencyKey: 's1' });
    expect((await application.getInstance(initiator, instanceId)).authorization?.canDelete).toBe(true);

    // Người tham vấn (C) duyệt: nút C đã pass.
    await application.applyAction(consultant, instanceId, { action: 'approve', idempotencyKey: 'c1' });
    expect((await application.getInstance(initiator, instanceId)).authorization?.canDelete).toBe(false);
    await expect(
      application.deleteInstance(initiator, instanceId, { reason: 'Không cần nữa' }),
    ).rejects.toMatchObject({ code: 'forbidden', message: expect.stringContaining('nút C/A') });

    // Người phê duyệt (A) trả về bước 1: lượt duyệt C vẫn tính, người submit vẫn không xoá được.
    await application.applyAction(approver, instanceId, { action: 'return', idempotencyKey: 'a1' });
    expect((await application.getInstance(initiator, instanceId)).authorization?.canDelete).toBe(false);

    // Người giữ vai A vẫn xoá được.
    await application.deleteInstance(approver, instanceId, { reason: 'Lập lại đơn khác' });
  });

  it('đơn chỉ có nút A: người submit xoá được cho tới khi A duyệt', async () => {
    const { application, instanceId } = await setup();
    await application.applyAction(initiator, instanceId, { action: 'complete', idempotencyKey: 's1' });
    await application.deleteInstance(initiator, instanceId, { reason: 'Nhập nhầm' });
    await expect(application.getInstance(initiator, instanceId)).rejects.toMatchObject({ code: 'not_found' });
  });
});
