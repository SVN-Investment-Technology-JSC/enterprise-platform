import type { InventoryTaskTemplateResolver } from './inventory-task-template.port.js';
import {
  PROCEDURE_SYSTEM_ACTOR_ID,
  type ApplyProcedureActionRequest,
  type CreateProcedureDefinitionRequest,
  type CreateProcedureDelegationRequest,
  type CreateProcedureInstanceRequest,
  type ProcedureStepMaterial,
  type ProcedureStepMaterialCheck,
  type ProcedureSubtask,
  type ProcedureSubtaskInput,
  type SetProcedureSubtasksRequest,
  type ProcedureDefinition,
  type ProcedureInstance,
  type ProcedureInstanceStep,
  type ProcedureRuntimeAction,
  type ProcedureWorkspace,
  type PostProcedureCommentRequest,
  type ProcedureInstanceSourceType,
  type StartProcedureInstanceRequest,
  type UpdateProcedureDefinitionRequest,
} from '@enterprise-platform/contracts-procedure-engine';
import {
  deriveProcedureAuthorization,
  isProcedureParticipant,
  matchesProcedureAssignment,
  runtimeStages,
  type ProcedureActor,
} from '../domain/procedure-authorization.js';
import {
  validateDefinitionDraft,
  validateDefinitionForPublish,
} from '../domain/procedure-definition.policy.js';
import { ProcedureEngineError } from '../domain/procedure-engine.error.js';
import type { SubtaskEvidenceCounter } from './subtask-evidence.port.js';
import { computeSlaDueAt } from '@enterprise-platform/contracts-procedure-engine';
import type {
  ProcedureClock,
  ProcedureIdGenerator,
  ProcedureStore,
  ProcedureTenantState,
} from './procedure-store.port.js';

export class ProcedureEngineApplication {
  constructor(
    private readonly store: ProcedureStore,
    private readonly clock: ProcedureClock,
    private readonly ids: ProcedureIdGenerator,
    /** Absent in deployments without the Inventory module; publishing a
     *  definition that sources Role E tasks from Inventory then fails loudly. */
    private readonly inventoryTasks?: InventoryTaskTemplateResolver,
    /** Absent in deployments without object storage; evidence is then not enforced. */
    private readonly attachments?: SubtaskEvidenceCounter,
  ) {}

  async getWorkspace(actor: ProcedureActor): Promise<ProcedureWorkspace> {
    const state = await this.store.read(actor.tenantId);

    // A participant sees every work order they are named in — at any step, not
    // only the current one — so an approver at step 4 can watch it approach while
    // it sits at step 2. Origin does not matter: manual and maintenance-generated
    // work orders appear in the same list.
    const visibleInstances = [...state.instances]
      .filter((instance) => isProcedureParticipant(instance, actor))
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .map((instance) => this.withAuthorization(instance, actor));

    return {
      tenantId: actor.tenantId,
      actor: { id: actor.userId, name: actor.displayName },
      permissions: {
        canManageDefinitions: actor.canDesign,
        canPublishDefinitions: actor.canDesign,
        canCreateInstances: actor.canDesign,
        canOverrideActions: actor.isOverride,
      },
      // The process matrix is a design artefact: participants execute work orders
      // but must not see, or infer, the whole definition catalogue.
      definitions: actor.canDesign
        ? [...state.definitions].sort((left, right) =>
            left.name.localeCompare(right.name, 'vi'),
          )
        : [],
      instances: visibleInstances,
    };
  }

  /**
   * Dựng một hồ sơ mới từ định nghĩa, ngay bên trong transaction đang mở.
   *
   * Tách ra để bước nối tiếp tự động dùng lại đúng logic khởi tạo — chép tay
   * lần hai là cách chắc chắn để hai đường đi lệch nhau sau vài lần sửa.
   */
  private buildInstance(
    definition: ProcedureDefinition,
    now: string,
    options: {
      title: string;
      initiatedBy: string;
      initiatedByName: string;
      sourceType?: ProcedureInstanceSourceType;
      sourceId?: string;
      idempotencyKey: string;
    },
  ): ProcedureInstance {
    const instanceId = this.ids.next();
    const steps: ProcedureInstanceStep[] = definition.steps.map((step, index) => {
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
        linkedDefinitionId: step.linkedDefinitionId,
        startedAt: index === 0 ? now : undefined,
        slaHours: step.slaHours,
        slaDueAt: index === 0 ? computeSlaDueAt(step.slaHours, now) : undefined,
        materials: step.materials?.map((item) => ({ ...item })),
      };
    });

    return {
      id: instanceId,
      code: this.createInstanceCode(now, instanceId),
      title: options.title,
      definitionId: definition.id,
      definitionCode: definition.code,
      definitionName: definition.name,
      definitionVersion: definition.versionNumber,
      status: 'running',
      currentStepId: steps[0]?.id,
      initiatedBy: options.initiatedBy,
      sourceType: options.sourceType ?? 'manual',
      sourceId: options.sourceId,
      startedAt: now,
      steps,
      activity: [
        {
          id: this.ids.next(),
          action: 'start',
          actorId: options.initiatedBy,
          actorName: options.initiatedByName,
          summary: `Khởi tạo quy trình “${definition.name}”.`,
          createdAt: now,
          idempotencyKey: options.idempotencyKey,
        },
      ],
    };
  }

  /**
   * Bước vừa hoàn tất có gắn quy trình nối tiếp thì mở hồ sơ cho quy trình đó.
   *
   * Chỉ mở khi quy trình nối tiếp đã công bố; nếu nó còn nháp hoặc đã bị gỡ thì
   * ghi một dòng vào nhật ký thay vì làm hỏng bước đang chạy — hồ sơ cha không
   * nên chết chỉ vì một liên kết cấu hình sai.
   */
  private startLinkedProcedure(
    state: ProcedureTenantState,
    parent: ProcedureInstance,
    step: ProcedureInstanceStep,
    now: string,
  ): void {
    if (!step.linkedDefinitionId) return;

    const key = `linked:${parent.id}:${step.id}`;
    if (state.idempotency[key]) return;

    const linked = state.definitions.find(
      (candidate: ProcedureDefinition) => candidate.id === step.linkedDefinitionId,
    );
    const summary = !linked
      ? 'Quy trình nối tiếp không còn tồn tại nên không mở được hồ sơ tiếp theo.'
      : linked.status !== 'published'
        ? `Quy trình nối tiếp “${linked.name}” chưa công bố nên chưa mở hồ sơ tiếp theo.`
        : '';

    if (!linked || summary) {
      parent.activity.unshift({
        id: this.ids.next(),
        action: 'comment',
        actorId: PROCEDURE_SYSTEM_ACTOR_ID,
        actorName: 'Hệ thống',
        summary,
        createdAt: now,
        stepInstanceId: step.id,
        idempotencyKey: `${key}:skipped`,
      });
      return;
    }

    const child = this.buildInstance(linked, now, {
      title: `${linked.name} — nối tiếp ${parent.code}`,
      initiatedBy: PROCEDURE_SYSTEM_ACTOR_ID,
      initiatedByName: 'Hệ thống',
      sourceType: 'auto_from_parent',
      sourceId: parent.id,
      idempotencyKey: key,
    });
    state.instances.push(child);
    state.idempotency[key] = child.id;

    parent.activity.unshift({
      id: this.ids.next(),
      action: 'comment',
      actorId: PROCEDURE_SYSTEM_ACTOR_ID,
      actorName: 'Hệ thống',
      summary: `Bước “${step.name}” xong nên đã mở hồ sơ ${child.code} theo quy trình “${linked.name}”.`,
      createdAt: now,
      stepInstanceId: step.id,
      idempotencyKey: `${key}:opened`,
    });
  }

  /**
   * Bắt đầu đếm SLA cho một bước. Gọi ở đúng những nơi gán `startedAt`, để một
   * thay đổi máy trạng thái sau này không thể quên mất đồng hồ.
   */
  private startStepClock(step: ProcedureInstanceStep, now: string): void {
    step.slaDueAt = computeSlaDueAt(step.slaHours, now);
  }

  private stopStepClock(step: ProcedureInstanceStep): void {
    step.slaDueAt = undefined;
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
            slaHours: step.slaHours,
            materials: step.materials?.map((item) => ({ ...item })),
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

  /**
   * Ghi đè nội dung một bản nháp. Chỉ bản nháp mới sửa được: bản đã công bố là
   * hợp đồng của các hồ sơ đang chạy, sửa nó sẽ đổi luật giữa chừng.
   */
  async updateDefinition(
    actor: ProcedureActor,
    definitionId: string,
    input: UpdateProcedureDefinitionRequest,
  ): Promise<ProcedureDefinition> {
    this.requireDesigner(actor);
    return this.store.transaction(actor.tenantId, (state) => {
      const definition = this.requireDefinition(state.definitions, definitionId);
      if (definition.status !== 'draft') {
        throw new ProcedureEngineError(
          'conflict',
          'Chỉ bản nháp mới sửa được; hãy tạo phiên bản mới cho quy trình đã công bố.',
        );
      }
      const name = input.name?.trim() || definition.name;
      const kind = input.kind ?? definition.kind;
      validateDefinitionDraft({
        code: definition.code,
        name,
        description: input.description,
        kind,
        steps: input.steps,
      });

      definition.name = name;
      definition.description =
        input.description === undefined
          ? definition.description
          : input.description.trim() || undefined;
      definition.kind = kind;
      // Giữ nguyên id của bước cũ theo mã bước: fixedRollbackStepId mà client
      // gửi lên trỏ tới id đang có, cấp id mới sẽ làm đứt tham chiếu quay-về.
      const idByKey = new Map(definition.steps.map((step) => [step.key, step.id]));
      definition.steps = [...input.steps]
        .sort((left, right) => left.order - right.order)
        .map((step) => ({
          id: idByKey.get(step.key.trim().toUpperCase()) ?? this.ids.next(),
          key: step.key.trim().toUpperCase(),
          order: step.order,
          name: step.name.trim(),
          description: step.description?.trim() || undefined,
          linkedDefinitionId: step.linkedDefinitionId,
          slaHours: step.slaHours,
          materials: step.materials?.map((item) => ({ ...item })),
          assignments: step.assignments.map((assignment) => ({
            id: this.ids.next(),
            ...assignment,
            subjectId: assignment.subjectId.trim(),
            subjectLabel: assignment.subjectLabel?.trim() || undefined,
          })),
        }));
      definition.updatedAt = this.clock.now().toISOString();
      return definition;
    });
  }

  /**
   * Mở một bản đã công bố trở lại trạng thái nháp để sửa.
   *
   * An toàn với các hồ sơ đang chạy: `startInstance` đã chụp lại các bước vào
   * step_instances, nên hồ sơ đã mở không đọc lại định nghĩa. Cái mất là không
   * mở được hồ sơ mới cho tới khi công bố lại.
   */
  async reviseDefinition(
    actor: ProcedureActor,
    definitionId: string,
  ): Promise<ProcedureDefinition> {
    this.requireDesigner(actor);
    return this.store.transaction(actor.tenantId, (state) => {
      const definition = this.requireDefinition(state.definitions, definitionId);
      if (definition.status !== 'published') {
        throw new ProcedureEngineError('conflict', 'Quy trình này đang là bản nháp.');
      }
      definition.status = 'draft';
      definition.updatedAt = this.clock.now().toISOString();
      return definition;
    });
  }

  async publishDefinition(
    actor: ProcedureActor,
    definitionId: string,
  ): Promise<ProcedureDefinition> {
    this.requireDesigner(actor);

    // Resolve Inventory task templates before opening the transaction: it is a
    // network call, and holding a DB transaction across it would keep locks for
    // the round trip and make failure recovery inside the transaction impossible.
    const draft = (await this.store.read(actor.tenantId)).definitions.find(
      (candidate) => candidate.id === definitionId,
    );
    if (!draft) {
      throw new ProcedureEngineError('not_found', 'Không tìm thấy quy trình.');
    }
    const resolvedTasks = await this.resolveInventoryTaskTemplates(actor.tenantId, draft);
    const resolvedMaterials = await this.resolveStepMaterials(actor.tenantId, draft);

    return this.store.transaction(actor.tenantId, (state) => {
      const definition = this.requireDefinition(
        state.definitions,
        definitionId,
      );
      validateDefinitionForPublish(definition);
      const now = this.clock.now().toISOString();

      // Freeze the snapshot onto the assignments so runtime never re-reads Inventory.
      for (const step of definition.steps) {
        for (const assignment of step.assignments) {
          const resolved = resolvedTasks.get(assignment.id);
          if (resolved) {
            assignment.eTaskConfig = {
              ...assignment.eTaskConfig,
              taskTemplate: resolved,
              resolvedAt: now,
            };
          }
        }
      }

      // Đóng băng tên và đơn vị vật tư, cùng khuôn với taskTemplate ở trên.
      for (const step of definition.steps) {
        if (!step.materials?.length) continue;
        step.materials = step.materials.map((item) => {
          const resolved = resolvedMaterials.get(item.materialCode);
          return resolved
            ? { ...item, materialName: resolved.name, unit: resolved.unit }
            : item;
        });
      }

      definition.status = 'published';
      definition.versionNumber = 1;
      definition.updatedAt = now;
      definition.publishedAt = now;
      return definition;
    });
  }

  /** Maps assignment id → task list, for every Role E sourced from Inventory. */
  /**
   * Kiểm mọi mã vật tư khai trên các bước và lấy tên + đơn vị để đóng băng.
   *
   * Gọi trước khi mở transaction, cùng lý do với `resolveInventoryTaskTemplates`:
   * đây là lời gọi mạng, giữ transaction qua nó sẽ khoá bảng suốt vòng đi về.
   */

  /**
   * Kiểm tồn cho danh sách vật tư của một bước.
   *
   * **Phải gọi ngoài transaction** — đây là lời gọi mạng sang Kho, giữ transaction
   * qua nó sẽ khoá bảng suốt vòng đi về (cùng lý do với `resolveStepMaterials`).
   *
   * Kho hỏng thì ném lỗi chứ không âm thầm cho qua: bỏ qua phép kiểm nghĩa là để
   * người ta ra kho lấy đồ không có, tệ hơn là báo lỗi rõ ràng.
   */
  private async checkMaterials(
    tenantId: string,
    materials: readonly ProcedureStepMaterial[] | undefined,
    /**
     * Bước này đang tự giữ chỗ phần vật tư của nó.
     *
     * Phải cộng lại vào tồn khả dụng, nếu không bước sẽ **bị chính phiếu giữ chỗ
     * của mình chặn**: giữ 4/5 rồi kiểm thấy còn 1 nên báo thiếu 3. `reserveForStep`
     * chỉ giữ khi gom đủ toàn bộ nhu cầu, nên phần tự giữ đúng bằng `quantity`.
     */
    holdsOwnReservation = false,
  ): Promise<ProcedureStepMaterialCheck | undefined> {
    if (!materials?.length) return undefined;
    if (!this.inventoryTasks) {
      throw new ProcedureEngineError(
        'conflict',
        'Chưa cấu hình kết nối Kho để kiểm tồn vật tư.',
      );
    }

    const lines: ProcedureStepMaterialCheck['lines'][number][] = [];
    for (const item of materials) {
      let available: number;
      try {
        available = await this.inventoryTasks.readAvailability(tenantId, item.materialCode);
      } catch (error) {
        throw new ProcedureEngineError(
          'conflict',
          `Không tra được tồn kho của “${item.materialCode}”: ${
            error instanceof Error ? error.message : 'lỗi không rõ'
          }`,
        );
      }
      const effective = holdsOwnReservation ? available + item.quantity : available;
      lines.push({
        materialCode: item.materialCode,
        materialName: item.materialName,
        unit: item.unit,
        required: item.quantity,
        available: effective,
        short: Math.max(0, item.quantity - effective),
      });
    }

    return {
      state: lines.some((line) => line.short > 0) ? 'short' : 'ok',
      checkedAt: this.clock.now().toISOString(),
      lines,
    };
  }

  /** Thông báo cho một bước đang thiếu hàng, dùng chung cho mọi chỗ chặn. */
  private shortageMessage(check: ProcedureStepMaterialCheck, stepName: string): string {
    const missing = check.lines
      .filter((line) => line.short > 0)
      .map(
        (line) =>
          `${line.materialName ?? line.materialCode} thiếu ${line.short}${
            line.unit ? ' ' + line.unit : ''
          }`,
      )
      .join('; ');
    return `Bước “${stepName}” chưa đủ vật tư: ${missing}. Bổ sung hàng rồi bấm “Kiểm lại tồn kho”.`;
  }

  /**
   * Chạy lại phép kiểm tồn cho bước hiện tại và lưu kết quả — chính là nút fetch.
   *
   * Ai thấy được hồ sơ thì kiểm được: đây là thao tác chỉ đọc bên Kho, và người
   * đi mua hàng về thường không phải người giữ vai trò của bước.
   */
  /**
   * Xoá hẳn một hồ sơ.
   *
   * Chỉ tài khoản có quyền override — đây là thao tác dọn dẹp, không phải nghiệp
   * vụ: hồ sơ chạy sai thì huỷ (`cancel`) để giữ vết, xoá là dành cho dữ liệu
   * rác. Nhả giữ chỗ và xoá đính kèm trước, nếu không kho kẹt hàng ảo và FK của
   * `attachments` vỡ lúc commit.
   */
  async deleteInstance(actor: ProcedureActor, instanceId: string): Promise<void> {
    if (!actor.isOverride) {
      throw new ProcedureEngineError('forbidden', 'Chỉ quản trị mới xoá được hồ sơ.');
    }
    const state = await this.store.read(actor.tenantId);
    const instance = state.instances.find((candidate) => candidate.id === instanceId);
    if (!instance) throw new ProcedureEngineError('not_found', 'Không tìm thấy hồ sơ.');

    await this.releaseReservations(
      actor.tenantId,
      instance.steps.flatMap((step) => step.materialReservations ?? []),
    );
    if (this.attachments?.deleteForInstance) {
      await this.attachments.deleteForInstance(actor.tenantId, instanceId);
    }

    await this.store.transaction(actor.tenantId, (draft) => {
      draft.instances = draft.instances.filter((candidate) => candidate.id !== instanceId);
      // Bỏ luôn khoá idempotency trỏ vào hồ sơ đã xoá, để khoá cũ không "hồi sinh"
      // một hồ sơ không còn tồn tại ở lần gọi lặp.
      for (const [key, value] of Object.entries(draft.idempotency)) {
        if (value === instanceId) delete draft.idempotency[key];
      }
      return draft.instances[0] ?? ({ id: instanceId } as ProcedureInstance);
    });
  }

  /** Xoá hẳn một định nghĩa. Chặn khi còn hồ sơ tham chiếu — xoá hồ sơ trước. */
  async deleteDefinition(actor: ProcedureActor, definitionId: string): Promise<void> {
    this.requireDesigner(actor);
    if (!actor.isOverride) {
      throw new ProcedureEngineError('forbidden', 'Chỉ quản trị mới xoá được quy trình.');
    }
    const state = await this.store.read(actor.tenantId);
    if (!state.definitions.some((candidate) => candidate.id === definitionId)) {
      throw new ProcedureEngineError('not_found', 'Không tìm thấy quy trình.');
    }
    const used = state.instances.filter((item) => item.definitionId === definitionId).length;
    if (used > 0) {
      throw new ProcedureEngineError(
        'conflict',
        `Còn ${used} hồ sơ dùng quy trình này; xoá hoặc huỷ các hồ sơ đó trước.`,
      );
    }

    await this.store.transaction(actor.tenantId, (draft) => {
      // Gỡ mọi liên kết "bước nối tiếp" trỏ vào quy trình sắp xoá. Không gỡ thì
      // `steps_linked_definition_id_fkey` vỡ ngay lúc dựng lại bảng chuẩn hoá —
      // và lỗi hiện ra là 500 khó hiểu chứ không phải thông báo nghiệp vụ.
      for (const definition of draft.definitions) {
        for (const step of definition.steps) {
          if (step.linkedDefinitionId === definitionId) step.linkedDefinitionId = undefined;
        }
      }
      for (const instance of draft.instances) {
        for (const step of instance.steps) {
          if (step.linkedDefinitionId === definitionId) step.linkedDefinitionId = undefined;
        }
      }

      draft.definitions = draft.definitions.filter((candidate) => candidate.id !== definitionId);
      return draft.instances[0] ?? ({ id: definitionId } as ProcedureInstance);
    });
  }

  async recheckStepMaterials(
    actor: ProcedureActor,
    instanceId: string,
  ): Promise<ProcedureInstance> {
    const state = await this.store.read(actor.tenantId);
    const instance = state.instances.find((candidate) => candidate.id === instanceId);
    if (!instance) throw new ProcedureEngineError('not_found', 'Không tìm thấy hồ sơ.');
    if (!isProcedureParticipant(instance, actor)) {
      throw new ProcedureEngineError('forbidden', 'Bạn không có mặt trong hồ sơ này.');
    }

    const step = instance.steps.find((candidate) => candidate.id === instance.currentStepId);
    const check = await this.checkMaterials(
      actor.tenantId,
      step?.materials,
      (step?.materialReservations?.length ?? 0) > 0,
    );

    // Đủ hàng mà chưa giữ chỗ thì giữ ngay: người khác có thể lấy mất giữa lúc
    // kiểm xong và lúc ra kho. Thiếu hàng thì nhả phiếu cũ, tránh tự chặn mình.
    const held = step?.materialReservations ?? [];
    let reservations = held;
    if (check?.state === 'ok' && held.length === 0 && step?.materials) {
      reservations = await this.reserveForStep(actor.tenantId, instanceId, step.materials);
    } else if (check?.state === 'short' && held.length > 0) {
      await this.releaseReservations(actor.tenantId, held);
      reservations = [];
    }

    const result = await this.store.transaction(actor.tenantId, (draft) => {
      const target = draft.instances.find((candidate) => candidate.id === instanceId);
      if (!target) throw new ProcedureEngineError('not_found', 'Không tìm thấy hồ sơ.');
      const current = target.steps.find((candidate) => candidate.id === target.currentStepId);
      if (current) {
        current.materialCheck = check;
        current.materialReservations = reservations.length ? reservations : undefined;
      }
      return target;
    });
    return this.withAuthorization(result, actor);
  }


  /**
   * Giữ chỗ vật tư cho một bước đã kiểm đủ hàng.
   *
   * **Quyết định B** — kiểm tổng tồn toàn bộ kho, nhưng giữ chỗ theo **từng kho**:
   * bảng `reservations` gắn một phiếu với một kho. Chọn kho nhiều hàng nhất trước
   * rồi lấy tiếp kho sau nếu chưa đủ, nên một dòng vật tư có thể sinh nhiều phiếu.
   *
   * Chạy ngoài transaction. Lỗi giữa chừng thì nhả lại những phiếu đã tạo — nếu
   * không, kho kẹt hàng ảo mà không hồ sơ nào biết để nhả.
   */
  private async reserveForStep(
    tenantId: string,
    instanceId: string,
    materials: readonly ProcedureStepMaterial[],
  ): Promise<string[]> {
    if (!this.inventoryTasks?.reserveMaterials) return [];

    const perWarehouse = new Map<string, { materialCode: string; quantityReserved: number }[]>();
    for (const item of materials) {
      let remaining = item.quantity;
      const stock = await this.inventoryTasks.readAvailabilityByWarehouse(
        tenantId,
        item.materialCode,
      );
      for (const row of [...stock].sort((a, b) => b.available - a.available)) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, row.available);
        if (take <= 0) continue;
        const lines = perWarehouse.get(row.warehouseCode) ?? [];
        lines.push({ materialCode: item.materialCode, quantityReserved: take });
        perWarehouse.set(row.warehouseCode, lines);
        remaining -= take;
      }
      if (remaining > 0) {
        // Tổng đủ nhưng chia lẻ không gom nổi — coi như chưa giữ được, để phép
        // kiểm ở lần sau báo thiếu thay vì giữ nửa vời.
        return [];
      }
    }

    const codes: string[] = [];
    try {
      for (const [warehouseCode, items] of perWarehouse) {
        codes.push(
          await this.inventoryTasks.reserveMaterials(tenantId, {
            warehouseCode,
            referenceId: instanceId,
            items,
          }),
        );
      }
    } catch {
      await this.releaseReservations(tenantId, codes);
      return [];
    }
    return codes;
  }

  /**
   * Kiểm tồn cho một bước rồi giữ chỗ nếu đủ, ghi kết quả vào hồ sơ.
   *
   * Dùng chung cho bước vừa bắt đầu sau khi chuyển bước. Kho hỏng thì bỏ qua —
   * phép kiểm sẽ chạy lại lúc hoàn thành, và ở đó lỗi mới thực sự chặn.
   */
  private async checkAndHoldForStep(
    actor: ProcedureActor,
    instanceId: string,
    stepId: string,
  ): Promise<ProcedureInstance | undefined> {
    const snapshot = (await this.store.read(actor.tenantId)).instances.find(
      (candidate) => candidate.id === instanceId,
    );
    const step = snapshot?.steps.find((candidate) => candidate.id === stepId);
    if (!step?.materials?.length) return undefined;

    const check = await this.checkMaterials(actor.tenantId, step.materials).catch(() => undefined);
    if (!check) return undefined;

    const codes =
      check.state === 'ok'
        ? await this.reserveForStep(actor.tenantId, instanceId, step.materials)
        : [];

    return this.store.transaction(actor.tenantId, (state) => {
      const target = state.instances.find((candidate) => candidate.id === instanceId);
      if (!target) throw new ProcedureEngineError('not_found', 'Không tìm thấy hồ sơ.');
      const current = target.steps.find((candidate) => candidate.id === stepId);
      if (current) {
        current.materialCheck = check;
        current.materialReservations = codes.length ? codes : undefined;
      }
      return target;
    });
  }

  /** Nhả phiếu giữ chỗ, bỏ qua lỗi từng phiếu để một phiếu hỏng không chặn phần còn lại. */
  private async releaseReservations(tenantId: string, codes: readonly string[]): Promise<void> {
    if (!this.inventoryTasks?.releaseReservation) return;
    for (const code of codes) {
      try {
        await this.inventoryTasks.releaseReservation(tenantId, code);
      } catch {
        // Nuốt lỗi có chủ đích: nhả là thao tác dọn dẹp sau khi việc chính đã
        // commit. Ném ra đây sẽ làm hỏng một hành động đã thành công.
      }
    }
  }

  private async resolveStepMaterials(
    tenantId: string,
    definition: ProcedureDefinition,
  ): Promise<Map<string, { name: string; unit: string }>> {
    const resolved = new Map<string, { name: string; unit: string }>();
    const codes = new Set<string>();
    for (const step of definition.steps) {
      for (const item of step.materials ?? []) {
        const code = item.materialCode?.trim();
        if (!code) {
          throw new ProcedureEngineError(
            'validation',
            `Bước “${step.name}” có dòng vật tư thiếu mã.`,
          );
        }
        if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
          throw new ProcedureEngineError(
            'validation',
            `Số lượng vật tư “${code}” ở bước “${step.name}” phải là số dương.`,
          );
        }
        codes.add(code);
      }
    }
    if (codes.size === 0) return resolved;

    if (!this.inventoryTasks) {
      throw new ProcedureEngineError(
        'conflict',
        'Chưa cấu hình kết nối Kho để kiểm vật tư của các bước.',
      );
    }

    for (const code of codes) {
      let material: { name: string; unit: string } | null;
      try {
        material = await this.inventoryTasks.resolveMaterial(tenantId, code);
      } catch (error) {
        throw new ProcedureEngineError(
          'conflict',
          `Không tra được vật tư “${code}” từ Kho: ${
            error instanceof Error ? error.message : 'lỗi không rõ'
          }`,
        );
      }
      if (!material) {
        throw new ProcedureEngineError(
          'validation',
          `Không có vật tư mã “${code}” trong Kho; sửa lại trước khi công bố.`,
        );
      }
      resolved.set(code, material);
    }
    return resolved;
  }

  private async resolveInventoryTaskTemplates(
    tenantId: string,
    definition: ProcedureDefinition,
  ): Promise<Map<string, Record<string, unknown>[]>> {
    const resolved = new Map<string, Record<string, unknown>[]>();

    for (const step of definition.steps) {
      for (const assignment of step.assignments) {
        if (assignment.role !== 'E' || assignment.eTaskSource !== 'inventory_asset') continue;

        const assetCode = assignment.eTaskConfig?.assetCode?.trim();
        if (!assetCode) {
          throw new ProcedureEngineError(
            'validation',
            `Vai trò E tại bước “${step.name}” lấy đầu việc từ Inventory nhưng thiếu mã thiết bị.`,
          );
        }
        if (!this.inventoryTasks) {
          throw new ProcedureEngineError(
            'conflict',
            'Chưa cấu hình kết nối Inventory để lấy đầu việc cho vai trò E.',
          );
        }

        let template: Record<string, unknown>[] | null;
        try {
          template = await this.inventoryTasks.resolveAssetTaskTemplate(tenantId, assetCode);
        } catch (error) {
          throw new ProcedureEngineError(
            'conflict',
            `Không lấy được đầu việc từ Inventory cho thiết bị “${assetCode}”: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        if (!template?.length) {
          throw new ProcedureEngineError(
            'validation',
            `Thiết bị “${assetCode}” chưa có danh sách đầu việc để gán cho vai trò E.`,
          );
        }

        resolved.set(assignment.id, template);
      }
    }

    return resolved;
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

    // Lên workorder là phát lệnh kiểm tồn ngay cho bước đầu, để người nhận việc
    // thấy thiếu hàng từ lúc mở hồ sơ chứ không phải lúc bấm hoàn thành.
    // Thiếu hàng **không chặn khởi tạo** — hồ sơ vẫn phải mở ra thì mới có chỗ
    // ghi nhận là đang chờ vật tư.
    const firstStepMaterials = (await this.store.read(actor.tenantId)).definitions.find(
      (candidate) => candidate.id === input.definitionId,
    )?.steps.find((step) => step.order === 1)?.materials;
    const startCheck = await this.checkMaterials(actor.tenantId, firstStepMaterials).catch(
      // Kho hỏng lúc khởi tạo thì vẫn mở hồ sơ; phép kiểm sẽ chạy lại khi bấm
      // hoàn thành, và ở đó lỗi mới thực sự chặn.
      () => undefined,
    );

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
      const instance = this.buildInstance(definition, now, {
        title: input.title.trim(),
        initiatedBy: actor.userId,
        initiatedByName: actor.displayName,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        idempotencyKey,
      });
      const firstStep = instance.steps[0];
      if (firstStep && startCheck) firstStep.materialCheck = startCheck;

      state.instances.push(instance);
      state.idempotency[idempotencyKey] = instance.id;
      return instance;
    });

    // Giữ chỗ sau khi hồ sơ đã có id: `referenceId` của phiếu trỏ về hồ sơ, nên
    // không thể giữ trước lúc tạo. Hai lần ghi, nhưng đổi lại phiếu luôn truy
    // ngược được về hồ sơ đang giữ hàng.
    if (startCheck?.state === 'ok' && firstStepMaterials?.length) {
      const codes = await this.reserveForStep(actor.tenantId, result.id, firstStepMaterials);
      if (codes.length > 0) {
        await this.store.transaction(actor.tenantId, (state) => {
          const target = state.instances.find((candidate) => candidate.id === result.id);
          const step = target?.steps.find((candidate) => candidate.id === target.currentStepId);
          if (step) step.materialReservations = codes;
          return target ?? result;
        });
        const refreshed = (await this.store.read(actor.tenantId)).instances.find(
          (candidate) => candidate.id === result.id,
        );
        if (refreshed) return this.withAuthorization(refreshed, actor);
      }
    }

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
      // Starts work orders on behalf of another module, but never designs
      // definitions — that stays a human, tenant-admin action.
      canDesign: false,
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

  /**
   * Hands the caller's claim on a step to someone else.
   *
   * The inherited roles are captured now, from the delegator's own matches: their
   * org units are known at this moment but not when the delegatee later acts.
   */
  async delegate(
    actor: ProcedureActor,
    instanceId: string,
    input: CreateProcedureDelegationRequest,
  ): Promise<ProcedureInstance> {
    if (!input.delegatedTo?.trim()) {
      throw new ProcedureEngineError('validation', 'Cần chọn người được uỷ quyền.');
    }
    if (input.delegatedTo.trim() === actor.userId) {
      throw new ProcedureEngineError('validation', 'Không thể uỷ quyền cho chính mình.');
    }

    const result = await this.store.transaction(actor.tenantId, (state) => {
      const instance = state.instances.find((candidate) => candidate.id === instanceId);
      if (!instance) {
        throw new ProcedureEngineError('not_found', 'Không tìm thấy hồ sơ.');
      }
      if (instance.status !== 'running') {
        throw new ProcedureEngineError('conflict', 'Hồ sơ không còn chạy.');
      }

      const step = input.stepInstanceId
        ? instance.steps.find((candidate) => candidate.id === input.stepInstanceId)
        : instance.steps.find((candidate) => candidate.id === instance.currentStepId);
      if (!step) {
        throw new ProcedureEngineError('not_found', 'Không tìm thấy bước cần uỷ quyền.');
      }

      // Only what the delegator actually holds can be handed on. An override may
      // delegate on anyone's behalf, so it takes every role present on the step.
      const roles = actor.isOverride
        ? [...new Set(step.assignments.map((assignment) => assignment.role))]
        : [
            ...new Set(
              step.assignments
                .filter((assignment) => matchesProcedureAssignment(assignment, actor))
                .map((assignment) => assignment.role),
            ),
          ];
      if (roles.length === 0) {
        throw new ProcedureEngineError(
          'forbidden',
          'Bạn không giữ vai trò nào ở bước này để uỷ quyền.',
        );
      }

      const now = this.clock.now().toISOString();
      instance.delegations = [
        ...(instance.delegations ?? []),
        {
          id: this.ids.next(),
          stepInstanceId: step.id,
          delegatedBy: actor.userId,
          delegatedByName: actor.displayName,
          delegatedTo: input.delegatedTo.trim(),
          roles,
          reason: input.reason?.trim() || undefined,
          createdAt: now,
        },
      ];

      instance.activity.unshift({
        id: this.ids.next(),
        action: 'comment',
        actorId: actor.userId,
        actorName: actor.displayName,
        summary: `Uỷ quyền vai trò ${roles.join(', ')} tại bước “${step.name}”.`,
        comment: input.reason?.trim() || undefined,
        createdAt: now,
        stepInstanceId: step.id,
        idempotencyKey: `delegate:${instance.id}:${step.id}:${input.delegatedTo.trim()}:${now}`,
      });

      return instance;
    });
    return this.withAuthorization(result, actor);
  }

  /**
   * Replaces the Role E decomposition for the current step.
   *
   * Weights must total exactly 100. This is enforced here rather than at publish
   * because subtasks are runtime entities — at definition time none exist yet.
   */
  async setSubtasks(
    actor: ProcedureActor,
    instanceId: string,
    input: SetProcedureSubtasksRequest,
  ): Promise<ProcedureInstance> {
    const result = await this.store.transaction(actor.tenantId, (state) => {
      const instance = state.instances.find((candidate) => candidate.id === instanceId);
      if (!instance) throw new ProcedureEngineError('not_found', 'Không tìm thấy hồ sơ.');
      if (instance.status !== 'running') {
        throw new ProcedureEngineError('conflict', 'Hồ sơ không còn chạy.');
      }

      const step = instance.steps.find((candidate) => candidate.id === instance.currentStepId);
      if (!step) this.noCurrentStep();

      const authorization = deriveProcedureAuthorization(instance, actor);
      if (!authorization.canManageSubtasks) {
        throw new ProcedureEngineError(
          'forbidden',
          'Chỉ vai trò E ở bước hiện tại mới được phân rã công việc.',
        );
      }

      const items = input.items?.length
        ? input.items
        : this.subtasksFromTemplate(step);
      if (!items.length) {
        throw new ProcedureEngineError(
          'validation',
          'Cần ít nhất một đầu việc, hoặc thiết bị nguồn phải có sẵn danh sách đầu việc.',
        );
      }

      for (const item of items) {
        if (!item.title?.trim()) {
          throw new ProcedureEngineError('validation', 'Đầu việc phải có tên.');
        }
        if (!Number.isFinite(item.weight) || item.weight <= 0) {
          throw new ProcedureEngineError(
            'validation',
            `Trọng số của “${item.title}” phải là số dương.`,
          );
        }
      }

      // Compare in hundredths to avoid float drift on values like 33.33.
      const total = Math.round(items.reduce((sum, item) => sum + item.weight, 0) * 100);
      if (total !== 10_000) {
        throw new ProcedureEngineError(
          'validation',
          `Tổng trọng số các đầu việc phải bằng 100, hiện là ${total / 100}.`,
        );
      }

      // Chế độ chạy thuộc về bước, không thuộc từng đầu việc. Bỏ trống thì giữ
      // nguyên chế độ đang có, để lần phân rã lại không âm thầm đổi luật.
      if (input.executionMode) {
        if (input.executionMode !== 'parallel' && input.executionMode !== 'sequential') {
          throw new ProcedureEngineError('validation', 'Chế độ chạy đầu việc không hợp lệ.');
        }
        step.subtaskExecutionMode = input.executionMode;
      }

      const now = this.clock.now().toISOString();
      // Subtasks of other steps stay untouched; only this step is redecomposed.
      const others = (instance.subtasks ?? []).filter(
        (subtask) => subtask.stepInstanceId !== step.id,
      );
      instance.subtasks = [
        ...others,
        // Thứ tự trong mảng chính là thứ tự chạy khi bước ở chế độ tuần tự.
        ...items.map((item, index) => ({
          id: this.ids.next(),
          instanceId: instance.id,
          stepInstanceId: step.id,
          title: item.title.trim(),
          order: index + 1,
          assigneeId: item.assigneeId,
          assigneeName: item.assigneeName?.trim() || undefined,
          weight: item.weight,
          status: 'open' as const,
          dueAt: item.dueAt,
          createdAt: now,
        })),
      ];

      return instance;
    });
    return this.withAuthorization(result, actor);
  }

  completeSubtask(
    actor: ProcedureActor,
    instanceId: string,
    subtaskId: string,
  ): Promise<ProcedureInstance> {
    return this.setSubtaskStatus(actor, instanceId, subtaskId, 'completed');
  }

  /** Drops a subtask that turned out not to be needed. */
  cancelSubtask(
    actor: ProcedureActor,
    instanceId: string,
    subtaskId: string,
  ): Promise<ProcedureInstance> {
    return this.setSubtaskStatus(actor, instanceId, subtaskId, 'cancelled');
  }

  private async setSubtaskStatus(
    actor: ProcedureActor,
    instanceId: string,
    subtaskId: string,
    status: 'completed' | 'cancelled',
  ): Promise<ProcedureInstance> {
    // Đếm đính kèm trước khi mở transaction: nó nằm ở bảng riêng, không thuộc
    // runtime_state, và giữ transaction qua một truy vấn khác là vô ích.
    const evidence =
      status === 'completed' && this.attachments
        ? await this.attachments.countForSubtask(actor.tenantId, instanceId, subtaskId)
        : 1;

    const result = await this.store.transaction(actor.tenantId, (state) => {
      const instance = state.instances.find((candidate) => candidate.id === instanceId);
      if (!instance) throw new ProcedureEngineError('not_found', 'Không tìm thấy hồ sơ.');

      const subtask = (instance.subtasks ?? []).find((candidate) => candidate.id === subtaskId);
      if (!subtask) throw new ProcedureEngineError('not_found', 'Không tìm thấy đầu việc.');

      const authorization = deriveProcedureAuthorization(instance, actor);
      // Người được phân công tự đánh dấu phần việc của mình là xong; huỷ hay sửa
      // phân rã thì vẫn chỉ vai trò E.
      const isMine = subtask.assigneeId === actor.userId;
      const allowed = authorization.canManageSubtasks || (status === 'completed' && isMine);
      if (!allowed) {
        throw new ProcedureEngineError(
          'forbidden',
          isMine
            ? 'Chỉ vai trò E mới được huỷ đầu việc.'
            : 'Chỉ vai trò E ở bước hiện tại, hoặc người được phân công, mới cập nhật được đầu việc.',
        );
      }

      // Bước tuần tự: chặn ở server chứ không chỉ ẩn nút trên giao diện, vì API
      // gọi thẳng vẫn phải tôn trọng thứ tự chủ E đã sắp.
      if (status === 'completed') {
        const blocker = this.firstUnresolvedPredecessor(instance, subtask);
        if (blocker) {
          throw new ProcedureEngineError(
            'conflict',
            `Bước này chạy tuần tự — phải xong “${blocker.title}” trước khi làm “${subtask.title}”.`,
          );
        }
      }

      if (status === 'completed' && evidence === 0) {
        throw new ProcedureEngineError(
          'validation',
          `Cần đính kèm ít nhất một tài liệu (ảnh hoặc văn bản) làm bằng chứng cho “${subtask.title}” trước khi đánh dấu xong.`,
        );
      }

      const now = this.clock.now().toISOString();
      instance.subtasks = (instance.subtasks ?? []).map((candidate) =>
        candidate.id === subtaskId
          ? { ...candidate, status, completedAt: status === 'completed' ? now : undefined }
          : candidate,
      );
      return instance;
    });
    return this.withAuthorization(result, actor);
  }

  /**
   * Đầu việc đứng trước còn dang dở, khi bước chạy tuần tự.
   *
   * Trả `undefined` nếu bước chạy song song (mặc định), hoặc mọi đầu việc đứng
   * trước đã `completed`/`cancelled` — huỷ cũng là một cách giải quyết, giống
   * luật ở `requireSubtasksResolved`.
   */
  private firstUnresolvedPredecessor(
    instance: ProcedureInstance,
    subtask: ProcedureSubtask,
  ): ProcedureSubtask | undefined {
    const step = instance.steps.find((candidate) => candidate.id === subtask.stepInstanceId);
    if (step?.subtaskExecutionMode !== 'sequential') return undefined;

    return (instance.subtasks ?? [])
      .filter(
        (candidate) =>
          candidate.stepInstanceId === subtask.stepInstanceId &&
          candidate.order < subtask.order &&
          candidate.status !== 'completed' &&
          candidate.status !== 'cancelled',
      )
      .sort((a, b) => a.order - b.order)[0];
  }

  /**
   * Blocks finishing a step while its decomposition is unfinished.
   *
   * Without this the weights would be decorative: requiring them to total 100
   * only means something if the step cannot close until that 100 is accounted
   * for. Cancelled subtasks count as resolved — dropping work is a deliberate,
   * audited choice, unlike simply leaving it open.
   */
  private requireSubtasksResolved(
    instance: ProcedureInstance,
    step: ProcedureInstanceStep | undefined,
  ): void {
    if (!step) return;
    const pending = (instance.subtasks ?? []).filter(
      (subtask) =>
        subtask.stepInstanceId === step.id &&
        subtask.status !== 'completed' &&
        subtask.status !== 'cancelled',
    );
    if (pending.length === 0) return;

    const remaining = pending.reduce((sum, subtask) => sum + subtask.weight, 0);
    throw new ProcedureEngineError(
      'conflict',
      `Còn ${pending.length} đầu việc chưa xong (${Math.round(remaining * 100) / 100}% khối lượng). ` +
        'Hoàn thành hoặc huỷ các đầu việc đó trước khi kết thúc bước.',
    );
  }

  /**
   * Reads the task list frozen onto the step's Role E assignment at publish.
   *
   * Inventory task templates describe work (key, name, durationMinutes) and carry
   * no weights, so weights are derived here: proportional to duration when known,
   * otherwise an even split. They are computed in hundredths and the rounding
   * remainder is pushed onto the largest item, so the set totals exactly 100 —
   * anything else is rejected by setSubtasks.
   */
  private subtasksFromTemplate(step: ProcedureInstanceStep): ProcedureSubtaskInput[] {
    const template = step.assignments.find((assignment) => assignment.role === 'E')
      ?.eTaskConfig?.taskTemplate;
    if (!template?.length) return [];

    // Templates come from Inventory and are not strongly typed; accept the usual
    // naming for the label rather than forcing one key.
    const entries = template.map((entry) => ({
      title: String(entry.title ?? entry.step ?? entry.name ?? 'Đầu việc'),
      explicit: Number(entry.weight ?? 0),
      duration: Number(entry.durationMinutes ?? entry.minutes ?? 0),
    }));

    if (entries.every((entry) => entry.explicit > 0)) {
      return entries.map((entry) => ({ title: entry.title, weight: entry.explicit }));
    }

    const durationTotal = entries.reduce(
      (sum, entry) => sum + (entry.duration > 0 ? entry.duration : 0),
      0,
    );
    const shares = entries.map((entry) =>
      durationTotal > 0
        ? Math.floor((10_000 * (entry.duration > 0 ? entry.duration : 0)) / durationTotal)
        : Math.floor(10_000 / entries.length),
    );

    const remainder = 10_000 - shares.reduce((sum, share) => sum + share, 0);
    if (remainder !== 0) {
      let largest = 0;
      for (let index = 1; index < shares.length; index += 1) {
        if (shares[index] > shares[largest]) largest = index;
      }
      shares[largest] += remainder;
    }

    return entries.map((entry, index) => ({
      title: entry.title,
      weight: shares[index] / 100,
    }));
  }

  /**
   * Gửi một trao đổi vào hồ sơ.
   *
   * Cố ý KHÔNG đi qua `applyAction`: `availableActions` được UI render thẳng
   * thành hàng nút hành động, nới nó ra để ai cũng bình luận được sẽ mọc nút
   * "trao đổi" cạnh Phê duyệt/Từ chối và làm loãng nghĩa RACI. Quyền nói chuyện
   * và quyền quyết định là hai câu hỏi khác nhau.
   */
  async postComment(
    actor: ProcedureActor,
    instanceId: string,
    input: PostProcedureCommentRequest,
  ): Promise<ProcedureInstance> {
    if (!input.idempotencyKey?.trim()) {
      throw new ProcedureEngineError('validation', 'Cần idempotency key khi gửi trao đổi.');
    }
    const body = input.body?.trim();
    if (!body) {
      throw new ProcedureEngineError('validation', 'Nội dung trao đổi không được để trống.');
    }
    if (body.length > 4000) {
      throw new ProcedureEngineError('validation', 'Nội dung trao đổi tối đa 4000 ký tự.');
    }

    const result = await this.store.transaction(actor.tenantId, (state) => {
      const instance = state.instances.find((candidate) => candidate.id === instanceId);
      if (!instance) throw new ProcedureEngineError('not_found', 'Không tìm thấy hồ sơ.');

      const key = `comment:${input.idempotencyKey.trim()}`;
      if (state.idempotency[key]) return instance;

      if (!isProcedureParticipant(instance, actor)) {
        throw new ProcedureEngineError(
          'forbidden',
          'Chỉ người có mặt trong hồ sơ mới gửi được trao đổi.',
        );
      }
      if (instance.status !== 'running') {
        throw new ProcedureEngineError(
          'conflict',
          'Hồ sơ đã kết thúc — chỉ đọc lại được lịch sử trao đổi.',
        );
      }

      const now = this.clock.now().toISOString();
      state.idempotency[key] = instance.id;
      instance.activity.unshift({
        id: this.ids.next(),
        action: 'comment',
        actorId: actor.userId,
        actorName: actor.displayName,
        summary: 'Đã gửi trao đổi.',
        comment: body,
        mentions: input.mentions?.length ? [...new Set(input.mentions)] : undefined,
        createdAt: now,
        stepInstanceId: instance.currentStepId,
        // actions.idempotency_key là NOT NULL UNIQUE và được dựng lại từ activity.
        idempotencyKey: key,
      });
      return instance;
    });
    return this.withAuthorization(result, actor);
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

    // Kiểm tồn trước khi mở transaction: đây là lời gọi mạng sang Kho. Chỉ chạy
    // với hành động kết thúc bước — không ai muốn phép kiểm chạy khi chỉ trả lại
    // hay huỷ hồ sơ.
    let precheck: ProcedureStepMaterialCheck | undefined;
    if (input.action === 'complete' || input.action === 'approve') {
      const snapshot = (await this.store.read(actor.tenantId)).instances.find(
        (candidate) => candidate.id === instanceId,
      );
      const step = snapshot?.steps.find((candidate) => candidate.id === snapshot.currentStepId);
      precheck = await this.checkMaterials(
        actor.tenantId,
        step?.materials,
        (step?.materialReservations?.length ?? 0) > 0,
      );
    }

    // Phiếu giữ chỗ của bước hiện tại, ghi lại trước khi transaction đổi trạng
    // thái — sau khi commit thì `currentStepId` đã sang bước khác.
    const before = (await this.store.read(actor.tenantId)).instances.find(
      (candidate) => candidate.id === instanceId,
    );
    const heldBefore =
      before?.steps.find((candidate) => candidate.id === before.currentStepId)
        ?.materialReservations ?? [];

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
          this.returnToPreviousStep(instance, currentIndex, now, input.returnToStepId);
          break;
        case 'complete':
        case 'approve':
          if (!current) this.noCurrentStep();
          if (precheck) {
            // Lưu kết quả kể cả khi đủ hàng, để giao diện hiện được lần kiểm gần nhất.
            current.materialCheck = precheck;
            if (precheck.state === 'short') {
              throw new ProcedureEngineError(
                'conflict',
                this.shortageMessage(precheck, current.name),
              );
            }
          }
          this.requireSubtasksResolved(instance, current);
          // Bước xong thì thôi giữ hàng — dụng cụ trả lại kho cho việc khác.
          current.materialReservations = undefined;
          this.advance(instance, currentIndex, now, state);
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
        stepInstanceId: current?.id,
        idempotencyKey,
      });
      state.idempotency[idempotencyKey] = instance.id;
      return instance;
    });

    // Nhả giữ chỗ sau khi transaction đã commit — đây là dọn dẹp, không được làm
    // hỏng một hành động đã thành công. Nhả khi bước đã rời vị trí hiện tại, khi
    // bước bị trả lại, hoặc khi hồ sơ đóng hẳn.
    if (heldBefore.length > 0) {
      const stillHeld =
        result.status === 'running' &&
        result.steps.find((step) => step.id === result.currentStepId)?.materialReservations;
      if (!stillHeld) await this.releaseReservations(actor.tenantId, heldBefore);
    }

    // Bước mới vừa bắt đầu thì kiểm tồn và giữ chỗ ngay, không đợi ai bấm.
    // `advance()` chạy trong transaction nên không gọi mạng được; phải làm ở đây,
    // cùng cách `startInstance` xử lý bước đầu. Thiếu chỗ này thì bước giữa nằm
    // ở trạng thái "chưa kiểm" và hàng không được giữ — đúng lúc dễ bị hồ sơ
    // khác lấy mất nhất.
    const arrived =
      result.status === 'running'
        ? result.steps.find((step) => step.id === result.currentStepId)
        : undefined;
    if (arrived?.materials?.length && !arrived.materialCheck) {
      const refreshed = await this.checkAndHoldForStep(actor, result.id, arrived.id);
      if (refreshed) return this.withAuthorization(refreshed, actor);
    }

    return this.withAuthorization(result, actor);
  }

  private advance(
    instance: ProcedureInstance,
    currentIndex: number,
    now: string,
    state?: ProcedureTenantState,
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
    if (state) this.startLinkedProcedure(state, instance, current, now);
    const next = instance.steps[currentIndex + 1];
    if (next) {
      const firstStage = runtimeStages(next.assignments)[0] ?? null;
      next.currentRoleStage = firstStage;
      next.status =
        firstStage === 'C' || firstStage === 'A' ? 'ready' : 'active';
      next.startedAt = now;
      this.startStepClock(next, now);
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
    requestedStepId?: string,
  ): void {
    const current = instance.steps[currentIndex];
    if (!current) this.noCurrentStep();

    // C có điểm quay về cố định từ lúc thiết kế — đó là ý nghĩa của C(x), nên
    // người giữ C không được tự chọn nơi khác.
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

    // A là người phê duyệt cuối: họ nhìn thấy toàn bộ hồ sơ nên được chọn đúng
    // bước cần làm lại, thay vì luôn bị đẩy về bước liền trước.
    let chosenIndex = -1;
    if (requestedStepId) {
      if (configuredIndex >= 0) {
        throw new ProcedureEngineError(
          'validation',
          'Bước này đã cấu hình sẵn điểm quay về nên không chọn bước khác được.',
        );
      }
      chosenIndex = instance.steps.findIndex((step) => step.id === requestedStepId);
      if (chosenIndex < 0) {
        throw new ProcedureEngineError('not_found', 'Không tìm thấy bước muốn trả về.');
      }
      if (chosenIndex >= currentIndex) {
        throw new ProcedureEngineError(
          'validation',
          'Chỉ trả về được một bước đứng trước bước hiện tại.',
        );
      }
    }

    const targetIndex =
      chosenIndex >= 0 ? chosenIndex : configuredIndex >= 0 ? configuredIndex : currentIndex - 1;
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
      this.stopStepClock(step);
      step.currentRoleStage = runtimeStages(step.assignments)[0] ?? null;
    }
    const target = instance.steps[targetIndex];
    if (!target) this.noCurrentStep();
    const firstStage = runtimeStages(target.assignments)[0] ?? null;
    target.currentRoleStage = firstStage;
    target.status =
      firstStage === 'C' || firstStage === 'A' ? 'ready' : 'active';
    // Làm lại là cam kết mới: bước được trả về nhận trọn khung SLA mới, thay vì
    // giữ hạn cũ và đỏ vĩnh viễn. Việc trả về vẫn nằm nguyên trong nhật ký.
    target.startedAt = now;
    target.completedAt = undefined;
    this.startStepClock(target, now);
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
    if (!actor.canDesign) {
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
