import type {
  CreateProcedureDefinitionRequest,
  ProcedureInstance,
} from '@enterprise-platform/contracts-procedure-engine';
import type { ProcedureActor } from '../domain/procedure-authorization.js';
import { InMemoryProcedureStore } from '../infrastructure/in-memory-procedure-store.js';
import type { InstanceReversalGuard } from './instance-reversal-guard.port.js';
import { ProcedureEngineApplication } from './procedure-engine.application.js';
import type { ProcedureClock, ProcedureIdGenerator } from './procedure-store.port.js';

const TENANT = 'tenant-reverse';

class FixedClock implements ProcedureClock {
  now(): Date {
    return new Date('2026-10-09T08:00:00.000Z');
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

const admin = person('admin', { canDesign: true, canPublish: true, isOverride: true });
const employee = person('nhan-vien');
const approver = person('truong-phong');

const input: CreateProcedureDefinitionRequest = {
  code: 'DE-NGHI',
  name: 'Đề nghị',
  kind: 'process',
  category: 'hr',
  steps: [
    {
      key: 'LAP',
      order: 1,
      name: 'Lập đề nghị',
      assignments: [{ role: 'S', subjectType: 'user', subjectId: employee.userId }],
    },
    {
      key: 'DUYET',
      order: 2,
      name: 'Phê duyệt',
      assignments: [{ role: 'A', subjectType: 'user', subjectId: approver.userId }],
    },
  ],
};

function setup(guard?: InstanceReversalGuard) {
  const store = new InMemoryProcedureStore();
  const application = new ProcedureEngineApplication(
    store,
    new FixedClock(),
    new SequentialIds(),
    undefined,
    undefined,
    undefined,
    undefined,
    guard,
  );
  return { store, application };
}

async function completed(application: ProcedureEngineApplication): Promise<ProcedureInstance> {
  const draft = await application.createDefinition(admin, input);
  const definition = await application.publishDefinition(admin, draft.id);
  const started = await application.startInstance(employee, {
    definitionId: definition.id,
    title: 'Đề nghị mua máy',
    idempotencyKey: 'start-1',
  });
  return finish(application, started.id, 'start-1');
}

/** S hoàn tất bước lập, A duyệt: hồ sơ sang `completed`. */
async function finish(application: ProcedureEngineApplication, instanceId: string, key: string) {
  await application.applyAction(employee, instanceId, { action: 'complete', idempotencyKey: `${key}:complete` });
  return application.applyAction(approver, instanceId, { action: 'approve', idempotencyKey: `${key}:approve` });
}

describe('Huỷ hiệu lực hồ sơ', () => {
  it('chuyển hồ sơ đã hoàn thành sang reversed, giữ lịch sử và idempotent', async () => {
    const { application } = setup();
    const done = await completed(application);
    expect(done.status).toBe('completed');

    const reversed = await application.reverseInstance(admin, done.id, {
      reason: 'Sai số tiền đề nghị',
      createAdjustment: true,
    });
    expect(reversed.status).toBe('reversed');
    expect(reversed.reversal).toMatchObject({
      reversedBy: admin.userId,
      reason: 'Sai số tiền đề nghị',
      adjustmentRequested: true,
    });
    expect(reversed.activity[0]).toMatchObject({ action: 'reverse', comment: 'Sai số tiền đề nghị' });
    expect(reversed.activity.some((entry) => entry.action === 'complete')).toBe(true);

    const again = await application.reverseInstance(admin, done.id, {
      reason: 'Lần hai',
      createAdjustment: false,
    });
    expect(again.reversal?.reason).toBe('Sai số tiền đề nghị');
  });

  it('chỉ Quản trị viên được huỷ hiệu lực, chỉ với hồ sơ đã hoàn thành', async () => {
    const { application } = setup();
    const done = await completed(application);
    await expect(
      application.reverseInstance(employee, done.id, { reason: 'Muốn huỷ', createAdjustment: false }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      application.reverseInstance(admin, done.id, { reason: 'x', createAdjustment: false }),
    ).rejects.toMatchObject({ code: 'validation' });

    const running = await application.startInstance(employee, {
      definitionId: done.definitionId,
      title: 'Đang chạy',
      idempotencyKey: 'start-2',
    });
    await expect(
      application.reverseInstance(admin, running.id, { reason: 'Chưa xong', createAdjustment: false }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('hồ sơ điều chỉnh liên kết với hồ sơ gốc đã huỷ hiệu lực', async () => {
    const { application } = setup();
    const done = await completed(application);
    await expect(
      application.startInstance(employee, {
        definitionId: done.definitionId,
        title: 'Điều chỉnh sớm',
        idempotencyKey: 'adjust-0',
        adjustmentOfInstanceId: done.id,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });

    await application.reverseInstance(admin, done.id, { reason: 'Sai số tiền', createAdjustment: true });
    const adjustment = await application.startInstance(employee, {
      definitionId: done.definitionId,
      title: `Điều chỉnh ${done.code}`,
      idempotencyKey: 'adjust-1',
      adjustmentOfInstanceId: done.id,
    });
    expect(adjustment.adjustmentOf).toEqual({ instanceId: done.id, instanceCode: done.code });

    await expect(
      application.startInstance(employee, {
        definitionId: done.definitionId,
        title: 'Điều chỉnh lần hai',
        idempotencyKey: 'adjust-2',
        adjustmentOfInstanceId: done.id,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('đơn HRM: chặn khi HRM trả lời không huỷ được (kỳ lương đã chốt)', async () => {
    const guard: InstanceReversalGuard = {
      check: jest.fn().mockResolvedValue({ allowed: false, reason: 'Đơn HRM: Kỳ lương đã chốt' }),
    };
    const { application } = setup(guard);
    const draft = await application.createDefinition(admin, input);
    const definition = await application.publishDefinition(admin, draft.id);
    const created = await application.createInstance(TENANT, {
      definitionId: definition.id,
      title: 'Đơn nghỉ',
      sourceType: 'hrm_request',
      sourceId: 'link-1',
      initiatedBy: employee.userId,
      initiatedByName: 'Nhân viên',
      idempotencyKey: 'hrm-1',
      expectedDefinitionSnapshot: definition,
    });
    const done = await finish(application, created.id, 'hrm-1');
    expect(done.status).toBe('completed');
    await expect(
      application.reverseInstance(admin, done.id, { reason: 'Sai ngày nghỉ', createAdjustment: false }),
    ).rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining('Kỳ lương đã chốt') });
    expect(guard.check).toHaveBeenCalledWith(TENANT, { sourceType: 'hrm_request', sourceId: 'link-1' });
  });
});
