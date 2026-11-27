import type {
  CreateProcedureDefinitionRequest,
  ProcedureDefinitionBulkActions,
  ProcedureInstance,
  ProcedureRaciRole,
} from '@enterprise-platform/contracts-procedure-engine';
import type { ProcedureActor } from '../domain/procedure-authorization.js';
import { ProcedureEngineError } from '../domain/procedure-engine.error.js';
import { InMemoryProcedureStore } from '../infrastructure/in-memory-procedure-store.js';
import { ProcedureEngineApplication } from './procedure-engine.application.js';

/** Hồ sơ người dùng tự mở phải gắn dự án (luật bắt buộc chọn dự án). */
const TEST_WORKSPACE_LINK = { projectId: '0a0a0a0a-0000-4000-8000-00000000d001', projectCode: 'DA-TEST' };

function person(userId: string, extra: Partial<ProcedureActor> = {}): ProcedureActor {
  return {
    tenantId: 'tenant-bulk',
    userId,
    membershipId: userId,
    displayName: userId,
    canDesign: false,
    canPublish: false,
    canCreateInstances: true,
    isOverride: false,
    organizationUnitIds: [],
    positionIds: [],
    ...extra,
  };
}

const designer = person('designer', { canDesign: true, canPublish: true, isOverride: true });
const staff = person('nv');
const manager = person('ql');
const stranger = person('nguoi-ngoai');

const assign = (role: ProcedureRaciRole, userId: string) => ({ role, subjectType: 'user' as const, subjectId: userId });

function definitionInput(
  code: string,
  options: { bulkActions?: ProcedureDefinitionBulkActions; approvalNote?: boolean } = {},
): CreateProcedureDefinitionRequest {
  return {
    code,
    name: `Quy trình ${code}`,
    kind: 'process',
    category: 'technical',
    steps: [
      { key: 'LAP', order: 1, name: 'Lập đề nghị', assignments: [assign('S', staff.userId)] },
      { key: 'DUYET', order: 2, name: 'Quản lý duyệt', assignments: [assign('A', manager.userId)] },
    ],
    ...(options.approvalNote
      ? {
          attributes: [
            { id: '', code: 'y_kien', name: 'Ý kiến duyệt', type: 'text', required: true, entryStepKeys: ['DUYET'] },
          ],
        }
      : {}),
    ...(options.bulkActions ? { bulkActions: options.bulkActions } : {}),
  };
}

async function setup() {
  const store = new InMemoryProcedureStore();
  let id = 0;
  const application = new ProcedureEngineApplication(
    store,
    { now: () => new Date('2026-11-27T08:00:00.000Z') },
    { next: () => `id-${(id += 1).toString().padStart(5, '0')}` },
  );
  const publish = async (input: CreateProcedureDefinitionRequest) =>
    application.publishDefinition(designer, (await application.createDefinition(designer, input)).id);
  const bulk = await publish(definitionInput('BULK', { bulkActions: { approve: true, reject: true } }));
  const plain = await publish(definitionInput('PLAIN'));
  const noted = await publish(definitionInput('NOTED', { bulkActions: { approve: true }, approvalNote: true }));
  let key = 0;
  /** Mở hồ sơ; `submitted` thì người lập đã hoàn tất bước S, hồ sơ chờ quản lý duyệt. */
  const open = async (definitionId: string, submitted = true) => {
    const instance = await application.startInstance(staff, {
      workspaceLink: TEST_WORKSPACE_LINK,
      definitionId,
      title: `Hồ sơ ${(key += 1)}`,
      idempotencyKey: `start-${key}`,
    });
    if (submitted) {
      await application.applyAction(staff, instance.id, { action: 'complete', idempotencyKey: `submit-${key}` });
    }
    return instance;
  };
  const read = async (instanceId: string) =>
    (await store.read('tenant-bulk')).instances.find((item) => item.id === instanceId) as ProcedureInstance;
  return { application, store, bulk, plain, noted, open, read };
}

describe('Cài đặt thao tác hàng loạt của quy trình', () => {
  it('mặc định tắt; tạo / sửa / công bố / sửa lại giữ đúng cài đặt, chỉ giữ cờ đang bật', async () => {
    const { application } = await setup();
    const off = await application.createDefinition(designer, definitionInput('OFF'));
    expect(off.bulkActions).toBeUndefined();

    const draft = await application.createDefinition(
      designer,
      definitionInput('ON', { bulkActions: { approve: true, reject: false } }),
    );
    expect(draft.bulkActions).toEqual({ approve: true });

    // Sửa nháp không gửi trường này: giữ nguyên (client cũ không làm mất cài đặt).
    const kept = await application.updateDefinition(designer, draft.id, { steps: definitionInput('ON').steps });
    expect(kept.bulkActions).toEqual({ approve: true });
    const both = await application.updateDefinition(designer, draft.id, {
      steps: definitionInput('ON').steps,
      bulkActions: { approve: true, reject: true },
    });
    expect(both.bulkActions).toEqual({ approve: true, reject: true });

    const published = await application.publishDefinition(designer, draft.id);
    expect(published.bulkActions).toEqual({ approve: true, reject: true });
    const revised = await application.reviseDefinition(designer, draft.id);
    expect(revised.bulkActions).toEqual({ approve: true, reject: true });
    const republished = await application.publishDefinition(designer, draft.id);
    expect(republished.bulkActions).toEqual({ approve: true, reject: true });

    const cleared = await application.updateDefinition(designer, (await application.reviseDefinition(designer, draft.id)).id, {
      steps: definitionInput('ON').steps,
      bulkActions: {},
    });
    expect(cleared.bulkActions).toBeUndefined();
  });

  it('đổi được trên quy trình đã công bố bằng đường riêng; chỉ người thiết kế', async () => {
    const { application, plain } = await setup();
    const enabled = await application.setDefinitionBulkActions(designer, plain.id, { reject: true });
    expect(enabled).toMatchObject({ status: 'published', bulkActions: { reject: true } });
    const disabled = await application.setDefinitionBulkActions(designer, plain.id, null);
    expect(disabled.bulkActions).toBeUndefined();
    await expect(application.setDefinitionBulkActions(manager, plain.id, { approve: true })).rejects.toBeInstanceOf(
      ProcedureEngineError,
    );
  });
});

describe('POST v1/instances/bulk-action', () => {
  it('lô hỗn hợp: chỉ duyệt hồ sơ đủ điều kiện, còn lại bỏ qua kèm lý do; hồ sơ không xem được không lộ mã', async () => {
    const { application, bulk, plain, noted, open, read } = await setup();
    const ready = await open(bulk.id);
    const disabled = await open(plain.id);
    const notYet = await open(bulk.id, false);
    const needsInput = await open(noted.id);

    const result = await application.bulkApplyAction(manager, {
      action: 'approve',
      instanceIds: [ready.id, disabled.id, notYet.id, needsInput.id, 'khong-co', ready.id],
      idempotencyKey: 'bulk-1',
    });

    expect(result.done).toEqual([{ id: ready.id, code: ready.code }]);
    expect(result.skipped).toEqual([
      { id: disabled.id, code: disabled.code, reason: 'bulk_disabled', message: 'Quy trình này không cho duyệt hàng loạt.' },
      { id: notYet.id, code: notYet.code, reason: 'not_your_turn', message: 'Chưa tới lượt bạn xử lý bước hiện tại.' },
      {
        id: needsInput.id,
        code: needsInput.code,
        reason: 'input_required',
        message: 'Cần nhập: Ý kiến duyệt; hãy mở hồ sơ để xử lý.',
      },
      { id: 'khong-co', code: null, reason: 'not_found', message: 'Không tìm thấy hồ sơ.' },
    ]);
    expect((await read(ready.id)).status).toBe('completed');
    for (const id of [disabled.id, notYet.id, needsInput.id]) expect((await read(id)).status).toBe('running');

    const hidden = await application.bulkApplyAction(stranger, {
      action: 'approve',
      instanceIds: [disabled.id],
      idempotencyKey: 'bulk-x',
    });
    expect(hidden.skipped).toEqual([{ id: disabled.id, code: null, reason: 'not_found', message: 'Không tìm thấy hồ sơ.' }]);
  });

  it('duyệt hàng loạt đổi trạng thái y như duyệt từng hồ sơ', async () => {
    const { application, bulk, open, read } = await setup();
    const single = await open(bulk.id);
    const batched = await open(bulk.id);
    await application.applyAction(manager, single.id, { action: 'approve', idempotencyKey: 'single-1' });
    await application.bulkApplyAction(manager, { action: 'approve', instanceIds: [batched.id], idempotencyKey: 'b' });

    const shape = (instance: ProcedureInstance) => ({
      status: instance.status,
      currentStepId: instance.currentStepId ? 'có' : 'không',
      steps: instance.steps.map((step) => [step.key, step.status, step.currentRoleStage]),
      activity: instance.activity.map((entry) => [entry.action, entry.actorId, entry.summary]),
      progress: instance.progress,
    });
    expect(shape(await read(batched.id))).toEqual(shape(await read(single.id)));
    expect((await read(batched.id)).activity[0]).toMatchObject({ action: 'approve', idempotencyKey: `action:bulk:b:${batched.id}` });
  });

  it('pha thực hiện (S) dùng hoàn tất; người lập gửi hàng loạt hồ sơ của mình', async () => {
    const { application, bulk, open, read } = await setup();
    const draft = await open(bulk.id, false);
    const result = await application.bulkApplyAction(staff, { action: 'approve', instanceIds: [draft.id], idempotencyKey: 's' });
    expect(result.done).toHaveLength(1);
    const after = await read(draft.id);
    expect(after.activity[0].action).toBe('complete');
    expect(after.steps.find((step) => step.key === 'DUYET')?.status).toBe('ready');
  });

  it('gọi lại cùng khoá không xử lý hai lần, vẫn báo đã xong', async () => {
    const { application, bulk, open, read } = await setup();
    const draft = await open(bulk.id, false);
    const input = { action: 'approve' as const, instanceIds: [draft.id], idempotencyKey: 'retry' };
    await application.bulkApplyAction(staff, input);
    const activity = (await read(draft.id)).activity.length;
    const again = await application.bulkApplyAction(staff, input);
    expect(again).toEqual({ done: [{ id: draft.id, code: draft.code }], skipped: [] });
    expect((await read(draft.id)).activity).toHaveLength(activity);
    // Khoá khác là lần bấm mới: hồ sơ đã sang pha của quản lý nên không còn lượt của người lập.
    const fresh = await application.bulkApplyAction(staff, { ...input, idempotencyKey: 'retry-2' });
    expect(fresh.skipped[0]?.reason).toBe('not_your_turn');
  });

  it('không duyệt bắt buộc lý do; có lý do thì từ chối từng hồ sơ kèm lý do', async () => {
    const { application, bulk, plain, open, read } = await setup();
    const first = await open(bulk.id);
    const second = await open(bulk.id);
    const disabled = await open(plain.id);
    await expect(
      application.bulkApplyAction(manager, { action: 'reject', instanceIds: [first.id], idempotencyKey: 'r0', comment: '  ' }),
    ).rejects.toMatchObject({ code: 'validation', message: 'Cần nhập lý do không duyệt.' });
    expect((await read(first.id)).status).toBe('running');

    const result = await application.bulkApplyAction(manager, {
      action: 'reject',
      instanceIds: [first.id, second.id, disabled.id],
      comment: 'Sai đơn giá',
      idempotencyKey: 'r1',
    });
    expect(result.done.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(result.skipped).toEqual([
      expect.objectContaining({ id: disabled.id, reason: 'bulk_disabled', message: 'Quy trình này không cho không duyệt (huỷ) hàng loạt.' }),
    ]);
    for (const id of [first.id, second.id]) {
      const instance = await read(id);
      expect(instance.status).toBe('rejected');
      expect(instance.activity[0]).toMatchObject({ action: 'reject', comment: 'Sai đơn giá' });
    }
  });

  it('quyền can thiệp của quản trị không tính là tới lượt', async () => {
    const { application, bulk, open } = await setup();
    const ready = await open(bulk.id);
    const result = await application.bulkApplyAction(designer, { action: 'approve', instanceIds: [ready.id], idempotencyKey: 'a' });
    expect(result.skipped[0]?.reason).toBe('not_your_turn');
  });

  it('yêu cầu sai: thao tác lạ, thiếu khoá, rỗng, quá 50 hồ sơ', async () => {
    const { application } = await setup();
    const call = (input: unknown) =>
      application.bulkApplyAction(manager, input as Parameters<ProcedureEngineApplication['bulkApplyAction']>[1]);
    await expect(call({ action: 'return', instanceIds: ['a'], idempotencyKey: 'k' })).rejects.toMatchObject({ code: 'validation' });
    await expect(call({ action: 'approve', instanceIds: ['a'] })).rejects.toMatchObject({ code: 'validation' });
    await expect(call({ action: 'approve', instanceIds: [], idempotencyKey: 'k' })).rejects.toMatchObject({ code: 'validation' });
    const many = Array.from({ length: 51 }, (_, index) => `id-${index}`);
    await expect(call({ action: 'approve', instanceIds: many, idempotencyKey: 'k' })).rejects.toMatchObject({
      code: 'validation',
      message: 'Mỗi lần chỉ xử lý được tối đa 50 hồ sơ.',
    });
  });
});
