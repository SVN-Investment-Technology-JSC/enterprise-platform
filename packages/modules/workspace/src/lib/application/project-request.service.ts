import type {
  ProjectRequest,
  ProjectRequestList,
  ReverseProjectRequestRequest,
} from '@enterprise-platform/contracts-workspace';
import {
  ProjectRoleForbiddenError,
  WorkspaceError,
  WorkspaceValidationError,
} from '../domain/workspace.error.js';
import type { ProcedureReversalChecker } from './procedure-reversal-check.port.js';
import { hasProjectRole, type ProjectService } from './project.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

/**
 * Tab "Đơn từ" của dự án.
 *
 * Đơn được ghi bằng sự kiện từ module gửi (xem
 * `infrastructure/project-request-events.ts`). Mọi thành viên dự án đều xem
 * được, kể cả `viewer` — cùng hàng rào với các tab khác của dự án. Workspace
 * không sửa đơn: huỷ hiệu lực chỉ là YÊU CẦU gửi sang module nguồn.
 */
export class ProjectRequestService {
  constructor(
    private readonly store: WorkspaceStore,
    private readonly projects: ProjectService,
    private readonly reversal?: ProcedureReversalChecker,
  ) {}

  async listForProject(actor: WorkspaceActor, projectId: string): Promise<ProjectRequestList> {
    const access = await this.projects.access(actor, projectId);
    const items = await this.store.projectRequest.listByProject(actor.tenantId, access.project.id);
    return { items };
  }

  /**
   * Huỷ hiệu lực đơn đã duyệt: chủ nhiệm dự án, quản trị, hoặc người đã duyệt
   * đơn. Hỏi module nguồn trước (kỳ công/lương đã chốt… chặn hẳn), rồi phát
   * sự kiện; trạng thái chuyển "Đã huỷ hiệu lực" khi module nguồn báo về.
   */
  async reverse(
    actor: WorkspaceActor,
    projectRequestId: string,
    input: ReverseProjectRequestRequest,
  ): Promise<ProjectRequest> {
    const request = await this.store.projectRequest.findById(actor.tenantId, projectRequestId);
    if (!request) throw new WorkspaceValidationError('Không tìm thấy đơn từ.');
    const access = await this.projects.access(actor, request.projectId);
    const reason = String(input?.reason ?? '').trim();
    if (reason.length < 3) {
      throw new WorkspaceValidationError('Lý do huỷ hiệu lực cần ít nhất 3 ký tự.');
    }
    if (reason.length > 1000) {
      throw new WorkspaceValidationError('Lý do huỷ hiệu lực tối đa 1000 ký tự.');
    }
    if (request.status === 'REVERSED') return request;
    if (request.status !== 'APPROVED') {
      throw new WorkspaceValidationError('Chỉ huỷ hiệu lực được đơn đã duyệt.');
    }
    if (request.reversalRequest && !request.reversalRequest.error) {
      throw new WorkspaceValidationError('Đơn đang chờ huỷ hiệu lực ở module nguồn.');
    }

    const check = await this.checkSource(actor.tenantId, request);
    const isApprover = (check.approverUserIds ?? []).includes(actor.userId);
    if (!hasProjectRole(access, 'owner') && !isApprover) {
      throw new ProjectRoleForbiddenError('chủ nhiệm, người duyệt đơn hoặc quản trị');
    }
    if (!check.allowed) {
      throw new WorkspaceValidationError(
        `Không huỷ hiệu lực được: ${check.reason ?? 'module nguồn không cho phép huỷ đơn.'}`,
      );
    }

    await this.store.projectRequest.requestReversal(actor.tenantId, {
      projectRequestId: request.id,
      code: request.code,
      projectId: request.projectId,
      sourceModule: request.sourceModule,
      requestKind: request.sourceKind,
      requestId: request.sourceId,
      ...(request.procedureInstanceId ? { instanceId: request.procedureInstanceId } : {}),
      reason,
      createAdjustment: input.createAdjustment === true,
      requestedBy: actor.userId,
      requestedByName: actor.displayName,
    });
    return (await this.store.projectRequest.findById(actor.tenantId, request.id)) ?? request;
  }

  /** Đơn chạy qua Quy trình: hỏi Quy trình (đã gồm kiểm HRM); không thì hỏi HRM. */
  private async checkSource(tenantId: string, request: ProjectRequest) {
    if (request.sourceModule !== 'hrm') {
      return { allowed: false, reason: 'Module nguồn chưa hỗ trợ huỷ hiệu lực.' };
    }
    if (!this.reversal) return { allowed: false, reason: 'Chưa cấu hình kiểm tra với module nguồn.' };
    try {
      if (request.procedureInstanceId) {
        return await this.reversal.check(tenantId, request.procedureInstanceId);
      }
      if (!this.reversal.checkHrmRequest) {
        return { allowed: false, reason: 'Chưa cấu hình kiểm tra với HRM.' };
      }
      return await this.reversal.checkHrmRequest(tenantId, request.sourceKind, request.sourceId);
    } catch (error) {
      if (error instanceof WorkspaceError) throw error;
      return { allowed: false, reason: 'Không kiểm tra được với module nguồn.' };
    }
  }
}
