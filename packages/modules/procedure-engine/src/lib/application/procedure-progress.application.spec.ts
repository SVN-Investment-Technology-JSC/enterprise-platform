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

import { buildStepChangedPayload, instancesWithStepChange } from '../domain/procedure-progress.js';
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


async function startLeave(application: ProcedureEngineApplication, extra: Record<string, unknown> = {}) {
  const definition = await publish(application, leaveInput());
  const created = await application.createInstance(
    TENANT,
    request(definition, { autoCompleteInitiatorStep: true, ...extra }),
  );
  return { definition, created };
}

describe('FIX-E-02 - tiến độ hồ sơ cho module khác', () => {
  it('hồ sơ HRM mới tạo và đổi bước đều được phát step_changed với sequence tăng dần', async () => {
    const { application, store } = setup();
    const empty = (await store.read(TENANT)).instances;
    const { created } = await startLeave(application);
    const afterCreate = (await store.read(TENANT)).instances;

    const first = instancesWithStepChange(empty, afterCreate);
    expect(first.map((item) => item.id)).toEqual([created.id]);
    const firstPayload = buildStepChangedPayload(first[0], '2026-10-05T08:00:00.000Z');
    expect(firstPayload).toMatchObject({
      instanceId: created.id,
      sourceType: 'hrm_request',
      sourceId: 'leave-1',
      stepName: 'Trưởng phòng duyệt',
      assignees: ['Trưởng phòng A'],
      status: 'running',
    });
    expect(created.sequence).toBe(firstPayload.sequence);

    // Không đổi gì: không phát lại.
    expect(instancesWithStepChange(afterCreate, afterCreate)).toEqual([]);

    // Đổi bước (mô phỏng): phát lại với sequence mới hơn khi có thêm nhật ký.
    const moved = structuredClone(afterCreate);
    const target = moved.find((item) => item.id === created.id) as ProcedureInstance;
    target.currentStepId = target.steps.find((item) => item.id !== target.currentStepId)?.id;
    target.activity.unshift({ ...target.activity[0], id: 'act-moi' });
    const changed = instancesWithStepChange(afterCreate, moved);
    expect(changed.map((item) => item.id)).toEqual([created.id]);
    expect(buildStepChangedPayload(changed[0], 'x').sequence).toBeGreaterThan(firstPayload.sequence);

    // Hồ sơ không còn chạy: đã có sự kiện completed riêng, không phát step_changed.
    target.status = 'completed';
    expect(instancesWithStepChange(afterCreate, moved)).toEqual([]);
  });

  it('không phát cho nguồn khác hrm_request (tránh ồn outbox)', async () => {
    const { application, store } = setup();
    const definition = await publish(application, leaveInput());
    await application.createInstance(
      TENANT,
      request(definition, { sourceType: 'maintenance_occurrence', idempotencyKey: 'm1', autoCompleteInitiatorStep: false }),
    );
    expect(instancesWithStepChange([], (await store.read(TENANT)).instances)).toEqual([]);
  });

  it('getInstanceProgressForService trả đúng hình dạng tiến độ HRM đang dùng', async () => {
    const { application } = setup();
    const { created } = await startLeave(application);
    const progress = await application.getInstanceProgressForService(TENANT, created.id);
    expect(progress).toMatchObject({
      instanceId: created.id,
      status: 'running',
      currentStepName: 'Trưởng phòng duyệt',
      currentAssigneeName: 'Trưởng phòng A',
    });
    expect(progress.steps.map((item) => item.name)).toEqual(['Nộp đơn', 'Trưởng phòng duyệt', 'Giám đốc duyệt']);
    expect(progress.steps[1]).toEqual(
      expect.objectContaining({ id: expect.any(String), order: 2, roleTitle: 'Trưởng phòng A' }),
    );
    expect(Array.isArray(progress.activity)).toBe(true);
    await expect(application.getInstanceProgressForService(TENANT, 'khong-co')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('đối soát: trả bước hiện tại, bỏ qua mã lạ, giới hạn 100 mã', async () => {
    const { application } = setup();
    const { created } = await startLeave(application);
    const entries = await application.getInstanceStatusesForService(TENANT, [created.id, 'khong-co', created.id]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      instanceId: created.id,
      status: 'running',
      currentStepName: 'Trưởng phòng duyệt',
      sequence: created.sequence,
    });
    await expect(application.getInstanceStatusesForService(TENANT, [])).rejects.toMatchObject({ code: 'validation' });
    const many = Array.from({ length: 101 }, (_, index) => 'id-' + index);
    await expect(application.getInstanceStatusesForService(TENANT, many)).rejects.toMatchObject({ code: 'validation' });
  });
});
