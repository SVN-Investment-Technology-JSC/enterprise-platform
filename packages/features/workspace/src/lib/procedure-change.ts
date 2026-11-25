import type { ProcedureInstanceView } from './procedure-api';

const TOUCHED_STEP_STATUSES = new Set(['completed', 'returned', 'rejected', 'skipped']);

/**
 * Lý do chưa cho đổi quy trình, hoặc `undefined` khi hồ sơ trông còn nguyên.
 *
 * Chỉ là gợi ý để mờ nút; server (module Quy trình) mới là nơi quyết định.
 */
export function procedureChangeBlockReason(view: ProcedureInstanceView | undefined): string | undefined {
  if (!view) return undefined;
  if (view.status && view.status !== 'running') return 'Hồ sơ đã kết thúc nên không đổi quy trình được.';
  const handled = 'Hồ sơ đã được xử lý nên không đổi quy trình được.';
  if ((view.stepStatuses ?? []).some((status) => TOUCHED_STEP_STATUSES.has(status))) return handled;
  if (view.doneSteps > 0) return handled;
  if (view.currentStepIndex !== undefined && view.currentStepIndex > 0) return handled;
  if (view.activityCount !== undefined && view.activityCount > 1) return handled;
  return undefined;
}
