import type {
  ProcedureGatewayDecision,
  ProcedureInstance,
  ProcedureInstanceStep,
  ProcedureProgress,
} from '@enterprise-platform/contracts-procedure-engine';

/**
 * Tiến độ của hồ sơ. Server tính trên đường đi thực tế; hồ sơ cũ chưa có thì
 * rơi về cách đếm cũ (mọi bước), vốn đúng với quy trình tuyến tính.
 */
export function instanceProgress(instance: ProcedureInstance): ProcedureProgress {
  if (instance.progress) return instance.progress;
  return {
    completed: instance.steps.filter((step) => step.status === 'completed').length,
    total: instance.steps.length,
    isEstimate: false,
  };
}

/**
 * Nhãn tiến độ hiển thị cho hồ sơ. Hồ sơ đã huỷ không có tiến độ có ý nghĩa
 * (đếm bước cho ra "0/1"), nên hiện trạng thái "Đã huỷ".
 */
export function instanceProgressText(instance: ProcedureInstance, suffix = ''): string {
  if (instance.status === 'cancelled') return 'Đã huỷ';
  return `${progressLabel(instanceProgress(instance))}${suffix}`;
}

export function progressLabel(progress: ProcedureProgress): string {
  return `${progress.completed}/${progress.isEstimate ? '~' : ''}${progress.total}`;
}

export function progressPercent(progress: ProcedureProgress): number {
  return Math.round((progress.completed / Math.max(1, progress.total)) * 100);
}

export type TimelineEntry =
  | { readonly kind: 'step'; readonly step: ProcedureInstanceStep }
  | { readonly kind: 'decision'; readonly decision: ProcedureGatewayDecision }
  | { readonly kind: 'skipped'; readonly steps: readonly ProcedureInstanceStep[] };

/**
 * Thứ tự hiển thị timeline: các bước theo ĐƯỜNG ĐI (kể cả bước sắp tới chưa
 * quyết), thẻ quyết định chen ngay sau bước đặt gateway, và các bước ở nhánh
 * không đi gom thành một dòng ở cuối — để người đọc không nhầm chúng là việc
 * còn phải làm.
 */
export function timelineEntries(instance: ProcedureInstance): TimelineEntry[] {
  const decisions = (instance.decisions ?? []).filter((item) => !item.supersededAt);
  const decisionAfter = new Map(decisions.map((item) => [item.afterStepInstanceId, item]));
  const skipped = instance.steps.filter((step) => step.status === 'skipped');
  const entries: TimelineEntry[] = [];
  for (const step of [...instance.steps].sort((left, right) => left.order - right.order)) {
    if (step.status === 'skipped') continue;
    entries.push({ kind: 'step', step });
    const decision = decisionAfter.get(step.id);
    if (decision) entries.push({ kind: 'decision', decision });
  }
  if (skipped.length) entries.push({ kind: 'skipped', steps: skipped });
  return entries;
}
