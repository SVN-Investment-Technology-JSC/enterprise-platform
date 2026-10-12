import {
  PROCEDURE_EVERYONE_SUBJECT_ID,
  type CreateProcedureDefinitionRequest,
} from '@enterprise-platform/contracts-procedure-engine';
import { ProcedureEngineApplication } from './procedure-engine.application.js';
import type { ProcedureClock, ProcedureIdGenerator } from './procedure-store.port.js';
import type { ProcedureActor } from '../domain/procedure-authorization.js';
import { InMemoryProcedureStore } from '../infrastructure/in-memory-procedure-store.js';

class FixedClock implements ProcedureClock {
  now(): Date {
    return new Date('2026-08-15T10:00:00.000Z');
  }
}

class SequentialIds implements ProcedureIdGenerator {
  private value = 0;
  next(): string {
    this.value += 1;
    return `generated-${this.value.toString().padStart(4, '0')}`;
  }
}

const admin: ProcedureActor = {
  tenantId: 'tenant-a',
  userId: 'user-admin',
  displayName: 'Quản trị',
  canDesign: true,
  canPublish: true,
  canCreateInstances: true,
  isOverride: true,
  membershipId: 'm-admin',
  organizationUnitIds: [],
  positionIds: [],
};

/** Nhân viên thường: không giữ vai nào ở bất kỳ bước nào trừ khi được "everyone" cho phép. */
const employee = (userId: string): ProcedureActor => ({
  tenantId: 'tenant-a',
  userId,
  displayName: userId,
  canDesign: false,
  canPublish: false,
  canCreateInstances: true,
  isOverride: false,
  membershipId: `m-${userId}`,
  organizationUnitIds: [],
  positionIds: [],
});

const EVERYONE_S = {
  role: 'S',
  subjectType: 'everyone',
  subjectId: PROCEDURE_EVERYONE_SUBJECT_ID,
} as const;

function definition(
  firstStep: CreateProcedureDefinitionRequest['steps'][number]['assignments'],
): CreateProcedureDefinitionRequest {
  return {
    code: 'PROC-EVERYONE',
    name: 'Quy trình toàn bộ nhân viên',
    kind: 'process',
    category: 'technical',
    steps: [
      { key: 'REQUEST', order: 1, name: 'Lập đề nghị', assignments: firstStep },
      {
        key: 'APPROVE',
        order: 2,
        name: 'Phê duyệt',
        assignments: [{ role: 'A', subjectType: 'user', subjectId: 'user-approver' }],
      },
    ],
  };
}

describe('chủ thể "Toàn bộ nhân viên" (everyone) ở module Quy trình', () => {
  const setup = () =>
    new ProcedureEngineApplication(
      new InMemoryProcedureStore(),
      new FixedClock(),
      new SequentialIds(),
    );

  async function publishWithEveryone(application: ProcedureEngineApplication) {
    const draft = await application.createDefinition(admin, definition([EVERYONE_S]));
    return application.publishDefinition(admin, draft.id);
  }

  it('KB1: nhân viên bất kỳ (không được gán ở đâu) khởi tạo được hồ sơ', async () => {
    const application = setup();
    const published = await publishWithEveryone(application);
    const started = await application.startInstance(employee('user-a'), {
      definitionId: published.id,
      title: 'Hồ sơ của A',
      idempotencyKey: 'a-1',
    });
    expect(started.status).toBe('running');
    expect(started.initiatedBy).toBe('user-a');
  });

  it('KB2: thiếu "everyone" thì nhân viên không được phân vai vẫn bị từ chối khởi tạo', async () => {
    const application = setup();
    const draft = await application.createDefinition(
      admin,
      definition([{ role: 'S', subjectType: 'user', subjectId: 'user-someone-else' }]),
    );
    const published = await application.publishDefinition(admin, draft.id);
    await expect(
      application.startInstance(employee('user-a'), {
        definitionId: published.id,
        title: 'Không được',
        idempotencyKey: 'a-denied',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('KB3: "everyone" chỉ được gán vai S, vai khác bị từ chối khi lưu bản nháp', async () => {
    const application = setup();
    for (const role of ['R', 'A', 'C', 'I'] as const) {
      await expect(
        application.createDefinition(
          admin,
          definition([{ role, subjectType: 'everyone', subjectId: PROCEDURE_EVERYONE_SUBJECT_ID }]),
        ),
      ).rejects.toMatchObject({ code: 'validation' });
    }
  });

  it('KB4: "everyone" không cần subjectId cụ thể (không bị báo đối tượng trống)', async () => {
    const application = setup();
    const draft = await application.createDefinition(
      admin,
      definition([{ role: 'S', subjectType: 'everyone', subjectId: '' }]),
    );
    expect(draft.status).toBe('draft');
  });

  it('KB5: người khởi tạo hoàn thành được bước S của chính mình', async () => {
    const application = setup();
    const published = await publishWithEveryone(application);
    const owner = employee('user-a');
    const started = await application.startInstance(owner, {
      definitionId: published.id,
      title: 'Hồ sơ của A',
      idempotencyKey: 'a-2',
    });
    const next = await application.applyAction(owner, started.id, {
      action: 'complete',
      idempotencyKey: 'a-2-complete',
    });
    expect(next.authorization?.currentRoleStage).toBe('A');
  });

  it('KB6: nhân viên khác không thao tác được trên hồ sơ của người khởi tạo', async () => {
    const application = setup();
    const published = await publishWithEveryone(application);
    const started = await application.startInstance(employee('user-a'), {
      definitionId: published.id,
      title: 'Hồ sơ của A',
      idempotencyKey: 'a-3',
    });
    await expect(
      application.applyAction(employee('user-b'), started.id, {
        action: 'complete',
        idempotencyKey: 'b-complete',
      }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/forbidden|not_found/) });
  });

  it('KB7: nhân viên khác không thấy hồ sơ của người khác trong workspace', async () => {
    const application = setup();
    const published = await publishWithEveryone(application);
    const started = await application.startInstance(employee('user-a'), {
      definitionId: published.id,
      title: 'Hồ sơ của A',
      idempotencyKey: 'a-4',
    });
    const forB = await application.getWorkspace(employee('user-b'));
    expect(forB.instances.map((item) => item.id)).not.toContain(started.id);
    const forA = await application.getWorkspace(employee('user-a'));
    expect(forA.instances.map((item) => item.id)).toContain(started.id);
  });

  it('KB8: sau bước S, người khởi tạo không tự duyệt được bước A (RACI vẫn giữ nguyên)', async () => {
    const application = setup();
    const published = await publishWithEveryone(application);
    const owner = employee('user-a');
    const started = await application.startInstance(owner, {
      definitionId: published.id,
      title: 'Hồ sơ của A',
      idempotencyKey: 'a-5',
    });
    await application.applyAction(owner, started.id, {
      action: 'complete',
      idempotencyKey: 'a-5-complete',
    });
    await expect(
      application.applyAction(owner, started.id, { action: 'approve', idempotencyKey: 'a-5-approve' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const approver = { ...employee('user-approver'), canCreateInstances: false };
    const done = await application.applyAction(approver, started.id, {
      action: 'approve',
      idempotencyKey: 'a-5-approve-ok',
    });
    expect(done.status).toBe('completed');
  });

  it('KB9: hai nhân viên cùng khởi tạo, mỗi người chỉ thao tác hồ sơ của mình', async () => {
    const application = setup();
    const published = await publishWithEveryone(application);
    const a = employee('user-a');
    const b = employee('user-b');
    const ia = await application.startInstance(a, { definitionId: published.id, title: 'A', idempotencyKey: 'ka' });
    const ib = await application.startInstance(b, { definitionId: published.id, title: 'B', idempotencyKey: 'kb' });
    await expect(
      application.applyAction(a, ib.id, { action: 'complete', idempotencyKey: 'a-on-b' }),
    ).rejects.toBeDefined();
    const okB = await application.applyAction(b, ib.id, { action: 'complete', idempotencyKey: 'b-on-b' });
    expect(okB.authorization?.currentRoleStage).toBe('A');
    expect((await application.getWorkspace(a)).instances.map((item) => item.id)).toEqual([ia.id]);
  });
});
