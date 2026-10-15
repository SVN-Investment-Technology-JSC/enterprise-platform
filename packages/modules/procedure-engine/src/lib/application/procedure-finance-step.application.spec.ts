import type {
  CreateProcedureDefinitionRequest,
  CreateProcedureStepInput,
  ProcedureDefinition,
  ProcedureFinanceCapabilities,
  ProcedureInstance,
  ProcedureRaciRole,
} from '@enterprise-platform/contracts-procedure-engine';
import type { ProcedureActor } from '../domain/procedure-authorization.js';
import { financeStepEvents } from '../domain/procedure-finance-step.js';
import { InMemoryProcedureStore } from '../infrastructure/in-memory-procedure-store.js';
import type { FinanceIntegrationResolver } from './finance-integration.port.js';
import { ProcedureFinanceEvents } from './finance-step-events.js';
import type { InitiatorActorResolver } from './initiator-actor.port.js';
import { ProcedureEngineApplication } from './procedure-engine.application.js';
import type { ProcedureClock, ProcedureIdGenerator } from './procedure-store.port.js';

class FixedClock implements ProcedureClock {
  now(): Date {
    return new Date('2026-10-15T08:00:00.000Z');
  }
}

class SequentialIds implements ProcedureIdGenerator {
  private value = 0;
  next(): string {
    this.value += 1;
    return `id-${this.value.toString().padStart(5, '0')}`;
  }
}

class FakeFinance implements FinanceIntegrationResolver {
  failing = false;
  kinds: ProcedureFinanceCapabilities['voucherKinds'] = ['PAYMENT', 'RECEIPT'];
  async capabilities(): Promise<ProcedureFinanceCapabilities> {
    if (this.failing) throw new Error('Tài chính không phản hồi');
    return { voucherKinds: this.kinds };
  }
}

const ACCOUNTANT_POSITION = 'pos-ke-toan';

function person(userId: string, extra: Partial<ProcedureActor> = {}): ProcedureActor {
  return {
    tenantId: 'tenant-finance',
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
const requester = person('nv-de-nghi');
const manager = person('truong-phong');
const accountant = person('ke-toan-1', { positionIds: [ACCOUNTANT_POSITION] });
const colleague = person('ke-toan-2', { positionIds: [ACCOUNTANT_POSITION] });
const outsider = person('nguoi-ngoai');

/** Sơ đồ tổ chức giả: Quy trình đọc chức danh HIỆN TẠI của người được hỏi. */
class FakeOrganization implements InitiatorActorResolver {
  readonly people = new Map([accountant, colleague, outsider, requester, manager].map((item) => [item.userId, item]));
  async resolve(_tenantId: string, userId: string): Promise<ProcedureActor | null> {
    return this.people.get(userId) ?? null;
  }
}

function assign(role: ProcedureRaciRole, subjectId: string, subjectType: 'user' | 'position' = 'user') {
  return { role, subjectType, subjectId, subjectLabel: subjectType === 'position' ? 'Kế toán thanh toán' : subjectId };
}

function step(
  key: string,
  order: number,
  name: string,
  assignments: CreateProcedureStepInput['assignments'],
  extra: Partial<CreateProcedureStepInput> = {},
): CreateProcedureStepInput {
  return { key, order, name, assignments, ...extra };
}

/** Đề nghị thanh toán → Trưởng phòng duyệt → Chi tiền (bước Tài chính). */
function paymentInput(override: Partial<Record<'financeStep' | 'extraSteps', CreateProcedureStepInput[]>> = {}): CreateProcedureDefinitionRequest {
  const financeStep =
    override.financeStep ??
    [
      step('CHI_TIEN', 3, 'Chi tiền', [assign('R', ACCOUNTANT_POSITION, 'position'), assign('I', requester.userId)], {
        integration: { module: 'finance', action: 'voucher', voucherKind: 'PAYMENT', returnToStepId: 'DE_NGHI' },
      }),
    ];
  return {
    code: 'DE-NGHI-TT',
    name: 'Đề nghị thanh toán',
    kind: 'process',
    category: 'finance',
    attributes: [{ id: '', code: 'so_tien', name: 'Số tiền đề nghị', type: 'money', required: true }],
    steps: [
      step('DE_NGHI', 1, 'Lập đề nghị', [assign('S', requester.userId)], {
        attributes: [
          { id: '', code: 'nguoi_nop_nhan', name: 'Người nhận', type: 'text', required: false },
          { id: '', code: 'noi_dung', name: 'Nội dung', type: 'text', required: false },
        ],
      }),
      step('DUYET', 2, 'Trưởng phòng duyệt', [assign('A', manager.userId)]),
      ...financeStep,
      ...(override.extraSteps ?? []),
    ],
  };
}

function setup(options: { finance?: FakeFinance | null } = {}) {
  const store = new InMemoryProcedureStore();
  const finance = options.finance === null ? undefined : options.finance ?? new FakeFinance();
  const application = new ProcedureEngineApplication(
    store,
    new FixedClock(),
    new SequentialIds(),
    undefined,
    undefined,
    undefined,
    new FakeOrganization(),
    undefined,
    finance,
  );
  return { store, application, finance };
}

async function publish(application: ProcedureEngineApplication, input: CreateProcedureDefinitionRequest) {
  const draft = await application.createDefinition(designer, input);
  return application.publishDefinition(designer, draft.id);
}

const current = (instance: ProcedureInstance) => instance.steps.find((item) => item.id === instance.currentStepId);
const stepKey = (definition: ProcedureDefinition, key: string) => definition.steps.find((item) => item.key === key)?.id ?? '';

/** Mở hồ sơ, nhập số tiền và người nhận, trưởng phòng duyệt → hồ sơ đứng ở bước Chi tiền. */
async function reachFinanceStep(application: ProcedureEngineApplication, definition: ProcedureDefinition, key = 'a') {
  const started = await application.startInstance(requester, {
    definitionId: definition.id,
    title: 'Thanh toán tiền điện tháng 10',
    idempotencyKey: `start-${key}`,
  });
  await application.applyAction(requester, started.id, {
    action: 'complete',
    idempotencyKey: `submit-${key}`,
    attributeValues: {
      'process:so_tien': { type: 'money', value: 12_500_000 },
      [`step:${stepKey(definition, 'DE_NGHI')}:nguoi_nop_nhan`]: { type: 'text', value: 'Công ty Điện lực' },
    },
  });
  return application.applyAction(manager, started.id, { action: 'approve', idempotencyKey: `approve-${key}` });
}

describe('Bước Tài chính — công bố', () => {
  it('công bố được và đổi mã bước nhận hồ sơ khi trả về sang id', async () => {
    const { application } = setup();
    const definition = await publish(application, paymentInput());
    const finance = definition.steps.find((item) => item.key === 'CHI_TIEN');
    expect(definition.status).toBe('published');
    expect(finance?.integration).toEqual({
      module: 'finance',
      action: 'voucher',
      voucherKind: 'PAYMENT',
      returnToStepId: stepKey(definition, 'DE_NGHI'),
    });
  });

  it('chặn công bố khi Tài chính không phản hồi hoặc chưa cấu hình kết nối', async () => {
    const failing = new FakeFinance();
    failing.failing = true;
    const down = setup({ finance: failing });
    const draft = await down.application.createDefinition(designer, paymentInput());
    await expect(down.application.publishDefinition(designer, draft.id)).rejects.toThrow('không phản hồi');

    const missing = setup({ finance: null });
    const other = await missing.application.createDefinition(designer, paymentInput());
    await expect(missing.application.publishDefinition(designer, other.id)).rejects.toThrow('Chưa cấu hình kết nối');
  });

  it('chặn công bố khi Tài chính chưa nhận loại phiếu', async () => {
    const finance = new FakeFinance();
    finance.kinds = ['RECEIPT'];
    const { application } = setup({ finance });
    const draft = await application.createDefinition(designer, paymentInput());
    await expect(application.publishDefinition(designer, draft.id)).rejects.toThrow('phiếu chi');
  });

  it('bước Tài chính phải là bước có hành động cuối cùng', async () => {
    const { application } = setup();
    const draft = await application.createDefinition(
      designer,
      paymentInput({ extraSteps: [step('NGHIEM_THU', 4, 'Nghiệm thu', [assign('A', manager.userId)])] }),
    );
    const report = await application.inspectDefinition(designer, draft.id);
    expect(report.errors.map((issue) => issue.message).join('\n')).toContain('bước có hành động cuối cùng');
    await expect(application.publishDefinition(designer, draft.id)).rejects.toThrow('bước có hành động cuối cùng');
  });

  it('một đường đi chỉ có một bước Tài chính', async () => {
    const { application } = setup();
    const second = step('CHI_TIEN_2', 4, 'Chi tiền đợt 2', [assign('R', ACCOUNTANT_POSITION, 'position')], {
      integration: { module: 'finance', action: 'voucher', voucherKind: 'PAYMENT' },
    });
    const draft = await application.createDefinition(designer, paymentInput({ extraSteps: [second] }));
    const report = await application.inspectDefinition(designer, draft.id);
    expect(report.errors.map((issue) => issue.message).join('\n')).toContain('chỉ được có một bước Tài chính');
  });

  it('thiếu thuộc tính số tiền, có vai ngoài R/I, hoặc bước trả về đứng sau thì không công bố được', async () => {
    const { application } = setup();
    const input = paymentInput({
      financeStep: [
        step('CHI_TIEN', 3, 'Chi tiền', [assign('R', ACCOUNTANT_POSITION, 'position'), assign('A', manager.userId)], {
          integration: { module: 'finance', action: 'voucher', voucherKind: 'PAYMENT', returnToStepId: 'CHI_TIEN' },
        }),
      ],
    });
    const draft = await application.createDefinition(designer, { ...input, attributes: [] });
    const messages = (await application.inspectDefinition(designer, draft.id)).errors.map((issue) => issue.message).join('\n');
    expect(messages).toContain('cần thuộc tính số tiền');
    expect(messages).toContain('chỉ được gán vai R và I');
    expect(messages).toContain('bước nhận hồ sơ khi trả về');
  });

  it('ánh xạ trỏ tới thuộc tính sai kiểu bị từ chối', async () => {
    const { application } = setup();
    const input = paymentInput({
      financeStep: [
        step('CHI_TIEN', 3, 'Chi tiền', [assign('R', ACCOUNTANT_POSITION, 'position')], {
          integration: {
            module: 'finance',
            action: 'voucher',
            voucherKind: 'PAYMENT',
            mapping: { amount: 'step:DE_NGHI:noi_dung' },
          },
        }),
      ],
    });
    const draft = await application.createDefinition(designer, input);
    const messages = (await application.inspectDefinition(designer, draft.id)).errors.map((issue) => issue.message).join('\n');
    expect(messages).toContain('không nhận thuộc tính kiểu này');
  });

  it('cảnh báo nhắc quyền ghi sổ bên Tài chính', async () => {
    const { application } = setup();
    const draft = await application.createDefinition(designer, paymentInput());
    const report = await application.inspectDefinition(designer, draft.id);
    expect(report.errors).toEqual([]);
    expect(report.warnings.map((issue) => issue.message).join('\n')).toContain('finance.payment.approve');
  });

  it('lưu nháp từ chối cấu hình tích hợp không hợp lệ', async () => {
    const { application } = setup();
    const input = paymentInput({
      financeStep: [
        step('CHI_TIEN', 3, 'Chi tiền', [assign('R', ACCOUNTANT_POSITION, 'position')], {
          integration: { module: 'finance', action: 'voucher', voucherKind: 'TRANSFER' as never },
        }),
      ],
    });
    await expect(application.createDefinition(designer, input)).rejects.toThrow('phiếu chi hoặc phiếu thu');
  });
});

describe('Bước Tài chính — lúc chạy', () => {
  it('tới bước thì mở lần kích hoạt 1 và phát yêu cầu kèm giá trị hồ sơ', async () => {
    const { application, store } = setup();
    const definition = await publish(application, paymentInput());
    const before = (await store.read(requester.tenantId)).instances;
    const instance = await reachFinanceStep(application, definition);
    const after = (await store.read(requester.tenantId)).instances;

    expect(current(instance)?.key).toBe('CHI_TIEN');
    expect(current(instance)?.financeVoucher).toMatchObject({ activation: 1, state: 'requested' });

    const events = financeStepEvents(before, after);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('procedure.step.finance_voucher_requested');
    expect(events[0]?.payload).toMatchObject({
      instanceId: instance.id,
      stepInstanceId: current(instance)?.id,
      activation: 1,
      voucherKind: 'PAYMENT',
      values: {
        amount: 12_500_000,
        counterpartyName: 'Công ty Điện lực',
        content: null,
        counterpartyAccountNo: null,
        counterpartyBank: null,
        voucherDate: null,
      },
      initiatedBy: requester.userId,
      initiatedByName: requester.displayName,
      assigneeIds: [],
      assigneeSubjects: [{ subjectType: 'position', subjectId: ACCOUNTANT_POSITION, subjectLabel: 'Kế toán thanh toán' }],
      assigneeLabel: 'Kế toán thanh toán',
    });
    // Ghi lại hồ sơ mà bước không kích hoạt lại thì không phát lần nữa.
    expect(financeStepEvents(after, after)).toEqual([]);
  });

  it('không ai hoàn thành được bước bằng tay, kể cả quản trị; vẫn trả về được', async () => {
    const { application } = setup();
    const definition = await publish(application, paymentInput());
    const instance = await reachFinanceStep(application, definition);

    const byAccountant = await application.getInstance(accountant, instance.id);
    expect(byAccountant.authorization?.availableActions).not.toContain('complete');
    const byAdmin = await application.getInstance(designer, instance.id);
    expect(byAdmin.authorization?.availableActions).not.toContain('complete');
    expect(byAdmin.authorization?.availableActions).not.toContain('approve');
    expect(byAdmin.authorization?.availableActions).toContain('return');

    await expect(
      application.applyAction(accountant, instance.id, { action: 'complete', idempotencyKey: 'force' }),
    ).rejects.toThrow('không cho phép');
  });

  it('kích hoạt lại sau khi trả về thì tăng activation và giữ phiếu cũ', async () => {
    const { application, store } = setup();
    const definition = await publish(application, paymentInput());
    const first = await reachFinanceStep(application, definition);
    const firstStart = first.steps.find((item) => item.key === 'DE_NGHI')?.id ?? '';
    await application.applyAction(designer, first.id, {
      action: 'return',
      returnToStepId: firstStart,
      idempotencyKey: 'return-1',
    });
    await application.applyAction(requester, first.id, {
      action: 'complete',
      idempotencyKey: 'submit-again',
      attributeValues: { 'process:so_tien': { type: 'money', value: 11_000_000 } },
    });
    const before = (await store.read(requester.tenantId)).instances;
    const again = await application.applyAction(manager, first.id, { action: 'approve', idempotencyKey: 'approve-again' });
    const events = financeStepEvents(before, (await store.read(requester.tenantId)).instances);

    expect(current(again)?.financeVoucher).toMatchObject({ activation: 2, state: 'requested' });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.activation).toBe(2);
    expect(events[0]?.payload.values.amount).toBe(11_000_000);
  });
});

describe('Bước Tài chính — can-act', () => {
  async function ready() {
    const context = setup();
    const definition = await publish(context.application, paymentInput());
    const instance = await reachFinanceStep(context.application, definition);
    return { ...context, instance, stepId: current(instance)?.id ?? '' };
  }

  it('ai giữ chức danh phụ trách cũng ghi sổ được; người ngoài thì không', async () => {
    const { application, instance, stepId } = await ready();
    const ask = (userId: string) =>
      application.canActOnFinanceStepForService('tenant-finance', instance.id, stepId, { userId, activation: 1 });
    await expect(ask(accountant.userId)).resolves.toEqual({ allowed: true });
    await expect(ask(colleague.userId)).resolves.toEqual({ allowed: true });
    await expect(ask(outsider.userId)).resolves.toMatchObject({ allowed: false });
  });

  it('tính theo chức danh lúc hỏi: người vừa chuyển đi bị từ chối, người vừa bổ nhiệm được phép', async () => {
    const { application, instance, stepId } = await ready();
    const organization = (application as unknown as { initiatorActors: FakeOrganization }).initiatorActors;
    organization.people.set(colleague.userId, { ...colleague, positionIds: [] });
    organization.people.set(outsider.userId, { ...outsider, positionIds: [ACCOUNTANT_POSITION] });
    const ask = (userId: string) =>
      application.canActOnFinanceStepForService('tenant-finance', instance.id, stepId, { userId, activation: 1 });
    await expect(ask(colleague.userId)).resolves.toMatchObject({ allowed: false });
    await expect(ask(outsider.userId)).resolves.toEqual({ allowed: true });
  });

  it('người được uỷ quyền vai R được phép', async () => {
    const { application, instance, stepId } = await ready();
    await application.delegate(accountant, instance.id, { delegatedTo: requester.userId, stepInstanceId: stepId });
    await expect(
      application.canActOnFinanceStepForService('tenant-finance', instance.id, stepId, {
        userId: requester.userId,
        activation: 1,
      }),
    ).resolves.toEqual({ allowed: true, viaDelegation: true });
  });

  it('activation cũ, bước không phải bước Tài chính, hay đầu vào sai đều bị từ chối', async () => {
    const { application, instance, stepId } = await ready();
    await expect(
      application.canActOnFinanceStepForService('tenant-finance', instance.id, stepId, {
        userId: accountant.userId,
        activation: 2,
      }),
    ).resolves.toMatchObject({ allowed: false, reason: expect.stringContaining('lần kích hoạt cũ') });
    const otherStep = instance.steps.find((item) => item.key === 'DUYET')?.id ?? '';
    await expect(
      application.canActOnFinanceStepForService('tenant-finance', instance.id, otherStep, {
        userId: accountant.userId,
        activation: 1,
      }),
    ).resolves.toMatchObject({ allowed: false });
    await expect(
      application.canActOnFinanceStepForService('tenant-finance', instance.id, stepId, {
        userId: '',
        activation: 1,
      }),
    ).rejects.toThrow('userId');
  });
});

describe('Bước Tài chính — kết quả từ Tài chính', () => {
  async function ready() {
    const context = setup();
    const definition = await publish(context.application, paymentInput());
    const instance = await reachFinanceStep(context.application, definition);
    const stepId = current(instance)?.id ?? '';
    const events = new ProcedureFinanceEvents(context.application);
    const reload = async () => (await context.store.read('tenant-finance')).instances.find((item) => item.id === instance.id) as ProcedureInstance;
    const base = { instanceId: instance.id, stepInstanceId: stepId, activation: 1, voucherId: 'voucher-1' };
    return { ...context, definition, instance, stepId, events, reload, base };
  }

  it('linked: ghi mã phiếu vào bước, bước vẫn chờ', async () => {
    const { events, reload, base } = await ready();
    await events.handle('tenant-finance', 'finance.voucher.linked', {
      ...base,
      code: 'NHAP_PC_2610_0001',
      status: 'DRAFT',
      amount: 12_500_000,
    });
    const after = await reload();
    expect(current(after)?.financeVoucher).toMatchObject({
      activation: 1,
      state: 'linked',
      voucherId: 'voucher-1',
      code: 'NHAP_PC_2610_0001',
      amount: 12_500_000,
    });
    expect(after.status).toBe('running');
  });

  it('posted: đóng bước với người ghi sổ, hồ sơ hoàn tất, nhật ký ghi đúng người', async () => {
    const { events, reload, base, stepId } = await ready();
    await events.handle('tenant-finance', 'finance.voucher.posted', {
      ...base,
      code: 'PC-2610-0001',
      amount: 12_500_000,
      postedAt: '2026-10-15T08:00:00.000Z',
      postedBy: accountant.userId,
      postedByName: 'Kế toán 1',
    });
    const after = await reload();
    const finance = after.steps.find((item) => item.id === stepId);
    expect(finance?.status).toBe('completed');
    expect(finance?.financeVoucher).toMatchObject({ state: 'posted', code: 'PC-2610-0001', postedBy: accountant.userId });
    expect(after.status).toBe('completed');
    const entry = after.activity.find((item) => item.summary.includes('Đã ghi sổ PC-2610-0001'));
    expect(entry).toMatchObject({ actorId: accountant.userId, actorName: 'Kế toán 1', action: 'complete' });
    expect(after.activity.some((item) => item.summary.startsWith('Cảnh báo'))).toBe(false);
  });

  it('posted bởi người không phụ trách bước: vẫn áp kết quả, nhật ký có cảnh báo', async () => {
    const { events, reload, base } = await ready();
    await events.handle('tenant-finance', 'finance.voucher.posted', {
      ...base,
      code: 'PC-2610-0002',
      amount: 12_500_000,
      postedAt: '2026-10-15T08:00:00.000Z',
      postedBy: outsider.userId,
      postedByName: 'Người ngoài',
    });
    const after = await reload();
    expect(after.status).toBe('completed');
    expect(after.activity.some((item) => item.summary.startsWith('Cảnh báo: Người ngoài ghi sổ PC-2610-0002'))).toBe(true);
  });

  it('returned: trả về bước đã cấu hình kèm lý do; kích hoạt lại thì sự kiện của lần cũ bị bỏ qua', async () => {
    const { application, events, reload, base, stepId } = await ready();
    await events.handle('tenant-finance', 'finance.voucher.returned', {
      ...base,
      reason: 'Thiếu hoá đơn',
      actorId: colleague.userId,
      actorName: 'Kế toán 2',
    });
    const returned = await reload();
    expect(current(returned)?.key).toBe('DE_NGHI');
    expect(returned.steps.find((item) => item.id === stepId)?.financeVoucher).toMatchObject({
      state: 'returned',
      returnedReason: 'Thiếu hoá đơn',
    });
    const entry = returned.activity.find((item) => item.action === 'return' && item.actorId === colleague.userId);
    expect(entry?.comment).toBe('Thiếu hoá đơn');

    // Người lập sửa, trưởng phòng duyệt lại → bước Tài chính kích hoạt lần 2.
    await application.applyAction(requester, returned.id, { action: 'complete', idempotencyKey: 'submit-2' });
    await application.applyAction(manager, returned.id, { action: 'approve', idempotencyKey: 'approve-2' });
    const again = await reload();
    expect(current(again)?.financeVoucher).toMatchObject({ activation: 2, state: 'requested', voucherId: 'voucher-1' });

    // Kết quả muộn của lần kích hoạt 1 không được đóng bước của lần 2.
    await events.handle('tenant-finance', 'finance.voucher.posted', {
      ...base,
      code: 'PC-2610-0003',
      amount: 1,
      postedAt: '2026-10-15T08:00:00.000Z',
      postedBy: accountant.userId,
    });
    const stale = await reload();
    expect(stale.status).toBe('running');
    expect(current(stale)?.financeVoucher).toMatchObject({ activation: 2, state: 'requested' });
  });

  it('sự kiện trùng lặp chỉ áp một lần', async () => {
    const { events, reload, base } = await ready();
    const posted = {
      ...base,
      code: 'PC-2610-0004',
      amount: 12_500_000,
      postedAt: '2026-10-15T08:00:00.000Z',
      postedBy: accountant.userId,
      postedByName: 'Kế toán 1',
    };
    await events.handle('tenant-finance', 'finance.voucher.posted', posted);
    const once = await reload();
    await events.handle('tenant-finance', 'finance.voucher.posted', posted);
    await events.handle('tenant-finance', 'finance.voucher.returned', { ...base, reason: 'muộn', actorId: accountant.userId });
    const twice = await reload();
    expect(twice.activity).toHaveLength(once.activity.length);
    expect(twice.status).toBe('completed');
  });

  it('linked sau khi đã trả về cùng lần kích hoạt thì bỏ qua; payload thiếu trường thì bỏ qua', async () => {
    const { events, reload, base } = await ready();
    await events.handle('tenant-finance', 'finance.voucher.returned', { ...base, reason: 'Sai số tiền', actorId: accountant.userId });
    const before = await reload();
    await events.handle('tenant-finance', 'finance.voucher.linked', { ...base, code: 'X', status: 'DRAFT', amount: 1 });
    await events.handle('tenant-finance', 'finance.voucher.posted', { instanceId: base.instanceId });
    const after = await reload();
    expect(after).toEqual(before);
  });

  it('override vẫn bị chặn khi bước đang chờ Tài chính', async () => {
    const { application, instance } = await ready();
    await expect(
      application.applyAction(designer, instance.id, { action: 'approve', idempotencyKey: 'override' }),
    ).rejects.toThrow('không cho phép');
  });
});
