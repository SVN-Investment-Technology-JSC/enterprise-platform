import type { CreateProcedureDefinitionRequest } from '@enterprise-platform/contracts-procedure-engine';
import { ProcedureEngineApplication } from './procedure-engine.application.js';
import type {
  ProcedureClock,
  ProcedureIdGenerator,
} from './procedure-store.port.js';
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

const actor: ProcedureActor = {
  tenantId: 'tenant-a',
  userId: 'user-superadmin',
  displayName: 'Quản trị hệ thống',
  isOverride: true,
  membershipId: '20000000-0000-4000-8000-000000000001',
  organizationUnitIds: [],
  positionIds: [],
};

function definitionInput(): CreateProcedureDefinitionRequest {
  return {
    code: 'PROC-TEST',
    name: 'Quy trình kiểm thử',
    kind: 'process',
    steps: [
      {
        key: 'REQUEST',
        order: 1,
        name: 'Lập đề nghị',
        assignments: [
          {
            role: 'S',
            subjectType: 'user',
            subjectId: actor.userId,
          },
        ],
      },
      {
        key: 'APPROVE',
        order: 2,
        name: 'Phê duyệt',
        assignments: [
          {
            role: 'A',
            subjectType: 'user',
            subjectId: actor.userId,
          },
        ],
      },
    ],
  };
}

describe('ProcedureEngineApplication', () => {
  function setup() {
    return new ProcedureEngineApplication(
      new InMemoryProcedureStore(),
      new FixedClock(),
      new SequentialIds(),
    );
  }

  it('runs the first vertical slice from draft to completed instance', async () => {
    const application = setup();
    const draft = await application.createDefinition(actor, definitionInput());
    const published = await application.publishDefinition(actor, draft.id);
    const started = await application.startInstance(actor, {
      definitionId: published.id,
      title: 'Đề nghị thử nghiệm',
      idempotencyKey: 'start-001',
    });

    expect(started.status).toBe('running');
    expect(started.authorization?.currentRoleStage).toBe('S');

    const awaitingApproval = await application.applyAction(actor, started.id, {
      action: 'complete',
      idempotencyKey: 'action-001',
    });
    expect(awaitingApproval.authorization?.currentRoleStage).toBe('A');

    const completed = await application.applyAction(actor, started.id, {
      action: 'approve',
      idempotencyKey: 'action-002',
    });
    expect(completed.status).toBe('completed');
    expect(completed.steps.every((step) => step.status === 'completed')).toBe(
      true,
    );
  });

  it('keeps state isolated by tenant', async () => {
    const application = setup();
    const workspaceA = await application.getWorkspace(actor);
    const published = workspaceA.definitions.find(
      (definition) => definition.status === 'published',
    );
    expect(published).toBeDefined();
    await application.startInstance(actor, {
      definitionId: published?.id ?? '',
      title: 'Chỉ thuộc tenant A',
      idempotencyKey: 'tenant-a-start',
    });

    const workspaceB = await application.getWorkspace({
      ...actor,
      tenantId: 'tenant-b',
    });
    expect(workspaceB.instances).toHaveLength(0);
  });

  it('returns the same instance for a repeated idempotency key', async () => {
    const application = setup();
    const workspace = await application.getWorkspace(actor);
    const published = workspace.definitions.find(
      (definition) => definition.status === 'published',
    );
    const request = {
      definitionId: published?.id ?? '',
      title: 'Yêu cầu idempotent',
      idempotencyKey: 'same-command',
    };

    const first = await application.startInstance(actor, request);
    const second = await application.startInstance(actor, request);
    expect(second.id).toBe(first.id);
  });
});
