import {
  PROCEDURE_SYSTEM_ACTOR_ID,
  type ApplyProcedureActionRequest,
  type CreateProcedureDefinitionRequest,
  type CreateProcedureInstanceRequest,
  type ProcedureDefinition,
  type ProcedureInstance,
  type ProcedureInstanceStep,
  type ProcedureRuntimeAction,
  type ProcedureWorkspace,
  type StartProcedureInstanceRequest,
} from '@enterprise-platform/contracts-procedure-engine';
import {
  deriveProcedureAuthorization,
  matchesProcedureAssignment,
  runtimeStages,
  type ProcedureActor,
} from '../domain/procedure-authorization.js';
import {
  validateDefinitionDraft,
  validateDefinitionForPublish,
} from '../domain/procedure-definition.policy.js';
import { ProcedureEngineError } from '../domain/procedure-engine.error.js';
import type {
  ProcedureClock,
  ProcedureIdGenerator,
  ProcedureStore,
} from './procedure-store.port.js';

export class ProcedureEngineApplication {
  constructor(
    private readonly store: ProcedureStore,
    private readonly clock: ProcedureClock,
    private readonly ids: ProcedureIdGenerator,
  ) {}

  async getWorkspace(actor: ProcedureActor): Promise<ProcedureWorkspace> {
    const state = await this.store.read(actor.tenantId);

    // Merge instances from all sources (manual, maintenance_occurrence, etc.)
    // User workspace shows all work orders they're assigned to, regardless of origin
    const allInstances = [...state.instances]
      .filter((instance) => {
        // Show instances where user is assigned to any current role
        const currentStep = instance.steps.find((step) => step.id === instance.currentStepId);
        if (!currentStep) return false;

        // Check if user/org/position matches any assignment in current step
        return currentStep.assignments.some((assignment) =>
          matchesProcedureAssignment(assignment, actor),
        );
      })
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .map((instance) => this.withAuthorization(instance, actor));

    return {
      tenantId: actor.tenantId,
      actor: { id: actor.userId, name: actor.displayName },
      permissions: {
        canManageDefinitions: actor.isOverride,
        canPublishDefinitions: actor.isOverride,
        canCreateInstances: actor.isOverride,
        canOverrideActions: actor.isOverride,
      },
      definitions: [...state.definitions].sort((left, right) =>
        left.name.localeCompare(right.name, 'vi'),
      ),
      instances: allInstances,
    };
  }

  async createDefinition(
    actor: ProcedureActor,
    input: CreateProcedureDefinitionRequest,
  ): Promise<ProcedureDefinition> {
    this.requireDesigner(actor);
    validateDefinitionDraft(input);
    return this.store.transaction(actor.tenantId, (state) => {
      const code = input.code.trim().toUpperCase();
      if (state.definitions.some((definition) => definition.code === code)) {
        throw new ProcedureEngineError(
          'conflict',
          `Mã quy trình “${code}” đã tồn tại.`,
        );
      }
      const now = this.clock.now().toISOString();
      const definition: ProcedureDefinition = {
        id: this.ids.next(),
        code,
        name: input.name.trim(),
        description: input.description?.trim() || undefined,
        kind: input.kind,
        status: 'draft',
        versionNumber: 0,
        steps: [...input.steps]
          .sort((left, right) => left.order - right.order)
          .map((step) => ({
            id: this.ids.next(),
            key: step.key.trim().toUpperCase(),
            order: step.order,
            name: step.name.trim(),
            description: step.description?.trim() || undefined,
            linkedDefinitionId: step.linkedDefinitionId,
            assignments: step.assignments.map((assignment) => ({
              id: this.ids.next(),
              ...assignment,
              subjectId: assignment.subjectId.trim(),
              subjectLabel: assignment.subjectLabel?.trim() || undefined,
            })),
          })),
        createdAt: now,
        updatedAt: now,
      };
      state.definitions.push(definition);
      return definition;
    });
  }

  async publishDefinition(
    actor: ProcedureActor,
    definitionId: string,
  ): Promise<ProcedureDefinition> {
    this.requireDesigner(actor);
    return this.store.transaction(actor.tenantId, (state) => {
      const definition = this.requireDefinition(
        state.definitions,
        definitionId,
      );
      validateDefinitionForPublish(definition);
      const now = this.clock.now().toISOString();
      definition.status = 'published';
      definition.versionNumber = 1;
      definition.updatedAt = now;
      definition.publishedAt = now;
      return definition;
    });
  }

  async startInstance(
    actor: ProcedureActor,
    input: StartProcedureInstanceRequest,
  ): Promise<ProcedureInstance> {
    if (!input.idempotencyKey?.trim()) {
      throw new ProcedureEngineError(
        'validation',
        'Cần idempotency key khi khởi tạo hồ sơ.',
      );
    }
    if (!input.title?.trim() || input.title.trim().length > 255) {
      throw new ProcedureEngineError(
        'validation',
        'Tiêu đề hồ sơ là bắt buộc và không vượt quá 255 ký tự.',
      );
    }

    const result = await this.store.transaction(actor.tenantId, (state) => {
      const idempotencyKey = `start:${input.idempotencyKey.trim()}`;
      const existingId = state.idempotency[idempotencyKey];
      if (existingId) {
        const existing = state.instances.find(
          (instance) => instance.id === existingId,
        );
        if (existing) return existing;
      }
      const definition = this.requireDefinition(
        state.definitions,
        input.definitionId,
      );
      if (definition.status !== 'published') {
        throw new ProcedureEngineError(
          'conflict',
          'Quy trình chưa được công bố.',
        );
      }
      const canSubmit = definition.steps.some((step) =>
        step.assignments.some(
          (assignment) =>
            assignment.role === 'S' &&
            matchesProcedureAssignment(assignment, actor),
        ),
      );
      if (!actor.isOverride && !canSubmit) {
        throw new ProcedureEngineError(
          'forbidden',
          'Bạn chưa được phân vai S để khởi tạo quy trình này.',
        );
      }

      const now = this.clock.now().toISOString();
      const instanceId = this.ids.next();
      const steps: ProcedureInstanceStep[] = definition.steps.map(
        (step, index) => {
          const currentRoleStage = runtimeStages(step.assignments)[0] ?? null;
          return {
            id: this.ids.next(),
            definitionStepId: step.id,
            key: step.key,
            order: step.order,
            name: step.name,
            status:
              index === 0
                ? currentRoleStage === 'C' || currentRoleStage === 'A'
                  ? 'ready'
                  : 'active'
                : 'pending',
            currentRoleStage,
            assignments: structuredClone(step.assignments),
            startedAt: index === 0 ? now : undefined,
          };
        },
      );
      const instance: ProcedureInstance = {
        id: instanceId,
        code: this.createInstanceCode(now, instanceId),
        title: input.title.trim(),
        definitionId: definition.id,
        definitionCode: definition.code,
        definitionName: definition.name,
        definitionVersion: definition.versionNumber,
        status: 'running',
        currentStepId: steps[0]?.id,
        initiatedBy: actor.userId,
        sourceType: input.sourceType ?? 'manual',
        sourceId: input.sourceId,
        startedAt: now,
        steps,
        activity: [
          {
            id: this.ids.next(),
            action: 'start',
            actorId: actor.userId,
            actorName: actor.displayName,
            summary: `Khởi tạo quy trình “${definition.name}”.`,
            createdAt: now,
          },
        ],
      };
      state.instances.push(instance);
      state.idempotency[idempotencyKey] = instance.id;
      return instance;
    });
    return this.withAuthorization(result, actor);
  }

  async createInstance(
    tenantId: string,
    input: CreateProcedureInstanceRequest,
  ): Promise<{ id: string; code: string }> {
    // External API to create procedure instance from Maintenance or other modules
    // Used as: POST /v1/instances with CreateProcedureInstanceRequest
    if (!input.definitionId?.trim()) {
      throw new ProcedureEngineError(
        'validation',
        'definitionId là bắt buộc.',
      );
    }
    if (!input.idempotencyKey?.trim()) {
      throw new ProcedureEngineError(
        'validation',
        'idempotencyKey là bắt buộc.',
      );
    }

    // A service, not a person, is starting this. initiated_by is a uuid column,
    // so the provenance goes to sourceType/sourceId rather than into the actor id.
    const systemActor: ProcedureActor = {
      tenantId,
      userId: PROCEDURE_SYSTEM_ACTOR_ID,
      membershipId: PROCEDURE_SYSTEM_ACTOR_ID,
      displayName: `Hệ thống (${input.sourceType ?? 'service'})`,
      isOverride: true,
      organizationUnitIds: [],
      positionIds: [],
    };

    const instance = await this.startInstance(systemActor, {
      definitionId: input.definitionId,
      title: input.title || `Công việc từ ${input.sourceType || 'API'}`,
      idempotencyKey: `${input.sourceType || 'external'}:${input.idempotencyKey}`,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
    });

    // Return minimal response (id, code) for external callers
    return { id: instance.id, code: instance.code };
  }

  async applyAction(
    actor: ProcedureActor,
    instanceId: string,
    input: ApplyProcedureActionRequest,
  ): Promise<ProcedureInstance> {
    if (!input.idempotencyKey?.trim()) {
      throw new ProcedureEngineError(
        'validation',
        'Cần idempotency key khi xử lý hồ sơ.',
      );
    }
    const result = await this.store.transaction(actor.tenantId, (state) => {
      const instance = state.instances.find(
        (candidate) => candidate.id === instanceId,
      );
      if (!instance) {
        throw new ProcedureEngineError(
          'not_found',
          'Không tìm thấy phiên quy trình.',
        );
      }
      const idempotencyKey = `action:${input.idempotencyKey.trim()}`;
      if (state.idempotency[idempotencyKey] === instance.id) return instance;
      if (instance.status !== 'running') {
        throw new ProcedureEngineError(
          'conflict',
          'Phiên quy trình không còn chạy.',
        );
      }
      const authorization = deriveProcedureAuthorization(instance, actor);
      if (!authorization.availableActions.includes(input.action)) {
        throw new ProcedureEngineError(
          'forbidden',
          'Vai trò RCSI hiện tại không cho phép thực hiện thao tác này.',
        );
      }
      if (input.action === 'comment' && !input.comment?.trim()) {
        throw new ProcedureEngineError(
          'validation',
          'Nội dung trao đổi không được để trống.',
        );
      }

      const currentIndex = instance.steps.findIndex(
        (step) => step.id === instance.currentStepId,
      );
      const current =
        currentIndex >= 0 ? instance.steps[currentIndex] : undefined;
      const now = this.clock.now().toISOString();

      switch (input.action) {
        case 'comment':
          break;
        case 'cancel':
          instance.status = 'cancelled';
          instance.completedAt = now;
          if (current) {
            current.status = 'cancelled';
            current.completedAt = now;
          }
          break;
        case 'reject':
          if (!current) this.noCurrentStep();
          current.status = 'rejected';
          current.completedAt = now;
          instance.status = 'rejected';
          instance.completedAt = now;
          break;
        case 'return':
          if (!current || currentIndex <= 0) {
            throw new ProcedureEngineError(
              'validation',
              'Không có bước trước để trả lại.',
            );
          }
          this.returnToPreviousStep(instance, currentIndex, now);
          break;
        case 'complete':
        case 'approve':
          if (!current) this.noCurrentStep();
          this.advance(instance, currentIndex, now);
          break;
      }

      instance.activity.unshift({
        id: this.ids.next(),
        action: input.action,
        actorId: actor.userId,
        actorName: actor.displayName,
        summary: this.actionSummary(input.action),
        comment: input.comment?.trim() || undefined,
        createdAt: now,
      });
      state.idempotency[idempotencyKey] = instance.id;
      return instance;
    });
    return this.withAuthorization(result, actor);
  }

  private advance(
    instance: ProcedureInstance,
    currentIndex: number,
    now: string,
  ): void {
    const current = instance.steps[currentIndex];
    if (!current) this.noCurrentStep();
    const stages = runtimeStages(current.assignments);
    const stageIndex = current.currentRoleStage
      ? stages.indexOf(current.currentRoleStage)
      : -1;
    const nextStage = stages[stageIndex + 1];
    if (nextStage) {
      current.currentRoleStage = nextStage;
      current.status =
        nextStage === 'C' || nextStage === 'A' ? 'ready' : 'active';
      return;
    }

    current.status = 'completed';
    current.completedAt = now;
    const next = instance.steps[currentIndex + 1];
    if (next) {
      const firstStage = runtimeStages(next.assignments)[0] ?? null;
      next.currentRoleStage = firstStage;
      next.status =
        firstStage === 'C' || firstStage === 'A' ? 'ready' : 'active';
      next.startedAt = now;
      instance.currentStepId = next.id;
      return;
    }

    instance.status = 'completed';
    instance.currentStepId = undefined;
    instance.completedAt = now;
  }

  private returnToPreviousStep(
    instance: ProcedureInstance,
    currentIndex: number,
    now: string,
  ): void {
    const current = instance.steps[currentIndex];
    if (!current) this.noCurrentStep();
    const configuredTarget =
      current.currentRoleStage === 'C'
        ? current.assignments.find(
            (assignment) =>
              assignment.role === 'C' && assignment.fixedRollbackStepId,
          )?.fixedRollbackStepId
        : undefined;
    const configuredIndex = configuredTarget
      ? instance.steps.findIndex(
          (step) => step.definitionStepId === configuredTarget,
        )
      : -1;
    const targetIndex =
      configuredIndex >= 0 ? configuredIndex : currentIndex - 1;
    if (targetIndex < 0 || targetIndex >= currentIndex) {
      throw new ProcedureEngineError(
        'validation',
        'Bước quay về không hợp lệ.',
      );
    }
    current.status = 'returned';
    current.completedAt = now;
    for (
      let index = targetIndex + 1;
      index < instance.steps.length;
      index += 1
    ) {
      const step = instance.steps[index];
      if (!step || step.id === current.id) continue;
      step.status = 'pending';
      step.startedAt = undefined;
      step.completedAt = undefined;
      step.currentRoleStage = runtimeStages(step.assignments)[0] ?? null;
    }
    const target = instance.steps[targetIndex];
    if (!target) this.noCurrentStep();
    const firstStage = runtimeStages(target.assignments)[0] ?? null;
    target.currentRoleStage = firstStage;
    target.status =
      firstStage === 'C' || firstStage === 'A' ? 'ready' : 'active';
    target.startedAt = now;
    target.completedAt = undefined;
    instance.currentStepId = target.id;
  }

  private withAuthorization(
    instance: ProcedureInstance,
    actor: ProcedureActor,
  ): ProcedureInstance {
    return {
      ...instance,
      authorization: deriveProcedureAuthorization(instance, actor),
    };
  }

  private requireDefinition(
    definitions: ProcedureDefinition[],
    definitionId: string,
  ): ProcedureDefinition {
    const definition = definitions.find(
      (candidate) => candidate.id === definitionId,
    );
    if (!definition) {
      throw new ProcedureEngineError('not_found', 'Không tìm thấy quy trình.');
    }
    return definition;
  }

  private requireDesigner(actor: ProcedureActor): void {
    if (!actor.isOverride) {
      throw new ProcedureEngineError(
        'forbidden',
        'Bạn không có quyền thiết kế hoặc công bố quy trình.',
      );
    }
  }

  private noCurrentStep(): never {
    throw new ProcedureEngineError('conflict', 'Không có bước đang xử lý.');
  }

  private createInstanceCode(now: string, id: string): string {
    return `PR-${now.slice(0, 10).replaceAll('-', '')}-${id.slice(0, 6).toUpperCase()}`;
  }

  private actionSummary(action: ProcedureRuntimeAction): string {
    const labels: Record<ProcedureRuntimeAction, string> = {
      approve: 'Đã phê duyệt pha xử lý hiện tại.',
      reject: 'Đã từ chối phiên quy trình.',
      return: 'Đã trả hồ sơ về bước trước.',
      complete: 'Đã hoàn tất pha xử lý hiện tại.',
      cancel: 'Đã hủy phiên quy trình.',
      comment: 'Đã thêm trao đổi vào hồ sơ.',
    };
    return labels[action];
  }
}
