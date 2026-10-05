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
import type { InitiatorActorResolver } from './initiator-actor.port.js';
import { ProcedureEngineApplication } from './procedure-engine.application.js';
import type { ProcedureClock, ProcedureIdGenerator } from './procedure-store.port.js';

const TENANT = 'tenant-auto';

class FixedClock implements ProcedureClock {
  now(): Date {
    return new Date('2026-10-05T08:00:00.000Z');
  }
}

class SequentialIds implements ProcedureIdGenerator {
  private value = 0;
  next(): string {
    this.value += 1;
    return `id-${this.value.toString().padStart(5, '0')}`;
  }
}

function person(userId: string, extra: Partial<ProcedureActor> = {}): ProcedureActor {
  return {
    tenantId: TENANT,
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
const employee = person('nhan-vien');
const outsider = person('nguoi-la');

const assign = (role: ProcedureRaciRole, userId: string, subjectLabel?: string) => ({
  role,
  subjectType: 'user' as const,
  subjectId: userId,
  subjectLabel,
});

const step = (
  key: string,
  order: number,
  name: string,
  assignments: CreateProcedureStepInput['assignments'],
  extra: Partial<CreateProcedureStepInput> = {},
): CreateProcedureStepInput => ({ key, order, name, assignments, ...extra });

/** Đơn nghỉ: S nhập số ngày (bắt buộc) -> cổng theo số ngày -> trưởng phòng hoặc giám đốc duyệt. */
function leaveInput(firstStepRoles: ProcedureRaciRole[] = ['S']): CreateProcedureDefinitionRequest {
  const days = { scope: 'step' as const, stepId: 'NOP_DON', code: 'so_ngay' };
  const gateway: ProcedureGatewayDefinition = {
    id: '',
    key: 'G_SO_NGAY',
    name: 'Theo số ngày nghỉ',
    type: 'exclusive',
    afterStepId: 'NOP_DON',
    branches: [
      {
        id: '',
        key: 'NGAN',
        label: 'Dưới 3 ngày',
        isDefault: false,
        condition: { combinator: 'and', rules: [{ id: '', attribute: days, operator: 'lt', value: 3 }] },
        stepIds: ['DUYET_TP'],
      },
      { id: '', key: 'DAI', label: 'Từ 3 ngày', isDefault: true, stepIds: ['DUYET_GD'] },
    ],
  };
  return {
    code: 'DON-NGHI',
    name: 'Đơn nghỉ',
    kind: 'process',
    category: 'hr',
    steps: [
      step(
        'NOP_DON',
        1,
        'Nộp đơn',
        firstStepRoles.map((role) => assign(role, employee.userId)),
        { attributes: [{ id: '', code: 'so_ngay', name: 'Số ngày nghỉ', type: 'number', required: true }] },
      ),
      step('DUYET_TP', 2, 'Trưởng phòng duyệt', [assign('A', 'truong-phong', 'Trưởng phòng A')]),
      step('DUYET_GD', 3, 'Giám đốc duyệt', [assign('A', 'giam-doc', 'Giám đốc B')]),
    ],
    gateways: [gateway],
  };
}

function setup(initiatorActors?: InitiatorActorResolver) {
  const store = new InMemoryProcedureStore();
  const application = new ProcedureEngineApplication(
    store,
    new FixedClock(),
    new SequentialIds(),
    undefined,
    undefined,
    undefined,
    initiatorActors,
  );
  return { store, application };
}

async function publish(application: ProcedureEngineApplication, input: CreateProcedureDefinitionRequest) {
  const draft = await application.createDefinition(designer, input);
  return application.publishDefinition(designer, draft.id);
}

const daysKey = (definition: ProcedureDefinition) =>
  `step:${definition.steps.find((item) => item.key === 'NOP_DON')?.id}:so_ngay`;
const keyOf = (instance: ProcedureInstance, stepId?: string) =>
  instance.steps.find((item) => item.id === stepId)?.key;

function request(definition: ProcedureDefinition, extra: Record<string, unknown> = {}) {
  return {
    definitionId: definition.id,
    title: 'Đơn nghỉ phép',
    sourceType: 'hrm_request' as const,
    sourceId: 'leave-1',
    initiatedBy: employee.userId,
    initiatedByName: 'Nhân viên',
    idempotencyKey: 'leave-1',
    expectedDefinitionSnapshot: definition,
    attributeValues: { [daysKey(definition)]: { type: 'number' as const, value: 1 } },
    ...extra,
  };
}

async function loadInstance(store: InMemoryProcedureStore, id: string) {
  return (await store.read(TENANT)).instances.find((item) => item.id === id) as ProcedureInstance;
}

describe('FIX-E-01 - bước S tự hoàn thành khi gửi đơn HRM', () => {
  it('hoàn thành S trong cùng giao dịch, sang bước duyệt đầu tiên và ghi nhật ký', async () => {
    const { application, store } = setup();
    const definition = await publish(application, leaveInput());

    const created = await application.createInstance(TENANT, request(definition, { autoCompleteInitiatorStep: true }));

    expect(created.autoComplete).toEqual({ status: 'completed' });
    expect(created.currentStepName).toBe('Trưởng phòng duyệt');
    expect(created.currentAssigneeName).toBe('Trưởng phòng A');
    expect(created.warnings).toBeUndefined();
    const instance = await loadInstance(store, created.id);
    expect(instance.status).toBe('running');
    expect(instance.steps.find((item) => item.key === 'NOP_DON')?.status).toBe('completed');
    const entry = instance.activity.find((item) => item.summary === 'Hoàn thành bước S khi gửi đơn (tự động)');
    expect(entry).toMatchObject({ action: 'complete', actorId: employee.userId });
  });

  it('cổng điều kiện rẽ nhánh theo đúng giá trị form', async () => {
    const { application, store } = setup();
    const definition = await publish(application, leaveInput());
    const created = await application.createInstance(
      TENANT,
      request(definition, {
        autoCompleteInitiatorStep: true,
        idempotencyKey: 'leave-long',
        attributeValues: { [daysKey(definition)]: { type: 'number', value: 5 } },
      }),
    );
    expect(created.currentStepName).toBe('Giám đốc duyệt');
    const instance = await loadInstance(store, created.id);
    expect(keyOf(instance, instance.currentStepId)).toBe('DUYET_GD');
    expect(instance.steps.find((item) => item.key === 'DUYET_TP')?.status).toBe('skipped');
  });

  it('thiếu thuộc tính bắt buộc của bước S: lỗi nêu rõ trường, không để lại hồ sơ', async () => {
    const { application, store } = setup();
    const definition = await publish(application, leaveInput());
    await expect(
      application.createInstance(
        TENANT,
        request(definition, { autoCompleteInitiatorStep: true, attributeValues: undefined }),
      ),
    ).rejects.toMatchObject({ code: 'validation', message: expect.stringContaining('Số ngày nghỉ') });
    expect((await store.read(TENANT)).instances).toHaveLength(0);
  });

  it('người khởi tạo không khớp phân công S: bỏ qua, đơn dừng ở bước đầu kèm cảnh báo', async () => {
    const { application, store } = setup();
    const definition = await publish(application, leaveInput());
    const created = await application.createInstance(
      TENANT,
      request(definition, { autoCompleteInitiatorStep: true, initiatedBy: outsider.userId }),
    );
    expect(created.autoComplete?.status).toBe('skipped');
    expect(created.warnings?.[0]).toContain('không khớp phân công S');
    expect(created.currentStepName).toBe('Nộp đơn');
    const instance = await loadInstance(store, created.id);
    expect(instance.steps.find((item) => item.key === 'NOP_DON')?.status).not.toBe('completed');
  });

  it('bước đầu không chỉ có vai S: không tự hoàn thành, không lỗi', async () => {
    const { application } = setup();
    const definition = await publish(application, leaveInput(['S', 'R']));
    const created = await application.createInstance(TENANT, request(definition, { autoCompleteInitiatorStep: true }));
    expect(created.autoComplete?.status).toBe('skipped');
    expect(created.warnings?.[0]).toContain('không chỉ có vai S');
    expect(created.currentStepName).toBe('Nộp đơn');
  });

  it('idempotent: gọi lại cùng khóa không tạo thêm và không hoàn thành lần hai', async () => {
    const { application, store } = setup();
    const definition = await publish(application, leaveInput());
    const input = request(definition, { autoCompleteInitiatorStep: true });
    const first = await application.createInstance(TENANT, input);
    const second = await application.createInstance(TENANT, input);
    expect(second.id).toBe(first.id);
    expect(second.autoComplete).toEqual({ status: 'completed' });
    expect(second.currentStepName).toBe('Trưởng phòng duyệt');
    const state = await store.read(TENANT);
    expect(state.instances).toHaveLength(1);
    const completions = state.instances[0].activity.filter(
      (item) => item.summary === 'Hoàn thành bước S khi gửi đơn (tự động)',
    );
    expect(completions).toHaveLength(1);
  });

  it('không có cờ: hành vi cũ, đơn dừng ở bước S (hồi quy)', async () => {
    const { application } = setup();
    const definition = await publish(application, leaveInput());
    const created = await application.createInstance(TENANT, request(definition));
    expect(created.autoComplete).toBeUndefined();
    expect(created.currentStepName).toBe('Nộp đơn');
  });

  it('chỉ nhận cờ khi sourceType là hrm_request', async () => {
    const { application } = setup();
    const definition = await publish(application, leaveInput());
    await expect(
      application.createInstance(TENANT, request(definition, { autoCompleteInitiatorStep: true, sourceType: 'manual' })),
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(
      application.startInstance(person(employee.userId), {
        definitionId: definition.id,
        title: 'Tự mở',
        idempotencyKey: 'manual-1',
        sourceType: 'hrm_request',
        autoCompleteInitiatorStep: true,
      }),
    ).rejects.toMatchObject({ code: 'validation' });
  });

  it('khớp phân công S theo chức danh qua ngữ cảnh tổ chức của người khởi tạo', async () => {
    const resolver: InitiatorActorResolver = {
      resolve: async (_tenant, userId) => person(userId, { positionIds: ['pos-nv'] }),
    };
    const { application } = setup(resolver);
    const input = leaveInput();
    const byPosition = {
      ...input,
      steps: input.steps.map((item) =>
        item.key === 'NOP_DON'
          ? { ...item, assignments: [{ role: 'S' as const, subjectType: 'position' as const, subjectId: 'pos-nv' }] }
          : item,
      ),
    };
    const definition = await publish(application, byPosition);
    const created = await application.createInstance(TENANT, request(definition, { autoCompleteInitiatorStep: true }));
    expect(created.autoComplete).toEqual({ status: 'completed' });
  });

  it('tra cứu tổ chức lỗi: bỏ qua với cảnh báo, đơn vẫn được tạo', async () => {
    const resolver: InitiatorActorResolver = {
      resolve: async () => {
        throw new Error('Core không phản hồi');
      },
    };
    const { application } = setup(resolver);
    const definition = await publish(application, leaveInput());
    const created = await application.createInstance(TENANT, request(definition, { autoCompleteInitiatorStep: true }));
    expect(created.autoComplete?.status).toBe('skipped');
    expect(created.warnings?.[0]).toContain('Core không phản hồi');
    expect(created.currentStepName).toBe('Nộp đơn');
  });
});
