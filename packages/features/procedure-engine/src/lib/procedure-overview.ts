import {
  definitionAllowsBulkAction,
  evaluateStepSla,
  isBlankAttributeValue,
  procedureBulkPlan,
  type ProcedureAttributeDefinition,
  type ProcedureBulkAction,
  type ProcedureDefinition,
  type ProcedureInstance,
  type ProcedureInstanceStep,
  type ProcedureRuntimeAction,
} from '@enterprise-platform/contracts-procedure-engine';
import { formatDate, formatTime } from '@enterprise-platform/shared-ui';
import type { InstanceWorkspaceProject } from './components/instance-source';
import { procedureDeskPart, type ProcedureDeskPart } from './procedure-desk';
import { currentWaiting } from './step-people';

/**
 * Mô hình của bảng hồ sơ dùng chung (`case-table/`, màn "Hồ sơ xử lý"; kiểu "Danh sách quy trình" của 1office): dòng gom
 * theo dự án, cột "Hành động" bấm được ngay khi tới lượt, luật "tới lượt bạn" / "bạn đã xử lý" của các tab. Toàn hàm
 * thuần, tính từ danh sách `/workspace` đã nạp, không gọi API. (Tên file giữ từ trang "Tổng quan" cũ, nay đã bỏ.)
 */

/** Cách chọn bước hiện trên dòng: `mine-done` (tab "Bạn đã xử lý") lấy bước người xem xử lý gần nhất. */
export type OverviewTab = 'all' | 'mine-done';

export const NO_PROJECT_KEY = '__no_project__';
export const NO_PROJECT_LABEL = 'Không thuộc dự án';

/** Thao tác xử lý thật (không tính trao đổi): người làm một trong các thao tác này là đã "thực hiện" phần mình. */
const ACTED_ACTIONS = new Set<string>(['start', 'approve', 'complete', 'return', 'reject']);

type OverviewInstance = ProcedureInstance;

/** Tới lượt người đang xem ở bước hiện tại (cùng luật với "Việc cần làm": `procedureDeskPart`). */
export function isMyActive(instance: OverviewInstance): boolean {
  return procedureDeskPart(instance) === 'act';
}

/** Người này đã tự tay mở hoặc xử lý hồ sơ (bất kỳ bước nào). */
export function hasActed(instance: OverviewInstance, actorId: string): boolean {
  return instance.activity.some((entry) => entry.actorId === actorId && ACTED_ACTIONS.has(entry.action));
}

/**
 * Hồ sơ người này đã làm xong phần mình (tab "Bạn đã xử lý", trước là "Bạn thực hiện – Hoàn thành" của Tổng quan): không
 * tới lượt nữa, và hoặc đã xong phần ở bước hiện tại (`done`), hoặc đã xử lý một bước nào đó (kể cả hồ sơ đã đóng).
 */
export function isMyDone(instance: OverviewInstance, actorId: string): boolean {
  if (isMyActive(instance)) return false;
  return procedureDeskPart(instance) === 'done' || hasActed(instance, actorId);
}

/**
 * Bước hiện trên dòng ("Tên công việc"): bước đang chạy; ở tab "Bạn đã xử lý" là bước người này xử lý gần nhất; hồ sơ
 * đã đóng thì bước xong sau cùng.
 */
export function overviewStep(
  instance: OverviewInstance,
  tab: OverviewTab,
  actorId: string,
): ProcedureInstanceStep | undefined {
  const byId = (id?: string) => (id ? instance.steps.find((step) => step.id === id) : undefined);
  if (tab === 'mine-done') {
    const mine = [...instance.activity]
      .reverse()
      .find((entry) => entry.actorId === actorId && ACTED_ACTIONS.has(entry.action) && entry.stepInstanceId);
    const step = byId(mine?.stepInstanceId);
    if (step) return step;
  }
  const current = byId(instance.currentStepId);
  if (current) return current;
  return [...instance.steps]
    .filter((step) => step.completedAt)
    .sort((left, right) => (right.completedAt ?? '').localeCompare(left.completedAt ?? ''))[0];
}

/** Mốc hoạt động gần nhất của hồ sơ: để sắp dòng và nhóm dự án theo "mới động tới nhất". */
export function lastActivityAt(instance: OverviewInstance): string {
  let latest = instance.completedAt && instance.completedAt > instance.startedAt ? instance.completedAt : instance.startedAt;
  for (const entry of instance.activity) if (entry.createdAt > latest) latest = entry.createdAt;
  for (const step of instance.steps) {
    if (step.startedAt && step.startedAt > latest) latest = step.startedAt;
    if (step.completedAt && step.completedAt > latest) latest = step.completedAt;
  }
  return latest;
}

/** "14:05 09/10/2026"; không có thì "--". */
export function formatOverviewDateTime(value?: string): string {
  if (!value) return '--';
  const date = formatDate(value);
  return date ? `${formatTime(value)} ${date}` : '--';
}

// ------------------------------------------------------------------ Thao tác ngay trên dòng

export type InlineActionKind = 'approve' | 'complete' | 'return' | 'reject' | 'withdraw';

export interface InlineAction {
  readonly kind: InlineActionKind;
  readonly label: string;
  /** Trả lại cần chọn bước (nhiều bước được trả về): không làm ngay trên dòng, mở hồ sơ. */
  readonly needsDetail?: boolean;
}

/** Tên nút theo cách gọi của 1office; Hoàn tất giữ đúng nhãn nút của khung xử lý hồ sơ. */
export const INLINE_ACTION_LABEL: Record<InlineActionKind, string> = {
  approve: 'Duyệt',
  complete: 'Hoàn tất',
  return: 'Không duyệt, cần chỉnh sửa',
  reject: 'Không duyệt, hủy',
  withdraw: 'Hoàn duyệt',
};

export interface InlineActionPlan {
  /** Nút bấm được ngay trên dòng, theo thứ tự hiện. */
  readonly actions: readonly InlineAction[];
  /** Tới lượt nhưng bước cần nhập/làm thêm ở màn hồ sơ: hiện "Mở để xử lý", kèm lý do làm gợi ý. */
  readonly openReason?: string;
  /** Không tới lượt: đang chờ ai / trạng thái hồ sơ, hiện chữ mờ. */
  readonly waiting?: string;
}

const STATUS_TEXT: Record<ProcedureInstance['status'], string> = {
  running: 'Đang xử lý',
  completed: 'Hoàn thành',
  rejected: 'Từ chối',
  cancelled: 'Đã huỷ',
  reversed: 'Đã huỷ hiệu lực',
};

function currentStep(instance: OverviewInstance): ProcedureInstanceStep | undefined {
  return instance.steps.find((step) => step.id === instance.currentStepId);
}

/**
 * Người đang giữ pha hiện tại của bước (xem `currentWaiting`): pha S là người đã mở hồ sơ; pha khác theo nhãn chụp lúc
 * công bố, tối đa 2 nhãn rồi "+N" (đủ danh sách ở `overviewWaitingTitle`).
 */
export function overviewWaitingLabel(instance: OverviewInstance): string | undefined {
  if (instance.status !== 'running') return STATUS_TEXT[instance.status];
  const waiting = currentWaiting(instance);
  return waiting ? `Chờ ${waiting.text}` : 'Đang xử lý';
}

/** Gợi ý của nhãn "Chờ …": đủ danh sách người / chức danh đang giữ pha hiện tại. */
export function overviewWaitingTitle(instance: OverviewInstance): string | undefined {
  if (instance.status !== 'running') return STATUS_TEXT[instance.status];
  const waiting = currentWaiting(instance);
  return waiting ? `Chờ ${waiting.title}` : 'Đang xử lý';
}

/** Thuộc tính bắt buộc người này phải nhập ở bước hiện tại mà còn trống. */
function missingRequiredInputs(instance: OverviewInstance): ProcedureAttributeDefinition[] {
  const editable = instance.authorization?.editableAttributeKeys ?? [];
  if (!editable.length) return [];
  const definitions = new Map<string, ProcedureAttributeDefinition>();
  for (const definition of instance.flow?.attributes ?? []) definitions.set(`process:${definition.code}`, definition);
  for (const step of instance.steps) {
    for (const definition of step.attributes ?? []) {
      definitions.set(`step:${step.definitionStepId}:${definition.code}`, definition);
    }
  }
  return editable
    .map((key) => ({ key, definition: definitions.get(key) }))
    .filter(
      (entry): entry is { key: string; definition: ProcedureAttributeDefinition } =>
        Boolean(entry.definition?.required) && isBlankAttributeValue(instance.attributeValues?.[entry.key]?.value),
    )
    .map((entry) => entry.definition);
}

/**
 * Vì sao không duyệt/hoàn tất được ngay trên dòng: bước chờ module khác, còn thông tin bắt buộc chưa nhập, thiếu vật tư,
 * còn đầu việc chưa xong hoặc chưa phân rã. Vắng là duyệt ngay được.
 */
export function inlineBlocker(instance: OverviewInstance): string | undefined {
  const step = currentStep(instance);
  if (!step) return undefined;
  if (step.integration) {
    return step.integration.module === 'finance' ? 'Bước chờ Tài chính lập phiếu' : 'Bước chờ module liên kết';
  }
  const missing = missingRequiredInputs(instance);
  if (missing.length) return `Cần nhập: ${missing.map((item) => item.name).join(', ')}`;
  if (step.materials?.length && step.materialCheck?.state === 'short') return 'Thiếu vật tư cho bước này';
  const subtasks = (instance.subtasks ?? []).filter((subtask) => subtask.stepInstanceId === step.id);
  if (subtasks.some((subtask) => subtask.status !== 'completed' && subtask.status !== 'cancelled')) {
    return 'Còn đầu việc chưa xong';
  }
  const authorization = instance.authorization;
  if (
    authorization?.currentRoleStage === 'E' &&
    authorization.canManageSubtasks &&
    subtasks.length === 0 &&
    step.assignments.some((assignment) => assignment.role === 'E' && assignment.eTaskSource)
  ) {
    return 'Cần phân rã công việc (WBS) của bước';
  }
  return undefined;
}

/** Thao tác hiện ở cột "Hành động" cho một hồ sơ. */
export function inlineActionPlan(instance: OverviewInstance): InlineActionPlan {
  const authorization = instance.authorization;
  const withdraw: InlineAction[] =
    instance.status === 'running' && authorization?.canWithdraw
      ? [{ kind: 'withdraw', label: INLINE_ACTION_LABEL.withdraw }]
      : [];
  if (instance.status !== 'running') return { actions: [], waiting: STATUS_TEXT[instance.status] };

  const step = currentStep(instance);
  // Như khung xử lý hồ sơ: pha Xem xét (R) chỉ được duyệt, không trả lại / từ chối.
  const stageIsReview = authorization?.currentRoleStage === 'R';
  const available = (authorization?.availableActions ?? []).filter(
    (action): action is Exclude<ProcedureRuntimeAction, 'comment' | 'cancel'> =>
      action !== 'comment' && action !== 'cancel' && !(stageIsReview && (action === 'return' || action === 'reject')),
  );
  const part: ProcedureDeskPart | undefined = procedureDeskPart(instance);

  if (!available.length) {
    if (part === 'act') {
      return { actions: withdraw, openReason: inlineBlocker(instance) ?? 'Phần việc của bạn ở bước này' };
    }
    return { actions: withdraw, waiting: overviewWaitingLabel(instance) };
  }

  const blocker = inlineBlocker(instance);
  const fixedRollback =
    step?.currentRoleStage === 'C'
      ? step.assignments.some((item) => item.role === 'C' && item.fixedRollbackStepId)
      : false;
  const returnTargets = authorization?.returnTargetStepIds?.length ?? 0;
  const actions: InlineAction[] = [];
  for (const kind of ['approve', 'complete'] as const) {
    if (available.includes(kind) && !blocker) actions.push({ kind, label: INLINE_ACTION_LABEL[kind] });
  }
  if (available.includes('return')) {
    actions.push({
      kind: 'return',
      label: INLINE_ACTION_LABEL.return,
      ...(!fixedRollback && returnTargets > 1 ? { needsDetail: true } : {}),
    });
  }
  if (available.includes('reject')) actions.push({ kind: 'reject', label: INLINE_ACTION_LABEL.reject });
  actions.push(...withdraw);
  const primaryBlocked = Boolean(blocker) && available.some((action) => action === 'approve' || action === 'complete');
  return { actions, ...(primaryBlocked ? { openReason: blocker } : {}) };
}

/**
 * Chia thao tác của cột "Hành động": nút chính (Duyệt / Hoàn tất) hiện thành nút đặc, còn lại (trả lại, không duyệt,
 * hoàn duyệt) gom vào menu "Thao tác khác" cạnh nút chính.
 */
export function splitInlineActions(plan: InlineActionPlan): {
  readonly primary?: InlineAction;
  readonly secondary: readonly InlineAction[];
} {
  const primary = plan.actions.find((action) => action.kind === 'approve' || action.kind === 'complete');
  return {
    ...(primary ? { primary } : {}),
    secondary: plan.actions.filter((action) => action !== primary),
  };
}

// ------------------------------------------------------------------ Thao tác hàng loạt

/** Quy trình của hồ sơ có bật thao tác hàng loạt nào không (để khoá ô chọn của dòng). Không thấy quy trình = không. */
export function bulkAllowedByDefinition(
  instance: OverviewInstance,
  definitions: ReadonlyMap<string, Pick<ProcedureDefinition, 'bulkActions'>>,
): boolean {
  const definition = definitions.get(instance.definitionId);
  return definitionAllowsBulkAction(definition, 'approve') || definitionAllowsBulkAction(definition, 'reject');
}

/**
 * Hồ sơ được tính vào nút "Duyệt N hồ sơ" / "Không duyệt N hồ sơ": quy trình bật thao tác đó, tới lượt người xem,
 * pha có thao tác và (khi duyệt) không cần nhập gì thêm. Cùng luật với server (`procedureBulkPlan`); server vẫn kiểm
 * lại từng hồ sơ.
 */
export function isBulkEligible(
  instance: OverviewInstance,
  definitions: ReadonlyMap<string, Pick<ProcedureDefinition, 'bulkActions'>>,
  action: ProcedureBulkAction,
): boolean {
  if (!definitionAllowsBulkAction(definitions.get(instance.definitionId), action)) return false;
  return procedureBulkPlan(instance, instance.authorization, action).ok;
}

/** Ghi chú cho ô chọn bị khoá vì quy trình không bật thao tác hàng loạt. */
export const BULK_DISABLED_TOOLTIP = 'Quy trình này không cho duyệt hàng loạt';

// ------------------------------------------------------------------ Dòng và nhóm

export interface OverviewRow {
  readonly instance: OverviewInstance;
  readonly step?: ProcedureInstanceStep;
  readonly stepName: string;
  readonly projectKey: string;
  readonly projectName: string;
  readonly projectCode?: string;
  readonly actualStart?: string;
  readonly plannedEnd?: string;
  readonly overdue: boolean;
  readonly initiatorName?: string;
  readonly lastActivityAt: string;
}

export function buildOverviewRow(
  instance: OverviewInstance,
  tab: OverviewTab,
  actorId: string,
  project: InstanceWorkspaceProject | undefined,
  now: Date = new Date(),
): OverviewRow {
  const step = overviewStep(instance, tab, actorId);
  const sla = step ? evaluateStepSla(step, instance, now) : undefined;
  const initiator =
    instance.activity.find((entry) => entry.action === 'start')?.actorName ?? instance.createdOnBehalfBy?.name;
  return {
    instance,
    step,
    stepName: step?.name ?? (instance.status === 'running' ? 'Đang xử lý' : STATUS_TEXT[instance.status]),
    projectKey: project?.projectId ?? NO_PROJECT_KEY,
    projectName: project ? project.projectName || project.projectCode : NO_PROJECT_LABEL,
    ...(project?.projectCode ? { projectCode: project.projectCode } : {}),
    actualStart: step?.startedAt,
    plannedEnd: step?.slaDueAt,
    overdue: sla?.state === 'breached',
    initiatorName: initiator,
    lastActivityAt: lastActivityAt(instance),
  };
}

export interface OverviewGroup {
  readonly key: string;
  readonly name: string;
  readonly code?: string;
  readonly rows: readonly OverviewRow[];
  readonly lastActivityAt: string;
}

/**
 * Gom dòng theo dự án GIỮ NGUYÊN thứ tự đầu vào (màn Hồ sơ xử lý đã sắp sẵn theo ngày mở đơn): nhóm xếp theo dòng đầu tiên
 * của nhóm, dòng trong nhóm giữ thứ tự cũ; nhóm "Không thuộc dự án" luôn ở cuối.
 */
export function groupOverviewRowsInOrder(rows: readonly OverviewRow[]): OverviewGroup[] {
  const groups = new Map<string, { key: string; name: string; code?: string; rows: OverviewRow[] }>();
  for (const row of rows) {
    let group = groups.get(row.projectKey);
    if (!group) {
      group = { key: row.projectKey, name: row.projectName, ...(row.projectCode ? { code: row.projectCode } : {}), rows: [] };
      groups.set(row.projectKey, group);
    }
    group.rows.push(row);
  }
  const ordered = [...groups.values()].map((group) => ({ ...group, lastActivityAt: group.rows[0]?.lastActivityAt ?? '' }));
  return [
    ...ordered.filter((group) => group.key !== NO_PROJECT_KEY),
    ...ordered.filter((group) => group.key === NO_PROJECT_KEY),
  ];
}

// ------------------------------------------------------------------ Sắp xếp theo cột

/** Cột sắp xếp được; `project` là thứ tự nhóm dự án (không có cột riêng, bấm ở thanh công cụ). */
export type OverviewSortKey = 'name' | 'actualStart' | 'plannedEnd' | 'owner' | 'project';
export type OverviewSortDirection = 'asc' | 'desc';

export interface OverviewSort {
  readonly key: OverviewSortKey;
  readonly direction: OverviewSortDirection;
}

const SORT_KEYS: readonly OverviewSortKey[] = ['name', 'actualStart', 'plannedEnd', 'owner', 'project'];

/** Bấm lại cùng cột: tăng dần → giảm dần → bỏ sắp xếp (về thứ tự mặc định). Bấm cột khác: tăng dần theo cột đó. */
export function nextOverviewSort(current: OverviewSort | undefined, key: OverviewSortKey): OverviewSort | undefined {
  if (!current || current.key !== key) return { key, direction: 'asc' };
  return current.direction === 'asc' ? { key, direction: 'desc' } : undefined;
}

const viCollator = new Intl.Collator('vi', { sensitivity: 'base', numeric: true });

/** So sánh có "trống xếp cuối" bất kể chiều: chỉ đảo chiều phần có giá trị. */
function compareWithEmptyLast<T>(
  left: T | undefined,
  right: T | undefined,
  direction: OverviewSortDirection,
  compare: (a: T, b: T) => number,
): number {
  const leftEmpty = left === undefined || left === '';
  const rightEmpty = right === undefined || right === '';
  if (leftEmpty || rightEmpty) return leftEmpty === rightEmpty ? 0 : leftEmpty ? 1 : -1;
  const result = compare(left as T, right as T);
  return direction === 'asc' ? result : -result;
}

/**
 * Hàm so sánh hai dòng theo cột đang chọn. Bằng nhau trả 0 để giữ thứ tự mặc định (hoạt động gần nhất trước) nhờ
 * `Array.prototype.sort` ổn định.
 * - Tên công việc: tên bước, rồi tên hồ sơ (so theo tiếng Việt).
 * - Bắt đầu thực tế, Kết thúc dự kiến: theo thời điểm; dòng chưa có mốc luôn xếp cuối. Hạn đã qua là hạn sớm nhất nên
 *   tăng dần thì dòng quá hạn đứng đầu.
 * - Người tạo: theo họ tên tiếng Việt; không rõ người tạo xếp cuối.
 */
export function compareOverviewRows(sort: OverviewSort): (left: OverviewRow, right: OverviewRow) => number {
  const { direction } = sort;
  const sign = direction === 'asc' ? 1 : -1;
  switch (sort.key) {
    case 'name':
      return (left, right) =>
        sign *
        (viCollator.compare(left.stepName, right.stepName) || viCollator.compare(left.instance.title, right.instance.title));
    case 'actualStart':
      return (left, right) =>
        compareWithEmptyLast(left.actualStart, right.actualStart, direction, (a, b) => a.localeCompare(b));
    case 'plannedEnd':
      return (left, right) =>
        compareWithEmptyLast(left.plannedEnd, right.plannedEnd, direction, (a, b) => a.localeCompare(b));
    case 'owner':
      return (left, right) =>
        compareWithEmptyLast(left.initiatorName?.trim(), right.initiatorName?.trim(), direction, (a, b) =>
          viCollator.compare(a, b),
        );
    case 'project':
    default:
      return () => 0;
  }
}

/**
 * Áp sắp xếp lên các nhóm dự án (đầu vào đã theo thứ tự mặc định của `groupOverviewRowsInOrder`).
 * - Không sắp: giữ nguyên.
 * - Theo dự án: xếp nhóm theo tên dự án, "Không thuộc dự án" luôn cuối; dòng trong nhóm giữ thứ tự mặc định.
 * - Theo một cột: xếp dòng trong từng nhóm, rồi xếp nhóm theo dòng đứng đầu (dòng "tốt nhất") của nhóm theo cùng luật;
 *   hoà thì giữ thứ tự cũ của nhóm.
 */
export function sortOverviewGroups(groups: readonly OverviewGroup[], sort: OverviewSort | undefined): OverviewGroup[] {
  if (!sort) return [...groups];
  if (sort.key === 'project') {
    const sign = sort.direction === 'asc' ? 1 : -1;
    return [...groups].sort((left, right) => {
      const leftNone = left.key === NO_PROJECT_KEY;
      const rightNone = right.key === NO_PROJECT_KEY;
      if (leftNone || rightNone) return leftNone === rightNone ? 0 : leftNone ? 1 : -1;
      return sign * viCollator.compare(left.name, right.name);
    });
  }
  const compare = compareOverviewRows(sort);
  return groups
    .map((group) => ({ ...group, rows: [...group.rows].sort(compare) }))
    .sort((left, right) => {
      const leftFirst = left.rows[0];
      const rightFirst = right.rows[0];
      if (!leftFirst || !rightFirst) return leftFirst ? -1 : rightFirst ? 1 : 0;
      return compare(leftFirst, rightFirst);
    });
}

/** Đọc lại lựa chọn sắp xếp đã lưu; dữ liệu lạ thì coi như chưa sắp. */
export function parseOverviewSort(raw: unknown): OverviewSort | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const { key, direction } = raw as { key?: unknown; direction?: unknown };
  if (!SORT_KEYS.includes(key as OverviewSortKey)) return undefined;
  if (direction !== 'asc' && direction !== 'desc') return undefined;
  return { key: key as OverviewSortKey, direction };
}

// ------------------------------------------------------------------ Bố cục cột (thứ tự, độ rộng, ẩn/hiện)

/**
 * Các cột đổi chỗ được; ô chọn luôn đứng đầu, không nằm trong danh sách này. `status` (trạng thái hồ sơ) và `sla` chỉ có ở
 * bảng của màn Hồ sơ xử lý (`CASE_BOARD_COLUMN_SET`).
 */
export type OverviewColumnKey = 'name' | 'status' | 'sla' | 'actualStart' | 'plannedEnd' | 'action' | 'owner';

export interface OverviewColumnDefinition {
  readonly key: OverviewColumnKey;
  readonly label: string;
  /** Độ rộng mặc định (px). Cột "Tên công việc" lấy phần còn lại của bảng, số này là mức tối thiểu của nó. */
  readonly width: number;
  readonly minWidth: number;
  readonly sortKey?: OverviewSortKey;
  /** Cột không ẩn được (luôn phải có tên công việc để biết dòng là gì). */
  readonly required?: boolean;
}

/**
 * Bề rộng tối thiểu của cột ngày: đủ chỗ cho "HH:mm dd/mm/yyyy" (16 ký tự số canh đều) cùng lề ô. Bố cục đã lưu hẹp hơn
 * được nới lên mức này khi đọc lại (`normalizeOverviewColumnLayout`).
 */
export const DATE_COLUMN_MIN_WIDTH = 156;

/** Độ rộng mặc định vừa màn 1366px (trừ thanh bên của khung module) mà không cần cuộn ngang. */
export const OVERVIEW_COLUMNS: readonly OverviewColumnDefinition[] = [
  { key: 'name', label: 'Tên công việc', width: 240, minWidth: 180, sortKey: 'name', required: true },
  // Cột ngày: mức tối thiểu đủ "HH:mm dd/mm/yyyy" không bị cắt; tên cột xuống tối đa 2 dòng thay vì cắt "…".
  { key: 'actualStart', label: 'Bắt đầu thực tế', width: 164, minWidth: DATE_COLUMN_MIN_WIDTH, sortKey: 'actualStart' },
  { key: 'plannedEnd', label: 'Kết thúc dự kiến', width: 172, minWidth: DATE_COLUMN_MIN_WIDTH, sortKey: 'plannedEnd' },
  { key: 'action', label: 'Hành động', width: 232, minWidth: 190 },
  { key: 'owner', label: 'Người tạo', width: 176, minWidth: 110, sortKey: 'owner' },
];

/** Cột thêm của bảng Hồ sơ xử lý. */
export const CASE_BOARD_EXTRA_COLUMNS: readonly OverviewColumnDefinition[] = [
  { key: 'status', label: 'Trạng thái', width: 116, minWidth: 96 },
  { key: 'sla', label: 'SLA', width: 92, minWidth: 72 },
];

/** Ô chọn cố định ở đầu bảng. */
export const OVERVIEW_CHECK_COLUMN_WIDTH = 40;
const MAX_COLUMN_WIDTH = 900;

const COLUMN_BY_KEY = new Map(
  [...OVERVIEW_COLUMNS, ...CASE_BOARD_EXTRA_COLUMNS].map((column) => [column.key, column] as const),
);

/**
 * Bộ cột của một bảng (bộ mặc định `OVERVIEW_COLUMN_SET` có từ trang Tổng quan cũ, Hồ sơ xử lý dùng
 * `CASE_BOARD_COLUMN_SET`): các cột có, thứ tự mặc định, và khoá lưu bố cục cột / sắp xếp riêng của từng trang trên trình
 * duyệt.
 */
export interface CaseColumnSet {
  readonly keys: readonly OverviewColumnKey[];
  readonly columnsStorageKey: string;
  readonly sortStorageKey: string;
}

export const OVERVIEW_SORT_STORAGE_KEY = 'procedure-overview.sort.v1';
export const OVERVIEW_COLUMNS_STORAGE_KEY = 'procedure-overview.columns.v1';

export const OVERVIEW_COLUMN_SET: CaseColumnSet = {
  keys: OVERVIEW_COLUMNS.map((column) => column.key),
  columnsStorageKey: OVERVIEW_COLUMNS_STORAGE_KEY,
  sortStorageKey: OVERVIEW_SORT_STORAGE_KEY,
};

/** Bảng của màn Hồ sơ xử lý: thêm Trạng thái và SLA sau Tên công việc. */
export const CASE_BOARD_COLUMN_SET: CaseColumnSet = {
  keys: ['name', 'status', 'sla', 'actualStart', 'plannedEnd', 'action', 'owner'],
  columnsStorageKey: 'procedure-case-board.columns.v1',
  sortStorageKey: 'procedure-case-board.sort.v1',
};

export interface OverviewColumnLayout {
  readonly order: readonly OverviewColumnKey[];
  /** Chỉ chứa cột người dùng đã kéo đổi độ rộng; vắng là độ rộng mặc định. */
  readonly widths: Readonly<Partial<Record<OverviewColumnKey, number>>>;
  readonly hidden: readonly OverviewColumnKey[];
}

export function defaultOverviewColumnLayout(set: CaseColumnSet = OVERVIEW_COLUMN_SET): OverviewColumnLayout {
  return { order: [...set.keys], widths: {}, hidden: [] };
}

export function overviewColumn(key: OverviewColumnKey): OverviewColumnDefinition {
  return COLUMN_BY_KEY.get(key) as OverviewColumnDefinition;
}

function isColumnKey(value: unknown): value is OverviewColumnKey {
  return typeof value === 'string' && COLUMN_BY_KEY.has(value as OverviewColumnKey);
}

export function clampOverviewColumnWidth(key: OverviewColumnKey, width: number): number {
  const min = overviewColumn(key).minWidth;
  if (!Number.isFinite(width)) return overviewColumn(key).width;
  return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(min, width)));
}

/**
 * Chuẩn hoá bố cục đọc từ bộ nhớ trình duyệt: bỏ khoá cột lạ / trùng, thêm cột mới (về cuối, đúng thứ tự mặc định),
 * kẹp độ rộng trong khoảng cho phép, không cho ẩn cột bắt buộc. Dữ liệu hỏng thì về mặc định.
 */
export function normalizeOverviewColumnLayout(
  raw: unknown,
  set: CaseColumnSet = OVERVIEW_COLUMN_SET,
): OverviewColumnLayout {
  if (!raw || typeof raw !== 'object') return defaultOverviewColumnLayout(set);
  const inSet = (key: unknown): key is OverviewColumnKey => isColumnKey(key) && set.keys.includes(key);
  const value = raw as { order?: unknown; widths?: unknown; hidden?: unknown };
  const order: OverviewColumnKey[] = [];
  for (const key of Array.isArray(value.order) ? value.order : []) {
    if (inSet(key) && !order.includes(key)) order.push(key);
  }
  for (const key of set.keys) if (!order.includes(key)) order.push(key);
  const widths: Partial<Record<OverviewColumnKey, number>> = {};
  if (value.widths && typeof value.widths === 'object') {
    for (const [key, width] of Object.entries(value.widths as Record<string, unknown>)) {
      if (inSet(key) && typeof width === 'number' && Number.isFinite(width)) {
        widths[key] = clampOverviewColumnWidth(key, width);
      }
    }
  }
  const hidden = (Array.isArray(value.hidden) ? value.hidden : []).filter(
    (key, index, all): key is OverviewColumnKey =>
      inSet(key) && !overviewColumn(key).required && all.indexOf(key) === index,
  );
  return { order, widths, hidden };
}

/** Đưa cột `from` tới trước / sau cột `to` (thả vào nửa trái / phải tiêu đề). Khoá lạ hoặc trùng nhau thì giữ nguyên. */
export function moveOverviewColumn(
  layout: OverviewColumnLayout,
  from: string,
  to: string,
  side: 'before' | 'after' = 'before',
): OverviewColumnLayout {
  if (!isColumnKey(from) || !isColumnKey(to) || from === to || !layout.order.includes(from)) return layout;
  const rest = layout.order.filter((key) => key !== from);
  const target = rest.indexOf(to);
  if (target < 0) return layout;
  const order = [...rest];
  order.splice(side === 'before' ? target : target + 1, 0, from);
  if (order.every((key, index) => key === layout.order[index])) return layout;
  return { ...layout, order };
}

/** Lùi / tiến cột một vị trí (nút mũi tên trong bảng chọn "Cột"). */
export function shiftOverviewColumn(
  layout: OverviewColumnLayout,
  key: OverviewColumnKey,
  delta: -1 | 1,
): OverviewColumnLayout {
  const index = layout.order.indexOf(key);
  const neighbour = layout.order[index + delta];
  if (index < 0 || !neighbour) return layout;
  return moveOverviewColumn(layout, key, neighbour, delta < 0 ? 'before' : 'after');
}

export function resizeOverviewColumn(
  layout: OverviewColumnLayout,
  key: OverviewColumnKey,
  width: number,
): OverviewColumnLayout {
  if (!isColumnKey(key)) return layout;
  const next = clampOverviewColumnWidth(key, width);
  if (layout.widths[key] === next) return layout;
  return { ...layout, widths: { ...layout.widths, [key]: next } };
}

export function toggleOverviewColumn(layout: OverviewColumnLayout, key: OverviewColumnKey): OverviewColumnLayout {
  if (!isColumnKey(key) || overviewColumn(key).required) return layout;
  const hidden = layout.hidden.includes(key) ? layout.hidden.filter((item) => item !== key) : [...layout.hidden, key];
  return { ...layout, hidden };
}

/** Cột đang hiện, theo thứ tự người dùng. */
export function visibleOverviewColumns(layout: OverviewColumnLayout): OverviewColumnKey[] {
  return layout.order.filter((key) => !layout.hidden.includes(key));
}

export function overviewColumnWidth(layout: OverviewColumnLayout, key: OverviewColumnKey): number {
  return layout.widths[key] ?? overviewColumn(key).width;
}

/** Bố cục đã khác mặc định (để hiện nút "Về mặc định" ở trạng thái bấm được). */
export function isDefaultOverviewColumnLayout(
  layout: OverviewColumnLayout,
  set: CaseColumnSet = OVERVIEW_COLUMN_SET,
): boolean {
  const base = defaultOverviewColumnLayout(set);
  return (
    layout.hidden.length === 0 &&
    Object.keys(layout.widths).length === 0 &&
    layout.order.length === base.order.length &&
    layout.order.every((key, index) => key === base.order[index])
  );
}

// ------------------------------------------------------------------ Lưu trên trình duyệt

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem' | 'removeItem'>;

function browserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function readJson(storage: ReadableStorage | undefined, key: string): unknown {
  try {
    const text = storage?.getItem(key);
    return text ? (JSON.parse(text) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

/** Ghi lại; `undefined` là xoá. Trình duyệt chặn bộ nhớ (chế độ riêng tư, đầy) thì bỏ qua. */
function writeJson(storage: WritableStorage | undefined, key: string, value: unknown): void {
  try {
    if (value === undefined) storage?.removeItem(key);
    else storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Không lưu được thì vẫn dùng được trong phiên này.
  }
}

export function loadOverviewSort(
  storage: ReadableStorage | undefined = browserStorage(),
  key: string = OVERVIEW_SORT_STORAGE_KEY,
): OverviewSort | undefined {
  return parseOverviewSort(readJson(storage, key));
}

export function saveOverviewSort(
  sort: OverviewSort | undefined,
  storage: WritableStorage | undefined = browserStorage(),
  key: string = OVERVIEW_SORT_STORAGE_KEY,
): void {
  writeJson(storage, key, sort);
}

export function loadOverviewColumnLayout(
  storage: ReadableStorage | undefined = browserStorage(),
  set: CaseColumnSet = OVERVIEW_COLUMN_SET,
): OverviewColumnLayout {
  return normalizeOverviewColumnLayout(readJson(storage, set.columnsStorageKey), set);
}

/** Bố cục mặc định thì xoá khoá, để lần thêm cột sau người dùng nhận đúng thứ tự mới. */
export function saveOverviewColumnLayout(
  layout: OverviewColumnLayout,
  storage: WritableStorage | undefined = browserStorage(),
  set: CaseColumnSet = OVERVIEW_COLUMN_SET,
): void {
  writeJson(storage, set.columnsStorageKey, isDefaultOverviewColumnLayout(layout, set) ? undefined : layout);
}

export interface OverviewPage {
  /** Nhóm có dòng trên trang này; `total` là số hồ sơ của cả nhóm (không chỉ trên trang). */
  readonly groups: readonly { readonly group: OverviewGroup; readonly rows: readonly OverviewRow[] }[];
  /** Thứ tự (tính từ 1) của dòng đầu, dòng cuối trên trang; 0 khi không có dòng nào. */
  readonly from: number;
  readonly to: number;
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
}

/** Cắt trang theo dòng hồ sơ (tiêu đề nhóm không tính), giữ thứ tự nhóm. Trang vượt quá thì về trang cuối. */
export function paginateOverviewGroups(groups: readonly OverviewGroup[], page: number, pageSize: number): OverviewPage {
  const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  const start = (current - 1) * pageSize;
  const end = Math.min(total, start + pageSize);
  const slices: { group: OverviewGroup; rows: OverviewRow[] }[] = [];
  let offset = 0;
  for (const group of groups) {
    const groupStart = offset;
    offset += group.rows.length;
    if (offset <= start || groupStart >= end) continue;
    slices.push({ group, rows: group.rows.slice(Math.max(0, start - groupStart), end - groupStart) });
  }
  return { groups: slices, from: total ? start + 1 : 0, to: end, total, page: current, pageCount };
}
