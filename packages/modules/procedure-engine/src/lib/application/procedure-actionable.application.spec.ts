import type {
  CreateProcedureDefinitionRequest,
  CreateProcedureStepInput,
  ProcedureRaciRole,
} from '@enterprise-platform/contracts-procedure-engine';
import type { ProcedureActor } from '../domain/procedure-authorization.js';
import { InMemoryProcedureStore } from '../infrastructure/in-memory-procedure-store.js';
import type { DirectManagerResolver } from './direct-manager.port.js';
import type { InitiatorActorResolver } from './initiator-actor.port.js';
import { ProcedureEngineApplication } from './procedure-engine.application.js';
import type { ProcedureClock, ProcedureIdGenerator } from './procedure-store.port.js';

const TENANT = 'tenant-actionable';

class FixedClock implements ProcedureClock {
  now(): Date {
    return new Date('2026-10-14T08:00:00.000Z');
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
const requester = person('nhan-vien');
/** Quản lý trực tiếp giữ chức danh pos-ql; người dự phòng là chính người dùng du-phong. */
const manager = person('quan-ly', { positionIds: ['pos-ql'] });
const backup = person('du-phong');
const outsider = person('nguoi-la');
const people = new Map([requester, manager, backup, outsider].map((item) => [item.userId, item]));

const actors: InitiatorActorResolver = {
  resolve: async (_tenant, userId) => people.get(userId) ?? null,
};
const managers: DirectManagerResolver = {
  chain: async () => ({
    initiatorPositionId: 'pos-nv',
    chain: [{ positionId: 'pos-ql', positionName: 'Quản lý', holderUserIds: ['quan-ly'] }],
  }),
};

const step = (
  key: string,
  order: number,
  name: string,
  assignments: CreateProcedureStepInput['assignments'],
): CreateProcedureStepInput => ({ key, order, name, assignments });

/** Đơn nghỉ 2 bước: nhân viên nộp (S), quản lý trực tiếp duyệt (A) kèm người dự phòng. */
function leaveInput(role: ProcedureRaciRole = 'A'): CreateProcedureDefinitionRequest {
  return {
    code: 'DON-NGHI-QL',
    name: 'Đơn nghỉ',
    kind: 'process',
    category: 'hr',
    steps: [
      step('NOP', 1, 'Nộp đơn', [{ role: 'S', subjectType: 'user', subjectId: requester.userId }]),
      step('DUYET', 2, 'QL trực tiếp duyệt', [
        {
          role,
          subjectType: 'initiator_manager',
          subjectId: '',
          managerFallback: { subjectType: 'user', subjectId: backup.userId, subjectLabel: 'Trưởng phòng HC-NS' },
        },
      ]),
    ],
  };
}

async function startLeave(role: ProcedureRaciRole = 'A', autoCompleteInitiatorStep = true) {
  const application = new ProcedureEngineApplication(
    new InMemoryProcedureStore(),
    new FixedClock(),
    new SequentialIds(),
    undefined,
    undefined,
    managers,
    actors,
  );
  const draft = await application.createDefinition(designer, leaveInput(role));
  const definition = await application.publishDefinition(designer, draft.id);
  const created = await application.createInstance(TENANT, {
    definitionId: definition.id,
    title: 'Đơn nghỉ phép',
    sourceType: 'hrm_request',
    sourceId: 'leave-1',
    initiatedBy: requester.userId,
    initiatedByName: 'Nhân viên',
    idempotencyKey: 'leave-1',
    expectedDefinitionSnapshot: definition,
    autoCompleteInitiatorStep,
  });
  return { application, instanceId: created.id };
}

describe('getActionableInstanceIdsForService - hồ sơ người này đang xử lý được', () => {
  it('quản lý trực tiếp và người dự phòng đều xử lý được; người ngoài và người nộp thì không', async () => {
    const { application, instanceId } = await startLeave();
    const ids = [instanceId];
    expect(await application.getActionableInstanceIdsForService(TENANT, manager.userId, ids)).toEqual([instanceId]);
    expect(await application.getActionableInstanceIdsForService(TENANT, backup.userId, ids)).toEqual([instanceId]);
    expect(await application.getActionableInstanceIdsForService(TENANT, outsider.userId, ids)).toEqual([]);
    expect(await application.getActionableInstanceIdsForService(TENANT, requester.userId, ids)).toEqual([]);
  });

  it('chỉ trả những mã được hỏi, bỏ mã lạ và người dùng không xác định được trong sơ đồ tổ chức', async () => {
    const { application, instanceId } = await startLeave();
    expect(
      await application.getActionableInstanceIdsForService(TENANT, backup.userId, ['khong-co', instanceId, instanceId]),
    ).toEqual([instanceId]);
    expect(await application.getActionableInstanceIdsForService(TENANT, 'khong-ai-biet', [instanceId])).toEqual([]);
    expect(await application.getActionableInstanceIdsForService(TENANT, '', [instanceId])).toEqual([]);
    expect(await application.getActionableInstanceIdsForService(TENANT, backup.userId, [])).toEqual([]);
  });

  it('quá 100 mã thì báo lỗi', async () => {
    const { application } = await startLeave();
    const many = Array.from({ length: 101 }, (_, index) => `id-${index}`);
    await expect(application.getActionableInstanceIdsForService(TENANT, backup.userId, many)).rejects.toThrow(/100/);
  });

  it('đơn đang ở bước S (nộp lại): không ai, kể cả người khởi tạo, bị đưa vào hàng chờ duyệt', async () => {
    const { application, instanceId } = await startLeave('A', false);
    const ids = [instanceId];
    expect(await application.getActionableInstanceIdsForService(TENANT, requester.userId, ids)).toEqual([]);
    expect(await application.getActionableInstanceIdsForService(TENANT, manager.userId, ids)).toEqual([]);
    expect(await application.getActionableInstanceIdsForService(TENANT, backup.userId, ids)).toEqual([]);
    expect(await application.getActionableInstanceIdsForService(TENANT, outsider.userId, ids)).toEqual([]);
  });

  it('vai R: người dự phòng không được giao khi đã có quản lý nên không xử lý được', async () => {
    const { application, instanceId } = await startLeave('R');
    expect(await application.getActionableInstanceIdsForService(TENANT, manager.userId, [instanceId])).toEqual([instanceId]);
    expect(await application.getActionableInstanceIdsForService(TENANT, backup.userId, [instanceId])).toEqual([]);
  });
});
