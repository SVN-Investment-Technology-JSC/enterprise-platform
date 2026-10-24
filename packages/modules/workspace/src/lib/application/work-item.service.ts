import {
  DEPENDENCY_TYPES,
  WORK_ITEM_EXECUTION_TYPES,
  WORK_ITEM_STATUSES,
  WORK_ITEM_STATUS_TRANSITIONS,
  WORK_ITEM_TYPES,
  type AddDependencyRequest,
  type ChangeWorkItemStatusRequest,
  type CreateWorkItemRequest,
  type DependencyType,
  type MoveWorkItemRequest,
  type ReverseWorkItemRequest,
  type UpdateWorkItemRequest,
  type WorkItem,
  type WorkItemDependency,
  type WorkItemStatus,
  type WorkItemStatusHistoryEntry,
  type WorkItemTree,
  type WorkItemProcedureRequest,
} from '@enterprise-platform/contracts-workspace';
import {
  autoCompleteParents,
  isClosed,
  parseManualPercent,
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
  ProjectRoleForbiddenError,
  WorkItemAssigneeOnlyError,
  WorkItemNotFoundError,
  WorkspaceValidationError,
} from '../domain/workspace.error.js';
import {
  hasProjectPermission,
  hasProjectRole,
  requireProjectPermission,
  requireProjectRole,
  seesAllProjects,
  type ProjectService,
} from './project.service.js';
import { timezoneOf, todayKey } from '../domain/tenant-time.js';
import { parseTransport, type FleetTransportService } from './fleet-transport.service.js';
import type { ProcedureReversalChecker } from './procedure-reversal-check.port.js';
import type { WorkspaceActor } from './workspace.application.js';
import { WorkspaceLabelService } from './workspace-label.service.js';
import type { WorkspaceStore } from './workspace-store.port.js';

const HISTORY_LIMIT = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Nhãn tiếng Việt cho thông điệp lỗi — mã trạng thái thô không nói gì với người dùng. */
const STATUS_LABELS: Record<WorkItemStatus, string> = {
  todo: 'Chưa làm',
  in_progress: 'Đang làm',
  blocked: 'Vướng mắc',
  review: 'Chờ duyệt',
  done: 'Hoàn thành',
  cancelled: 'Đã huỷ',
};

/** Số tên gợi ý tối đa gửi xuống; giao diện lọc tiếp theo chữ gõ. */
const RECENT_TITLE_LIMIT = 300;

export class WorkItemService {
  constructor(
    private readonly store: WorkspaceStore,
    private readonly projects: ProjectService,
    private readonly procedureReversal?: ProcedureReversalChecker,
    private readonly fleet?: FleetTransportService,
  ) {}

  /** Danh mục mức ưu tiên ở Cài đặt; đọc lại mỗi lần nên không cần chia sẻ thực thể. */
  private get labels(): WorkspaceLabelService {
    return new WorkspaceLabelService(this.store);
  }

  /**
   * Tên công việc đã dùng để gợi ý khi gõ tên mới, mới nhất trước. Quản trị viên tenant thấy cả tenant;
   * người khác chỉ thấy việc mình tạo hoặc được giao, không lộ tên việc ngoài phạm vi được xem.
   */
  async recentTitles(actor: WorkspaceActor): Promise<readonly string[]> {
    return this.store.workItem.recentTitles(
      actor.tenantId,
      seesAllProjects(actor) ? undefined : actor.userId,
      RECENT_TITLE_LIMIT,
    );
  }

  /** Toàn bộ cây WBS của một dự án, trả phẳng kèm `parentId` và `depth`. */
  async tree(actor: WorkspaceActor, projectId: string): Promise<WorkItemTree> {
    const access = await this.projects.access(actor, projectId);
    const [all, procedureRequests] = await Promise.all([
      this.store.workItem.listByProject(actor.tenantId, projectId),
      this.store.procedureRequest.listByProject(actor.tenantId, projectId),
    ]);
    if (hasProjectPermission(access, 'project.view_all')) return { items: all, procedureRequests };
    // Chỉ "Xem dự án liên quan": việc của mình, kèm nhánh cha (để thấy nằm ở
    // đâu) và nhánh con (việc mình phụ trách bao trùm).
    const items = relatedItems(all, actor.userId);
    const visible = new Set(items.map((item) => item.id));
    return {
      items,
      procedureRequests: procedureRequests.filter((request) => visible.has(request.workItemId)),
    };
  }

  async detail(actor: WorkspaceActor, workItemId: string): Promise<WorkItem> {
    const { item, access } = await this.load(actor, workItemId);
    if (!hasProjectPermission(access, 'project.view_all')) {
      const all = await this.store.workItem.listByProject(actor.tenantId, item.projectId);
      if (!relatedItems(all, actor.userId).some((node) => node.id === item.id)) {
        throw new WorkItemNotFoundError(workItemId);
      }
    }
    return item;
  }

  /**
   * Tạo công việc.
   *
   * `linkedInstance` chỉ dùng nội bộ khi Quy trình nhờ tạo công việc cho một hồ
   * sơ đã mở (xử lý sự kiện); người dùng gửi lên không đi qua đường này.
   */
  async create(
    actor: WorkspaceActor,
    input: CreateWorkItemRequest,
    linkedInstance?: { instanceId: string; instanceCode: string; instanceStatus: string },
  ): Promise<WorkItem> {
    const access = await this.projects.access(actor, String(input.projectId ?? ''));
    requireProjectRole(access, 'member');

    const title = requireText(input.title, 'Tên công việc', 200);
    const itemType = pick(input.itemType, WORK_ITEM_TYPES, 'task');
    const executionType = pick(input.executionType, WORK_ITEM_EXECUTION_TYPES, 'manual');
    const priority = await this.labels.requirePriority(actor.tenantId, input.priority);
    assertDateOrder(input.plannedStart, input.plannedEnd);
    if (input.estimateHours != null && !(Number(input.estimateHours) > 0)) {
      throw new WorkspaceValidationError('Giờ ước lượng phải lớn hơn 0.');
    }
    // `phase` chỉ là vỏ chứa việc con: gán người hay ước lượng giờ cho nó sẽ
    // bị tính hai lần khi cuộn tiến độ.
    if (
      itemType === 'phase' &&
      (input.assigneeUserId || input.estimateHours != null || input.participantUserIds?.length)
    ) {
      throw new WorkspaceValidationError(
        'Nhóm công việc không nhận người phụ trách và giờ ước lượng; hãy đặt chúng ở việc con.',
      );
    }

    const siblings = await this.store.workItem.listByProject(actor.tenantId, access.project.id);
    const parent = input.parentId
      ? siblings.find((node) => node.id === input.parentId)
      : undefined;
    if (input.parentId && !parent) throw new WorkItemNotFoundError(String(input.parentId));
    if (parent?.reversal) {
      throw new WorkspaceValidationError(
        `Công việc ${parent.code} đã huỷ hiệu lực, không thêm được việc con.`,
      );
    }

    const depth = depthFor(parent);
    assertDepthWithinLimit(depth);

    // `member` tự nhận việc cho mình được; giao cho người khác cần `manager`.
    if (input.assigneeUserId && input.assigneeUserId !== actor.userId) {
      requireProjectRole(access, 'manager');
    }
    await this.requireMemberAssignee(actor, access.project.id, input.assigneeUserId);
    const participantUserIds = cleanIds(input.participantUserIds, input.assigneeUserId);
    // Kéo người khác vào cùng làm cũng là giao việc.
    if (participantUserIds.some((userId) => userId !== actor.userId)) {
      requireProjectRole(access, 'manager');
    }
    await this.requireMemberParticipants(actor, access.project.id, participantUserIds);
    const tagIds = await this.requireActiveTags(actor, input.tagIds);

    // "Theo quy trình" kèm quy trình: chỉ ghi yêu cầu và phát sự kiện; Quy
    // trình tự kiểm vai S của người tạo rồi mở hồ sơ và báo về.
    const procedureDefinitionId =
      !linkedInstance && executionType === 'procedure' && itemType !== 'phase'
        ? requireUuid(input.procedureDefinitionId, 'Quy trình')
        : undefined;

    const adjustmentOfId = await this.requireAdjustmentTarget(
      actor,
      access.project.id,
      input.adjustmentOfId,
    );
    // Kiểm hình thức phương tiện trước khi lưu công việc để lỗi nhập liệu không để lại công việc dở dang.
    const { transport, ...itemInput } = input;
    const parsedTransport = transport ? parseTransport(transport) : undefined;

    const created = await this.store.workItem.create(actor.tenantId, actor.userId, {
      ...itemInput,
      adjustmentOfId,
      procedureDefinitionId,
      participantUserIds,
      tagIds,
      projectId: access.project.id,
      title,
      itemType,
      executionType,
      priority,
      depth,
      sortOrder: nextSortOrder(siblings, input.parentId ?? null),
      procedureRequest: procedureDefinitionId
        ? {
            definitionId: procedureDefinitionId,
            projectCode: access.project.code,
            requestedByName: actor.displayName,
            requestedByIsTenantAdmin: actor.isTenantAdmin,
          }
        : undefined,
      linkedInstance: linkedInstance
        ? { ...linkedInstance, projectCode: access.project.code }
        : undefined,
    });

    await this.recalculate(actor, access.project.id);
    await this.fleet?.apply(
      actor,
      { sourceType: 'WORK_ITEM', sourceId: created.id, label: `${created.code} ${created.title}` },
      parsedTransport,
    );
    return created;
  }

  /**
   * Yêu cầu mở hồ sơ quy trình cho một công việc chưa có hồ sơ: nút "Quy
   * trình" trên đầu công việc, hoặc Thử lại khi lần trước bị từ chối.
   *
   * Việc tạo ở dạng "Thủ công" cũng mở được, như trước khi chuyển sang luồng
   * sự kiện; khi đó store chuyển nó sang "Theo quy trình" cùng transaction để
   * cây và badge chờ theo dõi được hồ sơ.
   */
  async requestProcedure(
    actor: WorkspaceActor,
    workItemId: string,
    definitionId: string,
  ): Promise<WorkItemProcedureRequest> {
    const { item, access } = await this.load(actor, workItemId);
    requireProjectRole(access, 'member');
    // Cùng luật với lúc tạo: nhóm công việc chỉ là vỏ chứa, không chạy quy trình.
    if (item.itemType === 'phase') {
      throw new WorkspaceValidationError('Nhóm công việc không chạy theo quy trình.');
    }
    if (item.status === 'cancelled' || item.reversal) {
      throw new WorkspaceValidationError('Công việc đã huỷ, không mở quy trình được.');
    }
    const refs = await this.store.externalRef.listByEntity(actor.tenantId, 'work_item', item.id);
    if (refs.some((ref) => ref.moduleKey === 'procedure-engine')) {
      throw new WorkspaceValidationError('Công việc đã có hồ sơ quy trình.');
    }
    return this.store.procedureRequest.request(actor.tenantId, actor.userId, {
      workItemId: item.id,
      workItemCode: item.code,
      projectId: item.projectId,
      title: item.title,
      definitionId: requireUuid(definitionId, 'Quy trình'),
      projectCode: access.project.code,
      requestedByName: actor.displayName,
      requestedByIsTenantAdmin: actor.isTenantAdmin,
    });
  }

  async update(
    actor: WorkspaceActor,
    workItemId: string,
    input: UpdateWorkItemRequest,
  ): Promise<WorkItem> {
    const { item, access } = await this.load(actor, workItemId);
    // `member` chỉ sửa được việc mình phụ trách hay cùng làm; từ `manager` trở
    // lên sửa mọi việc.
    if (!hasProjectRole(access, 'manager') && !isOwnItem(item, actor.userId)) {
      throw new WorkItemAssigneeOnlyError();
    }
    requireProjectRole(access, 'member');
    if (item.reversal) {
      throw new WorkspaceValidationError(
        'Công việc đã huỷ hiệu lực, không sửa được; hãy lập công việc điều chỉnh.',
      );
    }

    const { transport, ...patchInput } = input;
    const patch: UpdateWorkItemRequest = { ...patchInput };
    // `undefined`: giữ nguyên · `null`: bỏ phương tiện · còn lại: kiểm hình thức trước khi lưu.
    const parsedTransport = transport === undefined ? undefined : transport === null ? null : parseTransport(transport);
    if (input.title !== undefined) {
      Object.assign(patch, { title: requireText(input.title, 'Tên công việc', 200) });
    }
    if (input.priority !== undefined) {
      Object.assign(patch, { priority: await this.labels.requirePriority(actor.tenantId, input.priority) });
    }
    if (input.progressPercent !== undefined) {
      const percent = Math.trunc(Number(input.progressPercent));
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        throw new WorkspaceValidationError('Tiến độ phải là số nguyên từ 0 đến 100.');
      }
      Object.assign(patch, { progressPercent: percent });
    }
    if (input.manualProgressPercent !== undefined) {
      Object.assign(patch, { manualProgressPercent: parseManualPercent(input.manualProgressPercent) });
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

    if (input.participantUserIds !== undefined) {
      if (item.itemType === 'phase' && input.participantUserIds?.length) {
        throw new WorkspaceValidationError('Nhóm công việc không nhận người thực hiện.');
      }
      const assignee =
        input.assigneeUserId === undefined ? item.assigneeUserId : input.assigneeUserId;
      const next = cleanIds(input.participantUserIds, assignee);
      const before = new Set(item.participantUserIds ?? []);
      const touched = [
        ...next.filter((userId) => !before.has(userId)),
        ...[...before].filter((userId) => !next.includes(userId)),
      ];
      // `member` chỉ tự thêm hay tự rút mình ra; đổi người khác cần `manager`.
      if (touched.some((userId) => userId !== actor.userId)) {
        requireProjectRole(access, 'manager');
      }
      await this.requireMemberParticipants(actor, item.projectId, next);
      Object.assign(patch, { participantUserIds: next });
    }
    if (input.tagIds !== undefined) {
      Object.assign(patch, { tagIds: await this.requireActiveTags(actor, input.tagIds) });
    }

    const updated = await this.store.workItem.update(
      actor.tenantId,
      workItemId,
      patch,
      actor.userId,
    );
    await this.recalculate(actor, item.projectId);
    await this.fleet?.apply(
      actor,
      { sourceType: 'WORK_ITEM', sourceId: updated.id, label: `${updated.code} ${updated.title}` },
      parsedTransport,
    );
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
    if (!hasProjectRole(access, 'manager') && !isOwnItem(item, actor.userId)) {
      throw new WorkItemAssigneeOnlyError();
    }
    // `viewer` chỉ đọc, kể cả với việc gán cho chính họ.
    requireProjectRole(access, 'member');
    if (next === 'cancelled' && next !== item.status) {
      requireProjectPermission(access, 'work_item.cancel');
    }

    if (next === item.status) return item;
    if (item.reversal) {
      throw new WorkspaceValidationError(
        'Công việc đã huỷ hiệu lực, không mở lại được; hãy lập công việc điều chỉnh.',
      );
    }
    if (!WORK_ITEM_STATUS_TRANSITIONS[item.status].includes(next)) {
      const allowed = WORK_ITEM_STATUS_TRANSITIONS[item.status]
        .map((status) => `"${STATUS_LABELS[status]}"`)
        .join(', ');
      throw new WorkspaceValidationError(
        `Không thể chuyển từ "${STATUS_LABELS[item.status]}" sang "${STATUS_LABELS[next]}". ` +
          `Từ trạng thái hiện tại chỉ chuyển được sang: ${allowed}.`,
      );
    }

    // Mở lại một công việc điều chỉnh đã huỷ: công việc gốc chỉ có một công
    // việc điều chỉnh còn hiệu lực (unique index), báo rõ thay vì lỗi 500.
    if (item.status === 'cancelled' && item.adjustmentOfId) {
      const other = (await this.store.workItem.listByProject(actor.tenantId, item.projectId)).find(
        (node) =>
          node.id !== item.id && node.adjustmentOfId === item.adjustmentOfId && node.status !== 'cancelled',
      );
      if (other) {
        throw new WorkspaceValidationError(
          `Công việc gốc đã có công việc điều chỉnh khác (${other.code}); không mở lại được việc này.`,
        );
      }
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
    // Công việc bị huỷ thì trả xe đã giữ.
    if (next === 'cancelled') await this.fleet?.release(actor.tenantId, 'WORK_ITEM', workItemId);
    return updated;
  }

  /**
   * Huỷ hiệu lực công việc đã hoàn thành — chủ nhiệm dự án hoặc quản trị.
   *
   * Công việc không mở lại: chuyển `cancelled` kèm dấu huỷ, giữ lịch sử, nên
   * tiến độ và tài chính tự loại nó ra. Công việc gắn hồ sơ Quy trình thì hỏi
   * Quy trình trước (vật tư đã xuất, kỳ lương đã chốt… chặn hẳn), rồi Quy
   * trình nhận sự kiện và huỷ hiệu lực hồ sơ theo.
   */
  async reverse(
    actor: WorkspaceActor,
    workItemId: string,
    input: ReverseWorkItemRequest,
  ): Promise<WorkItem> {
    const { item, access } = await this.load(actor, workItemId);
    if (!hasProjectRole(access, 'owner')) {
      throw new ProjectRoleForbiddenError('chủ nhiệm dự án hoặc quản trị');
    }
    const reason = requireText(input?.reason, 'Lý do huỷ hiệu lực', 1000);
    if (reason.length < 3) {
      throw new WorkspaceValidationError('Lý do huỷ hiệu lực cần ít nhất 3 ký tự.');
    }
    if (item.reversal) return item;
    if (item.status !== 'done') {
      throw new WorkspaceValidationError('Chỉ huỷ hiệu lực được công việc đã hoàn thành.');
    }
    const children = (await this.store.workItem.listByProject(actor.tenantId, item.projectId)).filter(
      (node) => node.parentId === item.id && !(node.status === 'cancelled'),
    );
    if (children.length > 0) {
      throw new WorkspaceValidationError(
        `Còn ${children.length} việc con chưa huỷ (${children
          .slice(0, 3)
          .map((child) => child.code)
          .join(', ')}); huỷ hiệu lực từng việc con trước.`,
      );
    }

    const instanceId = await this.linkedInstanceId(actor.tenantId, item.id);
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

    const reversed = await this.store.workItem.reverse(actor.tenantId, item.id, {
      reversedBy: actor.userId,
      reversedByName: actor.displayName,
      reason,
      adjustmentRequested: input.createAdjustment === true,
      today: todayKey(timezoneOf(actor.tenantId)),
      instanceId,
    });
    await this.recalculate(actor, item.projectId);
    return reversed;
  }

  /**
   * Quy trình đã huỷ hiệu lực hồ sơ → huỷ hiệu lực công việc gắn với nó.
   * Không kiểm vai trò dự án: quyết định đã do Quản trị Quy trình đưa ra.
   */
  async reverseForProcedure(
    tenantId: string,
    workItemId: string,
    input: {
      readonly instanceCode: string;
      readonly reason: string;
      readonly reversedBy: string;
      readonly reversedByName?: string;
      readonly adjustmentRequested: boolean;
    },
  ): Promise<void> {
    const item = await this.store.workItem.findById(tenantId, workItemId);
    if (!item || item.reversal) return;
    await this.store.workItem.reverse(tenantId, item.id, {
      reversedBy: input.reversedBy,
      reversedByName: input.reversedByName,
      reason: `Hồ sơ ${input.instanceCode} bị huỷ hiệu lực: ${input.reason}`.slice(0, 1000),
      adjustmentRequested: input.adjustmentRequested,
      today: todayKey(timezoneOf(tenantId)),
    });
    const system: WorkspaceActor = {
      tenantId,
      userId: input.reversedBy,
      displayName: input.reversedByName ?? input.reversedBy,
      isTenantAdmin: true,
      canManage: false,
      canWriteTasks: true,
      canWriteDocuments: false,
      canDeleteDocuments: false,
    };
    await this.recalculate(system, item.projectId);
  }

  private async linkedInstanceId(tenantId: string, workItemId: string): Promise<string | undefined> {
    const refs = await this.store.externalRef.listByEntity(tenantId, 'work_item', workItemId);
    return refs.find((ref) => ref.moduleKey === 'procedure-engine')?.externalId;
  }

  /** Công việc điều chỉnh: trỏ về công việc đã huỷ hiệu lực cùng dự án, chưa có điều chỉnh khác. */
  private async requireAdjustmentTarget(
    actor: WorkspaceActor,
    projectId: string,
    adjustmentOfId: string | undefined,
  ): Promise<string | undefined> {
    if (!adjustmentOfId) return undefined;
    const original = await this.store.workItem.findById(actor.tenantId, adjustmentOfId);
    if (!original || original.projectId !== projectId || !original.reversal) {
      throw new WorkspaceValidationError(
        'Chỉ lập công việc điều chỉnh cho công việc đã huỷ hiệu lực trong cùng dự án.',
      );
    }
    const existing = (await this.store.workItem.listByProject(actor.tenantId, projectId)).find(
      (node) => node.adjustmentOfId === original.id && node.status !== 'cancelled',
    );
    if (existing) {
      throw new WorkspaceValidationError(
        `Công việc ${original.code} đã có công việc điều chỉnh ${existing.code}.`,
      );
    }
    return original.id;
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

  /** Người thực hiện cùng cũng phải là thành viên dự án, cùng lý do như người phụ trách. */
  private async requireMemberParticipants(
    actor: WorkspaceActor,
    projectId: string,
    userIds: readonly string[],
  ): Promise<void> {
    if (userIds.length === 0) return;
    const members = new Set(
      (await this.store.member.list(actor.tenantId, projectId)).map((member) => member.userId),
    );
    if (userIds.some((userId) => !members.has(userId))) {
      throw new WorkspaceValidationError('Người thực hiện phải là thành viên của dự án.');
    }
  }

  /** Chỉ gắn được nhãn đang dùng; id lạ hay nhãn đã ẩn bị từ chối. */
  private async requireActiveTags(
    actor: WorkspaceActor,
    tagIds: readonly string[] | undefined,
  ): Promise<string[]> {
    const ids = cleanIds(tagIds, undefined);
    if (ids.length === 0) return [];
    if (ids.some((id) => !UUID.test(id))) {
      throw new WorkspaceValidationError('Có nhãn không tồn tại hoặc đã ngừng dùng.');
    }
    const tags = await this.store.tag.findByIds(actor.tenantId, ids);
    const active = new Set(tags.filter((tag) => tag.isActive).map((tag) => tag.id));
    if (ids.some((id) => !active.has(id))) {
      throw new WorkspaceValidationError('Có nhãn không tồn tại hoặc đã ngừng dùng.');
    }
    return ids;
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
      manualPercent: row.manualPercent,
      estimateHours: row.estimateHours,
    }));

    const changed = rollUpProgress(nodes);
    await this.store.workItem.applyProgress(actor.tenantId, changed);

    // Công việc cha tự hoàn thành khi mọi việc con đã xong. Gọi thẳng store
    // (không qua `changeStatus` của service) nên không lặp lại recalculate, và
    // cũng không vướng hàng rào "việc con chưa đóng" — ở đây con đã xong hết.
    const toComplete = autoCompleteParents(nodes);
    if (toComplete.size > 0) {
      const today = todayKey(timezoneOf(actor.tenantId));
      for (const parentId of toComplete) {
        await this.store.workItem.changeStatus(
          actor.tenantId,
          parentId,
          actor.userId,
          'done',
          'Tự động hoàn thành khi mọi công việc con đã xong.',
          today,
        );
      }
    }

    // Dùng giá trị vừa tính, không đọc lại từ CSDL: bản ghi vừa ghi xong.
    const updated = nodes.map((node) => ({
      ...node,
      // Cha vừa tự hoàn thành thì tiến độ coi như 100% cho phép tính dự án.
      status: toComplete.has(node.id) ? 'done' : node.status,
      // Hoàn thành thì store bỏ tiến độ nhập tay, nên phép tính dự án cũng bỏ.
      manualPercent: toComplete.has(node.id) ? null : node.manualPercent,
      progressPercent: toComplete.has(node.id)
        ? 100
        : (changed.get(node.id) ?? node.progressPercent),
    }));
    await this.store.project.updateProgress(actor.tenantId, projectId, projectProgress(updated));
    // Mọi việc đã xong hoặc đã huỷ: tự đóng hồ sơ nếu tenant bật tuỳ chọn ở Cài đặt.
    await this.projects.autoArchiveIfDone(
      actor.tenantId,
      projectId,
      updated.map((node) => node.status),
    );
  }
}

/** Việc của một người: họ phụ trách hoặc cùng thực hiện. */
function isOwnItem(item: WorkItem, userId: string): boolean {
  return item.assigneeUserId === userId || (item.participantUserIds ?? []).includes(userId);
}

/**
 * Phần cây một người "liên quan": việc họ phụ trách, cùng làm hoặc tự tạo,
 * cộng mọi node cha và node con của những việc đó. Giữ thứ tự gốc.
 */
export function relatedItems(items: readonly WorkItem[], userId: string): WorkItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const children = new Map<string, WorkItem[]>();
  for (const item of items) {
    if (!item.parentId) continue;
    const list = children.get(item.parentId) ?? [];
    list.push(item);
    children.set(item.parentId, list);
  }
  const keep = new Set<string>();
  const addDescendants = (id: string) => {
    for (const child of children.get(id) ?? []) {
      if (keep.has(child.id)) continue;
      keep.add(child.id);
      addDescendants(child.id);
    }
  };
  for (const item of items) {
    if (!isOwnItem(item, userId) && item.createdBy !== userId) continue;
    keep.add(item.id);
    addDescendants(item.id);
    let parent = item.parentId ? byId.get(item.parentId) : undefined;
    while (parent && !keep.has(parent.id)) {
      keep.add(parent.id);
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
  }
  return items.filter((item) => keep.has(item.id));
}

/** Bỏ trùng, bỏ rỗng; người phụ trách đã có chỗ riêng nên không lặp lại ở đây. */
function cleanIds(values: unknown, exclude: string | null | undefined): string[] {
  if (values == null) return [];
  if (!Array.isArray(values)) throw new WorkspaceValidationError('Danh sách không hợp lệ.');
  const ids = values.map((value) => String(value ?? '').trim()).filter(Boolean);
  if (ids.length > 50) throw new WorkspaceValidationError('Danh sách quá dài (tối đa 50).');
  return [...new Set(ids)].filter((id) => id !== exclude);
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

/** Id dạng UUID bắt buộc; sai thì báo lỗi nhập liệu thay vì để Postgres ném lỗi kiểu. */
function requireUuid(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) {
    throw new WorkspaceValidationError(`Hãy chọn ${label.toLowerCase()} hợp lệ.`);
  }
  return text;
}
