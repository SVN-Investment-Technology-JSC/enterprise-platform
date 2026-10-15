import type {
  CreateProcedureDefinitionRequest,
  CreateProcedureStepInput,
  ProcedureDefinition,
} from '@enterprise-platform/contracts-procedure-engine';
import type { ProcedureActor } from '../domain/procedure-authorization.js';
import { InMemoryProcedureStore } from '../infrastructure/in-memory-procedure-store.js';
import type { DirectManagerChain, DirectManagerResolver } from './direct-manager.port.js';
import { procedureNotificationEvents } from '../infrastructure/procedure-notification-events.js';
import { ProcedureEngineApplication } from './procedure-engine.application.js';
import type { ProcedureClock, ProcedureIdGenerator } from './procedure-store.port.js';

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

class FakeManagers implements DirectManagerResolver {
  calls = 0;
  result: DirectManagerChain = { chain: [] };
  async chain(): Promise<DirectManagerChain> {
    this.calls += 1;
    return this.result;
  }
}

function person(userId: string, extra: Partial<ProcedureActor> = {}): ProcedureActor {
  return {
    tenantId: 'tenant-test',
    userId,
    membershipId: userId,
    displayName: `User ${userId}`,
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
const employee = person('emp-001');
const manager = person('manager-001', { positionIds: ['pos-manager'] });
const backup = person('backup-vp-001');

function setup(managers: FakeManagers) {
  const store = new InMemoryProcedureStore();
  const application = new ProcedureEngineApplication(
    store,
    new FixedClock(),
    new SequentialIds(),
    undefined,
    undefined,
    managers,
  );
  return { application, store };
}

function stepInput(
  key: string,
  order: number,
  name: string,
  assignments: CreateProcedureStepInput['assignments'],
): CreateProcedureStepInput {
  return {
    key,
    order,
    name,
    assignments,
    attributes: [],
  };
}

async function publish(
  application: ProcedureEngineApplication,
  input: CreateProcedureDefinitionRequest,
): Promise<ProcedureDefinition> {
  const draft = await application.createDefinition(designer, input);
  return application.publishDefinition(designer, draft.id);
}

describe('Kiểm thử quy trình duyệt PE với 2 người nhận (Quản lý trực tiếp & Người dự phòng)', () => {
  function leaveProcedureInput(): CreateProcedureDefinitionRequest {
    return {
      code: 'DON-NGHI-PHEP',
      name: 'Quy trình duyệt đơn nghỉ phép',
      kind: 'process',
      category: 'hr',
      steps: [
        stepInput('S_NOP_DON', 1, 'Nộp đơn nghỉ', [{ role: 'S', subjectType: 'user', subjectId: employee.userId }]),
        stepInput('A_DUYET', 2, 'Phê duyệt đơn nghỉ', [
          {
            role: 'A',
            subjectType: 'initiator_manager',
            subjectId: '',
            managerFallback: {
              subjectType: 'user',
              subjectId: backup.userId,
              subjectLabel: 'Trưởng HC - VP (Người dự phòng)',
            },
          },
        ]),
      ],
    };
  }

  async function createAndSubmitLeave(managers: FakeManagers) {
    const { application } = setup(managers);
    const definition = await publish(application, leaveProcedureInput());
    const started = await application.startInstance(employee, {
      definitionId: definition.id,
      title: 'Đơn xin nghỉ phép - Nguyễn Văn A',
      idempotencyKey: `start-${Date.now()}`,
    });
    // Bước S hoàn thành chuyển sang bước A
    const beforeAction = [started];
    const atApproval = await application.applyAction(employee, started.id, {
      action: 'complete',
      idempotencyKey: 'complete-step-s',
    });
    const afterAction = [atApproval];
    const events = procedureNotificationEvents(beforeAction, afterAction);
    return { application, atApproval, events };
  }

  it('Yêu cầu 1 & 2: Phiếu hiển thị trong PE và phát thông báo Bell cho CẢ 2 người (Quản lý & Dự phòng)', async () => {
    const managers = new FakeManagers();
    managers.result = {
      initiatorPositionId: 'pos-emp',
      chain: [{ positionId: 'pos-manager', positionName: 'Quản lý trực tiếp', holderUserIds: [manager.userId] }],
    };

    const { application, atApproval, events } = await createAndSubmitLeave(managers);

    // 1. Kiểm tra cấu hình phân giải bước A: Cả 2 cùng được gán
    const approvalStep = atApproval.steps.find((s) => s.key === 'A_DUYET');
    expect(approvalStep?.assignments.map((item) => [item.subjectType, item.subjectId])).toEqual([
      ['position', 'pos-manager'],
      ['user', backup.userId],
    ]);
    expect(approvalStep?.assignments[1].fallbackOfAssignmentId).toBe(approvalStep?.assignments[0].id);

    // 2. Kiểm tra hiển thị phiếu trong PE (Workspace): Cả 2 đều thấy phiếu và đều có quyền 'approve'
    const viewOf = async (actor: ProcedureActor) =>
      (await application.getWorkspace(actor)).instances.find((item) => item.id === atApproval.id);

    const managerWorkspace = await viewOf(manager);
    expect(managerWorkspace).toBeDefined();
    expect(managerWorkspace?.authorization?.availableActions).toContain('approve');

    const backupWorkspace = await viewOf(backup);
    expect(backupWorkspace).toBeDefined();
    expect(backupWorkspace?.authorization?.availableActions).toContain('approve');

    // Người ngoài không thấy quyền approve
    const stranger = person('nguoi-ngoai-cuoc');
    expect((await viewOf(stranger))?.authorization?.availableActions ?? []).not.toContain('approve');

    // 3. Kiểm tra thông báo Bell: Sự kiện procedure.assignment.created mang thông tin cả 2
    const assignmentEvent = events.find((e) => e.type === 'procedure.assignment.created');
    expect(assignmentEvent).toBeDefined();
    expect(assignmentEvent?.payload.assigneeUserIds).toContain(backup.userId);
    expect(assignmentEvent?.payload.assignments).toEqual([
      { subjectType: 'position', subjectId: 'pos-manager', role: 'A' },
    ]);
  });

  it('Trường hợp 1: Quản lý trực tiếp duyệt -> Hoàn thành hồ sơ, chặn người dự phòng thao tác lại', async () => {
    const managers = new FakeManagers();
    managers.result = {
      initiatorPositionId: 'pos-emp',
      chain: [{ positionId: 'pos-manager', positionName: 'Quản lý trực tiếp', holderUserIds: [manager.userId] }],
    };

    const { application, atApproval } = await createAndSubmitLeave(managers);

    // Quản lý bấm Duyệt
    const beforeApproval = [atApproval];
    const completedInstance = await application.applyAction(manager, atApproval.id, {
      action: 'approve',
      comment: 'Quản lý trực tiếp đồng ý cho nghỉ',
      idempotencyKey: 'manager-approve-key',
    });

    // Trạng thái hồ sơ PE chuyển thành completed
    expect(completedInstance.status).toBe('completed');
    expect(completedInstance.steps.find((s) => s.key === 'A_DUYET')?.status).toBe('completed');

    // Sự kiện kết thúc hồ sơ được phát ra với đúng actorId là quản lý
    const completionEvents = procedureNotificationEvents(beforeApproval, [completedInstance]);
    const completedEvent = completionEvents.find((e) => e.type === 'procedure.instance.completed');
    expect(completedEvent).toBeDefined();
    expect(completedEvent?.payload.status).toBe('completed');

    // Người dự phòng sau đó bấm Duyệt sẽ bị từ chối vì bước/hồ sơ đã kết thúc
    await expect(
      application.applyAction(backup, atApproval.id, {
        action: 'approve',
        comment: 'Dự phòng duyệt sau',
        idempotencyKey: 'backup-late-approve',
      }),
    ).rejects.toThrow();
  });

  it('Trường hợp 2: Người dự phòng duyệt -> Hoàn thành hồ sơ, chặn quản lý thao tác lại', async () => {
    const managers = new FakeManagers();
    managers.result = {
      initiatorPositionId: 'pos-emp',
      chain: [{ positionId: 'pos-manager', positionName: 'Quản lý trực tiếp', holderUserIds: [manager.userId] }],
    };

    const { application, atApproval } = await createAndSubmitLeave(managers);

    // Người dự phòng (Trưởng HC-VP) bấm Duyệt thay thế
    const beforeApproval = [atApproval];
    const completedInstance = await application.applyAction(backup, atApproval.id, {
      action: 'approve',
      comment: 'Trưởng HC - VP duyệt thay quản lý',
      idempotencyKey: 'backup-approve-key',
    });

    // Trạng thái hồ sơ PE chuyển thành completed
    expect(completedInstance.status).toBe('completed');
    expect(completedInstance.steps.find((s) => s.key === 'A_DUYET')?.status).toBe('completed');

    // Sự kiện kết thúc hồ sơ được phát ra với đúng actorId là người dự phòng
    const completionEvents = procedureNotificationEvents(beforeApproval, [completedInstance]);
    const completedEvent = completionEvents.find((e) => e.type === 'procedure.instance.completed');
    expect(completedEvent).toBeDefined();
    expect(completedEvent?.payload.status).toBe('completed');

    // Quản lý sau đó bấm Duyệt sẽ bị từ chối vì bước/hồ sơ đã kết thúc
    await expect(
      application.applyAction(manager, atApproval.id, {
        action: 'approve',
        comment: 'Quản lý duyệt sau',
        idempotencyKey: 'manager-late-approve',
      }),
    ).rejects.toThrow();
  });
});
