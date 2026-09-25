import {
  PROJECT_ROLES,
  PROJECT_STATUSES,
  type CreateProjectRequest,
  type Paged,
  type Project,
  type ProjectMember,
  type ProjectRole,
  type ProjectStatus,
  type ProjectSummary,
  type SetProjectMembersRequest,
  type UpdateProjectRequest,
} from '@enterprise-platform/contracts-workspace';
import {
  ProjectCodeConflictError,
  ProjectForbiddenError,
  ProjectNotFoundError,
  ProjectRoleForbiddenError,
  WorkspaceValidationError,
} from '../domain/workspace.error.js';
import { timezoneOf, todayKey } from '../domain/tenant-time.js';
import type { DirectoryService } from './directory.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 60;

/** Thứ tự thẩm quyền; số lớn hơn làm được mọi việc của số nhỏ hơn. */
const ROLE_RANK: Record<ProjectRole, number> = { viewer: 0, member: 1, manager: 2, owner: 3 };

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,31}$/;

/**
 * Ngữ cảnh truy cập một dự án: vai trò thật trong dự án, kèm cờ override của
 * quản trị viên tenant.
 */
export interface ProjectAccess {
  readonly project: Project;
  /** Rỗng khi người gọi là tenant-admin mà không phải thành viên dự án. */
  readonly role?: ProjectRole;
  readonly isTenantAdmin: boolean;
}

/**
 * Người gọi có ít nhất vai trò `minimum` trong dự án hay không.
 *
 * Để ngoài lớp để `WorkItemService` dùng lại mà không phải phụ thuộc vào
 * instance của `ProjectService`.
 */
export function hasProjectRole(access: ProjectAccess, minimum: ProjectRole): boolean {
  if (access.isTenantAdmin) return true;
  if (!access.role) return false;
  return ROLE_RANK[access.role] >= ROLE_RANK[minimum];
}

/** Như `hasProjectRole` nhưng ném lỗi thay vì trả về boolean. */
export function requireProjectRole(access: ProjectAccess, minimum: ProjectRole): void {
  if (!hasProjectRole(access, minimum)) throw new ProjectRoleForbiddenError(minimum);
}

export class ProjectService {
  /**
   * `directory` để trống thì bỏ qua bước đối chiếu danh bạ — dùng trong test
   * chỉ quan tâm quy tắc vai trò.
   */
  constructor(
    private readonly store: WorkspaceStore,
    private readonly directory?: DirectoryService,
  ) {}

  /**
   * Phân giải quyền truy cập một dự án; dùng chung cho mọi endpoint chạm vào
   * dự án đó.
   *
   * Không phải thành viên và không phải quản trị viên thì nhận `403`, KHÔNG
   * phải `404`: dự án có thật, chỉ là không được xem. Ngược lại dự án không
   * tồn tại thì `404` — hai tình huống khác nhau, đừng trộn.
   */
  async access(actor: WorkspaceActor, projectId: string): Promise<ProjectAccess> {
    const project = await this.store.project.findById(actor.tenantId, projectId);
    if (!project) throw new ProjectNotFoundError(projectId);

    const role = await this.store.member.roleOf(actor.tenantId, projectId, actor.userId);
    if (!role && !actor.isTenantAdmin) throw new ProjectForbiddenError();

    return { project, role, isTenantAdmin: actor.isTenantAdmin };
  }

  async list(
    actor: WorkspaceActor,
    query: {
      readonly search?: string;
      readonly status?: string;
      readonly page?: number | string;
      readonly pageSize?: number | string;
    },
  ): Promise<Paged<ProjectSummary>> {
    const page = Math.max(Math.trunc(Number(query.page) || 1), 1);
    const pageSize = Math.min(
      Math.max(Math.trunc(Number(query.pageSize) || DEFAULT_PAGE_SIZE), 1),
      MAX_PAGE_SIZE,
    );

    const { items, total } = await this.store.project.list(actor.tenantId, {
      // Quản trị viên tenant bỏ hàng rào thành viên và thấy toàn bộ dự án.
      userId: actor.isTenantAdmin ? undefined : actor.userId,
      search: query.search?.trim() || undefined,
      status: parseStatus(query.status),
      page,
      pageSize,
    });

    // Số liệu tổng hợp và vai trò lấy theo lô cho cả trang, không lặp từng dòng.
    const ids = items.map((project) => project.id);
    const today = todayKey(timezoneOf(actor.tenantId));
    const rollups = await this.store.project.rollup(actor.tenantId, ids, today);
    const byProject = new Map(rollups.map((entry) => [entry.projectId, entry]));
    const myRoles = await this.rolesOf(actor, ids);

    return {
      items: items.map((project) => ({
        ...project,
        totalItems: byProject.get(project.id)?.totalItems ?? 0,
        closedItems: byProject.get(project.id)?.closedItems ?? 0,
        overdueItems: byProject.get(project.id)?.overdueItems ?? 0,
        myRole: myRoles.get(project.id),
      })),
      total,
      page,
      pageSize,
    };
  }

  async detail(actor: WorkspaceActor, projectId: string): Promise<ProjectSummary> {
    const access = await this.access(actor, projectId);
    const [rollup] = await this.store.project.rollup(
      actor.tenantId,
      [projectId],
      todayKey(timezoneOf(actor.tenantId)),
    );
    return {
      ...access.project,
      totalItems: rollup?.totalItems ?? 0,
      closedItems: rollup?.closedItems ?? 0,
      overdueItems: rollup?.overdueItems ?? 0,
      myRole: access.role,
    };
  }

  async create(actor: WorkspaceActor, input: CreateProjectRequest): Promise<Project> {
    const code = String(input.code ?? '')
      .trim()
      .toUpperCase();
    if (!CODE_PATTERN.test(code)) {
      throw new WorkspaceValidationError(
        'Mã dự án chỉ gồm chữ in hoa, số và dấu gạch ngang, dài 2 đến 32 ký tự.',
      );
    }
    const name = requireText(input.name, 'Tên dự án', 180);
    assertDateOrder(input.startDate, input.endDate);

    // Kiểm tra trước để trả mã lỗi rõ ràng; UNIQUE trên cột `code` vẫn là chốt
    // chặn thật khi hai request vào cùng lúc.
    const existing = await this.store.project.findByCode(actor.tenantId, code);
    if (existing) throw new ProjectCodeConflictError(code);

    return this.store.project.create(actor.tenantId, actor.userId, { ...input, code, name });
  }

  async update(
    actor: WorkspaceActor,
    projectId: string,
    input: UpdateProjectRequest,
  ): Promise<Project> {
    const access = await this.access(actor, projectId);
    requireProjectRole(access, 'manager');

    const patch: UpdateProjectRequest = { ...input };
    if (input.name !== undefined) {
      Object.assign(patch, { name: requireText(input.name, 'Tên dự án', 180) });
    }
    if (input.status !== undefined && !parseStatus(input.status)) {
      throw new WorkspaceValidationError(`Trạng thái dự án "${input.status}" không hợp lệ.`);
    }
    // Đổi chủ nhiệm là thay người chịu trách nhiệm cuối cùng: chỉ chủ nhiệm
    // hiện tại hoặc quản trị viên tenant được làm.
    if (input.ownerUserId !== undefined) requireProjectRole(access, 'owner');

    assertDateOrder(
      input.startDate === undefined ? access.project.startDate : input.startDate,
      input.endDate === undefined ? access.project.endDate : input.endDate,
    );

    return this.store.project.update(actor.tenantId, projectId, patch);
  }

  /** Huỷ dự án: chuyển trạng thái, không xoá dòng. Lịch sử phải giữ lại. */
  async cancel(actor: WorkspaceActor, projectId: string): Promise<Project> {
    const access = await this.access(actor, projectId);
    requireProjectRole(access, 'owner');
    return this.store.project.update(actor.tenantId, projectId, { status: 'cancelled' });
  }

  async members(actor: WorkspaceActor, projectId: string): Promise<readonly ProjectMember[]> {
    await this.access(actor, projectId);
    return this.store.member.list(actor.tenantId, projectId);
  }

  async setMembers(
    actor: WorkspaceActor,
    projectId: string,
    input: SetProjectMembersRequest,
  ): Promise<readonly ProjectMember[]> {
    const access = await this.access(actor, projectId);
    requireProjectRole(access, 'manager');

    const members = input.members ?? [];
    // Không có chủ nhiệm thì không ai huỷ hay đổi chủ được dự án nữa; nhiều
    // chủ nhiệm thì không rõ ai chịu trách nhiệm.
    const owners = members.filter((member) => member.role === 'owner');
    if (owners.length !== 1) {
      throw new WorkspaceValidationError('Dự án phải có đúng một chủ nhiệm.');
    }
    const unique = new Set(members.map((member) => member.userId));
    if (unique.size !== members.length) {
      throw new WorkspaceValidationError('Một người chỉ được xuất hiện một lần trong danh sách.');
    }
    for (const member of members) {
      if (!(PROJECT_ROLES as readonly string[]).includes(member.role)) {
        throw new WorkspaceValidationError(`Vai trò "${member.role}" không hợp lệ.`);
      }
    }

    const current = await this.store.member.list(actor.tenantId, projectId);

    // Người mới thêm phải có trong tổ chức. Chỉ kiểm người MỚI: một thành
    // viên cũ đã rời tổ chức vẫn giữ được trong danh sách cho tới khi bàn
    // giao xong việc của họ.
    const existing = new Set(current.map((member) => member.userId));
    const added = members.map((member) => member.userId).filter((userId) => !existing.has(userId));
    const unknown = await this.directory?.unknownUserIds(actor.tenantId, added);
    if (unknown && unknown.length > 0) {
      throw new WorkspaceValidationError(
        `Không tìm thấy ${unknown.length} người trong tổ chức. Hãy chọn người từ danh bạ.`,
      );
    }

    // Gỡ người vẫn đang gánh việc chưa đóng sẽ để lại công việc không có chủ.
    const removed = current
      .filter((member) => !unique.has(member.userId))
      .map((member) => member.userId);
    if (removed.length > 0) {
      const open = await this.store.member.openItemCounts(actor.tenantId, projectId, removed);
      const blocked = [...open.values()].filter((count) => count > 0).length;
      if (blocked > 0) {
        throw new WorkspaceValidationError(
          `Không thể gỡ ${blocked} thành viên vẫn còn công việc chưa đóng. ` +
            'Hãy chuyển giao công việc của họ trước.',
        );
      }
    }

    return this.store.member.replaceAll(actor.tenantId, projectId, actor.userId, members);
  }

  /** Vai trò của người gọi trong nhiều dự án cùng lúc. */
  private async rolesOf(
    actor: WorkspaceActor,
    projectIds: readonly string[],
  ): Promise<Map<string, ProjectRole>> {
    const roles = new Map<string, ProjectRole>();
    await Promise.all(
      projectIds.map(async (projectId) => {
        const role = await this.store.member.roleOf(actor.tenantId, projectId, actor.userId);
        if (role) roles.set(projectId, role);
      }),
    );
    return roles;
  }
}

function parseStatus(value: unknown): ProjectStatus | undefined {
  if (!value) return undefined;
  const text = String(value);
  return (PROJECT_STATUSES as readonly string[]).includes(text)
    ? (text as ProjectStatus)
    : undefined;
}

function requireText(value: unknown, label: string, maxLength: number): string {
  const text = String(value ?? '').trim();
  if (!text) throw new WorkspaceValidationError(`${label} không được để trống.`);
  if (text.length > maxLength) {
    throw new WorkspaceValidationError(`${label} không được dài quá ${maxLength} ký tự.`);
  }
  return text;
}

/** Ngày ở dạng `YYYY-MM-DD` nên so sánh chuỗi là đủ và đúng. */
function assertDateOrder(start?: string | null, end?: string | null): void {
  if (start && end && start > end) {
    throw new WorkspaceValidationError('Ngày kết thúc phải sau ngày bắt đầu.');
  }
}
