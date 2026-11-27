import type {
  CreateProcedureDefinitionRequest,
  ProcedureInstance,
} from '@enterprise-platform/contracts-procedure-engine';
import { canDeleteProcedureInstance, type ProcedureActor } from '../domain/procedure-authorization.js';
import { REPLACE_REASON_DISABLED, replaceableInstanceReason } from '../domain/procedure-replace.js';
import { INSTANCE_DELETED_EVENT, workspaceLinkEvents } from '../domain/procedure-workspace-link.js';
import { InMemoryProcedureStore } from '../infrastructure/in-memory-procedure-store.js';
import { procedureNotificationEvents } from '../infrastructure/procedure-notification-events.js';
import { shouldMirrorAttachment } from './procedure-attachment.service.js';
import { ProcedureEngineApplication } from './procedure-engine.application.js';
import { DEFAULT_PROCEDURE_ENGINE_SETTINGS, type ProcedureEngineSettings } from './workspace-link-settings.js';

/**
 * Cài đặt `engine*` của nhóm "Công việc gắn quy trình": mỗi cài đặt được thực thi ở module Quy trình, mặc định
 * giữ nguyên hành vi cũ, và chỉ áp cho hồ sơ gắn Workspace.
 */

const TENANT = 'tenant-a';
const WORK_ITEM = 'wi-1';
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
const approver = person('approver');
const people = ['initiator', 'approver', 'approver-b', 'viewer', 'stranger'].map(person);

function definition(
  code: string,
  options: { starter?: 'everyone' | string; approver?: string } = {},
): CreateProcedureDefinitionRequest {
  const starter = options.starter ?? 'initiator';
  return {
    code,
    name: `Quy trình ${code}`,
    kind: 'process',
    category: 'technical',
    steps: [
      {
        key: 'REQUEST',
        order: 1,
        name: 'Lập đề nghị',
        assignments: [
          starter === 'everyone'
            ? { role: 'S', subjectType: 'everyone', subjectId: 'everyone' }
            : { role: 'S', subjectType: 'user', subjectId: starter },
        ],
      },
      {
        key: 'APPROVE',
        order: 2,
        name: 'Phê duyệt',
        assignments: [{ role: 'A', subjectType: 'user', subjectId: options.approver ?? 'approver' }],
      },
    ],
  };
}

type Overrides = Partial<ProcedureEngineSettings>;

async function setup(overrides: Overrides | 'throws' = {}, options: { attachments?: number } = {}) {
  const store = new InMemoryProcedureStore();
  let id = 0;
  const reader =
    overrides === 'throws'
      ? {
          get: async () => {
            throw new Error('Workspace tắt');
          },
        }
      : { get: async () => ({ ...DEFAULT_PROCEDURE_ENGINE_SETTINGS, ...overrides }) };
  const application = new ProcedureEngineApplication(
    store,
    { now: () => new Date('2026-10-21T08:00:00.000Z') },
    { next: () => `id-${(id += 1).toString().padStart(4, '0')}` },
    undefined,
    { countForSubtask: async () => 0, countForInstance: async () => options.attachments ?? 0 },
    undefined,
    { resolve: async (_tenant, userId) => people.find((candidate) => candidate.userId === userId) ?? null },
    undefined,
    undefined,
    reader,
  );
  const publish = async (input: CreateProcedureDefinitionRequest) =>
    application.publishDefinition(admin, (await application.createDefinition(admin, input)).id);
  const oldDefinition = await publish(definition('OLD'));
  const newDefinition = await publish(definition('NEW', { approver: 'approver-b' }));
  const openDefinition = await publish(definition('OPEN', { starter: 'everyone' }));

  const startFor = (requestedBy: string, definitionId: string, workItemId = WORK_ITEM) =>
    application.startForWorkspaceWorkItem(TENANT, {
      workItemId,
      workItemCode: 'CV-001',
      projectId: '11111111-1111-4111-8111-111111111111',
      projectCode: 'EVN',
      title: 'Mua cáp',
      definitionId,
      requestedBy,
      requestedByName: requestedBy,
      requestedByIsTenantAdmin: requestedBy === 'admin',
    });
  const started = await startFor('initiator', oldDefinition.id);
  if (!started.ok) throw new Error(started.reason);
  const oldId = started.instance.id;
  const request = (extra: Record<string, unknown> = {}) => ({
    expectedInstanceId: oldId,
    definitionId: newDefinition.id,
    requestedBy: 'initiator',
    requestedByName: 'initiator',
    requestedByIsTenantAdmin: false,
    workItemCode: 'CV-001',
    workItemTitle: 'Mua cáp',
    projectCode: 'EVN',
    ...extra,
  });
  const instances = async () => (await store.read(TENANT)).instances;
  const mutateOld = (change: (instance: ProcedureInstance) => void) =>
    store.transaction(TENANT, (state) => {
      change(state.instances.find((item) => item.id === oldId) as ProcedureInstance);
    });
  const complete = async () => {
    await application.applyAction(initiator, oldId, { action: 'complete', idempotencyKey: 'k-c' });
    await application.applyAction(approver, oldId, { action: 'approve', idempotencyKey: 'k-a' });
  };
  return {
    application,
    store,
    oldId,
    oldDefinition,
    newDefinition,
    openDefinition,
    request,
    instances,
    mutateOld,
    complete,
    startFor,
  };
}

describe('engineChangeEligibility: khi nào được đổi quy trình', () => {
  it('mặc định (untouched): có trao đổi thì bị chặn như cũ', async () => {
    const { application, oldId, request } = await setup();
    await application.postComment(initiator, oldId, { body: 'Xin chào', idempotencyKey: 'c1' });
    const outcome = await application.replaceWorkspaceWorkItemInstance(TENANT, WORK_ITEM, request());
    expect(outcome.ok).toBe(false);
  });

  it('no_step_handled: đổi được dù có trao đổi, dữ liệu nhập và tệp đính kèm', async () => {
    const { application, oldId, request, mutateOld } = await setup(
      { engineChangeEligibility: 'no_step_handled' },
      { attachments: 2 },
    );
    await application.postComment(initiator, oldId, { body: 'Xin chào', idempotencyKey: 'c1' });
    await mutateOld((instance) => void (instance.attributeValues = { soLuong: 3 } as never));
    const outcome = await application.replaceWorkspaceWorkItemInstance(TENANT, WORK_ITEM, request());
    expect(outcome.ok).toBe(true);
  });

  it('no_step_handled: vẫn chặn khi có bước hoàn thành hoặc có giữ chỗ vật tư', async () => {
    const stepDone = await setup({ engineChangeEligibility: 'no_step_handled' });
    await stepDone.application.applyAction(initiator, stepDone.oldId, { action: 'complete', idempotencyKey: 'k1' });
    const handled = await stepDone.application.replaceWorkspaceWorkItemInstance(TENANT, WORK_ITEM, stepDone.request());
    expect(handled).toMatchObject({ ok: false, reason: expect.stringContaining('hoàn thành, trả về hoặc từ chối') });

    const reserved = await setup({ engineChangeEligibility: 'no_step_handled' });
    await reserved.mutateOld((instance) => void (instance.steps[0].materialReservations = ['RSV-1']));
    const materials = await reserved.application.replaceWorkspaceWorkItemInstance(TENANT, WORK_ITEM, reserved.request());
    expect(materials).toMatchObject({ ok: false, reason: expect.stringContaining('giữ chỗ hoặc đặt vật tư') });
  });

  it('never: từ chối kể cả với quản trị', async () => {
    const { application, instances, request } = await setup({ engineChangeEligibility: 'never' });
    const outcome = await application.replaceWorkspaceWorkItemInstance(
      TENANT,
      WORK_ITEM,
      request({ requestedBy: 'admin', requestedByIsTenantAdmin: true }),
    );
    expect(outcome).toEqual({ ok: false, reason: REPLACE_REASON_DISABLED });
    expect(await instances()).toHaveLength(1);
  });

  it('Workspace tắt (reader ném lỗi): dùng mặc định, hành vi cũ', async () => {
    const { application, oldId, request } = await setup('throws');
    await application.postComment(initiator, oldId, { body: 'Xin chào', idempotencyKey: 'c1' });
    expect((await application.replaceWorkspaceWorkItemInstance(TENANT, WORK_ITEM, request())).ok).toBe(false);
  });

  it('domain: bảng mode x tình huống', async () => {
    const { application, oldId, instances } = await setup();
    await application.postComment(initiator, oldId, { body: 'Xin chào', idempotencyKey: 'c1' });
    const instance = (await instances()).find((item) => item.id === oldId) as ProcedureInstance;
    expect(replaceableInstanceReason(instance)).toContain('trao đổi');
    expect(replaceableInstanceReason(instance, 'untouched')).toContain('trao đổi');
    expect(replaceableInstanceReason(instance, 'no_step_handled')).toBeUndefined();
    expect(replaceableInstanceReason(instance, 'never')).toBe(REPLACE_REASON_DISABLED);
    expect(replaceableInstanceReason({ ...instance, status: 'completed' } as ProcedureInstance, 'never')).toContain(
      'đã kết thúc',
    );
  });
});

describe('engineChangeWho: ai được đổi quy trình', () => {
  it('approver_admin: người tạo hồ sơ không giữ vai A bị chặn, quản trị đổi được', async () => {
    const { application, request } = await setup({ engineChangeWho: 'approver_admin' });
    const byCreator = await application.replaceWorkspaceWorkItemInstance(TENANT, WORK_ITEM, request());
    expect(byCreator).toEqual({
      ok: false,
      reason: 'Chỉ người phê duyệt (vai A) hoặc quản trị mới đổi được quy trình.',
    });
    const byAdmin = await application.replaceWorkspaceWorkItemInstance(
      TENANT,
      WORK_ITEM,
      request({ requestedBy: 'admin', requestedByIsTenantAdmin: true }),
    );
    expect(byAdmin.ok).toBe(true);
  });

  it('admin_only: người giữ vai A cũng bị chặn', async () => {
    const { application, request } = await setup({ engineChangeWho: 'admin_only' });
    const byApprover = await application.replaceWorkspaceWorkItemInstance(
      TENANT,
      WORK_ITEM,
      request({ requestedBy: 'approver', requestedByName: 'approver' }),
    );
    expect(byApprover).toEqual({ ok: false, reason: 'Chỉ quản trị mới đổi được quy trình.' });
  });
});

describe('engineChangeOldInstanceFate: hồ sơ cũ sau khi đổi', () => {
  it('mặc định (delete): xoá mềm có dấu thay thế', async () => {
    const { application, oldId, request, instances } = await setup();
    const outcome = await application.replaceWorkspaceWorkItemInstance(TENANT, WORK_ITEM, request());
    expect(outcome.ok).toBe(true);
    const old = (await instances()).find((item) => item.id === oldId);
    expect(old?.deletion?.replacedByInstanceId).toBeDefined();
    expect(old?.replacedByInstanceId).toBeUndefined();
  });

  it('cancel_keep: hồ sơ cũ Đã huỷ, không xoá mềm, ghi hồ sơ thay thế; vẫn hiện trong danh sách', async () => {
    const { application, store, oldId, request, instances } = await setup({
      engineChangeOldInstanceFate: 'cancel_keep',
    });
    const before = (await store.read(TENANT)).instances;
    const outcome = await application.replaceWorkspaceWorkItemInstance(TENANT, WORK_ITEM, request());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const after = await instances();
    const old = after.find((item) => item.id === oldId);
    expect(old).toMatchObject({ status: 'cancelled', replacedByInstanceId: outcome.instance.id });
    expect(old?.deletion).toBeUndefined();
    expect(old?.activity[0]).toMatchObject({ action: 'cancel' });
    expect((await application.getWorkspace(initiator)).instances.map((item) => item.id)).toContain(oldId);
    // Không phát sự kiện xoá công việc.
    expect(workspaceLinkEvents(before, after).map((event) => event.type)).not.toContain(INSTANCE_DELETED_EVENT);
    // Sự kiện hồ sơ đóng mang dấu thay thế để Workspace bỏ qua.
    const closed = procedureNotificationEvents(before, after).find(
      (event) => event.type === 'procedure.instance.completed' && event.aggregateId === oldId,
    );
    expect(closed?.payload).toMatchObject({ replacedByInstanceId: outcome.instance.id, status: 'cancelled' });
    // Gọi lại cùng khoá vẫn trả hồ sơ mới.
    const again = await application.replaceWorkspaceWorkItemInstance(TENANT, WORK_ITEM, request());
    expect(again.ok && again.instance.id === outcome.instance.id).toBe(true);
    // Hồ sơ cũ không đổi tiếp được nữa.
    expect(replaceableInstanceReason(old as ProcedureInstance)).toContain('đã bị xoá hoặc đã được thay');
  });
});

describe('engineStartWithoutOrgChart: người tạo chưa có trong sơ đồ tổ chức', () => {
  it('block (mặc định): chặn người không có trong sơ đồ, quản trị được qua', async () => {
    const { startFor, openDefinition } = await setup();
    expect(await startFor('la-mat', openDefinition.id, 'wi-2')).toMatchObject({
      ok: false,
      reason: expect.stringContaining('chưa có trong sơ đồ tổ chức'),
    });
    expect((await startFor('admin', openDefinition.id, 'wi-3')).ok).toBe(true);
  });

  it('allow_if_role_matches: mở được nếu vai S là mọi người; không thì báo thiếu vai S', async () => {
    const { startFor, openDefinition, oldDefinition } = await setup({ engineStartWithoutOrgChart: 'allow_if_role_matches' });
    expect((await startFor('la-mat', openDefinition.id, 'wi-2')).ok).toBe(true);
    expect(await startFor('la-mat', oldDefinition.id, 'wi-3')).toMatchObject({
      ok: false,
      reason: expect.stringContaining('vai S'),
    });
    expect((await startFor('admin', oldDefinition.id, 'wi-4')).ok).toBe(true);
  });
});

describe('engineDeleteLinkedWho: ai được xoá hồ sơ gắn công việc', () => {
  it('mặc định: người tạo xoá được trước khi có duyệt; người giữ vai A xoá được', async () => {
    const first = await setup();
    await first.application.deleteInstance(initiator, first.oldId, { reason: 'Nhập nhầm' });
    const second = await setup();
    await second.application.deleteInstance(approver, second.oldId, { reason: 'Nhập nhầm' });
  });

  it('approver_admin: người tạo bị chặn, người giữ vai A và quản trị xoá được', async () => {
    const { application, oldId } = await setup({ engineDeleteLinkedWho: 'approver_admin' });
    await expect(application.deleteInstance(initiator, oldId, { reason: 'Nhập nhầm' })).rejects.toMatchObject({
      code: 'forbidden',
    });
    await application.deleteInstance(approver, oldId, { reason: 'Nhập nhầm' });
  });

  it('admin_only: người giữ vai A bị chặn, quản trị xoá được', async () => {
    const { application, oldId } = await setup({ engineDeleteLinkedWho: 'admin_only' });
    await expect(application.deleteInstance(approver, oldId, { reason: 'Nhập nhầm' })).rejects.toMatchObject({
      code: 'forbidden',
      message: 'Chỉ quản trị mới xoá được hồ sơ gắn công việc.',
    });
    await application.deleteInstance(admin, oldId, { reason: 'Nhập nhầm' });
  });

  it('cờ canDelete gửi cho giao diện theo đúng cài đặt', async () => {
    const { application, oldId } = await setup({ engineDeleteLinkedWho: 'admin_only' });
    const viewed = await application.getInstance(approver, oldId);
    expect(viewed.authorization?.canDelete).toBe(false);
    expect((await application.getInstance(admin, oldId)).authorization?.canDelete).toBe(true);
  });

  it('domain: hồ sơ không gắn Workspace bỏ qua mode', () => {
    const instance = {
      status: 'running',
      sourceType: 'hrm_request',
      initiatedBy: 'initiator',
      activity: [],
      steps: [],
    } as unknown as ProcedureInstance;
    expect(canDeleteProcedureInstance(instance, initiator, 'admin_only')).toBe(true);
    expect(
      canDeleteProcedureInstance({ ...instance, sourceType: 'workspace_work_item' } as ProcedureInstance, initiator, 'admin_only'),
    ).toBe(false);
  });
});

describe('engineReverseWho, engineReverseStatuses: huỷ hiệu lực', () => {
  it('mặc định: người giữ vai A bị chặn, quản trị huỷ hiệu lực được', async () => {
    const { application, oldId, complete } = await setup();
    await complete();
    await expect(
      application.reverseInstance(approver, oldId, { reason: 'Sai số liệu', createAdjustment: false }),
    ).rejects.toMatchObject({ code: 'forbidden', message: 'Chỉ quản trị mới huỷ hiệu lực được hồ sơ.' });
    const reversed = await application.reverseInstance(admin, oldId, { reason: 'Sai số liệu', createAdjustment: false });
    expect(reversed.status).toBe('reversed');
  });

  it('admin_or_approver: người giữ vai A được; người không có vai thì không', async () => {
    const { application, oldId, complete } = await setup({ engineReverseWho: 'admin_or_approver' });
    await complete();
    await expect(
      application.reverseInstance(person('stranger'), oldId, { reason: 'Sai số liệu', createAdjustment: false }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const reversed = await application.reverseInstance(approver, oldId, { reason: 'Sai số liệu', createAdjustment: false });
    expect(reversed.status).toBe('reversed');
  });

  it('completed_only: hồ sơ gắn Workspace bị từ chối không huỷ hiệu lực được; mặc định thì được', async () => {
    const strict = await setup({ engineReverseStatuses: 'completed_only' });
    await strict.mutateOld((instance) => void (instance.status = 'rejected'));
    await expect(
      strict.application.reverseInstance(admin, strict.oldId, { reason: 'Mở lại', createAdjustment: false }),
    ).rejects.toMatchObject({ code: 'conflict', message: 'Chỉ huỷ hiệu lực được hồ sơ đã hoàn thành.' });

    const lenient = await setup();
    await lenient.mutateOld((instance) => void (instance.status = 'rejected'));
    const reversed = await lenient.application.reverseInstance(admin, lenient.oldId, {
      reason: 'Mở lại',
      createAdjustment: false,
    });
    expect(reversed.status).toBe('reversed');
  });
});

describe('engineReasonRequired: lý do xoá / huỷ hiệu lực', () => {
  it('required (mặc định): lý do ngắn bị từ chối', async () => {
    const { application, oldId } = await setup();
    await expect(application.deleteInstance(initiator, oldId, { reason: 'ab' })).rejects.toMatchObject({
      code: 'validation',
    });
  });

  it('optional: hồ sơ gắn Workspace để trống lý do được, lý do mặc định được ghi', async () => {
    const { application, store, oldId } = await setup({ engineReasonRequired: 'optional' });
    await application.deleteInstance(initiator, oldId, { reason: '' });
    const stored = (await store.read(TENANT)).instances.find((item) => item.id === oldId);
    expect(stored?.deletion?.reason).toBe('Không ghi lý do.');
    expect(stored?.activity[0]).toMatchObject({ comment: 'Không ghi lý do.' });
  });

  it('optional: huỷ hiệu lực để trống lý do được', async () => {
    const { application, oldId, complete } = await setup({ engineReasonRequired: 'optional' });
    await complete();
    const reversed = await application.reverseInstance(admin, oldId, { reason: '  ', createAdjustment: false });
    expect(reversed.reversal?.reason).toBe('Không ghi lý do.');
  });

  it('optional: hồ sơ không gắn Workspace vẫn bắt buộc lý do', async () => {
    const store = new InMemoryProcedureStore();
    let id = 0;
    const application = new ProcedureEngineApplication(
      store,
      { now: () => new Date('2026-10-21T08:00:00.000Z') },
      { next: () => `id-${(id += 1).toString().padStart(4, '0')}` },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { get: async () => ({ ...DEFAULT_PROCEDURE_ENGINE_SETTINGS, engineReasonRequired: 'optional' as const }) },
    );
    const published = await application.publishDefinition(
      admin,
      (await application.createDefinition(admin, definition('PLAIN'))).id,
    );
    // Hồ sơ không gắn Workspace giờ chỉ đến từ module khác (người dùng tự mở thì bắt buộc chọn dự án).
    const started = await application.createInstance(TENANT, {
      definitionId: published.id,
      title: 'Hồ sơ thường',
      idempotencyKey: 'plain-1',
      sourceType: 'maintenance_occurrence',
      sourceId: 'occ-1',
    });
    await expect(application.deleteInstance(admin, started.id, { reason: '' })).rejects.toMatchObject({
      code: 'validation',
    });
  });
});

describe('engineAttachmentMirror: tệp đính kèm sang công việc', () => {
  const instance = {
    steps: [
      { id: 'a', order: 1 },
      { id: 'b', order: 2 },
      { id: 'c', order: 3 },
    ],
  };
  it('all: mọi tệp; none: không tệp nào', () => {
    expect(shouldMirrorAttachment(instance, { step_instance_id: 'a' }, 'all')).toBe(true);
    expect(shouldMirrorAttachment(instance, { step_instance_id: null }, 'all')).toBe(true);
    expect(shouldMirrorAttachment(instance, { step_instance_id: 'c' }, 'none')).toBe(false);
  });
  it('final_step_only: chỉ tệp của bước cuối; tệp hệ thống / bổ sung không gắn bước thì không', () => {
    expect(shouldMirrorAttachment(instance, { step_instance_id: 'c' }, 'final_step_only')).toBe(true);
    expect(shouldMirrorAttachment(instance, { step_instance_id: 'a' }, 'final_step_only')).toBe(false);
    expect(shouldMirrorAttachment(instance, { step_instance_id: null }, 'final_step_only')).toBe(false);
  });
});
