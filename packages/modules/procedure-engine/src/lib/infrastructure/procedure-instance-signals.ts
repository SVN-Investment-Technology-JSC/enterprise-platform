import type { ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';

export const PROCEDURE_INSTANCE_CHANGED_EVENT = 'procedure.instance.changed';

/** Người thực hiện khi không có mục lịch sử mới nào (ví dụ Tài chính cập nhật phiếu của bước). */
export const PROCEDURE_SYSTEM_ACTOR = 'system';

export interface ProcedureInstanceSignalEvent {
  readonly type: typeof PROCEDURE_INSTANCE_CHANGED_EVENT;
  readonly aggregateType: 'procedure-instance';
  readonly aggregateId: string;
  readonly payload: {
    readonly instanceId: string;
    readonly actorUserId: string;
  };
}

/**
 * Tín hiệu thời gian thực "hồ sơ vừa đổi", tối đa một cái cho mỗi hồ sơ trong một lần ghi.
 *
 * Giống tín hiệu trao đổi: chỉ mang id, vào PHÒNG của hồ sơ; người đang mở hồ sơ gọi lại API có kiểm quyền.
 * Tính là "đổi" khi người đang xem sẽ thấy khác: trạng thái hồ sơ, bước hiện tại, trạng thái hay pha RACI của
 * một bước, phiếu Tài chính của bước, việc con, ủy quyền, thuộc tính, xoá/huỷ hiệu lực, hay một mục lịch sử
 * mới không phải trao đổi (duyệt, trả về, hoàn duyệt, huỷ...). Trao đổi đã có tín hiệu riêng nên một lần ghi
 * chỉ thêm trao đổi không sinh tín hiệu này. Hồ sơ vừa tạo chưa ai mở nên cũng không phát.
 */
export function procedureInstanceSignals(
  before: readonly ProcedureInstance[],
  after: readonly ProcedureInstance[],
): readonly ProcedureInstanceSignalEvent[] {
  const previous = new Map(before.map((instance) => [instance.id, instance]));
  const events: ProcedureInstanceSignalEvent[] = [];
  for (const instance of after) {
    const prior = previous.get(instance.id);
    if (!prior || liveKey(prior) === liveKey(instance)) continue;
    const known = new Set(prior.activity.map((entry) => entry.id));
    // Lịch sử xếp mới nhất trước: mục mới đầu tiên là thao tác vừa làm.
    const latest = instance.activity.find((entry) => !known.has(entry.id) && entry.action !== 'comment');
    events.push({
      type: PROCEDURE_INSTANCE_CHANGED_EVENT,
      aggregateType: 'procedure-instance',
      aggregateId: instance.id,
      payload: { instanceId: instance.id, actorUserId: latest?.actorId || PROCEDURE_SYSTEM_ACTOR },
    });
  }
  return events;
}

/** Những gì người đang xem hồ sơ nhìn thấy, bỏ trao đổi; rẻ hơn so sánh cả hồ sơ. */
function liveKey(instance: ProcedureInstance): string {
  return JSON.stringify([
    instance.status,
    instance.currentStepId ?? null,
    instance.completedAt ?? null,
    instance.deletion ?? null,
    instance.reversal ?? null,
    instance.replacedByInstanceId ?? null,
    instance.assetCode ?? null,
    instance.workspaceLink ?? null,
    instance.steps.map((step) => [
      step.id,
      step.status,
      step.currentRoleStage,
      step.completedAt ?? null,
      step.financeVoucher ?? null,
      step.materialCheck ?? null,
    ]),
    instance.activity.filter((entry) => entry.action !== 'comment').map((entry) => entry.id),
    (instance.subtasks ?? []).map((subtask) => [subtask.id, subtask.status]),
    (instance.delegations ?? []).map((delegation) => delegation.id),
    instance.attributeValues ?? null,
  ]);
}
