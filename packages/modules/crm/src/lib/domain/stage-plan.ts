import type {
  OpportunityStagePlanItem,
  Pipeline,
  PipelineStage,
  StagePlanStatus,
} from '@enterprise-platform/contracts-crm';
import { CrmConflictError, CrmValidationError } from './crm.error.js';
import { findStage } from './opportunity.js';

/** Dòng kế hoạch lúc dựng (trước khi ghi DB). */
export interface PlannedStage {
  readonly stageId: string;
  readonly status: StagePlanStatus;
  readonly assigneeUserId: string | null;
  readonly assigneeWarning: string | null;
  readonly skippedReason: string | null;
}

export interface StageSkipInput {
  readonly stage: string;
  readonly reason: string;
}

/** Giai đoạn áp dụng cho dự án mới: đang bật, theo thứ tự luồng. */
export function planStages(pipeline: Pipeline): PipelineStage[] {
  return pipeline.stages.filter((stage) => stage.active).sort((a, b) => a.sortOrder - b.sortOrder);
}

const SKIP_REASON_REQUIRED = 'Phải ghi lý do bỏ qua giai đoạn.';

/** Chuẩn hoá lý do bỏ qua: bắt buộc, tối đa 2000 ký tự (400 nếu sai). */
export function normalizeSkipReason(reason: unknown): string {
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (!text) throw new CrmValidationError('SKIP_REASON_REQUIRED', SKIP_REASON_REQUIRED);
  if (text.length > 2000) throw new CrmValidationError('SKIP_REASON_TOO_LONG', 'Lý do bỏ qua tối đa 2000 ký tự.');
  return text;
}

/**
 * Giai đoạn có bỏ qua được không (409 nếu không): chỉ giai đoạn `skippable` nghĩa OPEN; không bỏ qua giai
 * đoạn hiện tại (ACTIVE), giai đoạn đã qua (DONE) hay đã bỏ qua (SKIPPED).
 */
export function assertSkippable(stage: Pick<PipelineStage, 'name' | 'semantic' | 'skippable'>, status: StagePlanStatus | null): void {
  if (stage.semantic !== 'OPEN') {
    throw new CrmConflictError('STAGE_NOT_SKIPPABLE', `Không bỏ qua được giai đoạn kết thúc "${stage.name}".`);
  }
  if (!stage.skippable) {
    throw new CrmConflictError('STAGE_NOT_SKIPPABLE', `Giai đoạn "${stage.name}" không cho bỏ qua.`);
  }
  if (status === 'ACTIVE') {
    throw new CrmConflictError('STAGE_IS_CURRENT', `Không bỏ qua được giai đoạn hiện tại "${stage.name}".`);
  }
  if (status === 'DONE') {
    throw new CrmConflictError('STAGE_ALREADY_PASSED', `Giai đoạn "${stage.name}" đã qua, không bỏ qua được.`);
  }
  if (status === 'SKIPPED') {
    throw new CrmConflictError('STAGE_ALREADY_SKIPPED', `Giai đoạn "${stage.name}" đã được bỏ qua.`);
  }
}

/**
 * Kiểm danh sách bỏ qua lúc tạo dự án và trả map `id giai đoạn -> lý do`. Giai đoạn đầu (giai đoạn hiện tại
 * của dự án mới) không bỏ qua được (409); mã lạ 400; trùng mã 400.
 */
export function validateCreationSkips(
  pipeline: Pipeline,
  start: PipelineStage,
  skips: readonly StageSkipInput[] | undefined,
): Map<string, string> {
  const result = new Map<string, string>();
  for (const skip of skips ?? []) {
    const code = typeof skip?.stage === 'string' ? skip.stage.trim() : '';
    const stage = code ? findStage(pipeline, code) : undefined;
    if (!stage || !stage.active) throw new CrmValidationError('INVALID_STAGE', 'Giai đoạn bỏ qua không hợp lệ.');
    if (result.has(stage.id)) throw new CrmValidationError('DUPLICATE_SKIP', `Giai đoạn "${stage.name}" bị bỏ qua hai lần.`);
    const reason = normalizeSkipReason(skip.reason);
    assertSkippable(stage, stage.id === start.id ? 'ACTIVE' : 'PENDING');
    result.set(stage.id, reason);
  }
  return result;
}

/** Tập id giai đoạn đã bỏ qua trong kế hoạch. */
export function skippedStageIds(items: readonly Pick<OpportunityStagePlanItem, 'status' | 'stage'>[]): Set<string> {
  return new Set(items.filter((item) => item.status === 'SKIPPED').map((item) => item.stage.id));
}
