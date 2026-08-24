import type {
  ProcedureDefinition,
  ProcedureRaciAssignment,
  ProcedureStepDefinition,
} from '@enterprise-platform/contracts-procedure-engine';
import type {
  ProcedureStore,
  ProcedureTenantState,
} from '../application/procedure-store.port.js';

export class InMemoryProcedureStore implements ProcedureStore {
  private readonly states = new Map<string, ProcedureTenantState>();
  private readonly queues = new Map<string, Promise<void>>();

  async read(tenantId: string): Promise<ProcedureTenantState> {
    await (this.queues.get(tenantId) ?? Promise.resolve());
    return structuredClone(this.ensureState(tenantId));
  }

  async transaction<TValue>(
    tenantId: string,
    operation: (state: ProcedureTenantState) => Promise<TValue> | TValue,
  ): Promise<TValue> {
    const previous = this.queues.get(tenantId) ?? Promise.resolve();
    const run = previous.then(async () => {
      const working = structuredClone(this.ensureState(tenantId));
      const result = await operation(working);
      this.states.set(tenantId, working);
      return structuredClone(result);
    });
    this.queues.set(
      tenantId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  private ensureState(tenantId: string): ProcedureTenantState {
    const existing = this.states.get(tenantId);
    if (existing) return existing;
    const state = seedTenantState();
    this.states.set(tenantId, state);
    return state;
  }
}

function assignment(
  id: string,
  role: ProcedureRaciAssignment['role'],
): ProcedureRaciAssignment {
  return {
    id,
    role,
    subjectType: 'user',
    subjectId: 'user-superadmin',
    subjectLabel: 'Quản trị hệ thống',
    ...(role === 'E' ? { eTaskSource: 'manual' as const } : {}),
  };
}

function step(
  id: string,
  key: string,
  order: number,
  name: string,
  roles: ProcedureRaciAssignment['role'][],
): ProcedureStepDefinition {
  return {
    id,
    key,
    order,
    name,
    assignments: roles.map((role, index) =>
      assignment(`${id}-assignment-${index + 1}`, role),
    ),
  };
}

function seedTenantState(): ProcedureTenantState {
  const now = new Date().toISOString();
  const definitions: ProcedureDefinition[] = [
    {
      id: 'definition-purchase-request',
      code: 'PROC-PURCHASE',
      name: 'Đề nghị mua sắm thiết bị',
      description:
        'Luồng mẫu gồm đề xuất, kiểm tra và phê duyệt.',
      kind: 'process',
      status: 'published',
      versionNumber: 1,
      steps: [
        step('purchase-step-request', 'REQUEST', 1, 'Lập đề nghị', ['S', 'R']),
        step('purchase-step-review', 'REVIEW', 2, 'Kiểm tra hồ sơ', ['C']),
        step('purchase-step-approve', 'APPROVE', 3, 'Phê duyệt cuối', [
          'A',
          'I',
        ]),
      ],
      createdAt: now,
      updatedAt: now,
      publishedAt: now,
    },
    {
      id: 'definition-maintenance-execution',
      code: 'PROC-MAINTENANCE',
      name: 'Luồng thực thi bảo trì',
      description:
        'Bản nháp minh họa liên kết Procedure với dữ liệu thiết bị thuộc Platform.',
      kind: 'maintenance_linked',
      status: 'draft',
      versionNumber: 0,
      steps: [
        step('maintenance-step-prepare', 'PREPARE', 1, 'Chuẩn bị công việc', [
          'R',
        ]),
        step('maintenance-step-execute', 'EXECUTE', 2, 'Thực hiện bảo trì', [
          'E',
          'C',
        ]),
      ],
      createdAt: now,
      updatedAt: now,
    },
  ];
  return { definitions, instances: [], idempotency: {} };
}
