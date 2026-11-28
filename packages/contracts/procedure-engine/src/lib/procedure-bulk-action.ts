import { isBlankAttributeValue } from './procedure-condition.js';
import type {
  ProcedureDefinition,
  ProcedureInstance,
  ProcedureRuntimeAuthorization,
} from './procedure-engine.contracts.js';
import type { ProcedureAttributeDefinition } from './procedure-flow.types.js';

/**
 * Duyệt / không duyệt hàng loạt ở trang Tổng quan (`POST v1/instances/bulk-action`).
 *
 * Luật chọn hồ sơ nằm ở đây, dùng chung cho server (quyết định thật) và giao diện (đếm số hồ sơ sẽ được xử lý), để hai
 * bên không lệch nhau. Mỗi hồ sơ vẫn đi qua đúng đường xử lý một hồ sơ (`applyAction`) với khoá chống trùng riêng.
 */

/** Số hồ sơ tối đa cho một lần gọi. */
export const PROCEDURE_BULK_ACTION_MAX = 50;

export const PROCEDURE_BULK_ACTIONS = ['approve', 'reject'] as const;
export type ProcedureBulkAction = (typeof PROCEDURE_BULK_ACTIONS)[number];

export interface ProcedureBulkActionRequest {
  readonly action: ProcedureBulkAction;
  readonly instanceIds: readonly string[];
  /** Ghi chú kèm thao tác; bắt buộc với `reject` (lý do không duyệt). */
  readonly comment?: string;
  /** Khoá của cả lần bấm; khoá từng hồ sơ suy từ khoá này + id hồ sơ, gọi lại không xử lý hai lần. */
  readonly idempotencyKey: string;
}

/**
 * Lý do một hồ sơ bị bỏ qua:
 *  - `not_found`: không có, đã xoá hoặc người gọi không xem được (không trả mã hồ sơ);
 *  - `bulk_disabled`: quy trình không bật thao tác hàng loạt này;
 *  - `not_running`: hồ sơ đã kết thúc;
 *  - `not_your_turn`: chưa tới lượt người gọi hoặc pha hiện tại không có thao tác này;
 *  - `input_required`: bước cần nhập / làm thêm mà thao tác hàng loạt không cung cấp được;
 *  - `failed`: đường xử lý một hồ sơ từ chối (lý do nằm trong `message`).
 */
export type ProcedureBulkSkipReason =
  | 'not_found'
  | 'bulk_disabled'
  | 'not_running'
  | 'not_your_turn'
  | 'input_required'
  | 'failed';

export interface ProcedureBulkActionDone {
  readonly id: string;
  readonly code: string;
}

export interface ProcedureBulkActionSkipped {
  readonly id: string;
  /** `null` khi người gọi không xem được hồ sơ. */
  readonly code: string | null;
  readonly reason: ProcedureBulkSkipReason;
  readonly message: string;
}

export interface ProcedureBulkActionResponse {
  readonly done: readonly ProcedureBulkActionDone[];
  readonly skipped: readonly ProcedureBulkActionSkipped[];
}

export const PROCEDURE_BULK_DISABLED_MESSAGE: Record<ProcedureBulkAction, string> = {
  approve: 'Quy trình này không cho duyệt hàng loạt.',
  reject: 'Quy trình này không cho không duyệt (huỷ) hàng loạt.',
};

/** Quy trình có bật thao tác hàng loạt này không. Vắng cài đặt = không (mặc định an toàn). */
export function definitionAllowsBulkAction(
  definition: Pick<ProcedureDefinition, 'bulkActions'> | undefined,
  action: ProcedureBulkAction,
): boolean {
  return definition?.bulkActions?.[action] === true;
}

/** Thuộc tính bắt buộc người này phải nhập ở bước hiện tại mà còn trống. */
function missingRequiredInputs(
  instance: ProcedureInstance,
  authorization: ProcedureRuntimeAuthorization,
): ProcedureAttributeDefinition[] {
  const editable = authorization.editableAttributeKeys ?? [];
  if (!editable.length) return [];
  const definitions = new Map<string, ProcedureAttributeDefinition>();
  for (const definition of instance.flow?.attributes ?? []) definitions.set(`process:${definition.code}`, definition);
  for (const step of instance.steps) {
    for (const definition of step.attributes ?? []) {
      definitions.set(`step:${step.definitionStepId}:${definition.code}`, definition);
    }
  }
  const missing: ProcedureAttributeDefinition[] = [];
  for (const key of editable) {
    const definition = definitions.get(key);
    if (definition?.required && isBlankAttributeValue(instance.attributeValues?.[key]?.value)) missing.push(definition);
  }
  return missing;
}

/**
 * Vì sao bước hiện tại không duyệt / hoàn tất hàng loạt được: bước chờ module khác (Tài chính…), còn thông tin bắt
 * buộc chưa nhập, thiếu vật tư, còn đầu việc chưa xong, chưa chọn thiết bị hoặc chưa phân rã đầu việc. Cùng luật với
 * nút "Mở để xử lý" ở trang Tổng quan. Vắng là không vướng gì.
 */
export function procedureBulkInputBlocker(
  instance: ProcedureInstance,
  authorization: ProcedureRuntimeAuthorization,
): string | undefined {
  const step = instance.steps.find((candidate) => candidate.id === instance.currentStepId);
  if (!step) return undefined;
  if (step.integration) {
    return step.integration.module === 'finance' ? 'Bước chờ Tài chính lập phiếu' : 'Bước chờ module liên kết';
  }
  const missing = missingRequiredInputs(instance, authorization);
  if (missing.length) return `Cần nhập: ${missing.map((item) => item.name).join(', ')}`;
  if (step.materials?.length && step.materialCheck?.state === 'short') return 'Thiếu vật tư cho bước này';
  const subtasks = (instance.subtasks ?? []).filter((subtask) => subtask.stepInstanceId === step.id);
  if (subtasks.some((subtask) => subtask.status !== 'completed' && subtask.status !== 'cancelled')) {
    return 'Còn đầu việc chưa xong';
  }
  if (authorization.currentRoleStage === 'E' && subtasks.length === 0) {
    const sources = step.assignments.filter((assignment) => assignment.role === 'E' && assignment.eTaskSource);
    if (
      sources.some(
        (assignment) =>
          assignment.eTaskSource === 'inventory_asset' &&
          !instance.assetCode?.trim() &&
          !assignment.eTaskConfig?.assetCode?.trim(),
      )
    ) {
      return 'Cần chọn thiết bị cho hồ sơ';
    }
    if (sources.length) return 'Cần phân rã công việc (WBS) của bước';
  }
  return undefined;
}

export type ProcedureBulkPlan =
  | { readonly ok: true; readonly runtimeAction: 'approve' | 'complete' | 'reject' }
  | {
      readonly ok: false;
      readonly reason: Extract<ProcedureBulkSkipReason, 'not_running' | 'not_your_turn' | 'input_required'>;
      readonly message: string;
    };

/**
 * Thao tác thật sẽ chạy cho một hồ sơ, hoặc lý do bỏ qua (chưa xét cài đặt quy trình: xem
 * `definitionAllowsBulkAction`).
 *
 * - Chỉ khi TỚI LƯỢT người gọi: giữ vai của pha hiện tại (kể cả được uỷ quyền). Quyền can thiệp của quản trị không
 *   tính, để không ai duyệt hàng loạt thay người khác.
 * - Duyệt: `approve` nếu pha có, không thì `complete` (pha thực hiện S/R/E); bước còn cần nhập/làm thêm thì bỏ qua.
 * - Không duyệt: `reject` khi pha hiện tại có (như trang Tổng quan, pha Xem xét R không từ chối).
 */
export function procedureBulkPlan(
  instance: ProcedureInstance,
  authorization: ProcedureRuntimeAuthorization | undefined,
  action: ProcedureBulkAction,
): ProcedureBulkPlan {
  if (instance.status !== 'running') {
    return { ok: false, reason: 'not_running', message: 'Hồ sơ đã kết thúc.' };
  }
  const stage = authorization?.currentRoleStage ?? null;
  if (!authorization || !stage || !authorization.myRoles.includes(stage)) {
    return { ok: false, reason: 'not_your_turn', message: 'Chưa tới lượt bạn xử lý bước hiện tại.' };
  }
  const available = authorization.availableActions;
  if (action === 'reject') {
    if (stage === 'R' || !available.includes('reject')) {
      return { ok: false, reason: 'not_your_turn', message: 'Pha hiện tại của bạn không có thao tác không duyệt.' };
    }
    return { ok: true, runtimeAction: 'reject' };
  }
  const runtimeAction = available.includes('approve')
    ? 'approve'
    : available.includes('complete')
      ? 'complete'
      : undefined;
  // Bước chờ Tài chính đã bị bỏ thao tác duyệt khỏi `availableActions`: báo đúng lý do "cần xử lý ở hồ sơ".
  const blocker = procedureBulkInputBlocker(instance, authorization);
  if (!runtimeAction && !blocker) {
    return { ok: false, reason: 'not_your_turn', message: 'Pha hiện tại của bạn không có thao tác duyệt.' };
  }
  if (blocker || !runtimeAction) return { ok: false, reason: 'input_required', message: `${blocker}; hãy mở hồ sơ để xử lý.` };
  return { ok: true, runtimeAction };
}
