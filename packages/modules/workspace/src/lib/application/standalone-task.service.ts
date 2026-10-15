import {
  CLOSED_WORK_ITEM_STATUSES,
  MAX_WORK_ITEM_DEPTH,
  STANDALONE_TASK_SCOPES,
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_STATUSES,
  allowedStandaloneTaskTransitions,
  type ChangeStandaloneTaskStatusRequest,
  type CreateStandaloneTaskRequest,
  type ReverseStandaloneTaskRequest,
  type StandaloneTask,
  type StandaloneTaskDetail,
  type StandaloneTaskList,
  type StandaloneTaskRole,
  type StandaloneTaskScope,
  type UpdateStandaloneTaskRequest,
  type WorkItemPriority,
  type WorkItemStatus,
} from '@enterprise-platform/contracts-workspace';
import {
  assertStandaloneTaskTransition,
  canDeleteStandaloneTask,
  standaloneTaskRoleOf,
} from '../domain/standalone-task.rules.js';
import { timezoneOf, todayKey } from '../domain/tenant-time.js';
import {
  StandaloneTaskConflictError,
  StandaloneTaskForbiddenError,
  StandaloneTaskNotFoundError,
  WorkspaceValidationError,
} from '../domain/workspace.error.js';
import type { DirectoryService } from './directory.service.js';
import type { ProcedureReversalChecker } from './procedure-reversal-check.port.js';
import type { WorkspaceActor } from './workspace.application.js';
import type {
  StandaloneTaskCreateModel,
  StandaloneTaskWriteModel,
  WorkspaceStore,
} from './workspace-store.port.js';

const HISTORY_LIMIT = 200;
const MAX_MEMBERS = 50;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Công việc ngoài dự án (giao việc lẻ).
 *
 * Không có khái niệm dự án hay thành viên dự án: ai dùng được Workspace cũng
 * giao được cho bất kỳ ai trong tenant. Quyền trên từng việc suy từ vai của
 * người gọi trên chính việc đó:
 *
 * - người giao: sửa, duyệt hoàn thành, trả lại, huỷ, xoá;
 * - người phụ trách và người cùng thực hiện: đổi trạng thái tới Chờ duyệt và
 *   cập nhật tiến độ;
 * - người theo dõi: chỉ xem;
 * - người giữ vai ở việc khác cùng cây (việc cha, việc con): xem để nắm bối
 *   cảnh (`viewer`).
 *
 * Người giao và người phụ trách được chia việc thành việc con; người tạo việc
 * con là người giao của việc con đó. Việc con không cần duyệt.
 *
 * Người không liên quan nhận 404, kể cả quản trị tenant — việc giao lẻ là
 * chuyện giữa những người trong việc, giống trang "Công việc của tôi".
 */
export class StandaloneTaskService {
  constructor(
    private readonly store: WorkspaceStore,
    private readonly directory: DirectoryService,
    /** Hỏi Quy trình trước khi huỷ hiệu lực việc có hồ sơ đã hoàn tất. */
    private readonly procedureReversal?: ProcedureReversalChecker,
  ) {}

  async list(actor: WorkspaceActor, scope?: string): Promise<StandaloneTaskList> {
    const resolved: StandaloneTaskScope = (STANDALONE_TASK_SCOPES as readonly string[]).includes(
      scope ?? '',
    )
      ? (scope as StandaloneTaskScope)
      : 'assigned_to_me';
    const tasks = await this.store.standaloneTask.listForUser(
      actor.tenantId,
      actor.userId,
      resolved,
    );
    return {
      items: tasks.map(({ task, parent }) => ({
        task,
        parent,
        myRole: standaloneTaskRoleOf(task, actor.userId) ?? 'follower',
      })),
    };
  }

  async detail(actor: WorkspaceActor, taskId: string): Promise<StandaloneTaskDetail> {
    const { task, role } = await this.load(actor, taskId);
    return this.toDetail(actor, task, role);
  }

  async create(
    actor: WorkspaceActor,
    input: CreateStandaloneTaskRequest,
  ): Promise<StandaloneTaskDetail> {
    const assigneeUserId = requireUuid(input.assigneeUserId, 'Người phụ trách');
    const participantUserIds = cleanIds(input.participantUserIds, [assigneeUserId]);
    const followerUserIds = cleanIds(input.followerUserIds, [assigneeUserId, ...participantUserIds]);
    const plannedStart = optionalDate(input.plannedStart, 'Ngày bắt đầu');
    const dueDate = optionalDate(input.dueDate, 'Hạn hoàn thành');
    assertDateOrder(plannedStart, dueDate);

    // Việc con: chỉ người giao và người phụ trách của việc cha được chia việc.
    const parentId = input.parentId ? requireUuid(input.parentId, 'Việc cha') : null;
    if (parentId) {
      const { task: parent, role } = await this.load(actor, parentId);
      if (role !== 'assigner' && role !== 'assignee') {
        throw new StandaloneTaskForbiddenError(
          'Chỉ người giao và người phụ trách của việc cha được tạo việc con.',
        );
      }
      if (CLOSED_WORK_ITEM_STATUSES.includes(parent.status)) {
        throw new WorkspaceValidationError('Việc cha đã đóng, không thêm việc con được.');
      }
      if (parent.depth + 1 >= MAX_WORK_ITEM_DEPTH) {
        throw new WorkspaceValidationError(
          `Công việc chỉ lồng được tối đa ${MAX_WORK_ITEM_DEPTH} cấp.`,
        );
      }
    }

    // Việc điều chỉnh: chỉ người giao của việc đã huỷ hiệu lực được lập, và
    // việc điều chỉnh là việc gốc.
    const adjustmentOfId = input.adjustmentOfId
      ? requireUuid(input.adjustmentOfId, 'Việc cần điều chỉnh')
      : null;
    if (adjustmentOfId) {
      if (parentId) {
        throw new WorkspaceValidationError('Việc điều chỉnh không tạo làm việc con được.');
      }
      const { task: original, role } = await this.load(actor, adjustmentOfId);
      if (role !== 'assigner') {
        throw new StandaloneTaskForbiddenError(
          'Chỉ người giao của việc đã huỷ hiệu lực được lập công việc điều chỉnh.',
        );
      }
      if (!original.reversal) {
        throw new WorkspaceValidationError(
          'Chỉ lập công việc điều chỉnh cho việc đã huỷ hiệu lực.',
        );
      }
      const open = (await this.store.standaloneTask.adjustments(actor.tenantId, original.id)).find(
        (adjustment) => adjustment.status !== 'cancelled',
      );
      if (open) {
        throw new WorkspaceValidationError(
          `Việc ${original.code} đã có công việc điều chỉnh ${open.code} còn hiệu lực.`,
        );
      }
    }

    const executionType = input.executionType === 'procedure' ? 'procedure' : 'manual';
    const procedureDefinitionId =
      executionType === 'procedure'
        ? requireUuid(input.procedureDefinitionId, 'Quy trình')
        : null;

    const model: StandaloneTaskCreateModel = {
      title: requireText(input.title, 'Tên công việc', 200),
      description: optionalText(input.description),
      priority: pickPriority(input.priority) ?? 'normal',
      assigneeUserId,
      participantUserIds,
      followerUserIds,
      plannedStart,
      dueDate,
      parentId,
      executionType,
      procedureDefinitionId,
      adjustmentOfId,
      requester: { displayName: actor.displayName, isTenantAdmin: actor.isTenantAdmin },
    };
    await this.requireKnownPeople(actor, [assigneeUserId, ...participantUserIds, ...followerUserIds]);

    const task = await this.store.standaloneTask.create(actor.tenantId, actor.userId, model);
    return this.toDetail(actor, task, 'assigner');
  }

  async update(
    actor: WorkspaceActor,
    taskId: string,
    input: UpdateStandaloneTaskRequest,
  ): Promise<StandaloneTaskDetail> {
    const { task, role } = await this.load(actor, taskId);
    const body = input ?? {};

    const progressPercent =
      body.progressPercent === undefined ? undefined : requireProgress(body.progressPercent);

    if (role === 'viewer') {
      throw new StandaloneTaskForbiddenError('Bạn chỉ được xem công việc này.');
    }
    if (role !== 'assigner') {
      const contentKeys = Object.keys(body).filter(
        (key) => key !== 'progressPercent' && (body as Record<string, unknown>)[key] !== undefined,
      );
      if (role === 'follower' || contentKeys.length > 0) {
        throw new StandaloneTaskForbiddenError(
          role === 'follower'
            ? 'Người theo dõi chỉ được xem công việc.'
            : 'Chỉ người giao việc được sửa nội dung công việc; bạn chỉ cập nhật được tiến độ.',
        );
      }
    }
    if (progressPercent !== undefined && (task.status === 'done' || task.status === 'cancelled')) {
      throw new WorkspaceValidationError('Công việc đã đóng, không cập nhật tiến độ được.');
    }
    if (progressPercent !== undefined && task.childCount > 0) {
      throw new WorkspaceValidationError(
        'Tiến độ của việc có việc con được tính tự động từ các việc con.',
      );
    }

    const patch: { -readonly [Key in keyof StandaloneTaskWriteModel]?: StandaloneTaskWriteModel[Key] } & {
      progressPercent?: number;
    } = {};
    if (progressPercent !== undefined) patch.progressPercent = progressPercent;

    if (role === 'assigner') {
      if (body.title !== undefined) patch.title = requireText(body.title, 'Tên công việc', 200);
      if (body.description !== undefined) patch.description = optionalText(body.description);
      if (body.priority !== undefined) {
        const priority = pickPriority(body.priority);
        if (!priority) throw new WorkspaceValidationError('Mức ưu tiên không hợp lệ.');
        patch.priority = priority;
      }
      if (body.plannedStart !== undefined) {
        patch.plannedStart = optionalDate(body.plannedStart, 'Ngày bắt đầu');
      }
      if (body.dueDate !== undefined) patch.dueDate = optionalDate(body.dueDate, 'Hạn hoàn thành');
      assertDateOrder(
        patch.plannedStart !== undefined ? patch.plannedStart : (task.plannedStart ?? null),
        patch.dueDate !== undefined ? patch.dueDate : (task.dueDate ?? null),
      );

      const assigneeUserId =
        body.assigneeUserId !== undefined
          ? requireUuid(body.assigneeUserId, 'Người phụ trách')
          : task.assigneeUserId;
      if (assigneeUserId !== task.assigneeUserId) patch.assigneeUserId = assigneeUserId;

      // Đổi người phụ trách hay danh sách thành viên đều dựng lại cả hai danh
      // sách, để một người không giữ hai vai cùng lúc.
      if (
        patch.assigneeUserId !== undefined ||
        body.participantUserIds !== undefined ||
        body.followerUserIds !== undefined
      ) {
        const participants = cleanIds(body.participantUserIds ?? task.participantUserIds, [
          assigneeUserId,
        ]);
        const followers = cleanIds(body.followerUserIds ?? task.followerUserIds, [
          assigneeUserId,
          ...participants,
        ]);
        patch.participantUserIds = participants;
        patch.followerUserIds = followers;
        const known = new Set([
          task.assigneeUserId,
          ...task.participantUserIds,
          ...task.followerUserIds,
        ]);
        await this.requireKnownPeople(
          actor,
          [assigneeUserId, ...participants, ...followers].filter((userId) => !known.has(userId)),
        );
      }
    }

    if (Object.keys(patch).length === 0) return this.toDetail(actor, task, role);
    const updated = await this.store.standaloneTask.update(
      actor.tenantId,
      task.id,
      actor.userId,
      patch,
    );
    return this.toDetail(actor, updated, standaloneTaskRoleOf(updated, actor.userId) ?? role);
  }

  async changeStatus(
    actor: WorkspaceActor,
    taskId: string,
    input: ChangeStandaloneTaskStatusRequest,
  ): Promise<StandaloneTaskDetail> {
    const { task, role } = await this.load(actor, taskId);
    const next = input?.status;
    if (!(WORK_ITEM_STATUSES as readonly string[]).includes(String(next))) {
      throw new WorkspaceValidationError('Trạng thái không hợp lệ.');
    }
    const note = optionalText(input?.note) ?? undefined;
    if (note && note.length > 1000) {
      throw new WorkspaceValidationError('Ghi chú không được dài quá 1000 ký tự.');
    }
    assertStandaloneTaskTransition(task, role, next as WorkItemStatus, note);

    const updated = await this.store.standaloneTask.changeStatus(
      actor.tenantId,
      task.id,
      actor.userId,
      task.status,
      next as WorkItemStatus,
      note,
      todayKey(timezoneOf(actor.tenantId)),
    );
    if (!updated) throw new StandaloneTaskConflictError();
    return this.toDetail(actor, updated, role);
  }

  /**
   * Huỷ hiệu lực việc đã hoàn thành: trạng thái cuối, không mở lại được.
   *
   * Cùng luật với công việc dự án: còn việc con chưa huỷ thì phải huỷ hiệu
   * lực từng việc con trước; việc có hồ sơ quy trình đã hoàn tất thì hỏi Quy
   * trình trước (hồ sơ đã sinh phiếu vật tư chẳng hạn thì không huỷ được), rồi
   * nhờ Quy trình huỷ hiệu lực hồ sơ theo.
   */
  async reverse(
    actor: WorkspaceActor,
    taskId: string,
    input: ReverseStandaloneTaskRequest,
  ): Promise<StandaloneTaskDetail> {
    const { task, role } = await this.load(actor, taskId);
    if (role !== 'assigner') {
      throw new StandaloneTaskForbiddenError('Chỉ người giao việc được huỷ hiệu lực công việc.');
    }
    const reason = requireText(input?.reason, 'Lý do huỷ hiệu lực', 1000);
    if (reason.length < 3) {
      throw new WorkspaceValidationError('Lý do huỷ hiệu lực cần ít nhất 3 ký tự.');
    }
    if (task.reversal) return this.toDetail(actor, task, role);
    if (task.status !== 'done') {
      throw new WorkspaceValidationError('Chỉ huỷ hiệu lực được công việc đã hoàn thành.');
    }
    if (task.childCount > 0) {
      const live = (await this.store.standaloneTask.children(actor.tenantId, task.id)).filter(
        (child) => child.status !== 'cancelled',
      );
      if (live.length > 0) {
        throw new WorkspaceValidationError(
          `Còn ${live.length} việc con chưa huỷ (${live
            .slice(0, 3)
            .map((child) => child.code)
            .join(', ')}); huỷ hiệu lực từng việc con trước.`,
        );
      }
    }
    const instanceId =
      task.procedure?.status === 'completed' ? task.procedure.instanceId : undefined;
    if (instanceId) {
      const check = this.procedureReversal
        ? await this.procedureReversal.check(actor.tenantId, instanceId)
        : { allowed: false, reason: 'Chưa cấu hình kiểm tra với Quy trình.' };
      if (!check.allowed) {
        throw new WorkspaceValidationError(
          `Không huỷ hiệu lực được: ${check.reason ?? 'Quy trình không cho phép huỷ hồ sơ gắn công việc.'}`,
        );
      }
    }
    const reversed = await this.store.standaloneTask.reverse(actor.tenantId, task.id, {
      reversedBy: actor.userId,
      reversedByName: actor.displayName,
      reason,
      today: todayKey(timezoneOf(actor.tenantId)),
      notifyProcedure: true,
      adjustmentRequested: input.createAdjustment === true,
    });
    return this.toDetail(actor, reversed, role);
  }

  async remove(actor: WorkspaceActor, taskId: string): Promise<void> {
    const { task, role } = await this.load(actor, taskId);
    if (role !== 'assigner') {
      throw new StandaloneTaskForbiddenError('Chỉ người giao việc được xoá công việc.');
    }
    if (task.reversal) {
      throw new WorkspaceValidationError(
        'Công việc đã huỷ hiệu lực được giữ lại làm vết, không xoá được.',
      );
    }
    const subtree = await this.store.standaloneTask.subtree(actor.tenantId, task.id);
    if (!canDeleteStandaloneTask(subtree)) {
      throw new WorkspaceValidationError(
        subtree.length > 1
          ? 'Chỉ xoá được khi công việc và mọi việc con đều chưa bắt đầu hoặc đã huỷ.'
          : 'Chỉ xoá được công việc chưa bắt đầu hoặc đã huỷ. Công việc đang làm hãy huỷ để giữ lại nhật ký.',
      );
    }
    await this.store.standaloneTask.remove(actor.tenantId, task.id);
  }

  /** Đọc việc và vai của người gọi; không liên quan thì coi như không tồn tại. */
  private async load(
    actor: WorkspaceActor,
    taskId: string,
  ): Promise<{ task: StandaloneTask; role: StandaloneTaskRole }> {
    const task = await this.store.standaloneTask.findById(actor.tenantId, taskId);
    if (!task) throw new StandaloneTaskNotFoundError();
    const role =
      standaloneTaskRoleOf(task, actor.userId) ??
      ((await this.store.standaloneTask.isTreeMember(actor.tenantId, task.rootId, actor.userId))
        ? 'viewer'
        : undefined);
    if (!role) throw new StandaloneTaskNotFoundError();
    return { task, role };
  }

  private async toDetail(
    actor: WorkspaceActor,
    task: StandaloneTask,
    role: StandaloneTaskRole,
  ): Promise<StandaloneTaskDetail> {
    const [history, ancestors, children, adjustments, adjustmentOf] = await Promise.all([
      this.store.standaloneTask.history(actor.tenantId, task.id, HISTORY_LIMIT),
      task.parentId
        ? this.store.standaloneTask.ancestors(actor.tenantId, task.id)
        : Promise.resolve([]),
      task.childCount > 0
        ? this.store.standaloneTask.children(actor.tenantId, task.id)
        : Promise.resolve([]),
      task.reversal
        ? this.store.standaloneTask.adjustments(actor.tenantId, task.id)
        : Promise.resolve([]),
      task.adjustmentOfId
        ? this.store.standaloneTask.findById(actor.tenantId, task.adjustmentOfId)
        : Promise.resolve(undefined),
    ]);
    return {
      task,
      myRole: role,
      allowedStatuses: allowedStandaloneTaskTransitions(task, role),
      canAddChild:
        (role === 'assigner' || role === 'assignee') &&
        !CLOSED_WORK_ITEM_STATUSES.includes(task.status) &&
        task.depth + 1 < MAX_WORK_ITEM_DEPTH,
      canReverse: role === 'assigner' && task.status === 'done' && !task.reversal,
      canCreateAdjustment:
        role === 'assigner' &&
        Boolean(task.reversal) &&
        !adjustments.some((adjustment) => adjustment.status !== 'cancelled'),
      adjustmentOf: adjustmentOf
        ? { id: adjustmentOf.id, code: adjustmentOf.code, title: adjustmentOf.title }
        : undefined,
      adjustments,
      ancestors,
      children,
      history,
    };
  }

  /**
   * Mọi người được giao phải có trong danh bạ tổ chức.
   *
   * Danh bạ không đọc được thì cho qua, cùng chính sách với lời mời họp: một
   * lần giao việc không nên hỏng chỉ vì Tenant Core chậm vài giây.
   */
  private async requireKnownPeople(actor: WorkspaceActor, userIds: readonly string[]) {
    const unknown = await this.directory.unknownUserIds(actor.tenantId, userIds);
    if (unknown && unknown.length > 0) {
      throw new WorkspaceValidationError('Có người được chọn không thuộc tổ chức.');
    }
  }
}

function requireText(value: unknown, label: string, maxLength: number): string {
  const text = String(value ?? '').trim();
  if (!text) throw new WorkspaceValidationError(`${label} không được để trống.`);
  if (text.length > maxLength) {
    throw new WorkspaceValidationError(`${label} không được dài quá ${maxLength} ký tự.`);
  }
  return text;
}

function optionalText(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function requireUuid(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) {
    throw new WorkspaceValidationError(`Hãy chọn ${label.toLowerCase()} hợp lệ.`);
  }
  return text;
}

function optionalDate(value: unknown, label: string): string | null {
  if (value == null || value === '') return null;
  const text = String(value).slice(0, 10);
  if (!DATE.test(text) || Number.isNaN(Date.parse(text))) {
    throw new WorkspaceValidationError(`${label} không hợp lệ.`);
  }
  return text;
}

function assertDateOrder(start: string | null, end: string | null): void {
  if (start && end && start > end) {
    throw new WorkspaceValidationError('Hạn hoàn thành phải sau ngày bắt đầu.');
  }
}

function pickPriority(value: unknown): WorkItemPriority | undefined {
  if (value == null || value === '') return undefined;
  return (WORK_ITEM_PRIORITIES as readonly string[]).includes(String(value))
    ? (String(value) as WorkItemPriority)
    : undefined;
}

function requireProgress(value: unknown): number {
  const percent = Number(value);
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new WorkspaceValidationError('Tiến độ phải là số nguyên từ 0 đến 100.');
  }
  return percent;
}

/** Bỏ trùng, bỏ rỗng, bỏ người đã giữ vai khác; mỗi id phải là UUID. */
function cleanIds(values: unknown, exclude: readonly string[]): string[] {
  if (values == null) return [];
  if (!Array.isArray(values)) throw new WorkspaceValidationError('Danh sách người không hợp lệ.');
  const ids = [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
  if (ids.length > MAX_MEMBERS) {
    throw new WorkspaceValidationError(`Danh sách quá dài (tối đa ${MAX_MEMBERS} người).`);
  }
  for (const id of ids) requireUuid(id, 'Người');
  return ids.filter((id) => !exclude.includes(id));
}
