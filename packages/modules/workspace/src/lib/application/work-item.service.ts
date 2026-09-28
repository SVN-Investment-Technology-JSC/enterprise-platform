import {
  DEPENDENCY_TYPES,
  WORK_ITEM_EXECUTION_TYPES,
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_STATUSES,
  WORK_ITEM_TYPES,
  type AddDependencyRequest,
  type ChangeWorkItemStatusRequest,
  type CreateWorkItemRequest,
  type DependencyType,
  type MoveWorkItemRequest,
  type UpdateWorkItemRequest,
  type WorkItem,
  type WorkItemDependency,
  type WorkItemStatus,
  type WorkItemStatusHistoryEntry,
  type WorkItemTree,
} from '@enterprise-platform/contracts-workspace';
import {
  isClosed,
  projectProgress,
  rollUpProgress,
  type ProgressNode,
} from '../domain/progress.rules.js';
import {
  assertDepthWithinLimit,
  assertMoveAllowed,
  dependencyWouldCycle,
  depthFor,
  nextSortOrder,
} from '../domain/wbs.rules.js';
import {
  ChildIncompleteError,
  DependencyBlockedError,
  DependencyCycleError,
  WorkItemAssigneeOnlyError,
  WorkItemNotFoundError,
  WorkspaceValidationError,
} from '../domain/workspace.error.js';
import { hasProjectRole, requireProjectRole, type ProjectService } from './project.service.js';
import { timezoneOf, todayKey } from '../domain/tenant-time.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

const HISTORY_LIMIT = 200;

/**
 * Chuyển trạng thái nào được phép.
 *
 * Bảng tường minh thay vì "cái gì cũng được": nhảy thẳng từ `todo` sang `done`
 * bỏ qua mốc bắt đầu thực tế, khiến báo cáo thời lượng vô nghĩa. `done` và
 * `cancelled` vẫn mở lại được — đóng nhầm là chuyện thường.
 */
const ALLOWED_TRANSITIONS: Record<WorkItemStatus, readonly WorkItemStatus[]> = {
  todo: ['in_progress', 'cancelled'],
  in_progress: ['todo', 'blocked', 'review', 'done', 'cancelled'],
  blocked: ['in_progress', 'cancelled'],
  review: ['in_progress', 'done', 'cancelled'],
  done: ['in_progress'],
  cancelled: ['todo'],
};

export class WorkItemService {
  constructor(
    private readonly store: WorkspaceStore,
    private readonly projects: ProjectService,
  ) {}

  /** Toàn bộ cây WBS của một dự án, trả phẳng kèm `parentId` và `depth`. */
  async tree(actor: WorkspaceActor, projectId: string): Promise<WorkItemTree> {
    await this.projects.access(actor, projectId);
    return { items: await this.store.workItem.listByProject(actor.tenantId, projectId) };
  }

  async detail(actor: WorkspaceActor, workItemId: string): Promise<WorkItem> {
    const { item } = await this.load(actor, workItemId);
    return item;
  }

  async create(actor: WorkspaceActor, input: CreateWorkItemRequest): Promise<WorkItem> {
    const access = await this.projects.access(actor, String(input.projectId ?? ''));
    requireProjectRole(access, 'member');

    const title = requireText(input.title, 'Tên công việc', 200);
    const itemType = pick(input.itemType, WORK_ITEM_TYPES, 'task');
    const executionType = pick(input.executionType, WORK_ITEM_EXECUTION_TYPES, 'manual');
    const priority = pick(input.priority, WORK_ITEM_PRIORITIES, 'normal');
    assertDateOrder(input.plannedStart, input.plannedEnd);
    if (input.estimateHours != null && !(Number(input.estimateHours) > 0)) {
      throw new WorkspaceValidationError('Giờ ước lượng phải lớn hơn 0.');
    }
    // `phase` chỉ là vỏ chứa việc con: gán người hay ước lượng giờ cho nó sẽ
    // bị tính hai lần khi cuộn tiến độ.
    if (itemType === 'phase' && (input.assigneeUserId || input.estimateHours != null)) {
      throw new WorkspaceValidationError(
        'Nhóm công việc không nhận người phụ trách và giờ ước lượng; hãy đặt chúng ở việc con.',
      );
    }

    const siblings = await this.store.workItem.listByProject(actor.tenantId, access.project.id);
    const parent = input.parentId
      ? siblings.find((node) => node.id === input.parentId)
      : undefined;
    if (input.parentId && !parent) throw new WorkItemNotFoundError(String(input.parentId));

    const depth = depthFor(parent);
    assertDepthWithinLimit(depth);

    // `member` tự nhận việc cho mình được; giao cho người khác cần `manager`.
    if (input.assigneeUserId && input.assigneeUserId !== actor.userId) {
      requireProjectRole(access, 'manager');
    }
    await this.requireMemberAssignee(actor, access.project.id, input.assigneeUserId);

    const created = await this.store.workItem.create(actor.tenantId, actor.userId, {
      ...input,
      projectId: access.project.id,
      title,
      itemType,
      executionType,
      priority,
      depth,
      sortOrder: nextSortOrder(siblings, input.parentId ?? null),
    });

    await this.recalculate(actor, access.project.id);
    return created;
  }

  async update(
    actor: WorkspaceActor,
    workItemId: string,
    input: UpdateWorkItemRequest,
  ): Promise<WorkItem> {
    const { item, access } = await this.load(actor, workItemId);
    // `member` chỉ sửa được việc của mình; từ `manager` trở lên sửa mọi việc.
    if (!hasProjectRole(access, 'manager') && item.assigneeUserId !== actor.userId) {
      throw new WorkItemAssigneeOnlyError();
    }
    requireProjectRole(access, 'member');

    const patch: UpdateWorkItemRequest = { ...input };
    if (input.title !== undefined) {
      Object.assign(patch, { title: requireText(input.title, 'Tên công việc', 200) });
    }
    if (input.priority !== undefined) {
      Object.assign(patch, { priority: pick(input.priority, WORK_ITEM_PRIORITIES, 'normal') });
    }
    if (input.progressPercent !== undefined) {
      const percent = Math.trunc(Number(input.progressPercent));
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        throw new WorkspaceValidationError('Tiến độ phải là số nguyên từ 0 đến 100.');
      }
      Object.assign(patch, { progressPercent: percent });
    }
    assertDateOrder(
      input.plannedStart === undefined ? item.plannedStart : input.plannedStart,
      input.plannedEnd === undefined ? item.plannedEnd : input.plannedEnd,
    );

    // Đổi người phụ trách là giao việc, dù `member` được sửa các trường khác
    // của việc mình: không được đẩy việc của mình sang người khác.
    if (
      input.assigneeUserId !== undefined &&
      (input.assigneeUserId ?? undefined) !== item.assigneeUserId
    ) {
      requireProjectRole(access, 'manager');
    }
    await this.requireMemberAssignee(actor, item.projectId, input.assigneeUserId);

    const updated = await this.store.workItem.update(actor.tenantId, workItemId, patch);
    await this.recalculate(actor, item.projectId);
    return updated;
  }

  /**
   * Đổi trạng thái theo đúng thứ tự kiểm tra ở `instruction_api.md` §4.3.
   *
   * Thứ tự quan trọng: kiểm quyền trước, để người không đủ thẩm quyền không
   * suy ra được cấu trúc cây từ thông điệp lỗi "còn việc con chưa đóng".
   */
  async changeStatus(
    actor: WorkspaceActor,
    workItemId: string,
    input: ChangeWorkItemStatusRequest,
  ): Promise<WorkItem> {
    const { item, access } = await this.load(actor, workItemId);
    const next = pick(input.status, WORK_ITEM_STATUSES, undefined);
    if (!next) throw new WorkspaceValidationError(`Trạng thái "${input.status}" không hợp lệ.`);

    // 1 — vai trò dự án
    if (!hasProjectRole(access, 'manager') && item.assigneeUserId !== actor.userId) {
      throw new WorkItemAssigneeOnlyError();
    }
    // `viewer` chỉ đọc, kể cả với việc gán cho chính họ.
    requireProjectRole(access, 'member');

    if (next === item.status) return item;
    if (!ALLOWED_TRANSITIONS[item.status].includes(next)) {
      throw new WorkspaceValidationError(
        `Không thể chuyển từ "${item.status}" sang "${next}".`,
      );
    }

    // 2 — việc con chưa đóng. Chỉ chặn khi đang đóng node; mở lại thì không.
    if (isClosed(next)) {
      const openChildren = await this.store.workItem.openChildCount(actor.tenantId, workItemId);
      if (openChildren > 0) throw new ChildIncompleteError(openChildren);
    }

    // 3 — tiền nhiệm FS. Chỉ `FS` chặn cứng; các loại khác chỉ là gợi ý lịch.
    if (next === 'done') {
      const edges = await this.store.dependency.listBySuccessor(actor.tenantId, workItemId);
      const blocking = edges.filter((edge) => edge.dependencyType === 'FS');
      for (const edge of blocking) {
        const predecessor = await this.store.workItem.findById(
          actor.tenantId,
          edge.predecessorId,
        );
        if (predecessor && predecessor.status !== 'done') {
          throw new DependencyBlockedError(predecessor.code);
        }
      }
    }

    // 4 và 5 — mốc thực tế và nhật ký ghi trong cùng một transaction ở store.
    const updated = await this.store.workItem.changeStatus(
      actor.tenantId,
      workItemId,
      actor.userId,
      next,
      input.note?.trim() || undefined,
      todayKey(timezoneOf(actor.tenantId)),
    );
    await this.recalculate(actor, item.projectId);
    return updated;
  }

  /** Đổi cha và vị trí trong cây. Cả nhánh con đi theo. */
  async move(
    actor: WorkspaceActor,
    workItemId: string,
    input: MoveWorkItemRequest,
  ): Promise<WorkItem> {
    const { item, access } = await this.load(actor, workItemId);
    requireProjectRole(access, 'manager');

    const nodes = await this.store.workItem.listByProject(actor.tenantId, item.projectId);
    const parentId = input.parentId ?? null;
    const parent = parentId ? nodes.find((node) => node.id === parentId) : undefined;
    if (parentId && !parent) throw new WorkItemNotFoundError(parentId);
    // Kiểm tra chu trình và giới hạn độ sâu của node SÂU NHẤT trong nhánh.
    assertMoveAllowed(nodes, workItemId, parent);

    const sortOrder =
      input.sortOrder != null ? Math.max(Math.trunc(Number(input.sortOrder)), 0) : nextSortOrder(
        nodes.filter((node) => node.id !== workItemId),
        parentId,
      );

    const moved = await this.store.workItem.move(
      actor.tenantId,
      workItemId,
      parentId,
      sortOrder,
      depthFor(parent) - item.depth,
    );
    await this.recalculate(actor, item.projectId);
    return moved;
  }

  async history(
    actor: WorkspaceActor,
    workItemId: string,
  ): Promise<readonly WorkItemStatusHistoryEntry[]> {
    await this.load(actor, workItemId);
    return this.store.history.listByWorkItem(actor.tenantId, workItemId, HISTORY_LIMIT);
  }

  async projectHistory(
    actor: WorkspaceActor,
    projectId: string,
  ): Promise<readonly WorkItemStatusHistoryEntry[]> {
    await this.projects.access(actor, projectId);
    return this.store.history.listByProject(actor.tenantId, projectId, HISTORY_LIMIT);
  }

  /** Toàn bộ phụ thuộc của một dự án; Gantt cần cả đồ thị trong một lời gọi. */
  async projectDependencies(
    actor: WorkspaceActor,
    projectId: string,
  ): Promise<readonly WorkItemDependency[]> {
    await this.projects.access(actor, projectId);
    return this.store.dependency.listByProject(actor.tenantId, projectId);
  }

  async dependencies(
    actor: WorkspaceActor,
    workItemId: string,
  ): Promise<readonly WorkItemDependency[]> {
    await this.load(actor, workItemId);
    return this.store.dependency.listBySuccessor(actor.tenantId, workItemId);
  }

  async addDependency(
    actor: WorkspaceActor,
    successorId: string,
    input: AddDependencyRequest,
  ): Promise<WorkItemDependency> {
    const { item, access } = await this.load(actor, successorId);
    requireProjectRole(access, 'manager');

    const predecessorId = String(input.predecessorId ?? '');
    const predecessor = await this.store.workItem.findById(actor.tenantId, predecessorId);
    if (!predecessor) throw new WorkItemNotFoundError(predecessorId || '(trống)');
    // Phụ thuộc chỉ tồn tại trong phạm vi một dự án; nối chéo dự án sẽ tạo ra
    // ràng buộc mà người xem dự án kia không nhìn thấy.
    if (predecessor.projectId !== item.projectId) {
      throw new WorkspaceValidationError('Chỉ tạo được phụ thuộc giữa hai công việc cùng dự án.');
    }

    const edges = await this.store.dependency.listByProject(actor.tenantId, item.projectId);
    if (
      edges.some(
        (edge) => edge.predecessorId === predecessorId && edge.successorId === successorId,
      )
    ) {
      throw new WorkspaceValidationError('Phụ thuộc này đã tồn tại.');
    }
    if (dependencyWouldCycle(edges, predecessorId, successorId)) throw new DependencyCycleError();

    const lagDays = Math.trunc(Number(input.lagDays ?? 0));
    if (!Number.isFinite(lagDays)) {
      throw new WorkspaceValidationError('Độ trễ phải là số ngày nguyên.');
    }

    return this.store.dependency.add(actor.tenantId, actor.userId, {
      projectId: item.projectId,
      predecessorId,
      successorId,
      dependencyType: pick(input.dependencyType, DEPENDENCY_TYPES, 'FS') as DependencyType,
      lagDays,
    });
  }

  async removeDependency(
    actor: WorkspaceActor,
    successorId: string,
    dependencyId: string,
  ): Promise<void> {
    const { item, access } = await this.load(actor, successorId);
    requireProjectRole(access, 'manager');

    // Xác minh cạnh thuộc đúng công việc đang thao tác, để một id lạ không xoá
    // được phụ thuộc của dự án khác.
    const edges = await this.store.dependency.listBySuccessor(actor.tenantId, successorId);
    const edge = edges.find((candidate) => candidate.id === dependencyId);
    if (!edge || edge.projectId !== item.projectId) {
      throw new WorkItemNotFoundError(dependencyId);
    }
    await this.store.dependency.remove(actor.tenantId, dependencyId);
  }

  /** Nạp công việc kèm quyền truy cập dự án chứa nó. */
  /**
   * Người phụ trách phải là thành viên dự án.
   *
   * Giao việc cho người ngoài dự án tạo ra một công việc mà chính người phụ
   * trách không mở được: mọi endpoint đều trả `403 PROJECT_FORBIDDEN` cho họ.
   * `null` (gỡ người phụ trách) và `undefined` (không đụng tới) đều bỏ qua.
   */
  private async requireMemberAssignee(
    actor: WorkspaceActor,
    projectId: string,
    assigneeUserId: string | null | undefined,
  ): Promise<void> {
    if (!assigneeUserId) return;
    const role = await this.store.member.roleOf(actor.tenantId, projectId, assigneeUserId);
    if (!role) {
      throw new WorkspaceValidationError('Người phụ trách phải là thành viên của dự án.');
    }
  }

  private async load(actor: WorkspaceActor, workItemId: string) {
    const item = await this.store.workItem.findById(actor.tenantId, workItemId);
    if (!item) throw new WorkItemNotFoundError(workItemId);
    const access = await this.projects.access(actor, item.projectId);
    return { item, access };
  }

  /**
   * Cuộn lại tiến độ cho cả cây rồi cho dự án.
   *
   * Chạy sau mọi thay đổi ảnh hưởng tới tiến độ. Đọc bản rút gọn của cây, tính
   * ở bộ nhớ, và chỉ ghi những node thật sự đổi giá trị.
   */
  private async recalculate(actor: WorkspaceActor, projectId: string): Promise<void> {
    const rows = await this.store.workItem.progressRows(actor.tenantId, projectId);
    const nodes: ProgressNode[] = rows.map((row) => ({
      id: row.id,
      parentId: row.parentId,
      status: row.status,
      progressPercent: row.progressPercent,
      estimateHours: row.estimateHours,
    }));

    const changed = rollUpProgress(nodes);
    await this.store.workItem.applyProgress(actor.tenantId, changed);

    // Dùng giá trị vừa tính, không đọc lại từ CSDL: bản ghi vừa ghi xong.
    const updated = nodes.map((node) => ({
      ...node,
      progressPercent: changed.get(node.id) ?? node.progressPercent,
    }));
    await this.store.project.updateProgress(actor.tenantId, projectId, projectProgress(updated));
  }
}

function pick<TValue extends string, TFallback extends TValue | undefined>(
  value: unknown,
  allowed: readonly TValue[],
  fallback: TFallback,
): TValue | TFallback {
  if (value == null || value === '') return fallback;
  const text = String(value);
  return (allowed as readonly string[]).includes(text) ? (text as TValue) : fallback;
}

function requireText(value: unknown, label: string, maxLength: number): string {
  const text = String(value ?? '').trim();
  if (!text) throw new WorkspaceValidationError(`${label} không được để trống.`);
  if (text.length > maxLength) {
    throw new WorkspaceValidationError(`${label} không được dài quá ${maxLength} ký tự.`);
  }
  return text;
}

function assertDateOrder(start?: string | null, end?: string | null): void {
  if (start && end && start > end) {
    throw new WorkspaceValidationError('Ngày kết thúc dự kiến phải sau ngày bắt đầu.');
  }
}
