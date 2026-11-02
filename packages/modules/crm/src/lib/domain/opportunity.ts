import {
  OPPORTUNITY_REQUIRED_FIELDS,
  QUOTE_DEFAULT_VALIDITY_DAYS,
  type OpportunityRequiredField,
  type Pipeline,
  type PipelineStage,
  type StageRef,
  type StageRequirement,
  type StageRequirementCheck,
} from '@enterprise-platform/contracts-crm';
import { CrmConflictError, CrmValidationError } from './crm.error.js';

/**
 * Máy trạng thái cơ hội theo cấu hình luồng (GĐ B).
 *
 * Mọi hàm nhận `Pipeline` (đọc từ DB, `application/pipeline-config.*`), không
 * dùng hằng 7 giai đoạn của phase 1:
 * - bước chuyển hợp lệ là cặp (từ, đến) có trong `PipelineStage.nextStageIds`,
 *   giai đoạn đích phải đang bật; giai đoạn có nghĩa WON, LOST là cuối;
 * - chuyển vào giai đoạn có nghĩa LOST bắt buộc lý do;
 * - điều kiện chuyển vào giai đoạn (`requirements`): FIELD, QUOTE_APPROVED,
 *   REASON, DOCUMENT_TYPE (xem `evaluateRequirements`).
 *
 * Tác động phụ theo nghĩa giai đoạn đích (`stageSideEffects`): sang giai đoạn
 * có mã `QUOTING` thì tạo nháp báo giá nếu chưa có (hành vi phase 1, chỉ gắn với
 * mã của luồng mặc định); sang nghĩa LOST thì báo giá chưa kết thúc sang Khách
 * từ chối.
 */

/** Mã giai đoạn "Báo giá" của luồng mặc định; sang đó thì tự tạo nháp báo giá (OPP-05). */
export const QUOTING_STAGE_CODE = 'QUOTING';

export function findStage(pipeline: Pipeline, code: string): PipelineStage | undefined {
  return pipeline.stages.find((stage) => stage.code === code);
}

export function findStageById(pipeline: Pipeline, id: string): PipelineStage | undefined {
  return pipeline.stages.find((stage) => stage.id === id);
}

export function stageRef(stage: PipelineStage): StageRef {
  return { id: stage.id, code: stage.code, name: stage.name, semantic: stage.semantic };
}

/** Giai đoạn còn mở (nghĩa OPEN). */
export function isOpenStage(stage: Pick<StageRef, 'semantic'>): boolean {
  return stage.semantic === 'OPEN';
}

/** Giai đoạn đầu của luồng cho cơ hội mới: bật, nghĩa OPEN, thứ tự nhỏ nhất. */
export function firstStage(pipeline: Pipeline): PipelineStage | undefined {
  return pipeline.stages
    .filter((stage) => stage.active && stage.semantic === 'OPEN')
    .sort((a, b) => a.sortOrder - b.sortOrder)[0];
}

/**
 * Giai đoạn đích chuyển được ngay từ `from`: có trong bảng bước chuyển, đang bật, theo thứ tự luồng.
 * `skippedStageIds` là các giai đoạn đã bỏ qua của dự án: đích rơi vào giai đoạn bỏ qua (nghĩa OPEN) thì
 * thay bằng giai đoạn kế còn áp dụng, đi tiếp theo cùng chiều (tiến hoặc lùi) trong bảng bước chuyển.
 */
export function allowedTransitions(
  pipeline: Pipeline,
  from: PipelineStage,
  skippedStageIds: ReadonlySet<string> = new Set(),
): PipelineStage[] {
  if (from.semantic !== 'OPEN') return [];
  const byId = new Map(pipeline.stages.map((stage) => [stage.id, stage]));
  const result = new Map<string, PipelineStage>();
  const visit = (stage: PipelineStage, direction: number, seen: Set<string>): void => {
    if (!skippedStageIds.has(stage.id) || stage.semantic !== 'OPEN') {
      result.set(stage.id, stage);
      return;
    }
    seen.add(stage.id);
    for (const nextId of stage.nextStageIds) {
      const next = byId.get(nextId);
      if (!next || !next.active || seen.has(next.id)) continue;
      if (Math.sign(next.sortOrder - stage.sortOrder) !== direction) continue;
      visit(next, direction, seen);
    }
  };
  for (const id of from.nextStageIds) {
    const to = byId.get(id);
    if (!to || !to.active || to.id === from.id) continue;
    visit(to, Math.sign(to.sortOrder - from.sortOrder), new Set([from.id]));
  }
  result.delete(from.id);
  return [...result.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function canTransition(
  pipeline: Pipeline,
  from: PipelineStage,
  to: PipelineStage,
  skippedStageIds: ReadonlySet<string> = new Set(),
): boolean {
  return allowedTransitions(pipeline, from, skippedStageIds).some((stage) => stage.id === to.id);
}

/**
 * Kiểm một lần chuyển giai đoạn, trả lý do đã chuẩn hoá (khi có).
 *
 * Chuyển không có trong bảng (kể cả chuyển về chính nó, ra khỏi giai đoạn cuối,
 * vào giai đoạn đã tắt): 409. Sang nghĩa LOST thiếu lý do: 400. Lý do tối đa
 * 2000 ký tự.
 */
export function assertStageTransition(
  pipeline: Pipeline,
  from: PipelineStage,
  to: PipelineStage,
  reason: string | null | undefined,
  skippedStageIds: ReadonlySet<string> = new Set(),
): string | null {
  if (!canTransition(pipeline, from, to, skippedStageIds)) {
    throw new CrmConflictError(
      'INVALID_STAGE_TRANSITION',
      `Không thể chuyển cơ hội từ "${from.name}" sang "${to.name}".`,
    );
  }
  const trimmed = reason?.trim() ?? '';
  if (to.semantic === 'LOST' && !trimmed) {
    throw new CrmValidationError('LOST_REASON_REQUIRED', 'Phải ghi lý do thua.');
  }
  if (trimmed.length > 2000) {
    throw new CrmValidationError(
      to.semantic === 'LOST' ? 'LOST_REASON_TOO_LONG' : 'REASON_TOO_LONG',
      to.semantic === 'LOST' ? 'Lý do thua tối đa 2000 ký tự.' : 'Lý do tối đa 2000 ký tự.',
    );
  }
  return trimmed || null;
}

/** Xác suất thắng: số nguyên 0–100. */
export function normalizeProbability(value: unknown, fallback = 0): number {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 100) {
    throw new CrmValidationError('INVALID_PROBABILITY', 'Xác suất phải là số nguyên từ 0 đến 100.');
  }
  return number;
}

// ---------------------------------------------------------------------------
// Điều kiện chuyển giai đoạn
// ---------------------------------------------------------------------------

/** Dữ liệu cơ hội để kiểm điều kiện, đã đọc sẵn (hàm kiểm là hàm thuần). */
export interface RequirementContext {
  readonly fields: Readonly<Partial<Record<OpportunityRequiredField, unknown>>>;
  /** Lý do người dùng nhập lần chuyển này (đã chuẩn hoá). */
  readonly reason: string | null;
  readonly hasAcceptedQuote: boolean;
  /**
   * Tra "có tài liệu loại `ref` còn hiệu lực" cho điều kiện DOCUMENT_TYPE.
   * Chưa có kho tài liệu (GĐ C) thì không truyền: điều kiện ấy ở trạng thái
   * "chưa kiểm" (`met = null`), không chặn.
   */
  readonly documentTypeMet?: (ref: string) => boolean;
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function defaultMessage(requirement: StageRequirement, to: Pick<StageRef, 'name'>): string {
  switch (requirement.kind) {
    case 'FIELD': {
      const label = OPPORTUNITY_REQUIRED_FIELDS[requirement.ref as OpportunityRequiredField] ?? requirement.ref;
      return `Cần điền "${label}" trước khi chuyển sang "${to.name}".`;
    }
    case 'QUOTE_APPROVED':
      return `Cần có báo giá được khách chấp nhận trước khi chuyển sang "${to.name}".`;
    case 'REASON':
      return `Phải ghi lý do khi chuyển sang "${to.name}".`;
    case 'DOCUMENT_TYPE':
      return `Cần có tài liệu "${requirement.ref}" trước khi chuyển sang "${to.name}".`;
  }
}

/** Kiểm từng điều kiện của giai đoạn đích, theo `sortOrder`. */
export function evaluateRequirements(to: PipelineStage, context: RequirementContext): StageRequirementCheck[] {
  return [...to.requirements]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((requirement) => {
      let met: boolean | null;
      switch (requirement.kind) {
        case 'FIELD':
          met = hasValue(context.fields[requirement.ref as OpportunityRequiredField]);
          break;
        case 'QUOTE_APPROVED':
          met = context.hasAcceptedQuote;
          break;
        case 'REASON':
          met = hasValue(context.reason);
          break;
        case 'DOCUMENT_TYPE':
          met = context.documentTypeMet ? context.documentTypeMet(requirement.ref) : null;
          break;
      }
      return {
        kind: requirement.kind,
        ref: requirement.ref,
        required: requirement.required,
        message: requirement.message?.trim() || defaultMessage(requirement, to),
        met,
      };
    });
}

/** Điều kiện bắt buộc (`required`) mà chắc chắn chưa đạt: chặn chuyển. */
export function blockingRequirements(checks: readonly StageRequirementCheck[]): StageRequirementCheck[] {
  return checks.filter((check) => check.required && check.met === false);
}

/** Mã lỗi 409: chỉ thiếu báo giá thì giữ mã phase 1 `ACCEPTED_QUOTE_REQUIRED`. */
export function requirementsErrorCode(blocking: readonly StageRequirementCheck[]): string {
  return blocking.every((check) => check.kind === 'QUOTE_APPROVED')
    ? 'ACCEPTED_QUOTE_REQUIRED'
    : 'STAGE_REQUIREMENTS_NOT_MET';
}

/** Ném 409 nêu rõ thiếu gì nếu có điều kiện bắt buộc chưa đạt. */
export function assertRequirementsMet(checks: readonly StageRequirementCheck[]): void {
  const blocking = blockingRequirements(checks);
  if (!blocking.length) return;
  throw new CrmConflictError(requirementsErrorCode(blocking), blocking.map((check) => check.message).join(' '), {
    missing: blocking.map((check) => ({ kind: check.kind, ref: check.ref, message: check.message })),
  });
}

/**
 * Tác động phụ của việc chuyển sang `to`, store làm trong cùng transaction:
 * sang Báo giá tạo nháp báo giá hạn hiệu lực mặc định tính từ `today` nếu chưa
 * có; sang nghĩa LOST thì báo giá chưa kết thúc sang Khách từ chối (T3-21).
 * "Thắng cần báo giá được chấp nhận" không còn cứng ở đây: là điều kiện
 * QUOTE_APPROVED của giai đoạn.
 */
export function stageSideEffects(
  to: Pick<StageRef, 'code' | 'semantic'>,
  today: string,
): { draftQuoteValidUntil?: string; declineOpenQuotes?: boolean } {
  if (to.semantic === 'LOST') return { declineOpenQuotes: true };
  if (to.code === QUOTING_STAGE_CODE) {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + QUOTE_DEFAULT_VALIDITY_DAYS);
    return { draftQuoteValidUntil: date.toISOString().slice(0, 10) };
  }
  return {};
}
