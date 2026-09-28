import type {
  CreateProcedureDefinitionRequest,
  CreateProcedureStepInput,
  ProcedureDefinition,
  ProcedureGatewayDefinition,
  ProcedureInstance,
  ProcedureRaciRole,
} from '@enterprise-platform/contracts-procedure-engine';
import type { ProcedureActor } from '../domain/procedure-authorization.js';
import { InMemoryProcedureStore } from '../infrastructure/in-memory-procedure-store.js';
import type { DirectManagerChain, DirectManagerResolver } from './direct-manager.port.js';
import { ProcedureEngineApplication } from './procedure-engine.application.js';
import type { ProcedureClock, ProcedureIdGenerator } from './procedure-store.port.js';

class FixedClock implements ProcedureClock {
  now(): Date {
    return new Date('2026-09-25T08:00:00.000Z');
  }
}

class SequentialIds implements ProcedureIdGenerator {
  private value = 0;
  next(): string {
    this.value += 1;
    return `id-${this.value.toString().padStart(5, '0')}`;
  }
}

class FakeManagers implements DirectManagerResolver {
  calls = 0;
  failing = false;
  result: DirectManagerChain = { chain: [] };
  async chain(): Promise<DirectManagerChain> {
    this.calls += 1;
    if (this.failing) throw new Error('Core không phản hồi');
    return this.result;
  }
}

function person(userId: string, extra: Partial<ProcedureActor> = {}): ProcedureActor {
  return {
    tenantId: 'tenant-branch',
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
const sales = person('nv-kd');
const headOfSales = person('tp-kd');
const deputy = person('pho-tgd');
const ceo = person('tgd');
const board = person('hdqt');
const director = person('giam-doc-kd');

function assign(role: ProcedureRaciRole, userId: string) {
  return { role, subjectType: 'user' as const, subjectId: userId };
}

function stepInput(
  key: string,
  order: number,
  name: string,
  assignments: CreateProcedureStepInput['assignments'],
  extra: Partial<CreateProcedureStepInput> = {},
): CreateProcedureStepInput {
  return { key, order, name, assignments, ...extra };
}

const MILLION = 1_000_000;
const BILLION = 1_000_000_000;

/**
 * Quy trình Duyệt báo giá: tạo báo giá → rẽ nhánh theo giá trị → một cấp duyệt →
 * hợp về "Gửi báo giá cho khách". Mốc biên theo khoảng nửa mở [từ; đến).
 */
function quoteInput(options: { defaultSteps?: boolean } = {}): CreateProcedureDefinitionRequest {
  const withDefaultStep = options.defaultSteps !== false;
  const value = { scope: 'step' as const, stepId: 'TAO_BG', code: 'gia_tri' };
  const gateway: ProcedureGatewayDefinition = {
    id: '',
    key: 'G_GIA_TRI',
    name: 'Theo giá trị báo giá',
    type: 'exclusive',
    afterStepId: 'TAO_BG',
    branches: [
      {
        id: '',
        key: 'DUOI_100TR',
        label: 'Dưới 100 triệu',
        isDefault: false,
        condition: { combinator: 'and', rules: [{ id: '', attribute: value, operator: 'lt', value: 100 * MILLION }] },
        stepIds: ['DUYET_TP'],
      },
      {
        id: '',
        key: 'DEN_1TY',
        label: 'Từ 100 triệu đến 1 tỷ',
        isDefault: false,
        condition: {
          combinator: 'and',
          rules: [{ id: '', attribute: value, operator: 'between', value: 100 * MILLION, valueTo: BILLION }],
        },
        stepIds: ['DUYET_PTGD'],
      },
      {
        id: '',
        key: 'DEN_10TY',
        label: 'Từ 1 tỷ đến 10 tỷ',
        isDefault: false,
        condition: {
          combinator: 'and',
          rules: [{ id: '', attribute: value, operator: 'between', value: BILLION, valueTo: 10 * BILLION }],
        },
        stepIds: ['DUYET_TGD'],
      },
      {
        id: '',
        key: 'NGUOC_LAI',
        label: 'Ngược lại',
        isDefault: true,
        stepIds: withDefaultStep ? ['DUYET_HDQT'] : [],
      },
    ],
  };
  const steps = [
    stepInput('TAO_BG', 1, 'Tạo báo giá', [assign('S', sales.userId)], {
      attributes: [{ id: '', code: 'gia_tri', name: 'Giá trị báo giá', type: 'money', required: true }],
    }),
    stepInput('DUYET_TP', 2, 'Trưởng phòng KD duyệt', [assign('A', headOfSales.userId)]),
    stepInput('DUYET_PTGD', 3, 'Phó TGĐ duyệt', [assign('A', deputy.userId)]),
    stepInput('DUYET_TGD', 4, 'TGĐ duyệt', [assign('A', ceo.userId)]),
    ...(withDefaultStep ? [stepInput('DUYET_HDQT', 5, 'HĐQT duyệt', [assign('A', board.userId)])] : []),
    stepInput('GUI_KH', 6, 'Gửi báo giá cho khách', [assign('R', sales.userId), assign('A', director.userId)]),
  ];
  return { code: 'DUYET-BAO-GIA', name: 'Duyệt báo giá', kind: 'process', category: 'sales', steps, gateways: [gateway] };
}

function setup(managers?: DirectManagerResolver) {
  const store = new InMemoryProcedureStore();
  const application = new ProcedureEngineApplication(
    store,
    new FixedClock(),
    new SequentialIds(),
    undefined,
    undefined,
    managers,
  );
  return { store, application };
}

async function publish(application: ProcedureEngineApplication, input: CreateProcedureDefinitionRequest) {
  const draft = await application.createDefinition(designer, input);
  return application.publishDefinition(designer, draft.id);
}

const stepId = (definition: ProcedureDefinition, key: string) =>
  definition.steps.find((step) => step.key === key)?.id ?? '';
const valueKey = (definition: ProcedureDefinition) => `step:${stepId(definition, 'TAO_BG')}:gia_tri`;
const statusOf = (instance: ProcedureInstance, key: string) =>
  instance.steps.find((step) => step.key === key)?.status;
const currentKey = (instance: ProcedureInstance) =>
  instance.steps.find((step) => step.id === instance.currentStepId)?.key;
const pathKeys = (instance: ProcedureInstance) =>
  (instance.path ?? [])
    .filter((entry) => !entry.supersededAt)
    .map((entry) => instance.steps.find((step) => step.id === entry.stepInstanceId)?.key);

async function submitQuote(
  application: ProcedureEngineApplication,
  definition: ProcedureDefinition,
  amount: number,
  key = `q-${amount}`,
) {
  const started = await application.startInstance(sales, {
    definitionId: definition.id,
    title: `Báo giá ${amount}`,
    idempotencyKey: `start-${key}`,
  });
  return application.applyAction(sales, started.id, {
    action: 'complete',
    idempotencyKey: `submit-${key}`,
    attributeValues: { [valueKey(definition)]: { type: 'money', value: amount } },
  });
}

describe('Rẽ nhánh — quy trình Duyệt báo giá', () => {
  it('accepts HRM submission attributes atomically and keeps subsequent approvals pending', async () => {
    const { application } = setup();
    const definition = await publish(application, quoteInput());
    const input = {
      definitionId: definition.id, title:'Đơn công tác',sourceType:'hrm_request' as const,sourceId:'request-1',
      initiatedBy:sales.userId,idempotencyKey:'hrm-submission',
      attributeValues:{[valueKey(definition)]:{type:'money' as const,value:50*MILLION}},
      expectedDefinitionSnapshot:definition,
    };
    const created = await application.createInstance(sales.tenantId,input);
    expect((await application.createInstance(sales.tenantId,input)).id).toBe(created.id);
    const afterSubmit = await application.applyAction(sales,created.id,{action:'complete',idempotencyKey:'submit-hrm'});
    expect(currentKey(afterSubmit)).toBe('DUYET_TP');
    expect(afterSubmit.status).toBe('running');
    expect(afterSubmit.attributeValues?.[valueKey(definition)]?.enteredBy).toBe(sales.userId);
  });

  it('does not start a queued HRM request against a changed definition snapshot', async () => {
    const { application } = setup();
    const definition = await publish(application,quoteInput());
    const changed = {...definition,name:'Nội dung trước khi sửa'};
    await expect(application.createInstance(sales.tenantId,{
      definitionId:definition.id,title:'Công tác',sourceType:'hrm_request',sourceId:'request-2',idempotencyKey:'stale-definition',
      expectedDefinitionSnapshot:changed,
    })).rejects.toThrow('thay đổi');
  });

  it('rejects invalid initial HRM attributes without creating a partial instance', async () => {
    const { application, store } = setup();
    const definition = await publish(application,quoteInput());
    const before=(await store.read(sales.tenantId)).instances.length;
    await expect(application.createInstance(sales.tenantId,{
      definitionId:definition.id,title:'Công tác',sourceType:'hrm_request',sourceId:'request-3',idempotencyKey:'invalid-attributes',
      attributeValues:{[valueKey(definition)]:{type:'money',value:-10}},
    })).rejects.toThrow('không hợp lệ');
    expect((await store.read(sales.tenantId)).instances).toHaveLength(before);
  });

  it.each([
    [99_999_999, 'DUYET_TP'],
    [100 * MILLION, 'DUYET_PTGD'],
    [999_999_999, 'DUYET_PTGD'],
    [BILLION, 'DUYET_TGD'],
    [9_999_999_999, 'DUYET_TGD'],
    [10 * BILLION, 'DUYET_HDQT'],
    [10 * BILLION + 1, 'DUYET_HDQT'],
  ])('giá trị %d đi tới bước %s', async (amount, expected) => {
    const { application } = setup();
    const definition = await publish(application, quoteInput());
    const instance = await submitQuote(application, definition, amount);

    expect(currentKey(instance)).toBe(expected);
    expect(pathKeys(instance)).toEqual(['TAO_BG', expected]);
    for (const other of ['DUYET_TP', 'DUYET_PTGD', 'DUYET_TGD', 'DUYET_HDQT'].filter((key) => key !== expected)) {
      expect(statusOf(instance, other)).toBe('skipped');
    }
    const decision = instance.decisions?.[0];
    expect(decision?.usedDefault).toBe(expected === 'DUYET_HDQT');
    expect(decision?.inputs[0]?.value).toEqual({ type: 'money', value: amount });
    expect(decision?.branchResults).toHaveLength(3);
  });

  it('nhánh mặc định rỗng đi thẳng tới điểm hợp', async () => {
    const { application } = setup();
    const definition = await publish(application, quoteInput({ defaultSteps: false }));
    const instance = await submitQuote(application, definition, 20 * BILLION);
    expect(currentKey(instance)).toBe('GUI_KH');
    expect(instance.decisions?.[0]?.usedDefault).toBe(true);
  });

  it('thiếu giá trị bắt buộc thì không hoàn tất được bước', async () => {
    const { application } = setup();
    const definition = await publish(application, quoteInput());
    const started = await application.startInstance(sales, {
      definitionId: definition.id,
      title: 'Thiếu giá trị',
      idempotencyKey: 'start-missing',
    });
    await expect(
      application.applyAction(sales, started.id, { action: 'complete', idempotencyKey: 'submit-missing' }),
    ).rejects.toThrow(/Giá trị báo giá/);
  });

  it('gọi lặp cùng idempotency key không đánh giá lại', async () => {
    const { application } = setup();
    const definition = await publish(application, quoteInput());
    const first = await submitQuote(application, definition, 50 * MILLION, 'dup');
    const again = await application.applyAction(sales, first.id, {
      action: 'complete',
      idempotencyKey: 'submit-dup',
      attributeValues: { [valueKey(definition)]: { type: 'money', value: 50 * MILLION } },
    });
    expect(again.decisions).toHaveLength(1);
    expect(currentKey(again)).toBe('DUYET_TP');
  });

  it('chạy hết: tiến độ tính trên đường đi, không trên tổng số bước', async () => {
    const { application } = setup();
    const definition = await publish(application, quoteInput());
    const atApproval = await submitQuote(application, definition, 50 * MILLION);
    expect(atApproval.progress).toEqual({ completed: 1, total: 3, isEstimate: false });

    const atSend = await application.applyAction(headOfSales, atApproval.id, {
      action: 'approve',
      idempotencyKey: 'tp-approve',
    });
    expect(currentKey(atSend)).toBe('GUI_KH');
    await application.applyAction(sales, atSend.id, { action: 'complete', idempotencyKey: 'send-r' });
    const done = await application.applyAction(director, atSend.id, { action: 'approve', idempotencyKey: 'send-a' });
    expect(done.status).toBe('completed');
    expect(done.progress).toEqual({ completed: 3, total: 3, isEstimate: false });
  });

  it('trước điểm rẽ nhánh, tiến độ là ước lượng', async () => {
    const { application } = setup();
    const definition = await publish(application, quoteInput());
    const started = await application.startInstance(sales, {
      definitionId: definition.id,
      title: 'Mới mở',
      idempotencyKey: 'start-estimate',
    });
    expect(started.progress).toEqual({ completed: 0, total: 3, isEstimate: true });
  });

  it('trả về qua điểm rẽ nhánh: chỉ làm lại đường đã đi, rồi đánh giá lại', async () => {
    const { application } = setup();
    const definition = await publish(application, quoteInput());
    const atApproval = await submitQuote(application, definition, 50 * MILLION);
    const atSend = await application.applyAction(headOfSales, atApproval.id, {
      action: 'approve',
      idempotencyKey: 'tp-approve-r',
    });
    await application.applyAction(sales, atSend.id, { action: 'complete', idempotencyKey: 'send-r-r' });

    const tao = atSend.steps.find((step) => step.key === 'TAO_BG')?.id;
    const returned = await application.applyAction(director, atSend.id, {
      action: 'return',
      idempotencyKey: 'director-return',
      returnToStepId: tao,
    });
    expect(currentKey(returned)).toBe('TAO_BG');
    expect(statusOf(returned, 'GUI_KH')).toBe('returned');
    expect(statusOf(returned, 'DUYET_TP')).toBe('pending');
    // Nhánh không đi được mở lại để đánh giá lại, không bị coi là đã bỏ qua mãi mãi.
    expect(statusOf(returned, 'DUYET_TGD')).toBe('pending');
    expect(returned.decisions?.[0]?.supersededAt).toBeDefined();

    const again = await application.applyAction(sales, returned.id, {
      action: 'complete',
      idempotencyKey: 'resubmit',
      attributeValues: { [valueKey(definition)]: { type: 'money', value: 2 * BILLION } },
    });
    expect(currentKey(again)).toBe('DUYET_TGD');
    expect(statusOf(again, 'DUYET_TP')).toBe('skipped');
    expect(again.decisions).toHaveLength(2);
    // Lịch sử giữ cả lượt đi cũ.
    expect((again.path ?? []).filter((entry) => entry.supersededAt).length).toBeGreaterThan(0);
  });

  it('bước bị trả về ở nhánh cũ thành "bỏ qua" khi lần đi lại chọn nhánh khác', async () => {
    const { application } = setup();
    const definition = await publish(application, quoteInput());
    const atCeo = await submitQuote(application, definition, 2 * BILLION, 'reroute');
    expect(currentKey(atCeo)).toBe('DUYET_TGD');

    const back = await application.applyAction(ceo, atCeo.id, { action: 'return', idempotencyKey: 'ceo-return' });
    expect(currentKey(back)).toBe('TAO_BG');
    expect(statusOf(back, 'DUYET_TGD')).toBe('returned');

    const again = await application.applyAction(sales, back.id, {
      action: 'complete',
      idempotencyKey: 'reroute-submit',
      attributeValues: { [valueKey(definition)]: { type: 'money', value: 50 * MILLION } },
    });
    expect(currentKey(again)).toBe('DUYET_TP');
    expect(statusOf(again, 'DUYET_TGD')).toBe('skipped');
    expect(again.progress).toEqual({ completed: 1, total: 3, isEstimate: false });
  });

  it('không trả về được một bước ngoài đường đã đi', async () => {
    const { application } = setup();
    const definition = await publish(application, quoteInput());
    const atApproval = await submitQuote(application, definition, 50 * MILLION);
    const atSend = await application.applyAction(headOfSales, atApproval.id, {
      action: 'approve',
      idempotencyKey: 'tp-approve-x',
    });
    await application.applyAction(sales, atSend.id, { action: 'complete', idempotencyKey: 'send-r-x' });
    const offPath = atSend.steps.find((step) => step.key === 'DUYET_TGD')?.id;
    await expect(
      application.applyAction(director, atSend.id, {
        action: 'return',
        idempotencyKey: 'bad-return',
        returnToStepId: offPath,
      }),
    ).rejects.toThrow(/đã đi qua/);
  });

  it('quyền trả về theo đường đi', async () => {
    const { application } = setup();
    const definition = await publish(application, quoteInput());
    const started = await application.startInstance(sales, {
      definitionId: definition.id,
      title: 'Quyền trả về',
      idempotencyKey: 'start-auth',
    });
    expect(started.authorization?.availableActions).not.toContain('return');

    const atApproval = await application.applyAction(sales, started.id, {
      action: 'complete',
      idempotencyKey: 'submit-auth',
      attributeValues: { [valueKey(definition)]: { type: 'money', value: 10 } },
    });
    const workspace = await application.getWorkspace(headOfSales);
    const seen = workspace.instances.find((item) => item.id === atApproval.id);
    expect(seen?.authorization?.availableActions).toContain('return');
    expect(seen?.authorization?.returnTargetStepIds).toEqual([
      atApproval.steps.find((step) => step.key === 'TAO_BG')?.id,
    ]);
  });
});

describe('Rẽ nhánh — luật công bố', () => {
  async function publishError(input: CreateProcedureDefinitionRequest) {
    const { application } = setup();
    const draft = await application.createDefinition(designer, input);
    return application.publishDefinition(designer, draft.id).then(
      () => undefined,
      (error: Error) => error.message,
    );
  }

  function withGateway(mutate: (gateway: ProcedureGatewayDefinition) => ProcedureGatewayDefinition) {
    const input = quoteInput();
    return { ...input, gateways: input.gateways?.map(mutate) };
  }

  it('thiếu nhánh mặc định', async () => {
    const message = await publishError(
      withGateway((gateway) => ({ ...gateway, branches: gateway.branches.filter((branch) => !branch.isDefault) })),
    );
    expect(message).toMatch(/nhánh mặc định/);
  });

  it('nhánh có điều kiện nhưng không có luật', async () => {
    const message = await publishError(
      withGateway((gateway) => ({
        ...gateway,
        branches: gateway.branches.map((branch, index) => (index === 0 ? { ...branch, condition: undefined } : branch)),
      })),
    );
    expect(message).toMatch(/chưa có điều kiện/);
  });

  it('thuộc tính không tồn tại', async () => {
    const message = await publishError(
      withGateway((gateway) => ({
        ...gateway,
        branches: gateway.branches.map((branch, index) =>
          index === 0 && branch.condition
            ? {
                ...branch,
                condition: {
                  ...branch.condition,
                  rules: branch.condition.rules.map((rule) => ({
                    ...rule,
                    attribute: { scope: 'step' as const, stepId: 'TAO_BG', code: 'khong_co' },
                  })),
                },
              }
            : branch,
        ),
      })),
    );
    expect(message).toMatch(/không tồn tại/);
  });

  it('thuộc tính của bước đứng sau điểm rẽ nhánh', async () => {
    const input = quoteInput();
    const steps = input.steps.map((step) =>
      step.key === 'GUI_KH'
        ? { ...step, attributes: [{ id: '', code: 'so_hd', name: 'Số hợp đồng', type: 'number' as const, required: false }] }
        : step,
    );
    const gateways = input.gateways?.map((gateway) => ({
      ...gateway,
      branches: gateway.branches.map((branch, index) =>
        index === 0 && branch.condition
          ? {
              ...branch,
              condition: {
                ...branch.condition,
                rules: [
                  { id: '', attribute: { scope: 'step' as const, stepId: 'GUI_KH', code: 'so_hd' }, operator: 'gt' as const, value: 1 },
                ],
              },
            }
          : branch,
      ),
    }));
    const message = await publishError({ ...input, steps, gateways });
    expect(message).toMatch(/không chắc chắn đã đi qua/);
  });

  it('phép so sánh không hợp kiểu', async () => {
    const message = await publishError(
      withGateway((gateway) => ({
        ...gateway,
        branches: gateway.branches.map((branch, index) =>
          index === 0 && branch.condition
            ? {
                ...branch,
                condition: {
                  ...branch.condition,
                  rules: branch.condition.rules.map((rule) => ({ ...rule, operator: 'in' as const })),
                },
              }
            : branch,
        ),
      })),
    );
    expect(message).toMatch(/phép so sánh/);
  });

  it('khoảng có cận dưới không nhỏ hơn cận trên', async () => {
    const message = await publishError(
      withGateway((gateway) => ({
        ...gateway,
        branches: gateway.branches.map((branch, index) =>
          index === 1 && branch.condition
            ? {
                ...branch,
                condition: {
                  ...branch.condition,
                  rules: branch.condition.rules.map((rule) => ({ ...rule, value: BILLION, valueTo: BILLION })),
                },
              }
            : branch,
        ),
      })),
    );
    expect(message).toMatch(/cận dưới/);
  });

  it('một bước thuộc hai nhánh', async () => {
    const message = await publishError(
      withGateway((gateway) => ({
        ...gateway,
        branches: gateway.branches.map((branch, index) =>
          index === 1 ? { ...branch, stepIds: ['DUYET_TP'] } : branch,
        ),
      })),
    );
    expect(message).toMatch(/nhiều hơn một nhánh|không bao giờ được đi tới/);
  });

  it('C ở điểm hợp không được quay về bước trong nhánh', async () => {
    const input = quoteInput();
    const draftSetup = setup();
    const draft = await draftSetup.application.createDefinition(designer, input);
    const branchStep = stepId(draft, 'DUYET_TP');
    const steps = draft.steps.map((step) => ({
      key: step.key,
      order: step.order,
      name: step.name,
      attributes: step.attributes,
      assignments: [
        ...step.assignments.map((assignment) => ({
          role: assignment.role,
          subjectType: assignment.subjectType,
          subjectId: assignment.subjectId,
        })),
        ...(step.key === 'GUI_KH'
          ? [{ role: 'C' as const, subjectType: 'user' as const, subjectId: 'kiem-soat', fixedRollbackStepId: branchStep }]
          : []),
      ],
    }));
    await draftSetup.application.updateDefinition(designer, draft.id, { steps });
    await expect(draftSetup.application.publishDefinition(designer, draft.id)).rejects.toThrow(
      /chắc chắn đã đi qua/,
    );
  });

  it('chồng lấn khoảng chỉ là cảnh báo', async () => {
    const { application } = setup();
    const input = withGateway((gateway) => ({
      ...gateway,
      branches: gateway.branches.map((branch, index) =>
        index === 0 && branch.condition
          ? {
              ...branch,
              condition: {
                ...branch.condition,
                rules: branch.condition.rules.map((rule) => ({ ...rule, value: 200 * MILLION })),
              },
            }
          : branch,
      ),
    }));
    const draft = await application.createDefinition(designer, input);
    const report = await application.inspectDefinition(designer, draft.id);
    expect(report.errors).toEqual([]);
    expect(report.warnings.some((item) => /chồng khoảng/.test(item.message))).toBe(true);
    const published = await application.publishDefinition(designer, draft.id);
    expect(published.status).toBe('published');
  });

  it('bản nháp có gateway dở dang vẫn lưu được', async () => {
    const { application } = setup();
    const draft = await application.createDefinition(
      designer,
      withGateway((gateway) => ({
        ...gateway,
        branches: gateway.branches.map((branch) => ({ ...branch, condition: undefined })),
      })),
    );
    expect(draft.gateways).toHaveLength(1);
  });

  it('sửa một ô RCSI không làm mất gateway và thuộc tính', async () => {
    const { application } = setup();
    const draft = await application.createDefinition(designer, quoteInput());
    const updated = await application.updateDefinition(designer, draft.id, {
      steps: draft.steps.map((step) => ({
        key: step.key,
        order: step.order,
        name: step.name,
        attributes: step.attributes,
        assignments: step.assignments.map((assignment) => ({
          role: assignment.role,
          subjectType: assignment.subjectType,
          subjectId: assignment.subjectId,
        })),
      })),
    });
    expect(updated.gateways?.[0]?.branches.map((branch) => branch.stepIds)).toEqual(
      draft.gateways?.[0]?.branches.map((branch) => branch.stepIds),
    );
    expect(updated.steps.find((step) => step.key === 'TAO_BG')?.attributes?.[0]?.code).toBe('gia_tri');
  });
});

describe('Rẽ nhánh — sửa quy trình và hồ sơ cũ', () => {
  it('hồ sơ đang chạy giữ luật lúc khởi tạo sau khi quy trình được sửa', async () => {
    const { application } = setup();
    const definition = await publish(application, quoteInput());
    const started = await application.startInstance(sales, {
      definitionId: definition.id,
      title: 'Luật cũ',
      idempotencyKey: 'start-old-rule',
    });

    await application.reviseDefinition(designer, definition.id);
    const revised = quoteInput();
    await application.updateDefinition(designer, definition.id, {
      steps: revised.steps,
      gateways: revised.gateways?.map((gateway) => ({
        ...gateway,
        branches: gateway.branches.map((branch, index) =>
          index === 0 && branch.condition
            ? {
                ...branch,
                condition: {
                  ...branch.condition,
                  rules: branch.condition.rules.map((rule) => ({ ...rule, value: 10 })),
                },
              }
            : branch,
        ),
      })),
    });
    await application.publishDefinition(designer, definition.id);

    const moved = await application.applyAction(sales, started.id, {
      action: 'complete',
      idempotencyKey: 'old-rule-submit',
      attributeValues: { [valueKey(definition)]: { type: 'money', value: 50 * MILLION } },
    });
    expect(currentKey(moved)).toBe('DUYET_TP');
  });

  it('không xoá được bước khi còn hồ sơ đang chạy dùng nó', async () => {
    const { application } = setup();
    const definition = await publish(application, quoteInput());
    await application.startInstance(sales, {
      definitionId: definition.id,
      title: 'Đang chạy',
      idempotencyKey: 'start-block-delete',
    });
    await application.reviseDefinition(designer, definition.id);
    const input = quoteInput();
    await expect(
      application.updateDefinition(designer, definition.id, {
        steps: input.steps.filter((step) => step.key !== 'DUYET_HDQT'),
      }),
    ).rejects.toThrow(/đang chạy/);
  });

  it('quy trình tuyến tính giữ nguyên hành vi', async () => {
    const { application } = setup();
    const definition = await publish(application, {
      code: 'TUYEN-TINH',
      name: 'Tuyến tính',
      kind: 'process',
      category: 'ops',
      steps: [
        stepInput('B1', 1, 'Bước 1', [assign('S', sales.userId)]),
        stepInput('B2', 2, 'Bước 2', [assign('A', headOfSales.userId)]),
        stepInput('B3', 3, 'Bước 3', [assign('R', sales.userId)]),
      ],
    });
    const started = await application.startInstance(sales, {
      definitionId: definition.id,
      title: 'Tuyến tính',
      idempotencyKey: 'start-linear',
    });
    expect(started.progress).toEqual({ completed: 0, total: 3, isEstimate: false });
    const second = await application.applyAction(sales, started.id, { action: 'complete', idempotencyKey: 'l1' });
    expect(currentKey(second)).toBe('B2');
    const third = await application.applyAction(headOfSales, started.id, { action: 'approve', idempotencyKey: 'l2' });
    expect(currentKey(third)).toBe('B3');
    expect(third.steps.map((step) => step.status)).toEqual(['completed', 'completed', 'active']);
  });

  it('hồ sơ mở trước khi có rẽ nhánh vẫn chạy và trả về đúng', async () => {
    const { application, store } = setup();
    const workspace = await application.getWorkspace(designer);
    const seeded = workspace.definitions.find((item) => item.code === 'PROC-PURCHASE');
    const started = await application.startInstance(designer, {
      definitionId: seeded?.id ?? '',
      title: 'Hồ sơ cũ',
      idempotencyKey: 'start-legacy',
    });
    // Giả lập hồ sơ ghi trước đợt này: không có flow, path, decisions, progress.
    await store.transaction(designer.tenantId, (state) => {
      const instance = state.instances.find((item) => item.id === started.id);
      if (instance) {
        delete instance.flow;
        delete instance.path;
        delete instance.decisions;
        delete instance.progress;
      }
      return null;
    });

    const afterS = await application.applyAction(designer, started.id, { action: 'complete', idempotencyKey: 'legacy-1' });
    const atReview = await application.applyAction(designer, afterS.id, { action: 'complete', idempotencyKey: 'legacy-2' });
    expect(currentKey(atReview)).toBe('REVIEW');
    const back = await application.applyAction(designer, atReview.id, { action: 'return', idempotencyKey: 'legacy-3' });
    expect(currentKey(back)).toBe('REQUEST');
    expect(statusOf(back, 'REVIEW')).toBe('returned');
  });
});

describe('Người duyệt: quản lý trực tiếp của người khởi tạo', () => {
  function managerInput(): CreateProcedureDefinitionRequest {
    return {
      code: 'DE-NGHI',
      name: 'Đề nghị',
      kind: 'process',
      category: 'hr',
      steps: [
        stepInput('LAP', 1, 'Lập đề nghị', [assign('S', sales.userId)]),
        stepInput('DUYET', 2, 'Quản lý duyệt', [
          {
            role: 'A',
            subjectType: 'initiator_manager',
            subjectId: '',
            managerFallback: { subjectType: 'user', subjectId: 'du-phong', subjectLabel: 'Người dự phòng' },
          },
        ]),
      ],
    };
  }

  async function reachApproval(managers: FakeManagers) {
    const { application } = setup(managers);
    const definition = await publish(application, managerInput());
    const started = await application.startInstance(sales, {
      definitionId: definition.id,
      title: 'Đề nghị',
      idempotencyKey: 'start-manager',
    });
    const atApproval = await application.applyAction(sales, started.id, { action: 'complete', idempotencyKey: 'lap' });
    return { application, atApproval };
  }

  const approvalStep = (instance: ProcedureInstance) => instance.steps.find((step) => step.key === 'DUYET');

  it('phân giải về chức danh báo cáo trực tiếp', async () => {
    const managers = new FakeManagers();
    managers.result = {
      initiatorPositionId: 'pos-nv',
      chain: [{ positionId: 'pos-tp', positionName: 'Trưởng phòng', holderUserIds: ['tp-kd'] }],
    };
    const { application, atApproval } = await reachApproval(managers);
    const step = approvalStep(atApproval);
    expect(step?.assignments[0]).toMatchObject({ subjectType: 'position', subjectId: 'pos-tp' });
    expect(step?.resolutions?.[0]?.usedFallback).toBe(false);

    const manager = person('tp-kd', { positionIds: ['pos-tp'] });
    const view = (await application.getWorkspace(manager)).instances.find((item) => item.id === atApproval.id);
    expect(view?.authorization?.availableActions).toContain('approve');
  });

  it('chức danh trống thì leo tiếp lên cấp trên', async () => {
    const managers = new FakeManagers();
    managers.result = {
      chain: [
        { positionId: 'pos-tp', positionName: 'Trưởng phòng', holderUserIds: [] },
        { positionId: 'pos-ptgd', positionName: 'Phó TGĐ', holderUserIds: ['pho-tgd'] },
      ],
    };
    const { atApproval } = await reachApproval(managers);
    expect(approvalStep(atApproval)?.assignments[0]?.subjectId).toBe('pos-ptgd');
  });

  it('người khởi tạo không tự duyệt đơn của mình', async () => {
    const managers = new FakeManagers();
    managers.result = {
      chain: [
        { positionId: 'pos-kiem', positionName: 'Kiêm nhiệm', holderUserIds: [sales.userId] },
        { positionId: 'pos-tp', positionName: 'Trưởng phòng', holderUserIds: ['tp-kd'] },
      ],
    };
    const { atApproval } = await reachApproval(managers);
    expect(approvalStep(atApproval)?.assignments[0]?.subjectId).toBe('pos-tp');
  });

  it('leo tới gốc vẫn trống thì dùng người dự phòng', async () => {
    const managers = new FakeManagers();
    managers.result = { chain: [{ positionId: 'pos-tp', positionName: 'Trưởng phòng', holderUserIds: [] }] };
    const { atApproval } = await reachApproval(managers);
    const step = approvalStep(atApproval);
    expect(step?.assignments[0]).toMatchObject({ subjectType: 'user', subjectId: 'du-phong' });
    expect(step?.resolutions?.[0]?.usedFallback).toBe(true);
  });

  it('Core lỗi thì hành động thất bại, hồ sơ không đổi', async () => {
    const managers = new FakeManagers();
    const { application } = setup(managers);
    const definition = await publish(application, managerInput());
    const started = await application.startInstance(sales, {
      definitionId: definition.id,
      title: 'Core lỗi',
      idempotencyKey: 'start-core-down',
    });
    managers.failing = true;
    await expect(
      application.applyAction(sales, started.id, { action: 'complete', idempotencyKey: 'core-down' }),
    ).rejects.toThrow(/Sơ đồ tổ chức/);
    const unchanged = (await application.getWorkspace(designer)).instances.find((item) => item.id === started.id);
    expect(currentKey(unchanged as ProcedureInstance)).toBe('LAP');
  });

  it('thiếu người dự phòng thì không công bố được', async () => {
    const { application } = setup();
    const input = managerInput();
    const draft = await application.createDefinition(designer, {
      ...input,
      steps: input.steps.map((step) =>
        step.key === 'DUYET'
          ? { ...step, assignments: step.assignments.map((item) => ({ ...item, managerFallback: undefined })) }
          : step,
      ),
    });
    await expect(application.publishDefinition(designer, draft.id)).rejects.toThrow(/dự phòng/);
  });
});
