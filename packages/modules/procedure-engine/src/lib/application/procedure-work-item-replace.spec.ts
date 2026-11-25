import type {
  CreateProcedureDefinitionRequest,
  ProcedureInstance,
} from '@enterprise-platform/contracts-procedure-engine';
import type { ProcedureActor } from '../domain/procedure-authorization.js';
import {
  REPLACE_REASON_ATTACHMENTS,
  replaceableInstanceReason,
} from '../domain/procedure-replace.js';
import {
  INSTANCE_DELETED_EVENT,
  STARTED_FOR_WORK_ITEM_EVENT,
  workspaceLinkEvents,
  workItemReplaceIdempotencyKey,
  type ReplaceWorkItemInstanceRequest,
} from '../domain/procedure-workspace-link.js';
import { InMemoryProcedureStore } from '../infrastructure/in-memory-procedure-store.js';
import { ProcedureEngineApplication } from './procedure-engine.application.js';

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
const people = ['initiator', 'approver', 'approver-b', 'viewer', 'stranger', 'other-starter'].map(person);

function definition(
  code: string,
  options: { starter?: string; approver?: string } = {},
): CreateProcedureDefinitionRequest {
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
          { role: 'S', subjectType: 'user', subjectId: options.starter ?? 'initiator' },
          { role: 'I', subjectType: 'user', subjectId: 'viewer' },
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

async function setup(options: { attachments?: number } = {}) {
  const store = new InMemoryProcedureStore();
  let id = 0;
  const application = new ProcedureEngineApplication(
    store,
    { now: () => new Date('2026-10-21T08:00:00.000Z') },
    { next: () => `id-${(id += 1).toString().padStart(4, '0')}` },
    undefined,
    {
      countForSubtask: async () => 0,
      countForInstance: async () => options.attachments ?? 0,
    },
    undefined,
    { resolve: async (_tenant, userId) => people.find((candidate) => candidate.userId === userId) ?? null },
  );
  const publish = async (input: CreateProcedureDefinitionRequest) =>
    application.publishDefinition(admin, (await application.createDefinition(admin, input)).id);
  const oldDefinition = await publish(definition('OLD'));
  const newDefinition = await publish(definition('NEW', { approver: 'approver-b' }));
  const foreignStartDefinition = await publish(definition('FOREIGN', { starter: 'other-starter' }));

  const started = await application.startForWorkspaceWorkItem(TENANT, {
    workItemId: WORK_ITEM,
    workItemCode: 'CV-001',
    projectId: '11111111-1111-4111-8111-111111111111',
    projectCode: 'EVN',
    title: 'Mua cáp',
    definitionId: oldDefinition.id,
    requestedBy: 'initiator',
    requestedByName: 'initiator',
    requestedByIsTenantAdmin: false,
  });
  if (!started.ok) throw new Error(started.reason);
  const request = (overrides: Partial<ReplaceWorkItemInstanceRequest> = {}): ReplaceWorkItemInstanceRequest => ({
    expectedInstanceId: started.instance.id,
    definitionId: newDefinition.id,
    requestedBy: 'initiator',
    requestedByName: 'initiator',
    requestedByIsTenantAdmin: false,
    workItemCode: 'CV-001',
    workItemTitle: 'Mua cáp',
    projectCode: 'EVN',
    ...overrides,
  });
  const instances = async () => (await store.read(TENANT)).instances;
  const mutateOld = (change: (instance: ProcedureInstance) => void) =>
    store.transaction(TENANT, (state) => {
      change(state.instances.find((item) => item.id === started.instance.id) as ProcedureInstance);
    });
  return {
    application,
    store,
    oldId: started.instance.id,
    oldDefinition,
    newDefinition,
    foreignStartDefinition,
    request,
    instances,
    mutateOld,
  };
}

describe('Đổi quy trình của công việc Workspace', () => {
  it('xoá mềm hồ sơ cũ có dấu thay thế, mở hồ sơ mới cho cùng công việc, không phát sự kiện xoá', async () => {
    const { application, store, oldId, newDefinition, request } = await setup();
    const before = (await store.read(TENANT)).instances;

    const outcome = await application.replaceWorkspaceWorkItemInstance(TENANT, WORK_ITEM, request());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.previous.id).toBe(oldId);
    expect(outcome.instance).toMatchObject({
      title: 'EVN-CV001-Mua cáp',
      status: 'running',
      definitionId: newDefinition.id,
    });

    const after = (await store.read(TENANT)).instances;
    const old = after.find((item) => item.id === oldId);
    const created = after.find((item) => item.id === outcome.instance.id);
    expect(old?.status).toBe('cancelled');
    expect(old?.deletion).toMatchObject({
      deletedBy: 'initiator',
      replacedByInstanceId: outcome.instance.id,
      reason: expect.stringContaining('Đổi quy trình sang'),
    });
    expect(created).toMatchObject({
      sourceType: 'workspace_work_item',
      sourceId: WORK_ITEM,
      initiatedBy: 'initiator',
      definitionId: newDefinition.id,
    });
    // Hồ sơ mới còn nguyên vẹn nên đổi tiếp được.
    expect(replaceableInstanceReason(created as ProcedureInstance)).toBeUndefined();

    const events = workspaceLinkEvents(before, after);
    expect(events.map((event) => event.type)).not.toContain(INSTANCE_DELETED_EVENT);
    expect(events).toEqual([
      expect.objectContaining({
        type: STARTED_FOR_WORK_ITEM_EVENT,
        aggregateId: outcome.instance.id,
        payload: expect.objectContaining({ workItemId: WORK_ITEM, instanceId: outcome.instance.id }),
      }),
    ]);
  });

  it('gọi lại cùng hồ sơ cũ trả đúng hồ sơ mới, không mở thêm', async () => {
    const { application, instances, request, oldId } = await setup();
    const first = await application.replaceWorkspaceWorkItemInstance(TENANT, WORK_ITEM, request());
    const second = await application.replaceWorkspaceWorkItemInstance(TENANT, WORK_ITEM, request());
    expect(first.ok && second.ok && first.instance.id === second.instance.id).toBe(true);
    expect(await instances()).toHaveLength(2);
    expect(workItemReplaceIdempotencyKey(WORK_ITEM, oldId)).toContain(':replace:');
  });

  it('gọi lại cùng hồ sơ cũ nhưng chọn quy trình khác thì báo đã bị đổi, không trả nhầm hồ sơ', async () => {
    const { application, instances, request, foreignStartDefinition } = await setup();
    await application.replaceWorkspaceWorkItemInstance(TENANT, WORK_ITEM, request());
    const stale = await application.replaceWorkspaceWorkItemInstance(
      TENANT,
      WORK_ITEM,
      request({ definitionId: foreignStartDefinition.id, requestedBy: 'admin', requestedByIsTenantAdmin: true }),
    );
    expect(stale.ok).toBe(false);
    expect(await instances()).toHaveLength(2);
  });

  it('quản trị đổi được dù không phải người tạo hồ sơ và không giữ vai S', async () => {
    const { application, request, foreignStartDefinition } = await setup();
    const outcome = await application.replaceWorkspaceWorkItemInstance(
      TENANT,
      WORK_ITEM,
      request({ requestedBy: 'admin', requestedByIsTenantAdmin: true, definitionId: foreignStartDefinition.id }),
    );
    expect(outcome.ok).toBe(true);
  });

  it('người giữ vai A qua được cửa quyền đổi, nhưng vẫn phải giữ vai S của quy trình mới', async () => {
    const { application, request } = await setup();
    const outcome = await application.replaceWorkspaceWorkItemInstance(
      TENANT,
      WORK_ITEM,
      request({ requestedBy: 'approver', requestedByName: 'approver' }),
    );
    // Người này giữ A nhưng chưa có vai S của quy trình mới: bị chặn ở vai S, không phải ở quyền đổi.
    expect(outcome).toEqual({ ok: false, reason: 'Bạn chưa được phân vai S để khởi tạo quy trình này.' });
  });

  describe('từ chối, không đổi gì', () => {
    async function rejected(
      setupOptions: { attachments?: number } = {},
      prepare?: (context: Awaited<ReturnType<typeof setup>>) => Promise<unknown>,
      overrides?: (context: Awaited<ReturnType<typeof setup>>) => Partial<ReplaceWorkItemInstanceRequest>,
      workItemId = WORK_ITEM,
    ) {
      const context = await setup(setupOptions);
      await prepare?.(context);
      const before = await context.instances();
      const outcome = await context.application.replaceWorkspaceWorkItemInstance(
        TENANT,
        workItemId,
        context.request(overrides?.(context)),
      );
      expect(outcome.ok).toBe(false);
      // Một giao dịch: từ chối thì hồ sơ cũ còn nguyên, không có hồ sơ mới.
      const after = await context.instances();
      expect(after).toHaveLength(before.length);
      expect(after.find((item) => item.id === context.oldId)?.deletion).toEqual(
        before.find((item) => item.id === context.oldId)?.deletion,
      );
      return outcome.ok ? '' : outcome.reason;
    }

    it('không thấy hồ sơ', async () => {
      expect(await rejected({}, undefined, () => ({ expectedInstanceId: 'khong-co' }))).toBe(
        'Không tìm thấy hồ sơ hiện tại của công việc.',
      );
    });

    it('hồ sơ thuộc công việc khác', async () => {
      expect(await rejected({}, undefined, undefined, 'wi-khac')).toBe(
        'Hồ sơ này không thuộc công việc đang đổi quy trình.',
      );
    });

    it('hồ sơ đã bị xoá / đã thay', async () => {
      const reason = await rejected({}, async ({ application, oldId }) =>
        application.deleteInstance(admin, oldId, { reason: 'Nhập nhầm' }),
      );
      expect(reason).toBe('Hồ sơ đã bị xoá hoặc đã được thay bằng hồ sơ khác.');
    });

    it('hồ sơ đã hoàn thành hoặc đã huỷ hiệu lực', async () => {
      for (const status of ['completed', 'reversed'] as const) {
        const reason = await rejected({}, ({ mutateOld }) =>
          mutateOld((instance) => {
            instance.status = status;
          }),
        );
        expect(reason).toContain('Hồ sơ đã kết thúc');
      }
    });

    it('quy trình mới trùng quy trình cũ', async () => {
      expect(await rejected({}, undefined, ({ oldDefinition }) => ({ definitionId: oldDefinition.id }))).toBe(
        'Quy trình mới trùng với quy trình của hồ sơ hiện tại.',
      );
    });

    it('quy trình mới không tồn tại', async () => {
      expect(await rejected({}, undefined, () => ({ definitionId: 'khong-co' }))).toBe('Không tìm thấy quy trình.');
    });

    it('người yêu cầu không phải người tạo, không giữ vai A, không phải quản trị', async () => {
      for (const who of ['viewer', 'stranger']) {
        const reason = await rejected({}, undefined, () => ({ requestedBy: who, requestedByName: who }));
        expect(reason).toContain('Chỉ người tạo hồ sơ');
      }
    });

    it('người yêu cầu không có trong sơ đồ tổ chức và không phải quản trị', async () => {
      expect(await rejected({}, undefined, () => ({ requestedBy: 'la-mat' }))).toContain('chưa có trong sơ đồ tổ chức');
    });

    it('người yêu cầu không giữ vai S của quy trình mới', async () => {
      expect(
        await rejected({}, undefined, ({ foreignStartDefinition }) => ({ definitionId: foreignStartDefinition.id })),
      ).toBe('Bạn chưa được phân vai S để khởi tạo quy trình này.');
    });

    it('hồ sơ đã có bước hoàn thành', async () => {
      const reason = await rejected({}, ({ application, oldId }) =>
        application.applyAction(person('initiator'), oldId, { action: 'complete', idempotencyKey: 'k1' }),
      );
      expect(reason).toContain('hoàn thành, trả về hoặc từ chối');
      expect(reason).toContain('hãy xoá hồ sơ ở module Quy trình');
    });

    it('hồ sơ đã có trao đổi', async () => {
      const reason = await rejected({}, ({ application, oldId }) =>
        application.postComment(person('initiator'), oldId, { body: 'Xin chào', idempotencyKey: 'c1' }),
      );
      expect(reason).toContain('trao đổi, duyệt hoặc bàn giao');
    });

    it('hồ sơ đã có tệp đính kèm', async () => {
      expect(await rejected({ attachments: 1 })).toBe(REPLACE_REASON_ATTACHMENTS);
    });

    it('hồ sơ đã giữ chỗ vật tư, có đơn vật tư, dữ liệu nhập hoặc dữ liệu module khác', async () => {
      const variants: [string, (instance: ProcedureInstance) => void][] = [
        ['giữ chỗ hoặc đặt vật tư', (instance) => void (instance.steps[0].materialReservations = ['RSV-1'])],
        [
          'giữ chỗ hoặc đặt vật tư',
          (instance) =>
            void (instance.materialOrders = [
              { code: 'MR-1', kind: 'issue', createdAt: '2026-10-21T08:00:00.000Z', lines: [] },
            ]),
        ],
        [
          'dữ liệu được nhập',
          (instance) =>
            void (instance.attributeValues = {
              'process:X': { value: { kind: 'text', text: 'a' }, enteredBy: 'initiator', enteredAt: 'x' },
            } as unknown as ProcedureInstance['attributeValues']),
        ],
        [
          'module khác',
          (instance) => void (instance.sourceSummary = { fields: [] } as unknown as ProcedureInstance['sourceSummary']),
        ],
      ];
      for (const [text, change] of variants) {
        expect(await rejected({}, ({ mutateOld }) => mutateOld(change))).toContain(text);
      }
    });

    it('hồ sơ đã có uỷ quyền', async () => {
      const reason = await rejected({}, ({ mutateOld }) =>
        mutateOld((instance) => {
          instance.delegations = [
            {
              id: 'd1',
              delegatedBy: 'initiator',
              delegatedByName: 'initiator',
              delegatedTo: 'viewer',
              roles: ['S'],
              createdAt: 'x',
            },
          ];
        }),
      );
      expect(reason).toContain('uỷ quyền');
    });
  });
});

describe('replaceableInstanceReason', () => {
  it('hồ sơ mới mở còn nguyên vẹn thì đổi được; bước thứ hai trở đi thì không', async () => {
    const { instances, application, oldId } = await setup();
    const fresh = (await instances()).find((item) => item.id === oldId) as ProcedureInstance;
    expect(replaceableInstanceReason(fresh)).toBeUndefined();

    await application.applyAction(person('initiator'), oldId, { action: 'complete', idempotencyKey: 'k1' });
    const moved = (await instances()).find((item) => item.id === oldId) as ProcedureInstance;
    expect(replaceableInstanceReason(moved)).toContain('Hồ sơ đã có bước được hoàn thành');

    const second = structuredClone(fresh);
    second.currentStepId = second.steps[1].id;
    expect(replaceableInstanceReason(second)).toContain('chuyển khỏi bước đầu tiên');
  });
});
