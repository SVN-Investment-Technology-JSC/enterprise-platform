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
import {
  PROCEDURE_SETTINGS_KEYS,
  type ProcedureMaterialRequestKind,
  type ProcedureMaterialRequestResult,
  type ProcedureStepMaterialCheckLine,
  type ProcedureSettingsEntry,
  type ProcedureSettingsKey,
  type RequestProcedureMaterialsRequest,
  type RequestProcedureMaterialsResponse,
  type ProcedureSettingsSnapshot,
  type UpdateProcedureSettingsRequest,
} from '@enterprise-platform/contracts-procedure-engine';
import {
  PROCEDURE_SETTINGS_DEFAULTS,
  isProcedureSettingsKey,
  normalizeProcedureSetting,
} from './procedure-settings.js';
import { computeSlaDueAt } from '@enterprise-platform/contracts-procedure-engine';
import type {
  ProcedureClock,
  ProcedureIdGenerator,
  ProcedureStore,
  ProcedureTenantState,
} from './procedure-store.port.js';

/**
 * Bảng kê vật tư dạng CSV để đính kèm vào đơn kho.
 *
 * Cột số lượng lấy phần THIẾU với đơn mua và phần CẦN với đơn xuất — người nhận
 * đơn mua chỉ quan tâm mua bao nhiêu, không phải tổng nhu cầu.
 *
 * Bọc mọi ô trong dấu nháy và nhân đôi nháy bên trong: tên vật tư tiếng Việt có
 * dấu phẩy là chuyện thường, không bọc thì file lệch cột ngay dòng đầu.
 */
function materialCsv(
  lines: readonly ProcedureStepMaterialCheckLine[],
  kind: ProcedureMaterialRequestKind,
): string {
  const cell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  const header = ['Mã vật tư', 'Tên vật tư', 'Số lượng', 'Đơn vị', 'Tồn tại thời điểm mở đơn'];
  const rows = lines.map((line) =>
    [
      cell(line.materialCode),
      cell(line.materialName ?? ''),
      cell(kind === 'purchase' ? line.short : line.required),
      cell(line.unit ?? ''),
      cell(line.available),
    ].join(','),
  );
  return [header.map(cell).join(','), ...rows].join('\n');
}

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

  /**
   * Đọc cả cấu hình module. Khoá chưa có dòng trả về mặc định với `version: 0`,
   * nên client vẫn gửi lại được `expectedVersion` ở lần ghi đầu tiên.
   */
  async getSettings(actor: ProcedureActor): Promise<ProcedureSettingsSnapshot> {
    const stored = new Map(
      (await this.store.listSettings(actor.tenantId)).map((entry) => [entry.key, entry]),
    );
    const snapshot = {} as Record<string, ProcedureSettingsEntry<unknown>>;
    for (const key of PROCEDURE_SETTINGS_KEYS) {
      const entry = stored.get(key);
      snapshot[key] = entry
        ? { ...entry, value: normalizeProcedureSetting(key, entry.value) }
        : {
            key,
            value: PROCEDURE_SETTINGS_DEFAULTS[key],
            version: 0,
            updatedAt: new Date(0).toISOString(),
          };
    }
    return snapshot as ProcedureSettingsSnapshot;
  }

  /**
   * Ghi cấu hình.
   *
   * Gác bằng `canDesign` chứ không bằng quyền suy từ method+path như hai module
   * kia: ProcedureAccessGuard chỉ quyết định một lần `module.access` cho cả
   * module, nên tầng application là chỗ duy nhất phân biệt được người thiết kế
   * quy trình với người chỉ thực thi.
   */
  async updateSetting(
    actor: ProcedureActor,
    key: ProcedureSettingsKey,
    input: UpdateProcedureSettingsRequest<unknown>,
  ): Promise<ProcedureSettingsEntry<unknown>> {
    if (!actor.canDesign) {
      throw new ProcedureEngineError('forbidden', 'Bạn không có quyền sửa cấu hình module.');
    }
    if (!isProcedureSettingsKey(key)) {
      throw new ProcedureEngineError('validation', `Khoá cấu hình ${key} không hợp lệ.`);
    }

    // Chuẩn hoá trước khi ghi: bảng là khoá–giá trị nên đây là chỗ duy nhất ngăn
    // một payload lạ nằm nguyên trạng trong database.
    const value = normalizeProcedureSetting(key, input?.value);
    // version 0 nghĩa là "lúc đọc chưa có dòng nào". Vẫn phải gửi xuống SQL chứ
    // không được bỏ qua: không dòng nào mang version 0, nên mệnh đề WHERE sẽ
    // chặn đúng trường hợp hai admin cùng đọc "chưa có" rồi cùng ghi. Chỉ khi
    // client không gửi gì mới là cố ý ghi đè bất chấp.
    const raw = input?.expectedVersion;
    const expected = Number.isInteger(raw) && Number(raw) >= 0 ? Number(raw) : undefined;
    const saved = await this.store.putSetting(
      actor.tenantId,
      key,
      value,
      actor.userId,
      expected,
    );
    if (!saved) {
      throw new ProcedureEngineError(
        'conflict',
        `Cấu hình ${key} đã được người khác sửa; tải lại rồi lưu lại.`,
      );
    }
    return { ...saved, value: normalizeProcedureSetting(key, saved.value) };
  }

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
      assetCode?: string;
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
      assetCode: options.assetCode,
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
   * Nạp đầu việc của vai E theo THIẾT BỊ CỦA HỒ SƠ, không theo thiết bị đóng
   * băng lúc công bố.
   *
   * Định nghĩa vẫn giữ nguyên bản đóng băng — đó là hợp đồng của phiên bản đã
   * công bố. Chỉ BẢN SAO trong hồ sơ được thay, nên một quy trình bảo trì dùng
   * chung cho nhiều máy sẽ nạp đúng đầu việc của máy đang làm.
   *
   * Kho hỏng thì giữ nguyên bản đóng băng: thà chạy theo danh sách cũ còn hơn mở
   * work order rỗng đầu việc.
   */
  private applyAssetTaskTemplate(
    instance: ProcedureInstance,
    template: readonly Record<string, unknown>[] | null | undefined,
  ): void {
    const assetCode = instance.assetCode?.trim();
    if (!assetCode || !template?.length) return;

    const resolvedAt = this.clock.now().toISOString();
    for (const step of instance.steps) {
      for (const assignment of step.assignments) {
        if (assignment.role !== 'E' || assignment.eTaskSource !== 'inventory_asset') continue;
        assignment.eTaskConfig = { ...assignment.eTaskConfig, assetCode, taskTemplate: template, resolvedAt };
      }
    }
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
        category: input.category?.trim() || undefined,
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
  /**
   * Đổi nhóm quy trình — chạy được cả khi quy trình ĐÃ CÔNG BỐ.
   *
   * Tách hẳn khỏi `updateDefinition` chứ không nới điều kiện ở đó: đường sửa
   * chung mang theo `steps`, mà nhận `steps` trên bản đã công bố là mở lối sửa
   * lén luật thực thi của những hồ sơ đang chạy. Ở đây chỉ có đúng một trường
   * đi qua, nên không có gì để lén.
   *
   * Nhóm chỉ dùng để phân loại và lọc, không tham gia quyết định ai được làm gì,
   * nên đổi nó không làm hồ sơ đang chạy đổi hành vi. Bắt đưa cả quy trình về
   * nháp rồi công bố lại chỉ để xếp lại một cái nhãn là quá đắt — trong lúc còn
   * nháp thì không mở được hồ sơ mới.
   */
  async setDefinitionCategory(
    actor: ProcedureActor,
    definitionId: string,
    category: string | undefined,
  ): Promise<ProcedureDefinition> {
    this.requireDesigner(actor);
    const value = category?.trim() || undefined;
    return this.store.transaction(actor.tenantId, (state) => {
      const definition = this.requireDefinition(state.definitions, definitionId);
      definition.category = value;
      return definition;
    });
  }

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
      if (input.category !== undefined) {
        definition.category = input.category.trim() || undefined;
      }
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
      const effective = available;
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
    const check = await this.checkMaterials(actor.tenantId, step?.materials);

    /**
     * CHỈ ĐỌC tồn, không giữ chỗ.
     *
     * Số lượng trong kho chỉ đổi khi thủ kho thao tác trong module Kho. Quy trình
     * báo đủ hay thiếu; cần lấy hàng thì mở một quy trình mượn/xuất để người thật
     * xử lý, như mọi quy trình khác. Trước đây bước tự đặt phiếu giữ chỗ, tức
     * module này ghi thẳng vào sổ kho của module khác.
     *
     * Đánh đổi đã biết: hai hồ sơ cùng lúc có thể cùng thấy đủ hàng rồi cùng đề
     * nghị xuất. Thủ kho là người phát hiện khi cấp phát, và đó đúng là chỗ nên
     * phát hiện.
     */
    const held = step?.materialReservations ?? [];
    if (held.length > 0) await this.releaseReservations(actor.tenantId, held);

    const result = await this.store.transaction(actor.tenantId, (draft) => {
      const target = draft.instances.find((candidate) => candidate.id === instanceId);
      if (!target) throw new ProcedureEngineError('not_found', 'Không tìm thấy hồ sơ.');
      const current = target.steps.find((candidate) => candidate.id === target.currentStepId);
      if (current) {
        current.materialCheck = check;
        current.materialReservations = undefined;
      }
      return target;
    });
    return this.withAuthorization(result, actor);
  }


  /**
   * Kiểm tồn cho một bước vừa bắt đầu và ghi kết quả vào hồ sơ.
   *
   * Chỉ ĐỌC — không giữ chỗ, không ghi gì vào sổ kho. Kho hỏng thì bỏ qua; phép
   * kiểm chạy lại lúc hoàn thành, và ở đó lỗi mới thực sự chặn.
   */
  private async checkMaterialsForStep(
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

    return this.store.transaction(actor.tenantId, (state) => {
      const target = state.instances.find((candidate) => candidate.id === instanceId);
      if (!target) throw new ProcedureEngineError('not_found', 'Không tìm thấy hồ sơ.');
      const current = target.steps.find((candidate) => candidate.id === stepId);
      if (current) current.materialCheck = check;
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

    // Nạp NGOÀI transaction: đây là một lượt gọi HTTP sang Kho, để trong
    // transaction thì mỗi lần mở hồ sơ giữ một connection pg suốt thời gian chờ
    // mạng. Kho hỏng thì rơi về bản đóng băng của định nghĩa.
    const assetCode = input.assetCode?.trim() || undefined;
    const assetTemplate = assetCode
      ? await this.inventoryTasks
          ?.resolveAssetTaskTemplate(actor.tenantId, assetCode)
          .catch(() => undefined)
      : undefined;

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
        assetCode,
        idempotencyKey,
      });
      const firstStep = instance.steps[0];
      if (firstStep && startCheck) firstStep.materialCheck = startCheck;
      this.applyAssetTaskTemplate(instance, assetTemplate);

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
      assetCode: input.assetCode?.trim() || undefined,
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
  /**
   * Vai E chọn THIẾT BỊ cho hồ sơ, ngay lúc chạy.
   *
   * Thiết bị không còn khai lúc thiết kế ma trận: một quy trình bảo trì dùng
   * chung cho cả dãy máy, khai cứng lúc thiết kế thì mọi phiếu sinh ra đều trỏ
   * về đúng một máy. Người trực tiếp làm mới biết hôm nay đang làm máy nào.
   *
   * Chọn xong thì nạp luôn đầu việc của thiết bị đó vào bản sao trong hồ sơ, nên
   * `subtasksFromTemplate` phía sau không cần biết đầu việc đến từ đâu.
   *
   * Phiếu do Bảo trì sinh ra đã mang sẵn `assetCode` nên không phải chọn lại;
   * đổi vẫn được nếu hiện trường khác với kế hoạch.
   */
  async setInstanceAsset(
    actor: ProcedureActor,
    instanceId: string,
    assetCode: string,
  ): Promise<ProcedureInstance> {
    const code = assetCode?.trim();
    if (!code) {
      throw new ProcedureEngineError('validation', 'Cần chọn thiết bị.');
    }

    const snapshot = (await this.store.read(actor.tenantId)).instances.find(
      (candidate) => candidate.id === instanceId,
    );
    if (!snapshot) throw new ProcedureEngineError('not_found', 'Không tìm thấy hồ sơ.');
    if (snapshot.status !== 'running') {
      throw new ProcedureEngineError('conflict', 'Hồ sơ không còn chạy.');
    }
    const authorization = deriveProcedureAuthorization(snapshot, actor);
    if (!authorization.canManageSubtasks) {
      throw new ProcedureEngineError(
        'forbidden',
        'Chỉ vai trò E ở bước hiện tại mới chọn được thiết bị.',
      );
    }

    // Đọc NGOÀI transaction: một lượt gọi sang Kho, giữ trong transaction thì
    // connection pg bị treo suốt thời gian chờ mạng.
    const template = await this.inventoryTasks
      ?.resolveAssetTaskTemplate(actor.tenantId, code)
      .catch(() => undefined);

    const result = await this.store.transaction(actor.tenantId, (state) => {
      const instance = state.instances.find((candidate) => candidate.id === instanceId);
      if (!instance) throw new ProcedureEngineError('not_found', 'Không tìm thấy hồ sơ.');
      instance.assetCode = code;
      this.applyAssetTaskTemplate(instance, template);
      return instance;
    });
    return this.withAuthorization(result, actor);
  }

  async setSubtasks(
    actor: ProcedureActor,
    instanceId: string,
    input: SetProcedureSubtasksRequest,
  ): Promise<ProcedureInstance> {
    // Tra tên/đơn vị vật tư NGOÀI transaction: mỗi mã là một lượt gọi sang Kho,
    // để trong transaction thì một lần phân rã mười đầu việc sẽ giữ connection
    // pg suốt mười lượt chờ mạng.
    const materialCatalog = await this.resolveSubtaskMaterials(actor.tenantId, input.items);

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
          materials: item.materials?.length
            ? item.materials.map((line) => {
                const code = line.materialCode.trim();
                const known = materialCatalog.get(code);
                return {
                  materialCode: code,
                  quantity: line.quantity,
                  note: line.note?.trim() || undefined,
                  materialName: known?.name,
                  unit: known?.unit,
                };
              })
            : undefined,
        })),
      ];

      return instance;
    });
    return this.withAuthorization(result, actor);
  }

  /**
   * Mở hồ sơ xin vật tư cho một đầu việc.
   *
   * **Không ghi một dòng nào vào sổ kho.** Số lượng trong kho chỉ đổi khi thủ
   * kho thao tác trong module Kho; ở đây Quy trình chỉ đọc tồn để biết nên mở
   * thủ tục nào, rồi mở đúng thủ tục đó cho người thật đi làm.
   *
   * Đủ thì mở quy trình mượn/xuất, thiếu thì mở quy trình mua. Một đầu việc có
   * thể sinh ra CẢ HAI hồ sơ: vài mã đủ, vài mã thiếu là chuyện thường, và gộp
   * chúng vào một thủ tục sẽ bắt người duyệt mua phải chờ phần đáng lẽ xuất được
   * ngay.
   */
  async requestSubtaskMaterials(
    actor: ProcedureActor,
    instanceId: string,
    input: RequestProcedureMaterialsRequest,
  ): Promise<RequestProcedureMaterialsResponse> {
    const subtaskId = input?.subtaskId?.trim();

    const snapshot = (await this.store.read(actor.tenantId)).instances.find(
      (candidate) => candidate.id === instanceId,
    );
    if (!snapshot) throw new ProcedureEngineError('not_found', 'Không tìm thấy hồ sơ.');
    if (snapshot.status !== 'running') {
      throw new ProcedureEngineError('conflict', 'Hồ sơ không còn chạy.');
    }

    const authorization = deriveProcedureAuthorization(snapshot, actor);

    /**
     * Hai đường vào. Xin theo ĐẦU VIỆC là đường của vai E sau khi phân rã; xin
     * theo BƯỚC là đường của mọi vai còn lại, những người không có đầu việc nào
     * nhưng vẫn cần dụng cụ để làm phần việc của mình.
     */
    let wanted: readonly ProcedureStepMaterial[];
    let label: string;
    if (subtaskId) {
      const subtask = (snapshot.subtasks ?? []).find((candidate) => candidate.id === subtaskId);
      if (!subtask) throw new ProcedureEngineError('not_found', 'Không tìm thấy đầu việc.');
      if (!subtask.materials?.length) {
        throw new ProcedureEngineError('validation', 'Đầu việc này chưa khai vật tư nào.');
      }
      const isMine = (authorization.mySubtaskIds ?? []).includes(subtaskId);
      if (!authorization.canManageSubtasks && !isMine) {
        throw new ProcedureEngineError(
          'forbidden',
          'Chỉ người giữ vai ở bước này hoặc người được giao đầu việc mới xin vật tư được.',
        );
      }
      wanted = subtask.materials;
      label = subtask.title;
    } else {
      if (!input?.materials?.length) {
        throw new ProcedureEngineError('validation', 'Cần chọn ít nhất một vật tư.');
      }
      // Xin cho bước thì phải đang GIỮ VAI ở bước đó. `myRoles` rỗng nghĩa là
      // người này chỉ đang xem, không được mở thủ tục nhân danh hồ sơ.
      if (!actor.isOverride && (authorization.myRoles ?? []).length === 0) {
        throw new ProcedureEngineError(
          'forbidden',
          'Chỉ người đang giữ vai ở bước hiện tại mới xin vật tư được.',
        );
      }
      const step = snapshot.steps.find((candidate) => candidate.id === snapshot.currentStepId);
      wanted = await this.resolveRequestedMaterials(actor.tenantId, input.materials);
      label = step?.name ?? 'bước hiện tại';
    }

    // Đọc tồn NGOÀI transaction, và đọc tươi: đây chính là con số quyết định mở
    // thủ tục nào, không được dùng lại bản chụp cũ của bước.
    const check = await this.checkMaterials(actor.tenantId, wanted);
    if (!check) {
      throw new ProcedureEngineError('conflict', 'Không đọc được tồn kho để xin vật tư.');
    }

    const enough = check.lines.filter((line) => line.short <= 0);
    const missing = check.lines.filter((line) => line.short > 0);

    const plans: {
      kind: ProcedureMaterialRequestKind;
      definitionId?: string;
      lines: typeof enough;
    }[] = [];
    if (enough.length) {
      plans.push({ kind: 'issue', definitionId: input.issueDefinitionId?.trim(), lines: enough });
    }
    if (missing.length) {
      plans.push({
        kind: 'purchase',
        definitionId: input.purchaseDefinitionId?.trim(),
        lines: missing,
      });
    }

    const kindLabel: Record<ProcedureMaterialRequestKind, string> = {
      issue: 'mượn/xuất kho',
      purchase: 'mua sắm',
    };
    for (const entry of plans) {
      if (!entry.definitionId) {
        throw new ProcedureEngineError(
          'validation',
          `Cần chọn quy trình ${kindLabel[entry.kind]} để mở hồ sơ.`,
        );
      }
    }

    const result = await this.store.transaction(actor.tenantId, (state) => {
      const parent = state.instances.find((candidate) => candidate.id === instanceId);
      if (!parent) throw new ProcedureEngineError('not_found', 'Không tìm thấy hồ sơ.');
      const now = this.clock.now().toISOString();
      const opened: ProcedureMaterialRequestResult[] = [];

      for (const entry of plans) {
        const definition = state.definitions.find(
          (candidate) => candidate.id === entry.definitionId,
        );
        if (!definition) {
          throw new ProcedureEngineError(
            'validation',
            `Quy trình ${kindLabel[entry.kind]} đã chọn không còn tồn tại.`,
          );
        }
        if (definition.status !== 'published') {
          throw new ProcedureEngineError(
            'conflict',
            `Quy trình ${kindLabel[entry.kind]} “${definition.name}” chưa công bố nên chưa mở hồ sơ được.`,
          );
        }

        /**
         * Khoá idempotency gắn với CHÍNH LÔ HÀNG đang đặt.
         *
         * Bấm hai lần liên tiếp cùng một bảng kê thì không sinh hai đơn trùng.
         * Nhưng khai thêm vật tư rồi đặt tiếp thì lô hàng khác đi, khoá khác đi,
         * và đơn bổ sung mở được — đó mới là hành vi đúng.
         *
         * Khoá cũ chỉ gắn theo bước và loại thủ tục, nên đơn thứ hai của cùng
         * một bước luôn bị nuốt và trả về đơn cũ, dù người dùng vừa khai thêm.
         */
        const signature = [...entry.lines]
          .map((line) => `${line.materialCode}:${entry.kind === 'purchase' ? line.short : line.required}`)
          .sort()
          .join('|');
        const key = `materials:${parent.id}:${subtaskId ?? parent.currentStepId}:${entry.kind}:${signature}`;
        const existingId = state.idempotency[key];
        const existing = existingId
          ? state.instances.find((candidate) => candidate.id === existingId)
          : undefined;
        if (existing) {
          opened.push({
            kind: entry.kind,
            instanceId: existing.id,
            code: existing.code,
            definitionName: definition.name,
            lines: entry.lines,
          });
          continue;
        }

        const child = this.buildInstance(definition, now, {
          title: `${definition.name} — ${label} (${parent.code})`,
          initiatedBy: actor.userId,
          initiatedByName: actor.displayName,
          sourceType: 'auto_from_parent',
          sourceId: parent.id,
          assetCode: parent.assetCode,
          idempotencyKey: key,
        });
        state.instances.push(child);
        state.idempotency[key] = child.id;

        const detail = entry.lines
          .map(
            (line) =>
              `${line.materialName ?? line.materialCode} ${
                entry.kind === 'purchase' ? line.short : line.required
              }${line.unit ? ` ${line.unit}` : ''}`,
          )
          .join(', ');
        parent.activity.unshift({
          id: this.ids.next(),
          action: 'comment',
          actorId: actor.userId,
          actorName: actor.displayName,
          summary: `Đã mở hồ sơ ${child.code} (${kindLabel[entry.kind]}) cho “${label}”: ${detail}.`,
          createdAt: now,
          stepInstanceId: subtaskId
            ? (snapshot.subtasks ?? []).find((item) => item.id === subtaskId)?.stepInstanceId
            : parent.currentStepId,
          idempotencyKey: `${key}:opened`,
        });

        // Ghi lại đã đặt những gì: lần bấm sau chỉ mở đơn cho phần khai THÊM,
        // không đặt lại toàn bộ. Thiếu nó thì thủ kho nhận nhiều phiếu trùng
        // nhau cho cùng một lô hàng.
        parent.materialOrders = [
          ...(parent.materialOrders ?? []),
          {
            code: child.code,
            kind: entry.kind,
            createdAt: now,
            lines: entry.lines.map((line) => ({
              materialCode: line.materialCode,
              quantity: entry.kind === 'purchase' ? line.short : line.required,
              materialName: line.materialName,
              unit: line.unit,
            })),
          },
        ];

        opened.push({
          kind: entry.kind,
          instanceId: child.id,
          code: child.code,
          definitionName: definition.name,
          lines: entry.lines,
        });
      }

      return { opened, instance: parent };
    });

    /**
     * Gắn bảng kê vật tư vào từng đơn vừa mở.
     *
     * Làm SAU transaction và nuốt lỗi có chủ đích: đơn đã mở rồi, ném ra ở đây
     * sẽ báo cho người dùng là thất bại trong khi hồ sơ vẫn nằm đó. Thiếu tệp
     * đính kèm là phiền, mất dấu một đơn đã mở mới là hỏng.
     */
    for (const entry of result.opened) {
      try {
        await this.attachments?.attachGenerated?.(actor.tenantId, entry.instanceId, {
          fileName: `bang-ke-vat-tu-${entry.code}.csv`,
          contentType: 'text/csv',
          body: materialCsv(entry.lines, entry.kind),
        });
      } catch (error) {
        // Nuốt lỗi nhưng KHÔNG im lặng: một đơn thiếu bảng kê mà không có dấu
        // vết nào thì không ai biết để đi tìm nguyên nhân.
        console.warn(
          `[procedure] không đính kèm được bảng kê cho ${entry.code}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    return {
      opened: result.opened,
      instance: this.withAuthorization(result.instance, actor),
    };
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

      // Đính kèm bằng chứng KHÔNG còn bắt buộc. Trước đây phải có ít nhất một
      // tệp mới đánh dấu xong được; luật đó bị bỏ theo yêu cầu vận hành. Vẫn
      // đính kèm được bình thường, chỉ là không chặn nữa.

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
  /**
   * Kiểm mã vật tư và chụp lại tên/đơn vị cho các đầu việc sắp lưu.
   *
   * Mã không tồn tại thì CHẶN ngay: một đầu việc trỏ vào mã ma sẽ báo thiếu hàng
   * vĩnh viễn mà không ai hiểu vì sao. Cùng luật với lúc công bố quy trình.
   */
  private async resolveSubtaskMaterials(
    tenantId: string,
    items: readonly ProcedureSubtaskInput[] | undefined,
  ): Promise<Map<string, { name: string; unit: string }>> {
    const resolved = new Map<string, { name: string; unit: string }>();
    const codes = new Set<string>();

    for (const item of items ?? []) {
      const seen = new Set<string>();
      for (const line of item.materials ?? []) {
        const code = line.materialCode?.trim();
        if (!code) {
          throw new ProcedureEngineError('validation', 'Dòng vật tư phải có mã.');
        }
        if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
          throw new ProcedureEngineError(
            'validation',
            `Số lượng của “${code}” phải là số dương.`,
          );
        }
        // Trùng mã trong CÙNG một đầu việc là lỗi nhập liệu, không phải ý đồ:
        // gộp im lặng thì người dùng thấy số lượng khác thứ mình gõ.
        if (seen.has(code)) {
          throw new ProcedureEngineError(
            'validation',
            `Vật tư “${code}” bị khai hai lần trong đầu việc “${item.title}”.`,
          );
        }
        seen.add(code);
        codes.add(code);
      }
    }

    if (codes.size === 0) return resolved;
    if (!this.inventoryTasks) {
      throw new ProcedureEngineError(
        'conflict',
        'Chưa cấu hình kết nối Kho để chọn vật tư cho đầu việc.',
      );
    }

    for (const code of codes) {
      const material = await this.inventoryTasks.resolveMaterial(tenantId, code);
      if (!material) {
        throw new ProcedureEngineError('validation', `Vật tư “${code}” không có trong Kho.`);
      }
      resolved.set(code, material);
    }
    return resolved;
  }

  /**
   * Kiểm và chụp tên/đơn vị cho danh sách vật tư xin theo BƯỚC.
   *
   * Dùng lại đúng luật của `resolveSubtaskMaterials` bằng cách bọc danh sách vào
   * một đầu việc giả — mã ma, số lượng âm và mã trùng đều bị chặn y hệt, nên hai
   * đường xin vật tư không thể lệch luật nhau.
   */
  private async resolveRequestedMaterials(
    tenantId: string,
    materials: readonly ProcedureStepMaterial[],
  ): Promise<ProcedureStepMaterial[]> {
    const catalog = await this.resolveSubtaskMaterials(tenantId, [
      { title: 'Vật tư cho bước', weight: 100, materials },
    ]);
    return materials.map((line) => {
      const code = line.materialCode.trim();
      const known = catalog.get(code);
      return {
        materialCode: code,
        quantity: line.quantity,
        note: line.note?.trim() || undefined,
        materialName: known?.name,
        unit: known?.unit,
      };
    });
  }

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
        // Chỉ nhận id trỏ tới một trao đổi CÓ THẬT trong chính hồ sơ này. Id lạ
        // bị bỏ đi thay vì chặn gửi: mất phần trích dẫn còn hơn mất cả nội dung
        // người dùng vừa gõ.
        replyToId: instance.activity.some(
          (entry) => entry.id === input.replyToId && entry.action === 'comment',
        )
          ? input.replyToId
          : undefined,
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
      precheck = await this.checkMaterials(actor.tenantId, step?.materials);
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
      const refreshed = await this.checkMaterialsForStep(actor, result.id, arrived.id);
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
    // KHÔNG giữ `completedAt`: bước bị trả về là bước chưa xong. Giữ lại thì
    // thanh tiến trình vẽ nó gần đầy trong khi biểu tượng ghi "".
    current.completedAt = undefined;
    for (
      let index = targetIndex + 1;
      index < instance.steps.length;
      index += 1
    ) {
      const step = instance.steps[index];
      if (!step) continue;
      // Bước bị trả về cũng phải được dọn như các bước sau nó, chỉ khác ở chỗ
      // giữ trạng thái 'returned' để người đọc biết vì sao nó quay lại. Bỏ qua
      // nó như trước sẽ để `currentRoleStage` kẹt ở C/A.
      const isReturned = step.id === current.id;
      step.status = isReturned ? 'returned' : 'pending';
      step.startedAt = undefined;
      step.completedAt = undefined;
      this.stopStepClock(step);
      step.currentRoleStage = runtimeStages(step.assignments)[0] ?? null;
      this.resetStepWork(instance, step);
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

  /**
   * Xoá dấu vết thực thi của một bước sắp phải làm lại.
   *
   * Không dọn subtask thì `requireSubtasksResolved` thấy chúng vẫn 'completed'
   * và cho duyệt lại ngay — việc bị trả về được thông qua mà không ai làm lại.
   * Kết quả kiểm tồn và đặt giữ chỗ vật tư cũng phải bỏ, vì chúng nói về lần
   * thực hiện trước.
   */
  private resetStepWork(instance: ProcedureInstance, step: ProcedureInstanceStep): void {
    step.materialCheck = undefined;
    step.materialReservations = undefined;
    if (!instance.subtasks?.length) return;
    instance.subtasks = instance.subtasks.filter(
      (subtask) => subtask.stepInstanceId !== step.id,
    );
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
