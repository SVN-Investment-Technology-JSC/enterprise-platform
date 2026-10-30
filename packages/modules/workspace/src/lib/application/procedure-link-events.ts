import {
  PROCEDURE_ATTACHMENT_ADDED,
  PROCEDURE_INSTANCE_DELETED,
  PROCEDURE_WORKSPACE_RELINK_REQUESTED,
  type ProcedureAttachmentAddedPayload,
  type ProcedureInstanceDeletedPayload,
  type ProcedureRelinkRequestedPayload,
  PROCEDURE_INSTANCE_COMPLETED,
  PROCEDURE_INSTANCE_REVERSED,
  PROCEDURE_STANDALONE_TASK_START_REJECTED,
  PROCEDURE_STARTED_FOR_STANDALONE_TASK,
  STANDALONE_TASK_PROCEDURE_SOURCE,
  type ProcedureInstanceCompletedPayload,
  type ProcedureStandaloneTaskStartRejectedPayload,
  type ProcedureStartedForStandaloneTaskPayload,
  PROCEDURE_STARTED_FOR_WORK_ITEM,
  PROCEDURE_WORK_ITEM_START_REJECTED,
  PROCEDURE_WORKSPACE_LINK_REQUESTED,
  WORK_ITEM_PROCEDURE_LINKED,
  WORK_ITEM_PROCEDURE_LINK_REJECTED,
  type ProcedureInstanceReversedPayload,
  type ProcedureLinkRequestedPayload,
  type ProcedureStartedForWorkItemPayload,
  type ProcedureWorkItemStartRejectedPayload,
} from '../domain/workspace-procedure-link.js';
import { timezoneOf, todayKey } from '../domain/tenant-time.js';
import {
  NameConflictError,
  ProjectArchivedError,
  WorkspaceError,
  WorkspaceSchemaNotReadyError,
  WorkspaceValidationError,
} from '../domain/workspace.error.js';
import type { DocumentService } from './document.service.js';
import type { FinanceService } from './finance.service.js';
import type { ProjectService } from './project.service.js';
import type { WorkItemDeletionService } from './work-item-deletion.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';
import type { WorkItemService } from './work-item.service.js';

/** Sự kiện từ module Quy trình mà Workspace xử lý. */
export const WORKSPACE_PROCEDURE_EVENT_TYPES = [
  PROCEDURE_WORKSPACE_LINK_REQUESTED,
  PROCEDURE_STARTED_FOR_WORK_ITEM,
  PROCEDURE_WORK_ITEM_START_REJECTED,
  PROCEDURE_INSTANCE_REVERSED,
  // Công việc ngoài dự án theo quy trình.
  PROCEDURE_STARTED_FOR_STANDALONE_TASK,
  PROCEDURE_STANDALONE_TASK_START_REJECTED,
  PROCEDURE_INSTANCE_COMPLETED,
  // Đổi công việc liên kết, xoá hồ sơ, tệp mới của hồ sơ gắn dự án.
  PROCEDURE_WORKSPACE_RELINK_REQUESTED,
  PROCEDURE_INSTANCE_DELETED,
  PROCEDURE_ATTACHMENT_ADDED,
] as const;

/**
 * Người thay mặt khi Quy trình đã quyết định thay người dùng (đưa tệp vào dự án, xoá / đổi công việc gắn
 * hồ sơ): quyền đã được Quy trình kiểm, Workspace chỉ ghi dữ liệu của mình.
 */
function systemActor(tenantId: string, userId: string): WorkspaceActor {
  return {
    tenantId,
    userId,
    displayName: userId,
    isTenantAdmin: true,
    canManage: false,
    canWriteTasks: true,
    canWriteDocuments: true,
    canDeleteDocuments: false,
  };
}

/** "Bản vẽ.pdf" → "Bản vẽ (HS-001).pdf": giữ đuôi tệp khi thêm hậu tố. */
function withSuffix(name: string, suffix: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)} (${suffix})${name.slice(dot)}` : `${name} (${suffix})`;
}

/**
 * Xử lý sự kiện của Quy trình bên phía Workspace.
 *
 * Mọi thao tác ghi đi qua service của chính Workspace, dưới danh nghĩa người
 * yêu cầu, nên luật vai trò dự án (thành viên mới tạo được việc, giao việc
 * người khác cần quản lý, chi phí cần quyền tài chính) giữ nguyên như khi họ
 * tự thao tác trên giao diện. Lỗi nghiệp vụ được báo lại Quy trình bằng sự
 * kiện; lỗi hạ tầng ném ra để worker xử lý lại sự kiện.
 */
export class WorkspaceProcedureEvents {
  constructor(
    private readonly store: WorkspaceStore,
    private readonly workItems: WorkItemService,
    private readonly finance: FinanceService,
    /** Đưa tệp của hồ sơ vào thư mục công việc; vắng (test) thì bỏ qua sự kiện tệp. */
    private readonly documents?: DocumentService,
    /** Xoá công việc gắn hồ sơ khi hồ sơ bị xoá hoặc đổi công việc liên kết. */
    private readonly deletion?: WorkItemDeletionService,
    /** Thêm người submit của đơn tạo hộ vào dự án, theo đúng luật quản lý thành viên. */
    private readonly projects?: ProjectService,
  ) {}

  async handle(tenantId: string, type: string, payload: unknown): Promise<void> {
    if (type === PROCEDURE_ATTACHMENT_ADDED) {
      await this.onAttachmentAdded(tenantId, payload as ProcedureAttachmentAddedPayload);
    } else if (type === PROCEDURE_INSTANCE_DELETED) {
      await this.onInstanceDeleted(tenantId, payload as ProcedureInstanceDeletedPayload);
    } else if (type === PROCEDURE_WORKSPACE_RELINK_REQUESTED) {
      await this.onRelinkRequested(tenantId, payload as ProcedureRelinkRequestedPayload);
    } else if (type === PROCEDURE_WORKSPACE_LINK_REQUESTED) {
      await this.onLinkRequested(tenantId, payload as ProcedureLinkRequestedPayload);
    } else if (type === PROCEDURE_STARTED_FOR_WORK_ITEM) {
      const started = payload as ProcedureStartedForWorkItemPayload;
      await this.store.procedureRequest.markStarted(tenantId, started);
    } else if (type === PROCEDURE_INSTANCE_REVERSED) {
      // Hồ sơ gắn công việc bị huỷ hiệu lực → công việc huỷ hiệu lực theo.
      const reversed = payload as ProcedureInstanceReversedPayload;
      if (reversed.sourceType === STANDALONE_TASK_PROCEDURE_SOURCE) {
        await this.reverseStandaloneTask(tenantId, reversed);
        return;
      }
      if (!reversed.workItemId) return;
      await this.workItems.reverseForProcedure(tenantId, reversed.workItemId, {
        instanceCode: reversed.instanceCode,
        reason: reversed.reason,
        reversedBy: reversed.reversedBy,
        reversedByName: reversed.reversedByName,
        adjustmentRequested: reversed.adjustmentRequested,
      });
    } else if (type === PROCEDURE_WORK_ITEM_START_REJECTED) {
      const rejected = payload as ProcedureWorkItemStartRejectedPayload;
      await this.store.procedureRequest.markRejected(tenantId, rejected.workItemId, rejected.reason);
    } else if (type === PROCEDURE_STARTED_FOR_STANDALONE_TASK) {
      const started = payload as ProcedureStartedForStandaloneTaskPayload;
      await this.store.standaloneTask.markProcedureStarted(
        tenantId,
        started.taskId,
        started.instanceId,
        started.instanceCode,
      );
    } else if (type === PROCEDURE_STANDALONE_TASK_START_REJECTED) {
      const rejected = payload as ProcedureStandaloneTaskStartRejectedPayload;
      await this.store.standaloneTask.markProcedureStartRejected(
        tenantId,
        rejected.taskId,
        rejected.reason,
      );
    } else if (type === PROCEDURE_INSTANCE_COMPLETED) {
      // Sự kiện chung cho mọi hồ sơ; chỉ hồ sơ mở cho việc ngoài dự án là của Workspace.
      const completed = payload as ProcedureInstanceCompletedPayload;
      if (completed?.sourceType !== STANDALONE_TASK_PROCEDURE_SOURCE || !completed.instanceId) return;
      const outcome =
        completed.status === 'completed'
          ? 'completed'
          : completed.status === 'rejected'
            ? 'rejected'
            : completed.status === 'cancelled'
              ? 'cancelled'
              : undefined;
      if (!outcome) return;
      await this.store.standaloneTask.applyProcedureOutcome(
        tenantId,
        completed.instanceId,
        outcome,
        completed.instanceCode,
        todayKey(timezoneOf(tenantId)),
      );
    }
  }

  /**
   * Hồ sơ của việc ngoài dự án bị huỷ hiệu lực bên Quy trình → việc huỷ hiệu
   * lực theo. Quyết định đã do Quy trình đưa ra nên không kiểm vai; không nhờ
   * Quy trình huỷ lại hồ sơ (tránh vòng lặp). Việc đã huỷ hiệu lực thì thôi.
   */
  private async reverseStandaloneTask(
    tenantId: string,
    reversed: ProcedureInstanceReversedPayload,
  ): Promise<void> {
    const task = await this.store.standaloneTask.findByProcedureInstance(
      tenantId,
      reversed.instanceId,
    );
    if (!task || task.reversal) return;
    await this.store.standaloneTask.reverse(tenantId, task.id, {
      reversedBy: reversed.reversedBy,
      reversedByName: reversed.reversedByName,
      reason: `Hồ sơ ${reversed.instanceCode} bị huỷ hiệu lực: ${reversed.reason}`.slice(0, 1000),
      today: todayKey(timezoneOf(tenantId)),
      notifyProcedure: false,
      // Quy trình yêu cầu điều chỉnh: ghi nhận để người giao lập việc điều chỉnh.
      adjustmentRequested: reversed.adjustmentRequested === true,
    });
  }

  /**
   * Hồ sơ điều chỉnh gắn dự án: công việc mới nối về công việc đã huỷ hiệu lực,
   * nếu công việc đó còn hợp lệ (cùng dự án, đã huỷ hiệu lực). Không thì bỏ
   * qua liên kết, công việc mới vẫn được tạo.
   */
  private async adjustmentTarget(
    tenantId: string,
    request: ProcedureLinkRequestedPayload,
  ): Promise<string | undefined> {
    if (!request.adjustmentOfWorkItemId) return undefined;
    const original = await this.store.workItem.findById(tenantId, request.adjustmentOfWorkItemId);
    if (!original || original.projectId !== request.projectId || !original.reversal) return undefined;
    const open = (await this.store.workItem.listByProject(tenantId, original.projectId)).some(
      (node) => node.adjustmentOfId === original.id && node.status !== 'cancelled',
    );
    return open ? undefined : original.id;
  }

  /** Hồ sơ vừa mở có gắn dự án: tạo công việc "Theo quy trình" rồi báo mã về. */
  private async onLinkRequested(tenantId: string, request: ProcedureLinkRequestedPayload): Promise<void> {
    // Sự kiện đến lại (worker xử lý lại): công việc đã có thì chỉ báo lại mã.
    const existing = await this.store.externalRef.findByExternalId(
      tenantId,
      'procedure-engine',
      request.instanceId,
    );
    if (existing) {
      const [item, project] = await Promise.all([
        this.store.workItem.findById(tenantId, existing.entityId),
        this.store.project.findById(tenantId, existing.projectId),
      ]);
      if (item && project) {
        await this.store.integration.emit(tenantId, {
          type: WORK_ITEM_PROCEDURE_LINKED,
          aggregateType: 'workspace-work-item',
          aggregateId: item.id,
          payload: {
            instanceId: request.instanceId,
            workItemId: item.id,
            workItemCode: item.code,
            projectId: project.id,
            projectCode: project.code,
          },
        });
      }
      return;
    }

    const actor: WorkspaceActor = {
      tenantId,
      userId: request.requestedBy,
      displayName: request.requestedBy,
      isTenantAdmin: request.requestedByIsTenantAdmin === true,
      canManage: false,
      canWriteTasks: true,
      canWriteDocuments: false,
      canDeleteDocuments: false,
    };
    const draft = request.workItem ?? {};
    try {
      await this.addSubmitterToProject(actor, request);
      const item = await this.workItems.create(
        actor,
        {
          projectId: request.projectId,
          parentId: draft.parentId,
          title: request.title,
          description: draft.description,
          itemType: draft.itemType === 'milestone' ? 'milestone' : 'task',
          executionType: 'procedure',
          priority: draft.priority,
          assigneeUserId: draft.assigneeUserId,
          plannedStart: draft.plannedStart,
          plannedEnd: draft.plannedEnd,
          estimateHours: draft.estimateHours,
          adjustmentOfId: await this.adjustmentTarget(tenantId, request),
        },
        {
          instanceId: request.instanceId,
          instanceCode: request.instanceCode,
          instanceStatus: request.instanceStatus,
        },
      );
      if (draft.estimatedCost !== undefined) {
        // Chi phí ghi qua đúng luật tài chính; người không có quyền thì bỏ qua
        // phần chi phí, công việc và liên kết vẫn giữ.
        await this.finance
          .updateItemCost(actor, item.id, { estimatedCost: draft.estimatedCost })
          .catch((error: unknown) => {
            if (!(error instanceof WorkspaceError)) throw error;
          });
      }
    } catch (error) {
      if (!(error instanceof WorkspaceError) || error instanceof WorkspaceSchemaNotReadyError) {
        throw error;
      }
      await this.store.integration.emit(tenantId, {
        type: WORK_ITEM_PROCEDURE_LINK_REJECTED,
        aggregateType: 'procedure-instance',
        aggregateId: request.instanceId,
        payload: { instanceId: request.instanceId, reason: error.message },
      });
    }
  }

  /**
   * Đơn tạo hộ: người submit chưa thuộc dự án thì thêm vào (vai thành viên) trước khi tạo công việc. Thêm
   * dưới quyền của người yêu cầu, nên người không có quyền quản lý thành viên dự án nhận lỗi rõ ràng và
   * Quy trình ghi liên kết bị từ chối.
   */
  private async addSubmitterToProject(
    actor: WorkspaceActor,
    request: ProcedureLinkRequestedPayload,
  ): Promise<void> {
    const submitter = request.submitterUserId;
    if (!submitter || !this.projects) return;
    const members = await this.store.member.list(actor.tenantId, request.projectId);
    if (members.some((member) => member.userId === submitter)) return;
    await this.projects.setMembers(actor, request.projectId, {
      members: [
        ...members.map((member) => ({ userId: member.userId, role: member.role })),
        { userId: submitter, role: 'member' },
      ],
    });
  }

  /**
   * Hồ sơ gắn dự án có tệp mới: tạo tài liệu trong thư mục `<dự án>/<công việc>` trỏ đúng tệp đó (không
   * tải lên lại) và gắn vào công việc. Hồ sơ chưa gắn xong công việc (Workspace chưa xử lý yêu cầu liên
   * kết) thì ném lỗi để worker thử lại sau. Nhận trùng thì bỏ qua theo khoá tệp.
   */
  private async onAttachmentAdded(
    tenantId: string,
    file: ProcedureAttachmentAddedPayload,
  ): Promise<void> {
    if (!this.documents) return;
    const reference = await this.store.externalRef.findByExternalId(
      tenantId,
      'procedure-engine',
      file.instanceId,
    );
    if (!reference || reference.entityType !== 'work_item') {
      throw new Error(`Hồ sơ ${file.instanceCode} chưa gắn công việc; thử lại sau.`);
    }
    if (await this.store.document.findByStorageKey(tenantId, file.objectKey)) return;

    const actor = systemActor(tenantId, file.uploadedBy);
    const folder = await this.documents
      .ensurePath(actor, {
        projectId: reference.projectId,
        workItemId: reference.entityId,
      })
      .catch((error: unknown) => {
        // Dự án đã lưu trữ chỉ xem: không lưu thêm tài liệu vào đó. Lỗi này không khỏi khi thử lại, nên ghi nhận sự
        // kiện đã xử lý thay vì để nó dồn vào hàng chờ lỗi; tệp vẫn nằm ở hồ sơ Quy trình.
        if (error instanceof ProjectArchivedError) return undefined;
        throw error;
      });
    if (!folder) return;
    const names = [file.fileName, withSuffix(file.fileName, file.instanceCode), withSuffix(file.fileName, file.attachmentId.slice(0, 8))];
    for (const [index, name] of names.entries()) {
      try {
        const { document } = await this.store.document.create(tenantId, file.uploadedBy, {
          folderId: folder.id,
          projectId: reference.projectId,
          name: name.slice(0, 255),
          description: `Từ hồ sơ ${file.instanceCode} · ${file.originLabel}`,
          storageKey: file.objectKey,
          fileName: file.fileName,
          contentType: file.contentType,
          sizeBytes: file.sizeBytes > 0 ? file.sizeBytes : 0,
          changeNote: `Tải lên ở hồ sơ ${file.instanceCode} (${file.originLabel})`,
        });
        await this.store.document.addLink(tenantId, file.uploadedBy, {
          documentId: document.id,
          entityType: 'work_item',
          entityId: reference.entityId,
        });
        return;
      } catch (error) {
        // Trùng tên trong thư mục: thử tên kèm mã hồ sơ, rồi kèm mã tệp.
        if (!(error instanceof NameConflictError) || index === names.length - 1) throw error;
      }
    }
  }

  /** Hồ sơ bị xoá: xoá công việc gắn hồ sơ. Tài liệu đã đưa vào dự án vẫn nằm trong thư mục dự án. */
  private async onInstanceDeleted(
    tenantId: string,
    deleted: ProcedureInstanceDeletedPayload,
  ): Promise<void> {
    if (!this.deletion) return;
    const reference = await this.store.externalRef.findByExternalId(
      tenantId,
      'procedure-engine',
      deleted.instanceId,
    );
    const workItemId = reference?.entityType === 'work_item' ? reference.entityId : deleted.workItemId;
    if (!workItemId) return;
    await this.deletion.removeForProcedure(tenantId, workItemId, {
      instanceId: deleted.instanceId,
      removedBy: deleted.deletedBy,
      note: `Xoá vì hồ sơ ${deleted.instanceCode} bị xoá (${deleted.reason})`,
    });
  }

  /**
   * Đổi công việc liên kết của hồ sơ.
   *
   * Người yêu cầu phải là thành viên dự án mới (hoặc quản trị tenant). Công việc mới chép thông tin của
   * công việc cũ, đặt dưới công việc cha đã chọn; người phụ trách / cùng làm chỉ giữ người là thành viên
   * dự án mới. Sau đó tài liệu của công việc cũ chuyển sang, công việc cũ bị xoá, rồi báo mã mới về Quy
   * trình. Lỗi nghiệp vụ trước khi tạo công việc mới → báo từ chối (Quy trình giữ liên kết cũ); lỗi sau
   * đó ném ra để worker chạy lại — các bước sau đều chạy lại được.
   */
  private async onRelinkRequested(
    tenantId: string,
    request: ProcedureRelinkRequestedPayload,
  ): Promise<void> {
    if (!this.documents || !this.deletion) return;
    const existing = await this.store.externalRef.findByExternalId(
      tenantId,
      'procedure-engine',
      request.instanceId,
    );
    // Lần chạy lại: công việc mới đã có, chỉ làm nốt các bước sau.
    if (existing && existing.entityType === 'work_item' && existing.entityId !== request.replacesWorkItemId) {
      const created = await this.store.workItem.findById(tenantId, existing.entityId);
      if (created) {
        await this.finishRelink(tenantId, request, created.id);
        return;
      }
    }

    let createdId: string;
    try {
      createdId = await this.createRelinkTarget(tenantId, request);
    } catch (error) {
      if (!(error instanceof WorkspaceError) || error instanceof WorkspaceSchemaNotReadyError) {
        throw error;
      }
      await this.store.integration.emit(tenantId, {
        type: WORK_ITEM_PROCEDURE_LINK_REJECTED,
        aggregateType: 'procedure-instance',
        aggregateId: request.instanceId,
        payload: { instanceId: request.instanceId, reason: error.message },
      });
      return;
    }
    await this.finishRelink(tenantId, request, createdId);
  }

  private async createRelinkTarget(
    tenantId: string,
    request: ProcedureRelinkRequestedPayload,
  ): Promise<string> {
    const project = await this.store.project.findById(tenantId, request.projectId);
    if (!project) throw new WorkspaceValidationError('Không tìm thấy dự án mới.');
    if (project.status === 'completed' || project.status === 'cancelled' || project.archivedAt) {
      throw new WorkspaceValidationError(`Dự án ${project.code} đã đóng hoặc đã lưu trữ, không thêm công việc được.`);
    }
    if (!request.requestedByIsTenantAdmin) {
      const role = await this.store.member.roleOf(tenantId, project.id, request.requestedBy);
      if (!role) {
        throw new WorkspaceValidationError(
          `Người yêu cầu không phải thành viên dự án ${project.code}; hãy nhờ chủ nhiệm thêm vào dự án trước.`,
        );
      }
    }
    const old = await this.store.workItem.findById(tenantId, request.replacesWorkItemId);
    const parentId = request.workItem?.parentId;
    if (old && parentId && old.projectId === project.id) {
      // Không đặt công việc mới dưới chính công việc cũ hay nhánh con của nó (nhánh đó sẽ bị xoá).
      const all = await this.store.workItem.listByProject(tenantId, project.id);
      const doomed = new Set([old.id]);
      for (let grew = true; grew; ) {
        grew = false;
        for (const node of all) {
          if (node.parentId && doomed.has(node.parentId) && !doomed.has(node.id)) {
            doomed.add(node.id);
            grew = true;
          }
        }
      }
      if (doomed.has(parentId)) {
        throw new WorkspaceValidationError(
          'Công việc cha không được là công việc đang liên kết hay việc con của nó.',
        );
      }
    }
    const members = new Set(
      (await this.store.member.list(tenantId, project.id)).map((member) => member.userId),
    );
    const keep = (userId?: string | null) => (userId && members.has(userId) ? userId : undefined);
    const item = await this.workItems.create(
      systemActor(tenantId, request.requestedBy),
      {
        projectId: project.id,
        parentId,
        title: old?.title ?? request.title,
        description: old?.description,
        itemType: old?.itemType === 'milestone' ? 'milestone' : 'task',
        executionType: 'procedure',
        priority: old?.priority,
        assigneeUserId: keep(old?.assigneeUserId),
        participantUserIds: (old?.participantUserIds ?? []).filter((userId) => members.has(userId)),
        tagIds: old?.tagIds ? [...old.tagIds] : undefined,
        plannedStart: old?.plannedStart,
        plannedEnd: old?.plannedEnd,
        estimateHours: old?.estimateHours ?? undefined,
      },
      {
        instanceId: request.instanceId,
        instanceCode: request.instanceCode,
        instanceStatus: request.instanceStatus,
      },
    );
    return item.id;
  }

  /** Chuyển tài liệu, xoá công việc cũ, báo mã mới. Mỗi bước chạy lại được. */
  private async finishRelink(
    tenantId: string,
    request: ProcedureRelinkRequestedPayload,
    createdId: string,
  ): Promise<void> {
    const documents = this.documents as DocumentService;
    const deletion = this.deletion as WorkItemDeletionService;
    const created = await this.store.workItem.findById(tenantId, createdId);
    const project = created ? await this.store.project.findById(tenantId, created.projectId) : undefined;
    if (!created || !project) return;
    const actor = systemActor(tenantId, request.requestedBy);

    const old = await this.store.workItem.findById(tenantId, request.replacesWorkItemId);
    if (old) {
      const oldFolder = await this.workItemFolder(tenantId, old);
      const documentIds = await this.store.document.idsForWorkItem(tenantId, old.id, oldFolder?.id);
      if (documentIds.length > 0) {
        const target = await documents.ensurePath(actor, { projectId: project.id, workItemId: created.id });
        await this.store.document.moveToWorkItem(tenantId, {
          documentIds,
          fromWorkItemId: old.id,
          toWorkItemId: created.id,
          toProjectId: project.id,
          toFolderId: target.id,
          actorUserId: request.requestedBy,
        });
      }
      // Thư mục riêng của công việc cũ đã rỗng thì gỡ khỏi cây.
      if (oldFolder) {
        const hasChildren = (await this.store.document.listFolders(tenantId, old.projectId)).some(
          (folder) => folder.parentId === oldFolder.id,
        );
        if (!hasChildren && (await this.store.document.countActiveDocuments(tenantId, oldFolder.id)) === 0) {
          await this.store.document.deactivateFolder(tenantId, oldFolder.id);
        }
      }
      await deletion.removeForProcedure(tenantId, old.id, {
        instanceId: request.instanceId,
        removedBy: request.requestedBy,
        note: `Đổi công việc liên kết của hồ sơ ${request.instanceCode} sang ${project.code}-${created.code}`,
      });
    }

    await this.store.integration.emit(tenantId, {
      type: WORK_ITEM_PROCEDURE_LINKED,
      aggregateType: 'workspace-work-item',
      aggregateId: created.id,
      payload: {
        instanceId: request.instanceId,
        workItemId: created.id,
        workItemCode: created.code,
        projectId: project.id,
        projectCode: project.code,
      },
    });
  }

  /** Thư mục riêng `<mã dự án · tên>/<mã việc · tên>` mà `ensurePath` đã dựng cho công việc, nếu có. */
  private async workItemFolder(
    tenantId: string,
    item: { readonly projectId: string; readonly code: string; readonly title: string },
  ) {
    const project = await this.store.project.findById(tenantId, item.projectId);
    if (!project) return undefined;
    const folders = await this.store.document.listFolders(tenantId, item.projectId);
    const same = (left: string, right: string) => left.trim().toLowerCase() === right.trim().toLowerCase();
    const projectFolder = folders.find(
      (folder) => folder.projectId === item.projectId && !folder.parentId && same(folder.name, `${project.code} · ${project.name}`),
    );
    if (!projectFolder) return undefined;
    return folders.find(
      (folder) => folder.parentId === projectFolder.id && same(folder.name, `${item.code} · ${item.title}`),
    );
  }
}
