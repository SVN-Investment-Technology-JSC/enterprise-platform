import {
  DEFAULT_WORK_ITEM_REOPEN_POLICY,
  DEFAULT_WORK_ITEM_PROGRESS_METHOD,
  DEPENDENCY_TYPES,
  LEGACY_PROJECT_PROGRESS_METHOD,
  MAX_CHECKLIST_ITEMS,
  MAX_WORK_ITEM_ESTIMATE_HOURS,
  MAX_WORK_ITEM_WEIGHT,
  STANDALONE_TASK_SYSTEM_ACTOR_ID,
  WORK_ITEM_EXECUTION_TYPES,
  WORK_ITEM_REOPEN_POLICIES,
  WORK_ITEM_STATUSES,
  WORK_ITEM_STATUS_TRANSITIONS,
  WORK_ITEM_TYPES,
  type AddDependencyRequest,
  type ChangeWorkItemStatusRequest,
  type CreateWorkItemRequest,
  type DependencyType,
  type MoveWorkItemRequest,
  type ReportWorkItemProgressRequest,
  type ReverseWorkItemRequest,
  type UpdateWorkItemRequest,
  type WorkItem,
  type WorkItemChecklistItem,
  type WorkItemProgressReport,
  type WorkItemDependency,
  type WorkItemProcedureSteps,
  type WorkItemStatus,
  type WorkItemStatusHistoryEntry,
  type WorkItemTree,
  type WorkItemProcedureRequest,
  type ProcedureLinkOnAllChildrenDone,
} from '@enterprise-platform/contracts-workspace';
import { parseBlockedReason } from '../domain/blocked-reason.rules.js';
import {
  changeProcedureBlockedMessage,
  manualProgressBlockedMessage,
  startProcedureBlockedMessage,
} from '../domain/procedure-link.rules.js';
import { evaluateCompletion, parseCompletionInput } from '../domain/completion.rules.js';
import {
  isClosedStatus,
  procedureOutcomeNote,
  statusPath,
  workItemOutcomeTarget,
  type ProcedureOutcomeKind,
} from '../domain/procedure-outcome.rules.js';
import {
  checklistPercent,
  parseChecklistTitle,
  parseChecklistTitles,
  parseProgressMethod,
  parseQuantityDone,
  parseQuantityTarget,
  parseQuantityUnit,
  quantityPercent,
} from '../domain/progress-method.rules.js';
import {
  parseReportDate,
  parseReportDescription,
  parseReportPercent,
  progressToRestore,
} from '../domain/progress-report.rules.js';
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
  ParentItemDoneError,
  ProjectRoleForbiddenError,
  ReopenNotAllowedError,
  WorkItemAssigneeOnlyError,
  WorkItemNotFoundError,
  WorkspaceValidationError,
} from '../domain/workspace.error.js';
import {
  hasProjectPermission,
  assertProjectWritable,
  hasProjectRole,
  requireProjectPermission,
  requireProjectRole,
  seesAllProjects,
  type ProjectAccess,
  type ProjectService,
} from './project.service.js';
import { parentProcedureWaitRules } from './procedure-link-settings.js';
import { timezoneOf, todayKey } from '../domain/tenant-time.js';
import { parseTransport, type FleetTransportService } from './fleet-transport.service.js';
import type { ProcedureInstanceReplacer } from './procedure-instance-replacer.port.js';
import { loadProcedureSteps } from './procedure-steps.js';
import type { ProcedureStepsReader } from './procedure-steps.port.js';
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
    /** Nhờ Quy trình đổi hồ sơ; vắng (test) thì không đổi quy trình được. */
    private readonly instanceReplacer?: ProcedureInstanceReplacer,
    /** Đọc các bước hồ sơ gắn công việc từ Quy trình; vắng (test) thì báo không đọc được. */
    private readonly procedureStepsReader?: ProcedureStepsReader,
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
   * Các bước hồ sơ Quy trình gắn với công việc. Ai xem được công việc (cùng luật với `detail`) thì xem được;
   * mã hồ sơ lấy từ liên kết Workspace giữ, không nhận từ client.
   */
  async procedureSteps(actor: WorkspaceActor, workItemId: string): Promise<WorkItemProcedureSteps> {
    const item = await this.detail(actor, workItemId);
    const instanceId = await this.linkedInstanceId(actor.tenantId, item.id);
    return loadProcedureSteps(this.procedureStepsReader, actor.tenantId, instanceId);
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
    assertProjectWritable(access.project);

    const title = requireText(input.title, 'Tên công việc', 200);
    const itemType = pick(input.itemType, WORK_ITEM_TYPES, 'task');
    const executionType = pick(input.executionType, WORK_ITEM_EXECUTION_TYPES, 'manual');
    const priority = await this.labels.requirePriority(actor.tenantId, input.priority);
    assertDateOrder(input.plannedStart, input.plannedEnd);
    assertWeight(input.weight);
    const progressMethod =
      input.progressMethod === undefined ? DEFAULT_WORK_ITEM_PROGRESS_METHOD : parseProgressMethod(input.progressMethod);
    const quantity =
      progressMethod === 'quantity'
        ? { quantityTarget: parseQuantityTarget(input.quantityTarget), quantityUnit: parseQuantityUnit(input.quantityUnit) }
        : { quantityTarget: undefined, quantityUnit: undefined };
    const checklistTitles = progressMethod === 'checklist' ? parseChecklistTitles(input.checklistTitles) : [];
    assertEstimateHours(input.estimateHours);
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
    // Cha đã hoàn thành mà thêm con thì cha không còn đúng: hoặc mở lại cha (và các cha đã xong phía trên), hoặc
    // từ chối. Kiểm hết quyền ở đây, trước khi ghi, để từ chối không để lại việc dở dang.
    // Việc do Quy trình nhờ tạo (`linkedInstance`) không có người dùng để hỏi nên giữ cách cũ: tạo dưới cha, không mở lại.
    const reopenChain = parent?.status === 'done' && !linkedInstance ? doneChain(siblings, parent) : [];
    if (reopenChain.length > 0) {
      if (input.reopenParent !== true) throw new ParentItemDoneError(reopenChain[0].code);
      for (const node of reopenChain) assertCanReopen(access, node, actor.userId);
    }
    const reopenPolicy = pick(input.reopenPolicy, WORK_ITEM_REOPEN_POLICIES, DEFAULT_WORK_ITEM_REOPEN_POLICY);

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
    const completion = parseCompletionInput(input.completion, itemType);

    const created = await this.store.workItem.create(actor.tenantId, actor.userId, {
      ...itemInput,
      progressMethod,
      ...quantity,
      checklistTitles,
      equalChildWeight: input.equalChildWeight !== false,
      completion,
      reopenPolicy,
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
            projectName: access.project.name,
            requestedByName: actor.displayName,
            requestedByIsTenantAdmin: actor.isTenantAdmin,
          }
        : undefined,
      linkedInstance: linkedInstance
        ? { ...linkedInstance, projectCode: access.project.code, projectName: access.project.name }
        : undefined,
    });

    if (reopenChain.length > 0) {
      await this.reopenDoneChain(actor, access.project.id, reopenChain, {
        trigger: 'child-added',
        childCode: created.code,
        childTitle: created.title,
      });
    }
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
    assertProjectWritable(access.project);
    requireProjectRole(access, 'member');
    // Cùng luật với lúc tạo: nhóm công việc chỉ là vỏ chứa, không chạy quy trình.
    if (item.itemType === 'phase') {
      throw new WorkspaceValidationError('Nhóm công việc không chạy theo quy trình.');
    }
    if (item.status === 'cancelled' || item.reversal) {
      throw new WorkspaceValidationError('Công việc đã huỷ, không mở quy trình được.');
    }
    const startGate = startProcedureBlockedMessage(await this.projects.procedureLinkSettings(actor.tenantId), item.status);
    if (startGate) throw new WorkspaceValidationError(startGate);
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
      projectName: access.project.name,
      requestedByName: actor.displayName,
      requestedByIsTenantAdmin: actor.isTenantAdmin,
    });
  }

  /**
   * Đổi quy trình của công việc có hồ sơ mở nhầm: Quy trình xoá hồ sơ cũ và mở
   * hồ sơ mới trong một transaction của nó (đồng bộ), rồi Workspace trỏ lại
   * con trỏ. Công việc được giữ nguyên. Hồ sơ còn nguyên hay không do Quy
   * trình quyết định; ở đây chỉ kiểm quyền và trạng thái công việc.
   */
  async changeProcedure(
    actor: WorkspaceActor,
    workItemId: string,
    definitionId: string,
  ): Promise<WorkItemProcedureRequest> {
    const { item, access } = await this.load(actor, workItemId);
    assertProjectWritable(access.project);
    requireProjectRole(access, 'member');
    if (item.itemType === 'phase') {
      throw new WorkspaceValidationError('Nhóm công việc không chạy theo quy trình.');
    }
    if (item.status === 'cancelled' || item.reversal) {
      throw new WorkspaceValidationError('Công việc đã huỷ, không đổi quy trình được.');
    }
    const changeGate = changeProcedureBlockedMessage(
      await this.projects.procedureLinkSettings(actor.tenantId),
      item.status,
    );
    if (changeGate) throw new WorkspaceValidationError(changeGate);
    const refs = await this.store.externalRef.listByEntity(actor.tenantId, 'work_item', item.id);
    const current = refs.find((ref) => ref.moduleKey === 'procedure-engine');
    if (!current) throw new WorkspaceValidationError('Công việc chưa có hồ sơ quy trình.');
    const nextDefinitionId = requireUuid(definitionId, 'Quy trình');
    const requests = await this.store.procedureRequest.listByProject(actor.tenantId, item.projectId);
    const currentRequest = requests.find((row) => row.workItemId === item.id);
    if (currentRequest && currentRequest.definitionId === nextDefinitionId) {
      throw new WorkspaceValidationError(
        'Công việc đang chạy theo quy trình này rồi; hãy chọn quy trình khác.',
      );
    }
    if (!this.instanceReplacer) {
      throw new WorkspaceValidationError('Chưa cấu hình kết nối tới Quy trình để đổi quy trình.');
    }
    let result: Awaited<ReturnType<ProcedureInstanceReplacer['replace']>>;
    try {
      result = await this.instanceReplacer.replace(actor.tenantId, {
        workItemId: item.id,
        expectedInstanceId: current.externalId,
        definitionId: nextDefinitionId,
        requestedBy: actor.userId,
        requestedByName: actor.displayName,
        requestedByIsTenantAdmin: actor.isTenantAdmin,
        workItemCode: item.code,
        workItemTitle: item.title,
        projectCode: access.project.code,
      });
    } catch {
      // Mất kết nối hoặc Quy trình lỗi: không biết đã đổi hay chưa. Chọn lại sau khi tải lại trang là an toàn, vì
      // gửi lại cùng hồ sơ cũ luôn trả cùng hồ sơ mới (khoá chống trùng theo hồ sơ cũ).
      throw new WorkspaceValidationError(
        'Chưa nhận được phản hồi từ module Quy trình. Hãy tải lại trang để xem hồ sơ hiện tại rồi thử lại.',
      );
    }
    if (!result.ok) throw new WorkspaceValidationError(result.reason);
    return this.store.procedureRequest.replaceStarted(actor.tenantId, {
      workItemId: item.id,
      previousInstanceId: current.externalId,
      definitionId: result.instance.definitionId || nextDefinitionId,
      instanceId: result.instance.id,
      instanceCode: result.instance.code,
      title: result.instance.title,
      status: result.instance.status,
      actorUserId: actor.userId,
    });
  }

  async update(
    actor: WorkspaceActor,
    workItemId: string,
    input: UpdateWorkItemRequest,
  ): Promise<WorkItem> {
    const { item, access } = await this.load(actor, workItemId);
    assertProjectWritable(access.project);
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
    // Chỉ nhập tay (`manualProgressPercent`) bị chặn; `progressPercent` là đường kéo tiến độ từ hồ sơ về nên giữ mở.
    if (input.manualProgressPercent !== undefined) {
      const manualGate = manualProgressBlockedMessage(
        await this.projects.procedureLinkSettings(actor.tenantId),
        item.executionType,
      );
      if (manualGate) throw new WorkspaceValidationError(manualGate);
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
    assertWeight(input.weight);
    assertEstimateHours(input.estimateHours);
    const currentMethod = item.progressMethod ?? DEFAULT_WORK_ITEM_PROGRESS_METHOD;
    const nextMethod = input.progressMethod === undefined ? currentMethod : parseProgressMethod(input.progressMethod);
    const touchesQuantity =
      input.progressMethod !== undefined || input.quantityTarget !== undefined || input.quantityUnit !== undefined;
    if (touchesQuantity && (nextMethod === 'quantity' || nextMethod === 'checklist')) {
      const nodes = await this.store.workItem.listByProject(actor.tenantId, item.projectId);
      if (nodes.some((node) => node.parentId === item.id && node.status !== 'cancelled')) {
        throw new WorkspaceValidationError(
          'Công việc có việc con nên tiến độ tự tính từ các việc con; không đổi sang tính theo khối lượng hay đầu việc được.',
        );
      }
    }
    if (typeof input.manualProgressPercent === 'number' && item.status === 'review') {
      throw new WorkspaceValidationError(
        'Công việc đang Chờ duyệt (100%); hãy báo cáo tiến độ mới để đưa việc về Đang làm.',
      );
    }
    if (touchesQuantity && (item.status === 'done' || item.status === 'cancelled') && nextMethod !== 'manual') {
      throw new WorkspaceValidationError(
        `Công việc đã ${item.status === 'done' ? 'hoàn thành' : 'huỷ'}; hãy mở lại trước khi đổi cách tính tiến độ hay khối lượng.`,
      );
    }
    if (nextMethod === 'quantity' && touchesQuantity) {
      const target = input.quantityTarget === undefined ? item.quantityTarget : input.quantityTarget;
      const unit = input.quantityUnit === undefined ? item.quantityUnit : input.quantityUnit;
      Object.assign(patch, { quantityTarget: parseQuantityTarget(target), quantityUnit: parseQuantityUnit(unit) });
    } else if (nextMethod !== 'quantity') {
      // Khối lượng chỉ có nghĩa với cách `quantity`: gửi lên khi cách khác thì bỏ, không lưu rác.
      delete (patch as { quantityTarget?: unknown }).quantityTarget;
      delete (patch as { quantityUnit?: unknown }).quantityUnit;
    }
    if (input.progressMethod !== undefined) Object.assign(patch, { progressMethod: nextMethod });
    if (
      (nextMethod === 'quantity' || nextMethod === 'checklist') &&
      ((typeof input.manualProgressPercent === 'number') || input.progressPercent !== undefined)
    ) {
      throw new WorkspaceValidationError(
        nextMethod === 'quantity'
          ? 'Tiến độ của công việc này tính theo khối lượng; hãy báo khối lượng đã làm.'
          : 'Tiến độ của công việc này tính theo đầu việc; hãy tích đầu việc.',
      );
    }
    assertDateOrder(
      input.plannedStart === undefined ? item.plannedStart : input.plannedStart,
      input.plannedEnd === undefined ? item.plannedEnd : input.plannedEnd,
    );

    // Điều kiện hoàn thành do người giao việc đặt: người nhận việc không tự gỡ hay nới điều kiện của chính mình.
    if (input.completion !== undefined) {
      if (!hasProjectRole(access, 'manager') && item.createdBy !== actor.userId) {
        throw new ProjectRoleForbiddenError('manager');
      }
      if (item.status === 'done') {
        throw new WorkspaceValidationError(
          'Công việc đã hoàn thành; mở lại công việc trước khi sửa điều kiện hoàn thành.',
        );
      }
      Object.assign(patch, {
        completion: parseCompletionInput(input.completion, item.itemType) ?? null,
      });
    }

    // Ai được hoàn tác cũng do người giao việc đặt, cùng luật với điều kiện hoàn thành. Việc đã xong thì không đổi,
    // kẻo người tạo gỡ khoá của chính việc đã chốt.
    if (input.reopenPolicy !== undefined) {
      if (!hasProjectRole(access, 'manager') && item.createdBy !== actor.userId) {
        throw new ProjectRoleForbiddenError('manager');
      }
      if (item.status === 'done' && input.reopenPolicy !== item.reopenPolicy) {
        throw new WorkspaceValidationError(
          'Công việc đã hoàn thành; mở lại công việc trước khi đổi quy định hoàn tác.',
        );
      }
      Object.assign(patch, {
        reopenPolicy: pick(input.reopenPolicy, WORK_ITEM_REOPEN_POLICIES, undefined),
      });
      if (patch.reopenPolicy === undefined) {
        throw new WorkspaceValidationError('Quy định hoàn tác không hợp lệ.');
      }
    }

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

    let updated = await this.store.workItem.update(
      actor.tenantId,
      workItemId,
      patch,
      actor.userId,
    );
    // Đổi sang (hoặc sửa mục tiêu của) cách tự tính thì tiến độ phải tính lại ngay theo dữ liệu hiện có.
    if (touchesQuantity && (nextMethod === 'quantity' || nextMethod === 'checklist')) {
      updated = (await this.writeComputedProgress(actor, updated)) ?? updated;
      // Việc đang Chờ duyệt (100%) mà số tính lại xuống dưới 100% thì không còn là "đã xong chờ duyệt": về Đang làm.
      if (updated.status === 'review' && updated.progressPercent < 100) {
        await this.changeStatus(actor, workItemId, { status: 'in_progress' }, { keepProgress: true });
        updated = (await this.store.workItem.findById(actor.tenantId, workItemId)) ?? updated;
      }
    }
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
    /** `keepProgress`: nơi gọi tự đặt tiến độ ngay sau đó (báo cáo tiến độ), nên khỏi khôi phục số của báo cáo cũ. */
    options: { readonly keepProgress?: boolean } = {},
  ): Promise<WorkItem> {
    const { item, access } = await this.load(actor, workItemId);
    assertProjectWritable(access.project);
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

    if (next === item.status) {
      // Đang Vướng mắc mà gửi lại "blocked" kèm lý do: chỉ cập nhật lý do (không phải một lần chuyển trạng thái).
      if (next === 'blocked' && typeof input.note === 'string' && input.note.trim()) {
        const reason = parseBlockedReason(input.note);
        if (reason === item.blockedReason) return item;
        const updated = await this.store.workItem.updateBlockedReason(actor.tenantId, workItemId, reason);
        // `undefined`: có người vừa chuyển việc sang trạng thái khác; trả bản mới nhất thay vì đè lý do.
        return updated ?? (await this.load(actor, workItemId)).item;
      }
      return item;
    }
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

    // Chuyển sang Vướng mắc bắt buộc có lý do; lý do đi cùng dòng nhật ký để tab Hoạt động hiện lại được.
    const blockedReason = next === 'blocked' ? parseBlockedReason(input.note) : undefined;

    // Hoàn tác việc đã hoàn thành: theo quy định người tạo việc đặt (xem `WorkItemReopenPolicy`).
    const reopening = item.status === 'done';
    if (reopening) assertCanReopen(access, item, actor.userId);

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

    // 4 — điều kiện hoàn thành. Server là nơi chặn thật: nút bị khoá ở giao diện không thay được việc này.
    const completionEvidence =
      next === 'done'
        ? evaluateCompletion(
            item.completion,
            Array.isArray(input.confirmedConditionIds) ? input.confirmedConditionIds : undefined,
          )
        : undefined;

    // 5 và 6 — mốc thực tế và nhật ký ghi trong cùng một transaction ở store.
    // Vào Hoàn thành / Chờ duyệt thì store đặt 100% và bỏ số nhập tay: ghi lại số hiện có thành một báo cáo để mở lại
    // sau này còn khôi phục được (xem `restoreProgress`).
    if (!options.keepProgress && (next === 'done' || next === 'review') && item.status !== 'done' && item.status !== 'review') {
      await this.snapshotProgress(actor, item);
    }
    let updated = await this.store.workItem.changeStatus(
      actor.tenantId,
      workItemId,
      actor.userId,
      next,
      blockedReason ?? (input.note?.trim() || undefined),
      todayKey(timezoneOf(actor.tenantId)),
      completionEvidence,
    );
    // Rời Hoàn thành / Chờ duyệt về Đang làm: store đưa tiến độ về 0%; có báo cáo trước đó thì trả về số của báo cáo
    // gần nhất thay vì mất hết (việc có con thì tiến độ tính lại từ con, không khôi phục).
    const selfComputing = (item.progressMethod ?? 'manual') === 'quantity' || item.progressMethod === 'checklist';
    if (!options.keepProgress && selfComputing && (next === 'todo' || next === 'in_progress')) {
      // Khối lượng và đầu việc vẫn còn nguyên dữ liệu: tiến độ lấy lại từ đó, không cần lịch sử báo cáo.
      const recomputed = await this.writeComputedProgress(actor, updated);
      if (recomputed) updated = recomputed;
    } else if (
      !options.keepProgress &&
      next === 'in_progress' &&
      (item.status === 'done' || item.status === 'review')
    ) {
      const restored = await this.restoreProgress(actor, item);
      if (restored) updated = restored;
    }
    if (reopening) {
      // Việc con được hoàn tác thì các cha đã xong phía trên không còn đúng là đã xong: mở lại luôn (từ ngoài vào trong).
      // Đây là hệ quả của việc hoàn tác, không phải thao tác riêng nên không kiểm quyền hoàn tác của từng cha.
      const all = await this.store.workItem.listByProject(actor.tenantId, item.projectId);
      const parentNode = item.parentId ? all.find((node) => node.id === item.parentId) : undefined;
      const today = todayKey(timezoneOf(actor.tenantId));
      for (const ancestor of parentNode ? [...doneChain(all, parentNode)].reverse() : []) {
        await this.store.workItem.changeStatus(
          actor.tenantId,
          ancestor.id,
          actor.userId,
          'in_progress',
          `Mở lại vì công việc con ${item.code} được hoàn tác.`,
          today,
        );
      }
      // Dự án đã Hoàn thành mà có việc được hoàn tác: về Đang chạy hay giữ nguyên, theo cài đặt của tenant.
      await this.projects.onItemReopened(actor.tenantId, actor.userId, item.projectId);
    }
    await this.recalculate(actor, item.projectId);
    // Công việc bị huỷ thì trả xe đã giữ.
    if (next === 'cancelled') await this.fleet?.release(actor.tenantId, 'WORK_ITEM', workItemId);
    return updated;
  }

  /**
   * Lưu số tiến độ hiện có thành một báo cáo trước khi Hoàn thành / Chờ duyệt ghi đè nó, nếu số đó chưa nằm sẵn trong
   * lịch sử (tiến độ đặt bằng cách sửa trực tiếp, hoặc đã đổi sau báo cáo cuối vì về Chưa làm). Bỏ qua việc có việc con
   * (tiến độ tính từ con), số 0% hoặc 100%.
   */
  private async snapshotProgress(actor: WorkspaceActor, item: WorkItem): Promise<void> {
    if ((item.progressMethod ?? 'manual') === 'quantity' || item.progressMethod === 'checklist') return;
    if (item.progressPercent <= 0 || item.progressPercent >= 100) return;
    const all = await this.store.workItem.listByProject(actor.tenantId, item.projectId);
    if (all.some((node) => node.parentId === item.id && node.status !== 'cancelled')) return;
    const [latest] = await this.store.workItem.listProgressReports(actor.tenantId, item.id);
    if (latest?.percent === item.progressPercent) return;
    await this.store.workItem.addProgressReport(actor.tenantId, {
      workItemId: item.id,
      projectId: item.projectId,
      reportedBy: actor.userId,
      reportedOn: todayKey(timezoneOf(actor.tenantId)),
      percent: item.progressPercent,
      description: 'Tiến độ trước khi chuyển trạng thái.',
    });
  }

  /** Khôi phục tiến độ theo báo cáo gần nhất chưa tới 100%; `undefined` khi không có gì để khôi phục. */
  private async restoreProgress(actor: WorkspaceActor, item: WorkItem): Promise<WorkItem | undefined> {
    const all = await this.store.workItem.listByProject(actor.tenantId, item.projectId);
    if (all.some((node) => node.parentId === item.id && node.status !== 'cancelled')) return undefined;
    const percent = progressToRestore(await this.store.workItem.listProgressReports(actor.tenantId, item.id));
    if (percent === undefined) return undefined;
    return this.store.workItem.update(actor.tenantId, item.id, { manualProgressPercent: percent }, actor.userId);
  }

  /** Lịch sử báo cáo tiến độ của công việc (mới nhất trước); ai xem được công việc thì xem được. */
  async progressReports(actor: WorkspaceActor, workItemId: string): Promise<readonly WorkItemProgressReport[]> {
    await this.load(actor, workItemId);
    return this.store.workItem.listProgressReports(actor.tenantId, workItemId);
  }

  /**
   * Báo cáo tiến độ (bám 1Office): ghi một dòng lịch sử và đưa tiến độ + trạng thái của công việc về khớp với con số.
   *
   *  · 100%  → chuyển sang trạng thái tenant chọn (Hoàn thành hoặc Chờ duyệt); việc đang Chưa làm hay Vướng mắc đi qua
   *            Đang làm trước vì bảng chuyển trạng thái không cho nhảy thẳng.
   *  · 1–99% → việc đang Chưa làm tự sang Đang làm (nếu tenant bật); việc đang Chờ duyệt quay về Đang làm.
   *  · 0%    → chỉ đặt số, không đổi trạng thái.
   * Việc có việc con không báo cáo trực tiếp (tiến độ tự tính từ con); việc đã đóng phải mở lại trước.
   *
   * Cách tính tiến độ của việc quyết định ai đặt con số:
   *  · `manual` (và `child_weight` ở việc lá): người báo gửi `percent`;
   *  · `quantity`: người báo gửi `quantityDone`, server tính % = đã làm / cần làm;
   *  · `checklist`: không báo trực tiếp, tiến độ theo đầu việc đã tích (`origin: 'computed'` do chính server gọi sau
   *    mỗi lần tích đầu việc, và khi đó con số tự ghi vào cột tự tính chứ không phải số nhập tay).
   *
   * Trạng thái đổi trước, tiến độ và dòng lịch sử ghi sau. Những gì chặn được Hoàn thành (điều kiện hoàn thành, tiền
   * nhiệm FS chưa xong) được kiểm trước khi đổi bất cứ gì, nên bị chặn thì không có gì được ghi; các lỗi bất ngờ giữa
   * chừng (mất kết nối…) không nằm chung một transaction, có thể để lại trạng thái đã đổi mà chưa có dòng lịch sử.
   */
  async reportProgress(
    actor: WorkspaceActor,
    workItemId: string,
    input: ReportWorkItemProgressRequest,
    origin: 'user' | 'computed' = 'user',
  ): Promise<WorkItem> {
    const { item, access } = await this.load(actor, workItemId);
    assertProjectWritable(access.project);
    // Quản lý và người phụ trách / cùng làm được đổi trạng thái; người chỉ là người tạo việc thì checklist chỉ đổi phần trăm.
    const mayMoveStatus = hasProjectRole(access, 'manager') || isOwnItem(item, actor.userId);
    // `computed` chỉ do server gọi sau khi `editableChecklistItem` đã kiểm quyền; nó chỉ được ghi phần trăm, không mở đường đổi trạng thái.
    if (origin !== 'computed' && !mayMoveStatus) {
      throw new WorkItemAssigneeOnlyError();
    }
    const percentOnly = origin === 'computed' && !mayMoveStatus;
    requireProjectRole(access, 'member');
    if (item.reversal) {
      throw new WorkspaceValidationError(
        'Công việc đã huỷ hiệu lực, không báo cáo tiến độ được; hãy lập công việc điều chỉnh.',
      );
    }
    if (origin === 'user') {
      const manualGate = manualProgressBlockedMessage(
        await this.projects.procedureLinkSettings(actor.tenantId),
        item.executionType,
      );
      if (manualGate) throw new WorkspaceValidationError(manualGate);
    }
    const method = item.progressMethod ?? 'manual';
    const computedMethod = method === 'quantity' || method === 'checklist';
    let percent: number;
    let quantityDone: number | undefined;
    if (origin === 'computed') {
      percent = parseReportPercent(input?.percent);
    } else if (method === 'checklist') {
      throw new WorkspaceValidationError(
        'Tiến độ của công việc này tự tính theo đầu việc; hãy tích đầu việc thay vì báo phần trăm.',
      );
    } else if (method === 'quantity') {
      quantityDone = parseQuantityDone(input?.quantityDone);
      percent = quantityPercent(quantityDone, item.quantityTarget);
    } else {
      if (input?.quantityDone !== undefined) {
        throw new WorkspaceValidationError('Công việc này không tính tiến độ theo khối lượng.');
      }
      percent = parseReportPercent(input?.percent);
    }
    const description = parseReportDescription(input?.description);
    const today = todayKey(timezoneOf(actor.tenantId));
    const reportedOn = parseReportDate(input?.reportedOn, today);
    if (item.status === 'done' || item.status === 'cancelled') {
      throw new WorkspaceValidationError(
        `Công việc đã ${item.status === 'done' ? 'hoàn thành' : 'huỷ'}; hãy mở lại trước khi báo cáo tiến độ.`,
      );
    }
    const all = await this.store.workItem.listByProject(actor.tenantId, item.projectId);
    if (all.some((node) => node.parentId === item.id && node.status !== 'cancelled')) {
      throw new WorkspaceValidationError(
        'Công việc có việc con nên tiến độ tự tính từ các việc con; hãy báo cáo ở từng việc con.',
      );
    }

    const settings = await this.projects.progressReportSettings(actor.tenantId);
    const completing = percent === 100;
    // Tích đầu việc là thao tác máy: không đòi mô tả như một lần người báo hoàn thành.
    if (completing && origin === 'user' && settings.requireDescription && !description) {
      throw new WorkspaceValidationError('Hãy ghi mô tả khi báo hoàn thành công việc.');
    }
    let target = completing && !percentOnly ? settings.completeStatus : undefined;
    if (target === 'done' && (item.completion?.conditions.length ?? 0) > 0) {
      // Người báo thì dừng lại để họ xác nhận điều kiện; tích đầu việc thì chỉ đặt 100%, việc vẫn chờ người bấm Hoàn thành.
      if (origin === 'user') {
        throw new WorkspaceValidationError(
          'Công việc có điều kiện hoàn thành; hãy bấm "Hoàn thành" để xác nhận từng điều kiện.',
        );
      }
      target = undefined;
    }

    // Kiểm trước những gì có thể chặn bước Hoàn thành, để không có chuyện đã sang Đang làm rồi mới bị từ chối.
    if (target === 'done') {
      const edges = await this.store.dependency.listBySuccessor(actor.tenantId, workItemId);
      for (const edge of edges.filter((candidate) => candidate.dependencyType === 'FS')) {
        const predecessor = await this.store.workItem.findById(actor.tenantId, edge.predecessorId);
        if (predecessor && predecessor.status !== 'done') {
          // Tích đầu việc đã được lưu rồi: không thể từ chối nữa, nên chỉ đặt 100% và việc chờ tiền nhiệm xong mới bấm
          // Hoàn thành được. Người báo trực tiếp thì bị từ chối như thường.
          if (origin === 'computed') {
            target = undefined;
            break;
          }
          throw new DependencyBlockedError(predecessor.code);
        }
      }
    }

    let status: WorkItemStatus = item.status;
    const move = async (to: WorkItemStatus, note?: string) => {
      await this.changeStatus(actor, workItemId, { status: to, note }, { keepProgress: true });
      status = to;
    };
    if (target) {
      if (status === 'todo' || status === 'blocked') await move('in_progress');
      if (status !== target) await move(target, description);
      // Hoàn thành / Chờ duyệt đã tự đặt 100% ở store; khối lượng đã làm vẫn phải lưu lại.
      if (quantityDone !== undefined) {
        await this.store.workItem.update(actor.tenantId, workItemId, { quantityDone }, actor.userId);
      }
    } else {
      if (!percentOnly) {
        if (status === 'review' && !completing) await move('in_progress');
        else if (status === 'todo' && percent > 0 && settings.startsWork) await move('in_progress');
      }
      // Việc tính theo khối lượng / đầu việc: số là số tự tính (nhật ký ghi như một lần đổi tiến độ), không phải số nhập tay.
      await this.store.workItem.update(
        actor.tenantId,
        workItemId,
        computedMethod
          ? { progressPercent: percent, manualProgressPercent: null, ...(quantityDone === undefined ? {} : { quantityDone }) }
          : { manualProgressPercent: percent },
        actor.userId,
      );
    }
    await this.store.workItem.addProgressReport(actor.tenantId, {
      workItemId,
      projectId: item.projectId,
      reportedBy: actor.userId,
      reportedOn,
      percent,
      quantityDone,
      description,
    });
    await this.recalculate(actor, item.projectId);
    return (await this.store.workItem.findById(actor.tenantId, workItemId)) ?? item;
  }

  /** Danh sách đầu việc của công việc; ai xem được công việc thì xem được. */
  async checklist(actor: WorkspaceActor, workItemId: string): Promise<readonly WorkItemChecklistItem[]> {
    await this.load(actor, workItemId);
    return this.store.workItem.listChecklist(actor.tenantId, workItemId);
  }

  /**
   * Quyền và điều kiện để sửa đầu việc: manager, người phụ trách / cùng làm hoặc người tạo việc (đều phải là thành
   * viên dự án). Công việc phải tính tiến độ theo đầu việc; riêng lúc thêm (`switchFromManual`), việc đang `manual`
   * được tự chuyển sang `checklist`.
   */
  private async editableChecklistItem(
    actor: WorkspaceActor,
    workItemId: string,
    options: { readonly switchFromManual?: boolean } = {},
  ): Promise<WorkItem> {
    const { item, access } = await this.load(actor, workItemId);
    assertProjectWritable(access.project);
    if (!hasProjectRole(access, 'manager') && !isOwnItem(item, actor.userId) && item.createdBy !== actor.userId) {
      throw new WorkItemAssigneeOnlyError(
        'Chỉ quản lý dự án, người phụ trách hoặc người tạo công việc mới sửa được đầu việc.',
      );
    }
    requireProjectRole(access, 'member');
    if (item.reversal) {
      throw new WorkspaceValidationError('Công việc đã huỷ hiệu lực, không sửa được đầu việc.');
    }
    const method = item.progressMethod ?? 'manual';
    const canSwitch = options.switchFromManual === true && method === 'manual';
    if (method !== 'checklist' && !canSwitch) {
      throw new WorkspaceValidationError(
        method === 'quantity'
          ? 'Công việc này tính tiến độ theo khối lượng; hãy đổi cách tính tiến độ sang đầu việc trước.'
          : 'Công việc này không tính tiến độ theo đầu việc; hãy đổi cách tính tiến độ trước.',
      );
    }
    if (item.status === 'done' || item.status === 'cancelled') {
      throw new WorkspaceValidationError(
        `Công việc đã ${item.status === 'done' ? 'hoàn thành' : 'huỷ'}; hãy mở lại trước khi sửa đầu việc.`,
      );
    }
    const siblings = await this.store.workItem.listByProject(actor.tenantId, item.projectId);
    if (siblings.some((node) => node.parentId === item.id && node.status !== 'cancelled')) {
      throw new WorkspaceValidationError('Công việc có việc con nên tiến độ tự tính từ các việc con, không theo đầu việc.');
    }
    return item;
  }

  /** Đưa tiến độ của việc về khớp với tỷ lệ đầu việc đã tích (chỉ ghi khi số đổi hoặc việc cần sang trạng thái mới). */
  private async syncChecklistProgress(
    actor: WorkspaceActor,
    workItemId: string,
    options: { readonly forceReport?: boolean } = {},
  ): Promise<void> {
    const items = await this.store.workItem.listChecklist(actor.tenantId, workItemId);
    const done = items.filter((entry) => entry.done).length;
    const percent = checklistPercent(done, items.length);
    const fresh = await this.store.workItem.findById(actor.tenantId, workItemId);
    if (!fresh) return;
    const settled = fresh.status === 'done' || fresh.status === 'review';
    if (!options.forceReport && percent === fresh.progressPercent && !(percent === 100 && !settled)) return;
    await this.reportProgress(
      actor,
      workItemId,
      { percent, description: `Đầu việc đã xong: ${done}/${items.length}.` },
      'computed',
    );
  }

  async addChecklistItems(
    actor: WorkspaceActor,
    workItemId: string,
    titles: readonly string[],
  ): Promise<readonly WorkItemChecklistItem[]> {
    const item = await this.editableChecklistItem(actor, workItemId, { switchFromManual: true });
    if (item.itemType !== 'task') {
      throw new WorkspaceValidationError(
        `${item.itemType === 'phase' ? 'Giai đoạn' : 'Cột mốc'} không có đầu việc; chỉ công việc mới thêm được đầu việc.`,
      );
    }
    const parsed = parseChecklistTitles(titles);
    if (parsed.length === 0) throw new WorkspaceValidationError('Nhập tên ít nhất một đầu việc.');
    const existing = await this.store.workItem.listChecklist(actor.tenantId, workItemId);
    if (existing.length + parsed.length > MAX_CHECKLIST_ITEMS) {
      throw new WorkspaceValidationError(`Một công việc có tối đa ${MAX_CHECKLIST_ITEMS} đầu việc.`);
    }
    // Thêm hàng đầu việc trước: nếu lỗi thì công việc còn nguyên cách tính và số nhập tay.
    await this.store.workItem.addChecklistItems(actor.tenantId, workItemId, parsed);
    const switching = (item.progressMethod ?? 'manual') === 'manual';
    if (switching) {
      // Đầu việc đầu tiên: tiến độ từ đây tính theo đầu việc (bỏ số nhập tay), giống đổi cách tính ở `update`.
      await this.store.workItem.update(actor.tenantId, workItemId, { progressMethod: 'checklist' }, actor.userId);
    }
    // Thêm đầu việc chưa tích làm tỷ lệ giảm đi: tính lại. Vừa đổi cách tính thì luôn ghi một báo cáo phản ánh số mới
    // (kể cả khi trùng số cũ), việc Chờ duyệt mà tính lại dưới 100% thì về Đang làm theo luật báo cáo.
    await this.syncChecklistProgress(actor, workItemId, { forceReport: switching });
    await this.recalculate(actor, item.projectId);
    return this.store.workItem.listChecklist(actor.tenantId, workItemId);
  }

  async updateChecklistItem(
    actor: WorkspaceActor,
    workItemId: string,
    itemId: string,
    patch: { readonly title?: string; readonly done?: boolean },
  ): Promise<readonly WorkItemChecklistItem[]> {
    const item = await this.editableChecklistItem(actor, workItemId);
    if (patch?.done !== undefined && typeof patch.done !== 'boolean') {
      throw new WorkspaceValidationError('Trạng thái đầu việc không hợp lệ.');
    }
    const title = patch?.title === undefined ? undefined : parseChecklistTitle(patch.title);
    if (title === undefined && patch?.done === undefined) {
      throw new WorkspaceValidationError('Không có gì để cập nhật.');
    }
    const updated = await this.store.workItem.updateChecklistItem(
      actor.tenantId,
      workItemId,
      itemId,
      { title, done: patch.done },
      actor.userId,
    );
    if (!updated) throw new WorkspaceValidationError('Không tìm thấy đầu việc này trong công việc.');
    if (patch.done !== undefined) {
      await this.syncChecklistProgress(actor, workItemId);
      await this.recalculate(actor, item.projectId);
    }
    return this.store.workItem.listChecklist(actor.tenantId, workItemId);
  }

  async removeChecklistItem(
    actor: WorkspaceActor,
    workItemId: string,
    itemId: string,
  ): Promise<readonly WorkItemChecklistItem[]> {
    const item = await this.editableChecklistItem(actor, workItemId);
    if (!(await this.store.workItem.removeChecklistItem(actor.tenantId, workItemId, itemId))) {
      throw new WorkspaceValidationError('Không tìm thấy đầu việc này trong công việc.');
    }
    await this.syncChecklistProgress(actor, workItemId);
    await this.recalculate(actor, item.projectId);
    return this.store.workItem.listChecklist(actor.tenantId, workItemId);
  }

  /**
   * Tiến độ tính từ dữ liệu của cách `quantity` / `checklist`; `undefined` với các cách còn lại (người báo tự đặt hoặc
   * tính từ việc con).
   */
  private async computedPercent(actor: WorkspaceActor, item: WorkItem): Promise<number | undefined> {
    const method = item.progressMethod ?? 'manual';
    if (method === 'quantity') return quantityPercent(item.quantityDone ?? 0, item.quantityTarget);
    if (method === 'checklist') {
      const items = await this.store.workItem.listChecklist(actor.tenantId, item.id);
      return checklistPercent(items.filter((entry) => entry.done).length, items.length);
    }
    return undefined;
  }

  /** Ghi lại tiến độ tự tính vào cột tự tính (bỏ số nhập tay); trả bản mới, hoặc `undefined` nếu cách tính không tự tính. */
  private async writeComputedProgress(actor: WorkspaceActor, item: WorkItem): Promise<WorkItem | undefined> {
    const percent = await this.computedPercent(actor, item);
    if (percent === undefined) return undefined;
    return this.store.workItem.update(
      actor.tenantId,
      item.id,
      { progressPercent: percent, manualProgressPercent: null },
      actor.userId,
    );
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
    assertProjectWritable(access.project);
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

  /**
   * Hồ sơ Quy trình gắn công việc vừa bắt đầu / hoàn tất / bị từ chối / bị huỷ / bị xoá → đổi công việc theo cài đặt
   * liên kết của tenant (`procedureLink`). Chạy từ sự kiện nên không kiểm vai trò dự án, không ném lỗi nghiệp vụ
   * (không đi được thì bỏ qua) và gọi lại không làm gì thêm: mọi quyết định dựa trên trạng thái hiện tại của việc.
   */
  async applyProcedureOutcome(
    tenantId: string,
    workItemId: string,
    kind: ProcedureOutcomeKind,
    input: { readonly instanceCode: string },
  ): Promise<void> {
    const item = await this.store.workItem.findById(tenantId, workItemId);
    if (!item || item.reversal || item.status === 'cancelled') return;
    const settings = await this.projects.procedureLinkSettings(tenantId);
    const system: WorkspaceActor = {
      tenantId,
      userId: STANDALONE_TASK_SYSTEM_ACTOR_ID,
      displayName: 'Hệ thống',
      isTenantAdmin: true,
      canManage: false,
      canWriteTasks: true,
      canWriteDocuments: false,
      canDeleteDocuments: false,
    };
    const note = procedureOutcomeNote(kind, input.instanceCode);

    if (kind === 'completed' && settings.onCompletedWorkItem === 'progress100') {
      await this.setProgressFull(system, item);
      return;
    }
    const target = workItemOutcomeTarget(kind, settings);
    if (!target || item.status === target) return;
    // Việc đã đóng không tự đổi lại; hồ sơ bắt đầu chỉ đưa việc Chưa làm sang Đang làm.
    if (item.status === 'done') return;
    if (kind === 'started' && item.status !== 'todo') return;
    // Không bao giờ đóng hay đẩy duyệt việc còn việc con chưa đóng: tiến độ của nó tính từ việc con.
    if (
      (isClosedStatus(target) || kind === 'completed') &&
      (await this.store.workItem.openChildCount(tenantId, item.id)) > 0
    ) {
      return;
    }
    if (kind === 'completed' && target === 'done' && settings.completedGuards === 'respect') {
      if (await this.completionBlocked(tenantId, item)) {
        await this.setProgressFull(system, item);
        return;
      }
    }
    const path = statusPath(item.status, target);
    if (!path || path.length === 0) return;

    if (!['done', 'review'].includes(item.status) && (target === 'done' || target === 'review')) {
      await this.snapshotProgress(system, item);
    }
    const today = todayKey(timezoneOf(tenantId));
    let blockedReason: string | undefined;
    if (target === 'blocked') blockedReason = parseBlockedReason(note);
    try {
      for (const step of path) {
        await this.store.workItem.changeStatus(
          tenantId,
          item.id,
          system.userId,
          step,
          step === 'blocked' ? blockedReason : note,
          today,
        );
      }
    } catch (error) {
      if (error instanceof WorkspaceValidationError) return;
      throw error;
    }
    if (item.status === 'review' && (target === 'todo' || target === 'in_progress')) {
      const fresh = await this.store.workItem.findById(tenantId, item.id);
      const computed = (item.progressMethod ?? 'manual') === 'quantity' || item.progressMethod === 'checklist';
      if (fresh) {
        if (computed) await this.writeComputedProgress(system, fresh);
        else await this.restoreProgress(system, item);
      }
    }
    await this.recalculate(system, item.projectId);
    if (target === 'cancelled') await this.fleet?.release(tenantId, 'WORK_ITEM', item.id);
  }

  /**
   * Hồ sơ Quy trình của công việc vừa kết thúc (liên kết ngoài đã ghi trạng thái kết thúc): đánh giá lại cây, vì công
   * việc cha đang chờ hồ sơ (`parentWaitsForProcedure = wait`) có thể đã đủ điều kiện tự đóng — việc con đã xong từ
   * trước, giờ hồ sơ hoàn tất (hoặc bị từ chối / hủy mà cài đặt cho thôi chờ). Gọi lại không làm gì thêm: cha đã đóng thì không còn trong danh sách cần đổi.
   */
  async reevaluateAfterProcedureCompleted(tenantId: string, workItemId: string): Promise<void> {
    const item = await this.store.workItem.findById(tenantId, workItemId);
    if (!item || item.reversal || item.status === 'cancelled') return;
    const system: WorkspaceActor = {
      tenantId,
      userId: STANDALONE_TASK_SYSTEM_ACTOR_ID,
      displayName: 'Hệ thống',
      isTenantAdmin: true,
      canManage: false,
      canWriteTasks: true,
      canWriteDocuments: false,
      canDeleteDocuments: false,
    };
    await this.recalculate(system, item.projectId);
  }

  /** Còn tiền nhiệm FS chưa xong hoặc điều kiện hoàn thành cần người xác nhận: việc không tự Hoàn thành được. */
  private async completionBlocked(tenantId: string, item: WorkItem): Promise<boolean> {
    if (item.completion && item.completion.conditions.length > 0) return true;
    const edges = await this.store.dependency.listBySuccessor(tenantId, item.id);
    for (const edge of edges.filter((candidate) => candidate.dependencyType === 'FS')) {
      const predecessor = await this.store.workItem.findById(tenantId, edge.predecessorId);
      if (predecessor && predecessor.status !== 'done') return true;
    }
    return false;
  }

  /**
   * Đặt tiến độ 100% mà giữ nguyên trạng thái. Việc có việc con, hoặc tính theo khối lượng / đầu việc, có số tự
   * tính từ dữ liệu của chúng nên bỏ qua.
   */
  private async setProgressFull(actor: WorkspaceActor, item: WorkItem): Promise<void> {
    if (item.progressPercent >= 100 || item.status === 'cancelled') return;
    if ((item.progressMethod ?? 'manual') === 'quantity' || item.progressMethod === 'checklist') return;
    const all = await this.store.workItem.listByProject(actor.tenantId, item.projectId);
    if (all.some((node) => node.parentId === item.id && node.status !== 'cancelled')) return;
    await this.store.workItem.update(actor.tenantId, item.id, { manualProgressPercent: 100 }, actor.userId);
    await this.recalculate(actor, item.projectId);
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
    assertProjectWritable(access.project);
    requireProjectRole(access, 'manager');

    const nodes = await this.store.workItem.listByProject(actor.tenantId, item.projectId);
    const parentId = input.parentId ?? null;
    const parent = parentId ? nodes.find((node) => node.id === parentId) : undefined;
    if (parentId && !parent) throw new WorkItemNotFoundError(parentId);
    // Kiểm tra chu trình và giới hạn độ sâu của node SÂU NHẤT trong nhánh.
    assertMoveAllowed(nodes, workItemId, parent);
    // Đưa việc chưa xong vào cha đã hoàn thành thì cha không còn đúng: người dùng phải đồng ý mở lại cha (và các cha đã
    // xong phía trên), như khi tạo việc con. Kiểm quyền mở lại trước khi ghi để từ chối không để lại việc dở dang.
    const reopenChain =
      parent?.status === 'done' && item.status !== 'done' && item.status !== 'cancelled' ? doneChain(nodes, parent) : [];
    if (reopenChain.length > 0) {
      if (input.reopenParent !== true) throw new ParentItemDoneError(reopenChain[0].code);
      for (const node of reopenChain) assertCanReopen(access, node, actor.userId);
    }

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
    if (reopenChain.length > 0) {
      await this.reopenDoneChain(actor, item.projectId, reopenChain, {
        trigger: 'child-moved',
        childCode: item.code,
        childTitle: item.title,
      });
    }
    await this.recalculate(actor, item.projectId);
    return moved;
  }

  /**
   * Đưa chuỗi công việc đã hoàn thành về "Đang làm" vì có việc con vừa vào dưới nó (thêm mới hoặc chuyển tới), từ cha
   * ngoài cùng xuống để nhật ký đọc đúng thứ tự mở. Mỗi việc được mở lại phát một thông báo cho người giao, người phụ
   * trách và người cùng thực hiện, nói rõ ai làm và vì sao. Tiến độ cha tính lại ở `recalculate` của nơi gọi.
   */
  private async reopenDoneChain(
    actor: WorkspaceActor,
    projectId: string,
    chain: readonly WorkItem[],
    cause: { trigger: 'child-moved' | 'child-added'; childCode: string; childTitle: string },
  ): Promise<void> {
    const today = todayKey(timezoneOf(actor.tenantId));
    const moved = cause.trigger === 'child-moved';
    const note = moved
      ? `Mở lại vì công việc con ${cause.childCode} được chuyển vào.`
      : `Mở lại để thêm công việc con ${cause.childCode}.`;
    const reason = moved
      ? `${actor.displayName} đã chuyển công việc ${cause.childCode} · ${cause.childTitle} vào làm việc con của công việc này, nên công việc được mở lại về "Đang làm" và tiến độ được tính lại.`
      : `${actor.displayName} đã thêm công việc con ${cause.childCode} · ${cause.childTitle} vào công việc này, nên công việc được mở lại về "Đang làm" và tiến độ được tính lại.`;
    for (const node of [...chain].reverse()) {
      await this.store.workItem.changeStatus(
        actor.tenantId,
        node.id,
        actor.userId,
        'in_progress',
        note,
        today,
        undefined,
        { ...cause, reason },
      );
    }
    await this.projects.onItemReopened(actor.tenantId, actor.userId, projectId);
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
    assertProjectWritable(access.project);
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
    assertProjectWritable(access.project);
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
    const method =
      (await this.store.project.findById(actor.tenantId, projectId))?.progressMethod ??
      LEGACY_PROJECT_PROGRESS_METHOD;
    const nodes: ProgressNode[] = rows.map((row) => ({
      id: row.id,
      parentId: row.parentId,
      status: row.status,
      progressPercent: row.progressPercent,
      manualPercent: row.manualPercent,
      estimateHours: row.estimateHours,
      weight: row.weight,
      plannedStart: row.plannedStart,
      plannedEnd: row.plannedEnd,
      method: row.method,
      equalChildWeight: row.equalChildWeight,
      requiresConfirmation: row.requiresConfirmation,
      procedureState: row.procedureState,
    }));

    const changed = rollUpProgress(nodes);
    await this.store.workItem.applyProgress(actor.tenantId, changed);

    // Công việc cha tự đổi trạng thái khi mọi việc con đã xong, theo cài đặt liên kết Quy trình của tenant (mặc định:
    // tự Hoàn thành; cha có hồ sơ riêng có thể chờ hồ sơ hoàn tất). Gọi thẳng store (không qua `changeStatus` của
    // service) nên không lặp lại recalculate, và cũng không vướng hàng rào "việc con chưa đóng" — ở đây con đã xong hết.
    // Cài đặt chỉ làm tập cần đổi nhỏ đi so với mặc định, nên không có ứng viên thì khỏi đọc cài đặt.
    let closeTarget: ProcedureLinkOnAllChildrenDone = 'done';
    let toClose = autoCompleteParents(nodes);
    if (toClose.size > 0) {
      const linkSettings = await this.projects.procedureLinkSettings(actor.tenantId);
      closeTarget = linkSettings.onAllChildrenDone;
      toClose = autoCompleteParents(nodes, { target: closeTarget, ...parentProcedureWaitRules(linkSettings) });
    }
    const toComplete = closeTarget === 'done' ? toClose : new Set<string>();
    if (toClose.size > 0) {
      const today = todayKey(timezoneOf(actor.tenantId));
      for (const parentId of toClose) {
        if (closeTarget === 'done') {
          await this.store.workItem.changeStatus(
            actor.tenantId,
            parentId,
            actor.userId,
            'done',
            'Tự động hoàn thành khi mọi công việc con đã xong.',
            today,
          );
          continue;
        }
        const from = nodes.find((node) => node.id === parentId)?.status;
        const path = from ? statusPath(from, 'review') : undefined;
        try {
          for (const step of path ?? []) {
            await this.store.workItem.changeStatus(
              actor.tenantId,
              parentId,
              actor.userId,
              step,
              'Tự chuyển Chờ duyệt khi mọi công việc con đã xong.',
              today,
            );
          }
        } catch (error) {
          if (!(error instanceof WorkspaceValidationError)) throw error;
        }
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
    await this.store.project.updateProgress(
      actor.tenantId,
      projectId,
      projectProgress(updated, method),
    );
    // Mọi việc đã xong hoặc đã huỷ: tự đóng hồ sơ nếu tenant bật tuỳ chọn ở Cài đặt.
    await this.projects.autoArchiveIfDone(
      actor.tenantId,
      projectId,
      updated.map((node) => node.status),
    );
  }
}

/**
 * `node` và các công việc cha đã hoàn thành liên tiếp phía trên nó, từ gần đến xa. Dừng ở cha đầu tiên chưa xong:
 * từ đó trở lên không còn mâu thuẫn "cha xong mà con đang làm".
 */
function doneChain(all: readonly WorkItem[], node: WorkItem): WorkItem[] {
  const byId = new Map(all.map((item) => [item.id, item]));
  const chain: WorkItem[] = [];
  for (let current: WorkItem | undefined = node; current?.status === 'done'; ) {
    chain.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}

/**
 * Người gọi có được hoàn tác công việc đã hoàn thành không. `none`: không ai (kể cả quản lý); `manager`: chỉ quản
 * lý dự án; `assignee`: thêm người phụ trách và người cùng thực hiện.
 */
function assertCanReopen(access: ProjectAccess, item: WorkItem, userId: string): void {
  const policy = item.reopenPolicy ?? DEFAULT_WORK_ITEM_REOPEN_POLICY;
  if (policy === 'none') throw new ReopenNotAllowedError(item.code, 'none');
  if (hasProjectRole(access, 'manager')) return;
  if (policy === 'manager') throw new ReopenNotAllowedError(item.code, 'manager');
  if (!isOwnItem(item, userId)) throw new WorkItemAssigneeOnlyError();
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

/** Giờ ước lượng: số lớn hơn 0 và tối đa `MAX_WORK_ITEM_ESTIMATE_HOURS`; `null`/vắng nghĩa là chưa đặt hoặc bỏ. */
export function assertEstimateHours(hours: number | null | undefined): void {
  if (hours === null || hours === undefined) return;
  const value = Number(hours);
  if (!Number.isFinite(value) || !(value > 0)) {
    throw new WorkspaceValidationError('Giờ ước lượng phải là số lớn hơn 0.');
  }
  if (value > MAX_WORK_ITEM_ESTIMATE_HOURS) {
    throw new WorkspaceValidationError('Giờ ước lượng tối đa là 99.999,99 giờ.');
  }
}

/** Tỷ trọng: số không âm, tối đa `MAX_WORK_ITEM_WEIGHT`; `null`/vắng nghĩa là chưa đặt. */
function assertWeight(weight: number | null | undefined): void {
  if (weight === null || weight === undefined) return;
  const value = Number(weight);
  if (!Number.isFinite(value) || value < 0 || value > MAX_WORK_ITEM_WEIGHT) {
    throw new WorkspaceValidationError(`Tỷ trọng phải là số từ 0 đến ${MAX_WORK_ITEM_WEIGHT}.`);
  }
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
