import type {
  ProcedureBranchView,
  ProcedureGatewayView,
  ProcedureStepView,
  ProcedureStepViewStatus,
  WorkItemProcedureSteps,
} from '@enterprise-platform/contracts-workspace';

/** Trạng thái hiển thị của một bước trên đường thời gian. */
export type StepDisplayState =
  | 'done'
  | 'current'
  | 'returned'
  | 'rejected'
  | 'cancelled'
  | 'upcoming'
  | 'skipped';

const DISPLAY_STATE: Record<ProcedureStepViewStatus, StepDisplayState> = {
  completed: 'done',
  active: 'current',
  ready: 'current',
  returned: 'returned',
  rejected: 'rejected',
  cancelled: 'cancelled',
  pending: 'upcoming',
  skipped: 'skipped',
};

export function stepDisplayState(
  status: ProcedureStepViewStatus,
): StepDisplayState {
  return DISPLAY_STATE[status] ?? 'upcoming';
}

export interface SplitSteps {
  /** Các bước trên đường đi thực tế, theo thứ tự định nghĩa. */
  readonly path: readonly ProcedureStepView[];
  /** Các bước thuộc nhánh không đi. */
  readonly skipped: readonly ProcedureStepView[];
}

const byOrder = (a: ProcedureStepView, b: ProcedureStepView) =>
  a.order - b.order;

/** Xếp theo `order` và tách nhánh không đi sang nhóm riêng. */
export function splitSteps(steps: readonly ProcedureStepView[]): SplitSteps {
  const sorted = [...steps].sort(byOrder);
  return {
    path: sorted.filter((step) => step.status !== 'skipped'),
    skipped: sorted.filter((step) => step.status === 'skipped'),
  };
}

/** Số bước đã xong trên tổng; dùng `progress` do server tính, thiếu thì đếm lại (không tính nhánh không đi). */
export function stepCounts(
  data: Pick<WorkItemProcedureSteps, 'progress' | 'steps'>,
): {
  readonly done: number;
  readonly total: number;
} {
  if (data.progress && data.progress.total > 0) {
    return { done: data.progress.completed, total: data.progress.total };
  }
  const path = data.steps.filter((step) => step.status !== 'skipped');
  return {
    done: path.filter((step) => step.status === 'completed').length,
    total: path.length,
  };
}

export function progressPercent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

const OPEN_STEP: ReadonlySet<ProcedureStepViewStatus> = new Set([
  'pending',
  'active',
  'ready',
  'returned',
]);

/** Quá hạn SLA: có hạn đã qua, bước chưa xong và hồ sơ còn chạy. `now` do người gọi truyền vào. */
export function isStepOverdue(
  step: Pick<ProcedureStepView, 'status' | 'slaDueAt'>,
  instanceStatus: string | undefined,
  now: Date,
): boolean {
  if (
    instanceStatus !== 'running' ||
    !step.slaDueAt ||
    !OPEN_STEP.has(step.status)
  )
    return false;
  const due = new Date(step.slaDueAt).getTime();
  return !Number.isNaN(due) && due < now.getTime();
}

/** 90 phút -> "2 giờ" (làm tròn); dưới 1 giờ tính phút, từ 48 giờ tính ngày. */
export function formatSpan(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} giờ`;
  return `${Math.round(hours / 24)} ngày`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `Hạn 25/11 14:00` theo giờ địa phương. */
export function formatDueShort(iso: string): string {
  const date = new Date(iso);
  return `Hạn ${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Dòng SLA của bước: rỗng khi bước đã xong, bị bỏ qua, hồ sơ không chạy hoặc không có hạn. */
export function slaText(
  step: Pick<ProcedureStepView, 'status' | 'slaDueAt'>,
  instanceStatus: string | undefined,
  now: Date,
): string {
  if (
    !step.slaDueAt ||
    !OPEN_STEP.has(step.status) ||
    instanceStatus !== 'running'
  )
    return '';
  const due = new Date(step.slaDueAt).getTime();
  if (Number.isNaN(due)) return '';
  const diff = due - now.getTime();
  if (diff < 0) return `Quá hạn ${formatSpan(-diff)}`;
  if (diff < 48 * 3_600_000) return `Còn ${formatSpan(diff)}`;
  return formatDueShort(step.slaDueAt);
}

export type BranchState = 'chosen' | 'not_chosen' | 'pending';

export interface FlowBranch {
  readonly branch: ProcedureBranchView;
  /** Các bước của nhánh, theo thứ tự `branch.stepIds`; bước không có trong hồ sơ bị bỏ qua. */
  readonly steps: readonly ProcedureStepView[];
  readonly state: BranchState;
}

export type FlowSegment =
  | { readonly kind: 'step'; readonly step: ProcedureStepView }
  | {
      readonly kind: 'gateway';
      readonly gateway: ProcedureGatewayView;
      readonly branches: readonly FlowBranch[];
    };

function branchStepIdSet(
  gateways: readonly ProcedureGatewayView[],
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const gateway of gateways) {
    for (const branch of gateway.branches) {
      for (const id of branch.stepIds) ids.add(id);
    }
  }
  return ids;
}

function branchState(
  gateway: ProcedureGatewayView,
  branch: ProcedureBranchView,
): BranchState {
  if (!gateway.chosenBranchId) return 'pending';
  return gateway.chosenBranchId === branch.id ? 'chosen' : 'not_chosen';
}

/**
 * Xếp các bước thành thân chính và các điểm rẽ: bước thân chính (không thuộc nhánh nào, không bị bỏ qua) theo `order`,
 * điểm rẽ đứng ngay sau bước nó đi theo. Bước của nhánh chỉ xuất hiện trong khối điểm rẽ, kể cả nhánh không đi.
 * Điểm rẽ không tìm thấy bước đứng trước thì xếp cuối cùng.
 */
export function buildFlowLayout(
  data: Pick<WorkItemProcedureSteps, 'steps' | 'gateways'>,
): readonly FlowSegment[] {
  const gateways = data.gateways ?? [];
  const inBranch = branchStepIdSet(gateways);
  const byId = new Map(data.steps.map((step) => [step.id, step]));
  const trunk = [...data.steps]
    .sort(byOrder)
    .filter((step) => step.status !== 'skipped' && !inBranch.has(step.id));
  const trunkIds = new Set(trunk.map((step) => step.id));

  const toSegment = (gateway: ProcedureGatewayView): FlowSegment => ({
    kind: 'gateway',
    gateway,
    branches: gateway.branches.map((branch) => ({
      branch,
      steps: branch.stepIds
        .map((id) => byId.get(id))
        .filter((step): step is ProcedureStepView => step !== undefined),
      state: branchState(gateway, branch),
    })),
  });

  const segments: FlowSegment[] = [];
  for (const step of trunk) {
    segments.push({ kind: 'step', step });
    for (const gateway of gateways) {
      if (gateway.afterStepId === step.id) segments.push(toSegment(gateway));
    }
  }
  for (const gateway of gateways) {
    if (!trunkIds.has(gateway.afterStepId)) segments.push(toSegment(gateway));
  }
  return segments;
}

/** Bước bị bỏ qua mà không thuộc nhánh nào của điểm rẽ (nhóm "Nhánh không đi"), theo `order`. */
export function skippedOutsideBranches(
  data: Pick<WorkItemProcedureSteps, 'steps' | 'gateways'>,
): readonly ProcedureStepView[] {
  const inBranch = branchStepIdSet(data.gateways ?? []);
  return [...data.steps]
    .sort(byOrder)
    .filter((step) => step.status === 'skipped' && !inBranch.has(step.id));
}
