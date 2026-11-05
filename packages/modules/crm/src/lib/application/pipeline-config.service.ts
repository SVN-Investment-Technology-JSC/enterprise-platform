import type {
  AdminPipeline,
  Pipeline,
  PipelineStage,
  PipelineTemplate,
} from '@enterprise-platform/contracts-crm';
import { CrmNotFoundError, CrmValidationError } from '../domain/crm.error.js';
import { isUuid } from '../domain/fields.js';
import {
  assertCanBeDefault,
  assertCanDeactivatePipeline,
  assertCanDeletePipeline,
  assertCanDeleteStage,
  assertCareSuggestionAllowed,
  assertOutcomeStages,
  assertPipelineCodeFree,
  assertSameIdSet,
  assertStageCodeFree,
  assertStageLimit,
  assertStagePatchAllowed,
  parseIdList,
  parseNewPipeline,
  parseNewStage,
  parsePipelinePatch,
  parseStagePatch,
  validateRequirements,
  validateTransitionTargets,
  type StagePatch,
  type StageUsage,
} from '../domain/pipeline-config.js';
import { requireSalesManager } from './crm-access.js';
import type { CrmActor } from './crm-actor.js';
import type { PipelineAdminSnapshot, PipelineAdminStore, PipelineAdminTx } from './pipeline-admin-store.port.js';
import type { PipelineConfigProvider } from './pipeline-config.port.js';
import { PIPELINE_TEMPLATES, blankPipelineTemplate, findPipelineTemplate } from './pipeline-templates.js';

const PIPELINE_NOT_FOUND = 'Không tìm thấy luồng.';
const STAGE_NOT_FOUND = 'Không tìm thấy giai đoạn.';
const NO_USAGE: StageUsage = { opportunityCount: 0, used: false };

/**
 * Cấu hình luồng cơ hội cho quản trị viên (GĐ G, P2G-01, P2G-02, P2G-04, P2G-05).
 *
 * Mọi thao tác yêu cầu `crm.manage` (403 nếu thiếu), chạy trong MỘT transaction của store (khoá tuần tự, đọc cấu
 * hiện hành không qua cache, kiểm quy tắc ở `domain/pipeline-config`, ghi, ghi `audit_log`). Ngay SAU khi transaction
 * commit, huỷ cache cấu hình của tenant để lần chuyển giai đoạn kế tiếp dùng cấu hình mới. Cache của tiến trình
 * khác (nếu chạy nhiều bản) tự hết hạn theo `PIPELINE_CONFIG_TTL_MS`.
 */
export class PipelineConfigService {
  constructor(
    private readonly store: PipelineAdminStore,
    private readonly config: PipelineConfigProvider,
  ) {}

  /** Mọi luồng kèm số cơ hội và cờ đã dùng của từng giai đoạn. */
  async list(actor: CrmActor): Promise<AdminPipeline[]> {
    requireSalesManager(actor);
    return toAdmin(await this.store.snapshot(actor.tenantId));
  }

  templates(actor: CrmActor): readonly PipelineTemplate[] {
    requireSalesManager(actor);
    return PIPELINE_TEMPLATES;
  }

  /** Tạo luồng: theo mẫu khi có `templateId`, không thì khung trống (Mới, Thắng, Thua) với `profile`. */
  async createPipeline(actor: CrmActor, body: unknown): Promise<AdminPipeline[]> {
    requireSalesManager(actor);
    const input = parseNewPipeline(body);
    let template: PipelineTemplate;
    if (input.templateId) {
      const found = findPipelineTemplate(input.templateId);
      if (!found) throw new CrmValidationError('INVALID_TEMPLATE', 'Mẫu luồng không tồn tại.');
      if (input.profile && input.profile !== found.profile) {
        throw new CrmValidationError('PROFILE_MISMATCH', 'Loại luồng không khớp với mẫu đã chọn.');
      }
      template = found;
    } else {
      template = blankPipelineTemplate(input.profile ?? 'STANDARD');
    }
    return this.mutate(actor, async (tx, snapshot) => {
      assertPipelineCodeFree(snapshot.pipelines, input.code);
      const id = await tx.insertPipeline({
        code: input.code,
        name: input.name,
        profile: template.profile,
        careSuggestion: template.profile !== 'TENDER',
        actorId: actor.userId,
      });
      const stageIds = new Map<string, string>();
      for (const stage of template.stages) {
        stageIds.set(
          stage.code,
          await tx.insertStage(
            id,
            { ...stage, active: true, assigneeParam: null },
            actor.userId,
          ),
        );
      }
      const outgoing = new Map<string, string[]>();
      for (const [from, to] of template.transitions) {
        outgoing.set(from, [...(outgoing.get(from) ?? []), stageIds.get(to) as string]);
      }
      for (const [from, targets] of outgoing) await tx.replaceTransitions(stageIds.get(from) as string, targets);
      for (const stage of template.stages) {
        const mine = template.requirements.filter((requirement) => requirement.stageCode === stage.code);
        if (mine.length === 0) continue;
        const requirements = validateRequirements(mine, template.profile, snapshot.documentTypeCodes);
        await tx.replaceRequirements(stageIds.get(stage.code) as string, requirements);
      }
      await tx.audit({
        entityType: 'pipeline',
        entityId: id,
        action: input.templateId ? 'create_from_template' : 'create',
        actorId: actor.userId,
        metadata: { code: input.code, name: input.name, profile: template.profile, templateId: input.templateId, stageCount: template.stages.length },
      });
    });
  }

  async updatePipeline(actor: CrmActor, pipelineId: string, body: unknown): Promise<AdminPipeline[]> {
    requireSalesManager(actor);
    const patch = parsePipelinePatch(body);
    return this.mutate(actor, async (tx, snapshot) => {
      const pipeline = findPipeline(snapshot, pipelineId);
      if (patch.active === false && pipeline.active) assertCanDeactivatePipeline(pipeline);
      if (patch.careSuggestion !== undefined) assertCareSuggestionAllowed(pipeline.profile, patch.careSuggestion);
      await tx.updatePipeline(pipeline.id, patch, actor.userId);
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const key of ['name', 'active'] as const) {
        if (patch[key] !== undefined && patch[key] !== pipeline[key]) {
          before[key] = pipeline[key];
          after[key] = patch[key];
        }
      }
      if (Object.keys(after).length > 0) {
        await tx.audit({ entityType: 'pipeline', entityId: pipeline.id, action: 'update', actorId: actor.userId, metadata: { before, after } });
      }
      if (patch.careSuggestion !== undefined && patch.careSuggestion !== pipeline.careSuggestion) {
        await tx.audit({
          entityType: 'pipeline',
          entityId: pipeline.id,
          action: 'set_care_suggestion',
          actorId: actor.userId,
          metadata: { from: pipeline.careSuggestion, to: patch.careSuggestion },
        });
      }
    });
  }

  async setDefaultPipeline(actor: CrmActor, pipelineId: string): Promise<AdminPipeline[]> {
    requireSalesManager(actor);
    return this.mutate(actor, async (tx, snapshot) => {
      const pipeline = findPipeline(snapshot, pipelineId);
      assertCanBeDefault(pipeline);
      if (pipeline.isDefault) return;
      const previous = snapshot.pipelines.find((candidate) => candidate.isDefault);
      await tx.setDefaultPipeline(pipeline.id, actor.userId);
      await tx.audit({
        entityType: 'pipeline',
        entityId: pipeline.id,
        action: 'set_default',
        actorId: actor.userId,
        metadata: { previousDefaultId: previous?.id ?? null },
      });
    });
  }

  async reorderPipelines(actor: CrmActor, body: unknown): Promise<AdminPipeline[]> {
    requireSalesManager(actor);
    const ids = parseIdList((body as { pipelineIds?: unknown } | null)?.pipelineIds, 'luồng');
    return this.mutate(actor, async (tx, snapshot) => {
      assertSameIdSet(ids, snapshot.pipelines.map((pipeline) => pipeline.id), 'luồng');
      await tx.setPipelineOrder(ids, actor.userId);
      await tx.audit({
        entityType: 'pipeline',
        entityId: ids[0] ?? snapshot.pipelines[0]?.id ?? '00000000-0000-0000-0000-000000000000',
        action: 'reorder',
        actorId: actor.userId,
        metadata: { order: ids },
      });
    });
  }

  async deletePipeline(actor: CrmActor, pipelineId: string): Promise<AdminPipeline[]> {
    requireSalesManager(actor);
    return this.mutate(actor, async (tx, snapshot) => {
      const pipeline = findPipeline(snapshot, pipelineId);
      assertCanDeletePipeline(pipeline, snapshot.pipelineOpportunityCount.get(pipeline.id) ?? 0);
      // Giai đoạn của luồng không có cơ hội nên không có lịch sử; vẫn kiểm để không vấp khoá ngoại.
      if (pipeline.stages.some((stage) => (snapshot.stageUsage.get(stage.id) ?? NO_USAGE).used)) {
        assertCanDeletePipeline(pipeline, 1);
      }
      await tx.deletePipeline(pipeline.id);
      await tx.audit({
        entityType: 'pipeline',
        entityId: pipeline.id,
        action: 'delete',
        actorId: actor.userId,
        metadata: { code: pipeline.code, name: pipeline.name, stageCount: pipeline.stages.length },
      });
    });
  }

  async addStage(actor: CrmActor, pipelineId: string, body: unknown): Promise<AdminPipeline[]> {
    requireSalesManager(actor);
    const input = parseNewStage(body);
    return this.mutate(actor, async (tx, snapshot) => {
      const pipeline = findPipeline(snapshot, pipelineId);
      assertStageCodeFree(pipeline, input.code);
      assertStageLimit(pipeline);
      const id = await tx.insertStage(pipeline.id, input, actor.userId);
      // Giai đoạn WON hoặc LOST mới không có bước chuyển đi; giai đoạn OPEN mới chưa có bước chuyển vào/ra
      // cho tới khi quản trị đặt (màn cấu hình), nên không ảnh hưởng cơ hội đang chạy.
      await tx.audit({
        entityType: 'pipeline_stage',
        entityId: id,
        action: 'create',
        actorId: actor.userId,
        metadata: { pipelineId: pipeline.id, ...input },
      });
    });
  }

  async updateStage(actor: CrmActor, pipelineId: string, stageId: string, body: unknown): Promise<AdminPipeline[]> {
    requireSalesManager(actor);
    return this.mutate(actor, async (tx, snapshot) => {
      const pipeline = findPipeline(snapshot, pipelineId);
      const stage = findStage(pipeline, stageId);
      const patch: StagePatch = parseStagePatch(body, stage);
      assertStagePatchAllowed(stage, snapshot.stageUsage.get(stage.id) ?? NO_USAGE, patch);
      if (patch.code !== undefined) assertStageCodeFree(pipeline, patch.code, stage.id);
      const after = pipeline.stages.map((candidate) => (candidate.id === stage.id ? { ...candidate, ...patch } : candidate));
      assertOutcomeStages(pipeline.name, after);
      const semanticChanged = patch.semantic !== undefined && patch.semantic !== stage.semantic;
      await tx.updateStage(stage.id, patch, actor.userId);
      // Giai đoạn kết thúc (WON, LOST) không có bước chuyển đi.
      if (semanticChanged && patch.semantic !== 'OPEN') await tx.replaceTransitions(stage.id, []);
      const before: Record<string, unknown> = {};
      const changed: Record<string, unknown> = {};
      for (const key of Object.keys(patch) as (keyof StagePatch)[]) {
        if (patch[key] !== stage[key]) {
          before[key] = stage[key];
          changed[key] = patch[key];
        }
      }
      if (Object.keys(changed).length > 0) {
        await tx.audit({
          entityType: 'pipeline_stage',
          entityId: stage.id,
          action: 'update',
          actorId: actor.userId,
          metadata: { pipelineId: pipeline.id, stageCode: stage.code, before, after: changed },
        });
      }
    });
  }

  async reorderStages(actor: CrmActor, pipelineId: string, body: unknown): Promise<AdminPipeline[]> {
    requireSalesManager(actor);
    const ids = parseIdList((body as { stageIds?: unknown } | null)?.stageIds, 'giai đoạn');
    return this.mutate(actor, async (tx, snapshot) => {
      const pipeline = findPipeline(snapshot, pipelineId);
      assertSameIdSet(ids, pipeline.stages.map((stage) => stage.id), 'giai đoạn');
      await tx.setStageOrder(pipeline.id, ids, actor.userId);
      await tx.audit({
        entityType: 'pipeline',
        entityId: pipeline.id,
        action: 'reorder_stages',
        actorId: actor.userId,
        metadata: { before: pipeline.stages.map((stage) => stage.id), after: ids },
      });
    });
  }

  async deleteStage(actor: CrmActor, pipelineId: string, stageId: string): Promise<AdminPipeline[]> {
    requireSalesManager(actor);
    return this.mutate(actor, async (tx, snapshot) => {
      const pipeline = findPipeline(snapshot, pipelineId);
      const stage = findStage(pipeline, stageId);
      assertCanDeleteStage(stage, snapshot.stageUsage.get(stage.id) ?? NO_USAGE);
      assertOutcomeStages(pipeline.name, pipeline.stages.filter((candidate) => candidate.id !== stage.id));
      await tx.deleteStage(stage.id);
      await tx.audit({
        entityType: 'pipeline_stage',
        entityId: stage.id,
        action: 'delete',
        actorId: actor.userId,
        metadata: { pipelineId: pipeline.id, code: stage.code, name: stage.name, semantic: stage.semantic },
      });
    });
  }

  async setTransitions(actor: CrmActor, pipelineId: string, stageId: string, body: unknown): Promise<AdminPipeline[]> {
    requireSalesManager(actor);
    const toStageIds = parseIdList((body as { toStageIds?: unknown } | null)?.toStageIds, 'giai đoạn đích');
    return this.mutate(actor, async (tx, snapshot) => {
      const pipeline = findPipeline(snapshot, pipelineId);
      const stage = findStage(pipeline, stageId);
      const targets = validateTransitionTargets(pipeline, stage, toStageIds);
      await tx.replaceTransitions(stage.id, targets);
      await tx.audit({
        entityType: 'pipeline_stage',
        entityId: stage.id,
        action: 'set_transitions',
        actorId: actor.userId,
        metadata: { pipelineId: pipeline.id, stageCode: stage.code, before: stage.nextStageIds, after: targets },
      });
    });
  }

  async setRequirements(actor: CrmActor, pipelineId: string, stageId: string, body: unknown): Promise<AdminPipeline[]> {
    requireSalesManager(actor);
    const raw = (body as { requirements?: unknown } | null)?.requirements;
    return this.mutate(actor, async (tx, snapshot) => {
      const pipeline = findPipeline(snapshot, pipelineId);
      const stage = findStage(pipeline, stageId);
      const requirements = validateRequirements(raw, pipeline.profile, snapshot.documentTypeCodes);
      await tx.replaceRequirements(stage.id, requirements);
      await tx.audit({
        entityType: 'pipeline_stage',
        entityId: stage.id,
        action: 'set_requirements',
        actorId: actor.userId,
        metadata: {
          pipelineId: pipeline.id,
          stageCode: stage.code,
          before: stage.requirements.map(({ kind, ref, required }) => ({ kind, ref, required })),
          after: requirements.map(({ kind, ref, required }) => ({ kind, ref, required })),
        },
      });
    });
  }

  /**
   * Một lần đổi cấu hình: transaction (đọc mới nhất, kiểm, ghi, audit), rồi SAU commit huỷ cache và trả cấu hình mới.
   * Lỗi quy tắc ném trước khi ghi nên transaction huỷ hết, cấu hình giữ nguyên.
   */
  private async mutate(
    actor: CrmActor,
    work: (tx: PipelineAdminTx, snapshot: PipelineAdminSnapshot) => Promise<void>,
  ): Promise<AdminPipeline[]> {
    await this.store.run(actor.tenantId, async (tx) => work(tx, await tx.load()));
    this.config.invalidate(actor.tenantId);
    return toAdmin(await this.store.snapshot(actor.tenantId));
  }
}

function findPipeline(snapshot: PipelineAdminSnapshot, id: string): Pipeline {
  const pipeline = isUuid(id) ? snapshot.pipelines.find((candidate) => candidate.id === id.toLowerCase()) : undefined;
  if (!pipeline) throw new CrmNotFoundError(PIPELINE_NOT_FOUND);
  return pipeline;
}

function findStage(pipeline: Pipeline, id: string): PipelineStage {
  const stage = isUuid(id) ? pipeline.stages.find((candidate) => candidate.id === id.toLowerCase()) : undefined;
  if (!stage) throw new CrmNotFoundError(STAGE_NOT_FOUND);
  return stage;
}

function toAdmin(snapshot: PipelineAdminSnapshot): AdminPipeline[] {
  return snapshot.pipelines.map((pipeline) => ({
    ...pipeline,
    opportunityCount: snapshot.pipelineOpportunityCount.get(pipeline.id) ?? 0,
    stages: pipeline.stages.map((stage) => {
      const usage = snapshot.stageUsage.get(stage.id) ?? NO_USAGE;
      return { ...stage, opportunityCount: usage.opportunityCount, used: usage.used };
    }),
  }));
}
