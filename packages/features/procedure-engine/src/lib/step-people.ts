import type {
  ProcedureActivity,
  ProcedureInstance,
  ProcedureInstanceStep,
  ProcedureRaciRole,
} from '@enterprise-platform/contracts-procedure-engine';

/**
 * Ai đang giữ pha hiện tại của một hồ sơ, để HIỂN THỊ (không dùng cho quyền: quyền vẫn do server tính).
 *
 * Luật hiển thị:
 *  - Pha S (người lập): hồ sơ đã có người mở nên hiện đúng người đó (người của thao tác "khởi tạo"), không hiện danh
 *    sách chức danh ĐƯỢC PHÉP lập đơn. Cùng cách dòng "S" trên thẻ bước của giao diện cũ.
 *  - Pha khác: phân giải từng phân công ra người (chức danh ra người đang giữ, nhân sự ra tên) cùng người nhận uỷ quyền
 *    cho pha đó; không phân giải được thì giữ nhãn chức danh / đơn vị.
 *  - Hiện tối đa 2 nhãn, phần còn lại thành "+N"; danh sách đầy đủ đặt ở gợi ý.
 */

/** Tra một chủ thể phân công (chức danh, đơn vị, nhân sự) ra tên và những người đang giữ, theo sơ đồ tổ chức. */
export type SubjectResolver = (
  subjectId: string,
) => { readonly title: string; readonly people?: readonly string[] } | undefined;

/** Số nhãn hiện trực tiếp trước "+N". */
export const PEOPLE_VISIBLE = 2;

/** Người đã khởi tạo hồ sơ (người của thao tác "khởi tạo"). */
export function submitterOf(instance: Pick<ProcedureInstance, 'activity'>): string | undefined {
  return instance.activity.find((entry) => entry.action === 'start')?.actorName?.trim() || undefined;
}

/** Tên (hay nhãn chức danh / đơn vị khi chưa phân giải được) của những người giữ vai `stage` ở bước. */
export function stagePeople(
  instance: Pick<ProcedureInstance, 'activity' | 'delegations'>,
  step: Pick<ProcedureInstanceStep, 'id' | 'assignments'>,
  stage: ProcedureRaciRole,
  resolve?: SubjectResolver,
): string[] {
  if (stage === 'S') {
    const submitter = submitterOf(instance);
    if (submitter) return [submitter];
  }
  const names: string[] = [];
  for (const assignment of step.assignments) {
    if (assignment.role !== stage) continue;
    const known = resolve?.(assignment.subjectId);
    if (known?.people?.length) {
      names.push(...known.people);
      continue;
    }
    const label = (known?.title ?? assignment.subjectLabel)?.trim();
    if (label) names.push(label);
  }
  for (const delegation of instance.delegations ?? []) {
    if (delegation.stepInstanceId && delegation.stepInstanceId !== step.id) continue;
    if (!delegation.roles.includes(stage)) continue;
    const name = resolve?.(delegation.delegatedTo)?.title?.trim();
    if (name) names.push(name);
  }
  return [...new Set(names)];
}

/** "A, B +3" (tối đa 2 nhãn) và danh sách đầy đủ cho gợi ý. */
export function peopleSummary(
  names: readonly string[],
  visible = PEOPLE_VISIBLE,
): { readonly text: string; readonly title: string; readonly more: number } {
  const shown = names.slice(0, visible);
  const more = Math.max(0, names.length - shown.length);
  return { text: `${shown.join(', ')}${more ? ` +${more}` : ''}`, title: names.join(', '), more };
}

/**
 * Đang chờ ai ở hồ sơ đang chạy: nhãn gọn (tối đa 2 tên + "+N") và danh sách đầy đủ. Vắng khi hồ sơ không chạy hay
 * chưa xác định được pha hiện tại.
 */
export function currentWaiting(
  instance: ProcedureInstance,
  resolve?: SubjectResolver,
): { readonly text: string; readonly title: string } | undefined {
  if (instance.status !== 'running') return undefined;
  const step = instance.steps.find((item) => item.id === instance.currentStepId);
  if (step?.integration?.module === 'finance') return { text: 'Tài chính', title: 'Tài chính' };
  const stage = instance.authorization?.currentRoleStage ?? step?.currentRoleStage;
  if (!step || !stage) return undefined;
  const names = stagePeople(instance, step, stage, resolve);
  if (!names.length) return { text: `vai ${stage}`, title: `vai ${stage}` };
  const summary = peopleSummary(names);
  return { text: summary.text, title: summary.title };
}

// ------------------------------------------------------------------ Tiến độ từng người trong một bước

/** Thứ tự các pha trong một bước (cùng thứ tự của máy trạng thái phía server; I chỉ theo dõi, không có pha). */
const STAGE_ORDER: readonly ProcedureRaciRole[] = ['S', 'R', 'E', 'C', 'A'];

/** Thao tác làm thay đổi phần việc của một pha. */
const STAGE_ACTIONS: ReadonlySet<ProcedureActivity['action']> = new Set([
  'complete',
  'approve',
  'reject',
  'return',
  'withdraw',
]);

/**
 * Phần việc của một vai (pha) trong bước:
 *  - `done`: đã xong pha (hoàn tất / duyệt); `returned`, `rejected`: người của pha đã trả lại / từ chối;
 *  - `waiting`: đang tới lượt pha này; `pending`: chưa tới lượt (hay bước đã dừng trước khi tới pha này).
 */
export type StageProgressStatus = 'done' | 'returned' | 'rejected' | 'waiting' | 'pending';

export interface StageProgress {
  readonly role: ProcedureRaciRole;
  readonly status: StageProgressStatus;
  /** Người đã xử lý pha (theo nhật ký), hoặc người được giao khi chưa xử lý. */
  readonly names: readonly string[];
  /** Người đã xử lý nhận vai qua uỷ quyền: tên người uỷ quyền. */
  readonly delegatedBy?: string;
  readonly at?: string;
  readonly comment?: string;
}

/** Các pha của bước theo phân công (S → R → E → C → A), đúng cách server chuyển pha. */
export function stepStages(step: Pick<ProcedureInstanceStep, 'assignments'>): ProcedureRaciRole[] {
  return STAGE_ORDER.filter((role) => step.assignments.some((assignment) => assignment.role === role));
}

/**
 * Ai đã làm phần nào trong một bước, CHỈ suy từ dữ liệu sẵn có của hồ sơ (không gọi thêm): server ghi mỗi lần hoàn tất /
 * duyệt một pha thành một dòng nhật ký (`complete` / `approve`, kèm `stepInstanceId`, người làm, ý kiến) rồi chuyển
 * `currentRoleStage` sang pha kế (S → R → E → C → A); `return` / `reject` dừng bước ở pha đang giữ; `withdraw` (hoàn duyệt)
 * mở lại pha vừa xong. Đi lại các dòng đó theo thời gian là ra phần việc của từng pha trong LẦN chạy gần nhất của bước
 * (bước được mở lại sau khi bị trả về thì bắt đầu lần mới, tính từ `startedAt`). Pha hiện tại lấy theo `currentRoleStage`.
 */
export function stepStageProgress(
  instance: Pick<ProcedureInstance, 'activity' | 'delegations' | 'currentStepId' | 'status'>,
  step: Pick<ProcedureInstanceStep, 'id' | 'assignments' | 'status' | 'currentRoleStage' | 'startedAt'>,
  resolve?: SubjectResolver,
): StageProgress[] {
  const stages = stepStages(step);
  if (!stages.length) return [];
  const since = step.startedAt ? Date.parse(step.startedAt) : Number.NEGATIVE_INFINITY;
  const entries = instance.activity
    .map((entry, index) => ({ entry, index }))
    .filter(
      ({ entry }) =>
        entry.stepInstanceId === step.id &&
        STAGE_ACTIONS.has(entry.action) &&
        !(Date.parse(entry.createdAt) < since),
    )
    // Nhật ký mới nhất ở đầu: cùng mốc thời gian thì dòng đứng sau là dòng ghi trước.
    .sort((left, right) => left.entry.createdAt.localeCompare(right.entry.createdAt) || right.index - left.index)
    .map(({ entry }) => entry);

  let outcomes: (ProcedureActivity | undefined)[] = [];
  let pointer = 0;
  let closed = false;
  for (const entry of entries) {
    if (entry.action === 'withdraw') {
      // Hoàn duyệt: mở lại pha vừa xong (pha cuối nếu bước đã xong).
      pointer = Math.max(0, Math.min(pointer, stages.length) - 1);
      outcomes = outcomes.slice(0, pointer);
      closed = false;
      continue;
    }
    // Bước đã đóng (xong hết pha, trả lại, từ chối) mà còn thao tác: bước đã được mở lại, tính lần mới.
    if (closed || pointer >= stages.length) {
      outcomes = [];
      pointer = 0;
      closed = false;
    }
    outcomes[pointer] = entry;
    if (entry.action === 'complete' || entry.action === 'approve') {
      pointer += 1;
      if (pointer >= stages.length) closed = true;
    } else {
      closed = true;
    }
  }

  const isCurrent = instance.status === 'running' && instance.currentStepId === step.id;
  const currentIndex = isCurrent && step.currentRoleStage ? stages.indexOf(step.currentRoleStage) : -1;
  const stopped = outcomes.findIndex((entry) => entry?.action === 'return' || entry?.action === 'reject');

  return stages.map((role, index) => {
    const assigned = () => stagePeople(instance, step, role, resolve);
    let status: StageProgressStatus;
    let entry = outcomes[index];
    if (currentIndex >= 0) {
      // Bước đang chạy: pha trước pha hiện tại đã xong, pha hiện tại đang chờ, pha sau chưa tới lượt.
      if (index < currentIndex) status = 'done';
      else {
        status = index === currentIndex ? 'waiting' : 'pending';
        entry = undefined;
      }
    } else if (stopped >= 0) {
      if (index < stopped) status = 'done';
      else if (index === stopped) status = entry?.action === 'reject' ? 'rejected' : 'returned';
      else {
        status = 'pending';
        entry = undefined;
      }
    } else if (step.status === 'completed') {
      status = 'done';
    } else {
      status = entry ? 'done' : 'pending';
    }
    if (status === 'done' && entry && entry.action !== 'complete' && entry.action !== 'approve') entry = undefined;
    if (!entry) return { role, status, names: assigned() };
    const delegation = (instance.delegations ?? []).find(
      (item) =>
        item.delegatedTo === entry.actorId &&
        item.roles.includes(role) &&
        (!item.stepInstanceId || item.stepInstanceId === step.id),
    );
    const comment = entry.comment?.trim();
    return {
      role,
      status,
      names: entry.actorName ? [entry.actorName] : assigned(),
      ...(delegation ? { delegatedBy: delegation.delegatedByName } : {}),
      at: entry.createdAt,
      ...(comment ? { comment } : {}),
    };
  });
}
