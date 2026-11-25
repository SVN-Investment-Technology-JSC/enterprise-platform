import type { ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import { firstInstanceStep } from './procedure-runtime-flow.js';

/**
 * "Đổi quy trình" của công việc Workspace: hồ sơ mở nhầm được xoá mềm và thay bằng hồ sơ mới
 * theo quy trình khác, công việc giữ nguyên. Chỉ cho phép khi hồ sơ cũ còn NGUYÊN VẸN, vì mọi dấu
 * vết đã phát sinh (duyệt, trao đổi, vật tư, chứng từ ở module khác) sẽ mất cùng hồ sơ.
 */

const HINT = 'hãy xoá hồ sơ ở module Quy trình nếu thật sự cần.';

export const REPLACE_REASON_DELETED = 'Hồ sơ đã bị xoá hoặc đã được thay bằng hồ sơ khác.';
export const REPLACE_REASON_ENDED =
  'Hồ sơ đã kết thúc (hoàn thành, huỷ hoặc huỷ hiệu lực) nên không đổi quy trình được.';
export const REPLACE_REASON_STEP_HANDLED =
  'Hồ sơ đã có bước được hoàn thành, trả về hoặc từ chối nên không đổi quy trình được; ' + HINT;
export const REPLACE_REASON_MOVED_ON =
  'Hồ sơ đã chuyển khỏi bước đầu tiên nên không đổi quy trình được; ' + HINT;
export const REPLACE_REASON_ACTIVITY =
  'Hồ sơ đã có trao đổi, duyệt hoặc bàn giao nên không đổi quy trình được; ' + HINT;
export const REPLACE_REASON_DELEGATED =
  'Hồ sơ đã có uỷ quyền hoặc đầu việc được giao nên không đổi quy trình được; ' + HINT;
export const REPLACE_REASON_MATERIALS =
  'Hồ sơ đã giữ chỗ hoặc đặt vật tư nên không đổi quy trình được; ' + HINT;
export const REPLACE_REASON_ATTRIBUTES =
  'Hồ sơ đã có dữ liệu được nhập nên không đổi quy trình được; ' + HINT;
export const REPLACE_REASON_EXTERNAL =
  'Hồ sơ đã tạo dữ liệu ở module khác nên không đổi quy trình được; ' + HINT;
export const REPLACE_REASON_DISABLED = 'Quy trình của công việc không được phép đổi theo cài đặt.';
export const REPLACE_REASON_ATTACHMENTS =
  'Hồ sơ đã có tệp đính kèm nên không đổi quy trình được; ' + HINT;

/** Khi nào được đổi quy trình (cài đặt `engineChangeEligibility`). */
export type ReplaceEligibilityMode = 'untouched' | 'no_step_handled' | 'never';

/**
 * Lý do hồ sơ KHÔNG đổi quy trình được; `undefined` = đổi được.
 *
 * Thuần trên bản chụp hồ sơ. Tệp đính kèm nằm ở bảng riêng nên bên gọi kiểm thêm
 * (`REPLACE_REASON_ATTACHMENTS`, bỏ qua khi `no_step_handled`).
 *
 * `mode`: `untouched` (mặc định) cần hồ sơ còn nguyên vẹn; `no_step_handled` cho đổi dù đã có trao đổi, uỷ quyền
 * hay dữ liệu nhập, nhưng vẫn chặn khi có bước đã xử lý, vật tư giữ chỗ hoặc dữ liệu ở module khác;
 * `never` chặn hẳn.
 */
export function replaceableInstanceReason(
  instance: ProcedureInstance,
  mode: ReplaceEligibilityMode = 'untouched',
): string | undefined {
  if (instance.deletion || instance.replacedByInstanceId) return REPLACE_REASON_DELETED;
  if (instance.status !== 'running' || instance.reversal) return REPLACE_REASON_ENDED;
  if (mode === 'never') return REPLACE_REASON_DISABLED;

  const current = instance.steps.find((step) => step.id === instance.currentStepId);
  const first = firstInstanceStep(instance);
  if (instance.steps.some((step) => ['completed', 'returned', 'rejected'].includes(step.status))) {
    return REPLACE_REASON_STEP_HANDLED;
  }
  if (!current || !first || current.id !== first.id) return REPLACE_REASON_MOVED_ON;
  if (
    instance.steps.some((step) => step.id !== current.id && step.status !== 'pending') ||
    (instance.path ?? []).some((entry) => entry.stepInstanceId !== current.id || entry.supersededAt) ||
    (instance.decisions ?? []).length > 0
  ) {
    return REPLACE_REASON_MOVED_ON;
  }

  const strict = mode === 'untouched';
  if (strict && instance.activity.some((entry) => entry.action !== 'start')) return REPLACE_REASON_ACTIVITY;
  if (strict && ((instance.delegations ?? []).length > 0 || (instance.subtasks ?? []).length > 0)) {
    return REPLACE_REASON_DELEGATED;
  }
  if (
    (instance.materialOrders ?? []).length > 0 ||
    instance.steps.some((step) => (step.materialReservations ?? []).length > 0)
  ) {
    return REPLACE_REASON_MATERIALS;
  }
  if (strict && Object.keys(instance.attributeValues ?? {}).length > 0) return REPLACE_REASON_ATTRIBUTES;
  if (
    instance.sourceSummary ||
    instance.workspaceLink ||
    instance.adjustmentOf ||
    instance.steps.some((step) => step.financeVoucher)
  ) {
    return REPLACE_REASON_EXTERNAL;
  }
  return undefined;
}
